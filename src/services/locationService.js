const { setTimeout: delay } = require('node:timers/promises');

const PUBLIC_HOSTS = new Set([
    'nominatim.openstreetmap.org',
    'routing.openstreetmap.de',
    'router.project-osrm.org',
    'map.project-osrm.org',
    'test.project-osrm.org'
]);
const PUBLIC_ENDPOINTS = {
    NOMINATIM_BASE_URL: 'https://nominatim.openstreetmap.org',
    OSRM_BASE_URL: 'https://routing.openstreetmap.de/routed-car'
};
const PUBLIC_INTERVAL_MS = 1050;
const PUBLIC_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const PUBLIC_CACHE_LIMIT = 500;
const publicCache = new Map();
const publicCooldown = new Map();
const TIMEOUT_MS = 8000;
const USER_AGENT = 'ClientCoreV2/1.0 (+https://github.com/jhoutromund0/ClientCoreV2)';
const postalCodePattern = /^\d{5}-\d{3}$/;
const houseNumberPrefix = /^n(?:[.º°]+|o\b|umero\b|\s+)\s*/;
const houseNumberPattern = /^(\d{1,3}(?:\.\d{3})+|\d+)([a-z]?)$/;
const addressSeparator = /\s+[-–—]\s+/;
const STATES = {
    AC: 'Acre', AL: 'Alagoas', AP: 'Amapá', AM: 'Amazonas', BA: 'Bahia', CE: 'Ceará',
    DF: 'Distrito Federal', ES: 'Espírito Santo', GO: 'Goiás', MA: 'Maranhão', MT: 'Mato Grosso',
    MS: 'Mato Grosso do Sul', MG: 'Minas Gerais', PA: 'Pará', PB: 'Paraíba', PR: 'Paraná',
    PE: 'Pernambuco', PI: 'Piauí', RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte',
    RS: 'Rio Grande do Sul', RO: 'Rondônia', RR: 'Roraima', SC: 'Santa Catarina',
    SP: 'São Paulo', SE: 'Sergipe', TO: 'Tocantins'
};
const STREET_PREFIXES = {
    r: 'Rua', av: 'Avenida', al: 'Alameda', rod: 'Rodovia', estr: 'Estrada',
    tv: 'Travessa', trav: 'Travessa', pc: 'Praça', pca: 'Praça'
};

class LocationError extends Error {
    constructor(message, status, { retryAfter, reason } = {}) {
        super(message);
        this.name = 'LocationError';
        this.status = status;
        this.retryAfter = retryAfter;
        this.reason = reason;
    }
}

