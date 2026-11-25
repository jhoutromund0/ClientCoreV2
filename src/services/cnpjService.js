const RATE_WINDOW_MS = 60_000;
const REQUESTS_PER_USER = 12;
const PROVIDER_REQUESTS_PER_USER = 2;
const PROVIDER_REQUESTS_TOTAL = 5;
const providerKey = 'provider';
const BASE_URL = () => (process.env.CNPJA_BASE_URL || 'https://open.cnpja.com/office').replace(/\/+$/, '');
const TIMEOUT_MS = () => Number(process.env.CNPJA_TIMEOUT_MS || 8000);

class CnpjError extends Error {
    constructor(status, message, extra = {}) {
        super(message);
        this.name = 'CnpjError';
        this.status = status;
        Object.assign(this, extra);
    }
}
const onlyDigits = (value) => String(value || '').replace(/\D/g, '');
const normalizeCnpj = (value) => String(value || '').replace(/[./\s-]/g, '').toUpperCase();
function isValidCnpj(value) {
    const cnpj = normalizeCnpj(value);
    if (!/^[A-Z0-9]{12}\d{2}$/.test(cnpj) || /^(\d)\1{13}$/.test(cnpj))
        return false;
    const check = (length) => {
        const weights = length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
        // O cálculo oficial usa o código ASCII de cada caractere menos 48.
        const sum = weights.reduce((acc, weight, i) => acc + (cnpj.charCodeAt(i) - 48) * weight, 0);
        const rest = sum % 11;
        return rest < 2 ? 0 : 11 - rest;
    };
    return check(12) === Number(cnpj[12]) && check(13) === Number(cnpj[13]);
}
function formatCnpj(value) {
    return normalizeCnpj(value).replace(/^([A-Z0-9]{2})([A-Z0-9]{3})([A-Z0-9]{3})([A-Z0-9]{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}
function formatPhone(phone) {
    if (!phone || !phone.number)
        return '';
    const area = onlyDigits(phone.area);
    const number = onlyDigits(phone.number);
    const formatted = number.length > 4 ? `${number.slice(0, -4)}-${number.slice(-4)}` : number;
    return area ? `(${area}) ${formatted}` : formatted;
}
function mapOffice(office) {
    const company = office.company || {};
    const address = office.address || {};
    const phones = Array.isArray(office.phones) ? office.phones : [];
    const phone = phones.find((contact) => onlyDigits(contact?.number));
    let establishmentType = '';
    if (typeof office.head === 'boolean')
        establishmentType = office.head ? 'matriz' : 'filial';
    const addressLine = [
        [address.street, address.number].filter(Boolean).join(', '),
        address.details,
        address.district,
        [address.city, address.state].filter(Boolean).join('/'),
        address.zip ? `CEP ${address.zip}` : ''
    ].filter(Boolean).join(' - ');
    return {
        cnpj: formatCnpj(office.taxId),
        company: company.name || office.alias || '',
        alias: office.alias || '',
        email: (office.emails && office.emails[0] && office.emails[0].address) || '',
        phone: formatPhone(phone),
        status: (office.status && office.status.text) || '',
        address: addressLine,
        establishmentType
    };
}
async function lockRate(client, key, limit) {
    const { rows: [rate] } = await client.query(`
        INSERT INTO cnpj_lookup_limits (key) VALUES ($1)
        ON CONFLICT (key) DO UPDATE SET updated_at = clock_timestamp()
        RETURNING hits, cooldown_until, clock_timestamp() AS now
    `, [key]);
    const now = rate.now.getTime();
    const hits = rate.hits.filter(hit => hit.getTime() > now - RATE_WINDOW_MS);
    const windowEnd = hits.length >= limit ? hits[0].getTime() + RATE_WINDOW_MS : now;
    const until = Math.max(windowEnd, rate.cooldown_until?.getTime() ?? now);
    return { key, hits: [...hits, rate.now], wait: Math.ceil((until - now) / 1000) };
}

function recordHits(client, rate) {
    return client.query('UPDATE cnpj_lookup_limits SET hits = $2 WHERE key = $1', [rate.key, rate.hits]);
}

async function reserve(cnpj, userId) {
    const { withTransaction } = require('../config/database');
    return withTransaction(async (client) => {
        const userRate = await lockRate(client, `user:${userId}`, REQUESTS_PER_USER);
        if (userRate.wait)
            return { wait: userRate.wait };
        await recordHits(client, userRate);
        const { rows: [cached] } = await client.query(
            'SELECT data FROM cnpj_lookup_cache WHERE cnpj = $1 AND expires_at > NOW()', [cnpj]
        );
        if (cached)
            return { cached: cached.data };
        const userMisses = await lockRate(client, `user-provider:${userId}`, PROVIDER_REQUESTS_PER_USER);
        if (userMisses.wait)
            return { wait: userMisses.wait };
        const provider = await lockRate(client, providerKey, PROVIDER_REQUESTS_TOTAL);
        if (provider.wait)
            return { wait: provider.wait };
        await recordHits(client, userMisses);
        await recordHits(client, provider);
        return {};
    });
}

function providerWait(value) {
    if (/^\d+$/.test(value))
        return Math.min(86400, Math.max(1, Number(value)));
    const date = Date.parse(value);
    return Number.isFinite(date) ? Math.min(86400, Math.max(1, Math.ceil((date - Date.now()) / 1000))) : 60;
}

async function lookup(rawCnpj, userId) {
    const cnpj = normalizeCnpj(rawCnpj);
    if (!isValidCnpj(cnpj))
        throw new CnpjError(400, 'CNPJ inválido. Confira os 14 caracteres informados.');
    const { query } = require('../config/database');
    const { cached, wait } = await reserve(cnpj, userId);
    if (cached)
        return { ...cached, cached: true };
    if (wait)
        throw new CnpjError(429, `Limite de consultas atingido. Tente novamente em ${wait}s.`, { retryAfter: wait });
    let response;
    try {
        response = await fetch(`${BASE_URL()}/${cnpj}`, {
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(TIMEOUT_MS())
        });
    }
    catch (err) {
        if (err.name === 'TimeoutError' || err.name === 'AbortError')
            throw new CnpjError(504, 'O serviço de consulta demorou demais para responder. Tente novamente.');
        throw new CnpjError(502, 'Não foi possível contatar o serviço de consulta de CNPJ.');
    }
    if (response.status === 404)
        throw new CnpjError(404, 'CNPJ não encontrado na base da Receita Federal.');
    if (response.status === 429) {
        const retryAfter = providerWait(response.headers.get('retry-after'));
        await query(`
            INSERT INTO cnpj_lookup_limits (key, cooldown_until)
            VALUES ($1, NOW() + make_interval(secs => $2))
            ON CONFLICT (key) DO UPDATE SET cooldown_until = GREATEST(cnpj_lookup_limits.cooldown_until, EXCLUDED.cooldown_until)
        `, [providerKey, retryAfter]);
        throw new CnpjError(429, `O serviço de consulta atingiu o limite. Tente novamente em ${retryAfter}s.`, { retryAfter });
    }
    if (!response.ok)
        throw new CnpjError(502, 'O serviço de consulta de CNPJ está indisponível no momento.');
    let office;
    try {
        office = await response.json();
    } catch {
        throw new CnpjError(502, 'Resposta inesperada do serviço de consulta de CNPJ.');
    }
    if (!office || typeof office !== 'object' || Array.isArray(office))
        throw new CnpjError(502, 'Resposta inesperada do serviço de consulta de CNPJ.');
    const data = mapOffice({ ...office, taxId: cnpj });
    await query(`
        INSERT INTO cnpj_lookup_cache (cnpj, data, expires_at)
        VALUES ($1, $2::jsonb, NOW() + INTERVAL '1 hour')
        ON CONFLICT (cnpj) DO UPDATE SET data = EXCLUDED.data, expires_at = EXCLUDED.expires_at
    `, [cnpj, JSON.stringify(data)]);
    return { ...data, cached: false };
}
module.exports = { lookup, isValidCnpj, CnpjError };
