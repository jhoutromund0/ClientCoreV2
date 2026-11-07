/**
 * Consulta pública de CNPJ via CNPJá Open API (https://open.cnpja.com/office/:cnpj).
 * - Sem autenticação; limite do provedor: 5 consultas por minuto por IP.
 * - Por isso há cache em memória e um limitador próprio (evita estourar o limite e tomar 429).
 * Obs.: use os dados respeitando os Termos de Uso do CNPJá e a legislação aplicável.
 */
const BASE_URL = () => (process.env.CNPJA_BASE_URL || 'https://open.cnpja.com/office').replace(/\/+$/, '');
const TIMEOUT_MS = () => Number(process.env.CNPJA_TIMEOUT_MS || 8000);
const CACHE_TTL_MS = 60 * 60 * 1000;
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60 * 1000;
const cache = new Map(); // cnpj -> { data, expires }
let calls = []; // timestamps das chamadas feitas ao provedor
class CnpjError extends Error {
    constructor(status, message, extra = {}) {
        super(message);
        this.name = 'CnpjError';
        this.status = status;
        Object.assign(this, extra);
    }
}
const onlyDigits = (value) => String(value || '').replace(/\D/g, '');
function isValidCnpj(value) {
    const cnpj = onlyDigits(value);
    if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj))
        return false;
    const check = (length) => {
        const weights = length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
        const sum = weights.reduce((acc, weight, i) => acc + Number(cnpj[i]) * weight, 0);
        const rest = sum % 11;
        return rest < 2 ? 0 : 11 - rest;
    };
    return check(12) === Number(cnpj[12]) && check(13) === Number(cnpj[13]);
}
function formatCnpj(value) {
    const d = onlyDigits(value);
    return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}
function formatPhone(phone) {
    if (!phone || !phone.number)
        return '';
    const area = onlyDigits(phone.area);
    const number = onlyDigits(phone.number);
    const formatted = number.length > 4 ? `${number.slice(0, -4)}-${number.slice(-4)}` : number;
    return area ? `(${area}) ${formatted}` : formatted;
}
// Converte a resposta do CNPJá nos campos usados pelo formulário de clientes.
function mapOffice(office) {
    const company = office.company || {};
    const address = office.address || {};
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
        phone: formatPhone(office.phones && office.phones[0]),
        status: (office.status && office.status.text) || '',
        address: addressLine
    };
}
function takeRateSlot() {
    const now = Date.now();
    calls = calls.filter((t) => now - t < RATE_WINDOW_MS);
    if (calls.length >= RATE_LIMIT) {
        return Math.ceil((RATE_WINDOW_MS - (now - calls[0])) / 1000);
    }
    calls.push(now);
    return 0;
}
async function lookup(rawCnpj) {
    const cnpj = onlyDigits(rawCnpj);
    if (!isValidCnpj(cnpj))
        throw new CnpjError(400, 'CNPJ inválido. Confira os 14 dígitos informados.');
    const cached = cache.get(cnpj);
    if (cached && cached.expires > Date.now())
        return { ...cached.data, cached: true };
    const wait = takeRateSlot();
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
        const retryAfter = Number(response.headers.get('retry-after')) || 60;
        throw new CnpjError(429, `O serviço de consulta atingiu o limite. Tente novamente em ${retryAfter}s.`, { retryAfter });
    }
    if (!response.ok)
        throw new CnpjError(502, 'O serviço de consulta de CNPJ está indisponível no momento.');
    let office;
    try {
        office = await response.json();
    }
    catch (err) {
        throw new CnpjError(502, 'Resposta inesperada do serviço de consulta de CNPJ.');
    }
    if (!office || typeof office !== 'object')
        throw new CnpjError(502, 'Resposta inesperada do serviço de consulta de CNPJ.');
    const data = mapOffice({ taxId: cnpj, ...office });
    data.cnpj = formatCnpj(cnpj);
    cache.set(cnpj, { data, expires: Date.now() + CACHE_TTL_MS });
    return { ...data, cached: false };
}
function _resetForTests() { cache.clear(); calls = []; }
module.exports = { lookup, isValidCnpj, onlyDigits, formatCnpj, mapOffice, CnpjError, _resetForTests };