function baseUrl(variable) {
    let url;
    try {
        url = new URL(process.env[variable]);
    } catch {
        throw new LocationError('O serviço de localização não está configurado.', 503);
    }
    const hostname = url.hostname.replace(/\.$/, '');
    if (hostname === 'example' || hostname.endsWith('.example') || PUBLIC_HOSTS.has(hostname)
        || ['openstreetmap.org', 'www.openstreetmap.org', 'api.openstreetmap.org'].includes(hostname)
        || !['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash)
        throw new LocationError('O endereço do serviço de localização é inválido.', 503);
    return url;
}

function isConfigured() {
    try {
        baseUrl('NOMINATIM_BASE_URL');
        baseUrl('OSRM_BASE_URL');
        return true;
    } catch {
        return false;
    }
}

function endpoint(variable, path, params, publicLookup) {
    const url = publicLookup ? new URL(PUBLIC_ENDPOINTS[variable]) : baseUrl(variable);
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/${path}`;
    for (const [name, value] of Object.entries(params))
        url.searchParams.set(name, value);
    return url;
}

async function requestJson(url, { publicLookup, signal }) {
    signal?.throwIfAborted();
    const userAgent = publicLookup ? USER_AGENT : process.env.OSM_USER_AGENT || USER_AGENT;
    const controller = new AbortController();
    const cancel = () => controller.abort(signal.reason);
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS).unref();
    signal?.addEventListener('abort', cancel, { once: true });
    try {
        const response = await fetch(url, {
            headers: { Accept: 'application/json', 'User-Agent': userAgent },
            signal: controller.signal,
            redirect: 'error'
        });
        if (response.status === 429) {
            const header = response.headers.get('Retry-After');
            const seconds = /^\d+$/.test(header) ? Number(header) : Math.ceil((Date.parse(header) - Date.now()) / 1000);
            throw new LocationError('O serviço de localização atingiu o limite de consultas.', 503, {
                retryAfter: seconds > 0 ? seconds : undefined
            });
        }
        if (!response.ok && response.status !== 400)
            throw new LocationError('O serviço de localização está indisponível no momento.', 502);
        return { ok: response.ok, data: await response.json() };
    } catch (error) {
        signal?.throwIfAborted();
        if (error instanceof LocationError)
            throw error;
        if (error.name === 'TimeoutError' || error.name === 'AbortError')
            throw new LocationError('O serviço de localização demorou demais para responder.', 504);
        throw new LocationError('O serviço de localização não retornou uma resposta válida.', 502);
    } finally {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', cancel);
    }
}

// O cálculo público mantém o lock do PostgreSQL até a última chamada e seu intervalo terminarem.
async function requestPublicJson(url, options) {
    const remaining = Math.ceil(((publicCooldown.get(url.host) ?? 0) - Date.now()) / 1000);
    if (remaining > 0)
        throw new LocationError('O serviço público atingiu o limite de consultas.', 429, { retryAfter: remaining });
    const started = performance.now();
    try {
        return await requestJson(url, options);
    } catch (error) {
        if (error.retryAfter || error.status === 503)
            publicCooldown.set(url.host, Date.now() + (error.retryAfter || 60) * 1000);
        throw error;
    } finally {
        const wait = PUBLIC_INTERVAL_MS - (performance.now() - started);
        if (wait > 0)
            await delay(Math.ceil(wait));
    }
}

function request(url, options) {
    return options.publicLookup ? requestPublicJson(url, options) : requestJson(url, options);
}

async function cachePublic(key, lookup) {
    const cached = publicCache.get(key);
    if (cached && cached.expires > Date.now())
        return cached.value;
    const value = await lookup();
    if (value != null) {
        publicCache.delete(key);
        if (publicCache.size >= PUBLIC_CACHE_LIMIT)
            publicCache.delete(publicCache.keys().next().value);
        publicCache.set(key, { value, expires: Date.now() + PUBLIC_CACHE_TTL_MS });
    }
    return value;
}

const normalize = (value) => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const expandStreet = (value) => value.replace(/^([a-zç]{1,4})\.?\s+/i, (prefix, word) => {
    const street = STREET_PREFIXES[normalize(word)];
    return street ? `${street} ` : prefix;
});
const streetKey = (value) => normalize(expandStreet(value)).replace(/[^a-z0-9]+/g, ' ').trim();

function houseNumber(value) {
    const number = normalize(String(value ?? '')).trim().replace(houseNumberPrefix, '');
    const match = houseNumberPattern.exec(number);
    return match ? match[1].replaceAll('.', '') + match[2] : '';
}

function addressQueries(address, publicLookup) {
    const segments = address.trim().split(addressSeparator);
    const municipality = segments.findIndex((segment) => /\/[a-z]{2}$/i.test(segment));
    // A resposta do CNPJá põe complemento e bairro entre o número e o município/UF.
    const text = municipality > 0 ? [segments[0], ...segments.slice(municipality)].join(', ') : address;
    const parts = text.split(addressSeparator).join(', ')
        .replace(/\/([a-z]{2})(?=\s*(?:,|$))/gi, ', $1')
        .replace(/\b(?:CEP\s*)?(\d{5})-?(\d{3})\b/gi, '$1-$2')
        .split(',').map((part) => part.trim()).filter(Boolean);
    if (parts.length < 2)
        return null;

    parts[0] = expandStreet(parts[0]);
    const street = streetKey(parts[0]);
    const number = houseNumber(parts[1]);
    if (number)
        parts.splice(0, 2, `${parts[0]} ${number}`);
    else if (houseNumberPrefix.test(normalize(parts[1])))
        return null;
    else if (/^S\s*\/?\s*N\.?$/i.test(parts[1]))
        parts.splice(1, 1);

    if (parts.length < 2)
        return null;

    const stateIndex = parts.findIndex((part, index) => index > 1 && Object.hasOwn(STATES, part.toUpperCase()));
    const hasState = stateIndex !== -1;
    const stateCode = hasState ? parts[stateIndex].toUpperCase() : '';
    if (hasState)
        parts[stateIndex] = STATES[stateCode];
    const shortQuery = hasState ? [parts[0], parts[stateIndex - 1], parts[stateIndex]] :
        parts.filter(part => !postalCodePattern.test(part));
    const postalCode = parts.find(part => postalCodePattern.test(part));
    const firstQuery = publicLookup && hasState ? [...shortQuery, postalCode].filter(Boolean) : parts;
    const queries = new Set([firstQuery.join(', ')]);
    if (shortQuery.length >= 2)
        queries.add(shortQuery.join(', '));
    const city = hasState ? parts[stateIndex - 1] : parts.slice(1).filter(part =>
        !postalCodePattern.test(part) && !/^bra[sz]il$/i.test(part)).at(-1);
    if (!city && !postalCode)
        return null;
    return { street, number, city: city ? normalize(city) : '', stateCode, postalCode, queries };
}

const coordinate = (value) => (typeof value === 'number' || (typeof value === 'string' && value.trim())) ? Number(value) : NaN;
const postalDigits = (value) => String(value ?? '').replace(/\D/g, '');

function pointForRoute(place) {
    const lat = coordinate(place.lat);
    const lon = coordinate(place.lon);
    return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? `${lon},${lat}` : null;
}

function matchAddress(place, requested) {
    const address = place?.address;
    if (address?.country_code !== 'br')
        return null;
    if (requested.stateCode && (typeof address['ISO3166-2-lvl4'] === 'string'
        ? address['ISO3166-2-lvl4'] !== `BR-${requested.stateCode}`
        : typeof address.state !== 'string' || normalize(address.state) !== normalize(STATES[requested.stateCode])))
        return null;
    const municipalities = [address.city, address.town, address.municipality, address.village, address.hamlet];
    if (requested.city && !municipalities.some(name => typeof name === 'string' && normalize(name) === requested.city))
        return null;
    const matchedPostal = postalDigits(address.postcode);
    if (requested.postalCode && (matchedPostal || !requested.city) && matchedPostal !== postalDigits(requested.postalCode))
        return null;
    const street = address.road || address.pedestrian || address.residential || address.square || place.name;
    if (typeof street !== 'string' || !street.trim())
        return null;
    const name = streetKey(street);
    const suffix = requested.street.slice(name.length).trim();
    const inlineNumber = houseNumber(suffix);
    if (requested.street !== name && !(requested.street.startsWith(`${name} `) && inlineNumber))
        return null;

    const expectedNumber = requested.number || inlineNumber;
    const matchedNumber = String(address.house_number ?? '').trim();
    const matchesNumber = expectedNumber ? expectedNumber === houseNumber(matchedNumber)
        : !matchedNumber && (place.category === 'highway' || place.addresstype === 'road');
    if (!matchesNumber)
        return null;
    return pointForRoute(place);
}

async function searchPlaces(params, options) {
    const url = endpoint('NOMINATIM_BASE_URL', 'search', {
        ...params, format: 'jsonv2', addressdetails: '1', countrycodes: 'br', limit: '5', 'accept-language': 'pt-BR'
    }, options.publicLookup);
    const response = await request(url, options);
    if (!response.ok || !Array.isArray(response.data))
        throw new LocationError('O serviço de geocodificação retornou uma resposta inesperada.', 502);
    return response.data;
}

async function geocodePostalCode(requested, options) {
    const places = await searchPlaces({ postalcode: requested.postalCode, country: 'Brasil' }, options);
    const digits = postalDigits(requested.postalCode);
    for (const place of places) {
        const address = place?.address;
        if (address?.country_code !== 'br' || !postalDigits(address.postcode).startsWith(digits))
            continue;
        const state = address['ISO3166-2-lvl4'];
        if (requested.stateCode && typeof state === 'string' && state.startsWith('BR-') && state !== `BR-${requested.stateCode}`)
            continue;
        const municipalities = [address.city, address.town, address.municipality].filter(name => typeof name === 'string' && name.trim());
        if (requested.city && municipalities.length && !municipalities.some(name => normalize(name.trim()) === requested.city))
            continue;
        const point = pointForRoute(place);
        if (point)
            return point;
    }
    return null;
}

async function geocode(address, options) {
    const requested = typeof address === 'string' && addressQueries(address, options.publicLookup);
    if (!requested)
        return null;
    for (const query of requested.queries) {
        for (const place of await searchPlaces({ q: query }, options)) {
            const point = matchAddress(place, requested);
            if (point)
                return point;
        }
    }
    return requested.postalCode ? geocodePostalCode(requested, options) : null;
}

async function routeDistanceKm(origin, destination, options) {
    const url = endpoint('OSRM_BASE_URL', `route/v1/driving/${origin};${destination}`, {
        overview: 'false', steps: 'false', skip_waypoints: 'true', generate_hints: 'false'
    }, options.publicLookup);
    const { ok, data } = await request(url, options);
    if (data?.code === 'NoRoute' || data?.code === 'NoSegment')
        return null;
    const distance = data?.routes?.[0]?.distance;
    if (!ok || data?.code !== 'Ok' || !Number.isFinite(distance) || distance < 0
        || !Number.isSafeInteger(Math.round(distance * 2000)))
        throw new LocationError('O serviço de rotas retornou uma resposta inesperada.', 502);
    return Math.round(distance * 1000) / 1000000;
}

function createDistanceLookup(options = {}) {
    const points = new Map();
    async function locate(address) {
        if (!points.has(address)) {
            const lookup = () => geocode(address, options);
            points.set(address, options.publicLookup ? await cachePublic(`address:${address}`, lookup) : await lookup());
        }
        return points.get(address);
    }

    return async function drivingDistanceKm(originAddress, destinationAddress) {
        options.signal?.throwIfAborted();
        const from = await locate(originAddress);
        if (!from)
            throw new LocationError('Endereço de partida não localizado.', 422, { reason: 'origin_not_found' });
        const to = await locate(destinationAddress);
        if (!to)
            throw new LocationError('Endereço de destino não localizado.', 422, { reason: 'address_not_found' });
        const lookup = () => routeDistanceKm(from, to, options);
        return options.publicLookup ? cachePublic(`route:${from};${to}`, lookup) : lookup();
    };
}

module.exports = { createDistanceLookup, isConfigured, LocationError };
