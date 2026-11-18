const PUBLIC_HOSTS = new Set([
    'nominatim.openstreetmap.org',
    'routing.openstreetmap.de',
    'router.project-osrm.org',
    'map.project-osrm.org',
    'test.project-osrm.org'
]);
const TIMEOUT_MS = 8000;
const USER_AGENT = 'ClientCoreV2/1.0 (+https://github.com/jhoutromund0/ClientCoreV2)';
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
    constructor(message, status, retryAfter) {
        super(message);
        this.name = 'LocationError';
        this.status = status;
        this.retryAfter = retryAfter;
    }
}

function baseUrl(variable) {
    let url;
    try {
        url = new URL(process.env[variable]);
    }
    catch {
        throw new LocationError(`Configure ${variable} com o endereço do serviço de localização.`, 503);
    }
    if (PUBLIC_HOSTS.has(url.hostname.replace(/\.$/, '')))
        throw new LocationError(`Use uma instância própria ou contratada em ${variable} para consultar endereços em lote.`, 503);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash)
        throw new LocationError(`O endereço configurado em ${variable} é inválido.`, 503);
    return url;
}

function isConfigured() {
    try {
        baseUrl('NOMINATIM_BASE_URL');
        baseUrl('OSRM_BASE_URL');
        return true;
    }
    catch {
        return false;
    }
}

function endpoint(variable, path, params) {
    const url = baseUrl(variable);
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/${path}`;
    for (const [name, value] of Object.entries(params))
        url.searchParams.set(name, value);
    return url;
}

async function requestJson(url) {
    try {
        const response = await fetch(url, {
            headers: { Accept: 'application/json', 'User-Agent': process.env.OSM_USER_AGENT || USER_AGENT },
            signal: AbortSignal.timeout(TIMEOUT_MS),
            redirect: 'error'
        });
        if (response.status === 429) {
            const header = response.headers.get('Retry-After');
            const seconds = /^\d+$/.test(header) ? Number(header) : Math.ceil((Date.parse(header) - Date.now()) / 1000);
            throw new LocationError('O serviço de localização atingiu o limite de consultas.', 503, seconds > 0 ? seconds : undefined);
        }
        if (!response.ok && response.status !== 400)
            throw new LocationError('O serviço de localização está indisponível no momento.', 502);
        return { ok: response.ok, data: await response.json() };
    }
    catch (error) {
        if (error instanceof LocationError)
            throw error;
        if (error.name === 'TimeoutError' || error.name === 'AbortError')
            throw new LocationError('O serviço de localização demorou demais para responder.', 504);
        throw new LocationError('O serviço de localização não retornou uma resposta válida.', 502);
    }
}

const normalize = (value) => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const expandStreet = (value) => value.replace(/^([a-zç]{1,4})\.?\s+/i, (prefix, word) => {
    const street = STREET_PREFIXES[normalize(word)];
    return street ? `${street} ` : prefix;
});
const streetKey = (value) => normalize(expandStreet(value)).replace(/[^a-z0-9]+/g, ' ').trim();

function addressQueries(address) {
    const segments = address.trim().split(/\s+-\s+/);
    const municipality = segments.findIndex((segment) => /\/[a-z]{2}$/i.test(segment));
    // A resposta do CNPJá põe complemento e bairro entre o número e o município/UF.
    const text = municipality > 0 ? [segments[0], ...segments.slice(municipality)].join(', ') : address;
    const parts = text
        .replace(/\s+-\s+/g, ', ')
        .replace(/\/([a-z]{2})(?=\s*(?:,|$))/gi, ', $1')
        .replace(/\b(?:CEP\s*)?(\d{5})-?(\d{3})\b/gi, '$1-$2')
        .split(',').map((part) => part.trim()).filter(Boolean);
    if (parts.length < 2)
        return null;

    parts[0] = expandStreet(parts[0]);
    const number = /^\d+[a-z]?$/i.test(parts[1]) ? parts[1] : '';
    if (number)
        parts.splice(0, 2, `${parts[0]} ${number}`);
    else if (/^S\s*\/?\s*N\.?$/i.test(parts[1]))
        parts.splice(1, 1);

    const uf = parts.findIndex((part, index) => index > 1 && Object.hasOwn(STATES, part.toUpperCase()));
    const stateCode = uf === -1 ? '' : parts[uf].toUpperCase();
    if (uf !== -1)
        parts[uf] = STATES[stateCode];
    const simplified = uf > 1 ? [parts[0], ...parts.slice(uf - 1, uf + 1)] : parts.filter((part) => !/^\d{5}-\d{3}$/.test(part));
    if (parts.length < 2)
        return null;
    const queries = new Set([parts.join(', ')]);
    if (simplified.length >= 2)
        queries.add(simplified.join(', '));
    const city = uf > 1 ? normalize(parts[uf - 1]) : '';
    return { street: streetKey(parts[0]), number, city, stateCode, queries };
}

const validCoordinates = (point) => point && Number.isFinite(point.lat) && Math.abs(point.lat) <= 90
    && Number.isFinite(point.lon) && Math.abs(point.lon) <= 180;
const coordinate = (value) => (typeof value === 'number' || (typeof value === 'string' && value.trim())) ? Number(value) : NaN;

function matchAddress(place, requested) {
    const address = place?.address;
    if (address?.country_code !== 'br')
        return null;
    const state = address['ISO3166-2-lvl4'];
    if (typeof state === 'string' && state.startsWith('BR-') && requested.stateCode && state !== `BR-${requested.stateCode}`)
        return null;
    const municipalities = [address.city, address.town, address.municipality].filter(name => typeof name === 'string');
    if (requested.city && municipalities.length && !municipalities.some(name => normalize(name) === requested.city))
        return null;
    const street = address.road || address.pedestrian || address.residential || address.square || place.name;
    if (typeof street !== 'string' || !street.trim())
        return null;
    const name = streetKey(street);
    const suffix = requested.street.slice(name.length).trim();
    if (requested.street !== name && !(requested.street.startsWith(`${name} `) && /^\d+[a-z]?$/.test(suffix)))
        return null;

    const expectedNumber = requested.number || suffix;
    const matchedNumber = String(address.house_number ?? '').trim().toLowerCase();
    const exact = Boolean(matchedNumber) && (!expectedNumber || expectedNumber.toLowerCase() === matchedNumber);
    const onStreet = !matchedNumber && (place.category === 'highway' || place.addresstype === 'road');
    if (!exact && !onStreet)
        return null;
    const point = { lat: coordinate(place.lat), lon: coordinate(place.lon) };
    return validCoordinates(point) ? { point, exact } : null;
}

async function geocode(address) {
    const requested = typeof address === 'string' && addressQueries(address);
    if (!requested)
        return null;
    let streetPoint = null;
    for (const query of requested.queries) {
        const url = endpoint('NOMINATIM_BASE_URL', 'search', {
            q: query, format: 'jsonv2', addressdetails: '1', countrycodes: 'br', limit: '5', 'accept-language': 'pt-BR'
        });
        const response = await requestJson(url);
        if (!response.ok || !Array.isArray(response.data))
            throw new LocationError('O serviço de geocodificação retornou uma resposta inesperada.', 502);
        for (const place of response.data) {
            const match = matchAddress(place, requested);
            if (match?.exact)
                return match.point;
            streetPoint ??= match?.point ?? null;
        }
    }
    return streetPoint;
}

const coordinateString = (point) => `${point.lon},${point.lat}`;
const validDistance = (value) => Number.isFinite(value) && value >= 0;
const noRoute = (data) => ['NoTable', 'NoRoute', 'NoSegment'].includes(data?.code);
const routeResponseError = () => new LocationError('O serviço de rotas retornou uma resposta inesperada.', 502);

async function routeDistance(origin, destination) {
    const url = endpoint('OSRM_BASE_URL', `route/v1/driving/${origin};${destination}`, { overview: 'false', steps: 'false' });
    const { ok, data } = await requestJson(url);
    if (noRoute(data))
        return null;
    const distance = data?.routes?.[0]?.distance;
    if (!ok || data?.code !== 'Ok' || !validDistance(distance))
        throw routeResponseError();
    return distance;
}

async function drivingDistances(origin, destination) {
    if (!validCoordinates(origin) || !validCoordinates(destination))
        return null;
    const from = coordinateString(origin);
    const to = coordinateString(destination);
    const url = endpoint('OSRM_BASE_URL', `table/v1/driving/${from};${to}`, { annotations: 'distance' });
    const { ok, data } = await requestJson(url);
    if (noRoute(data))
        return null;
    if (data?.code === 'NotImplemented' || (ok && data?.code === 'Ok' && !data.distances)) {
        // Versões antigas do OSRM podem oferecer somente duração na matriz.
        const outboundMeters = await routeDistance(from, to);
        if (outboundMeters === null)
            return null;
        const returnMeters = await routeDistance(to, from);
        return returnMeters === null ? null : { outboundMeters, returnMeters };
    }
    const outboundMeters = data?.distances?.[0]?.[1];
    const returnMeters = data?.distances?.[1]?.[0];
    if (!ok || data?.code !== 'Ok')
        throw routeResponseError();
    if (outboundMeters === null || returnMeters === null)
        return null;
    if (!validDistance(outboundMeters) || !validDistance(returnMeters))
        throw routeResponseError();
    return { outboundMeters, returnMeters };
}

module.exports = { geocode, drivingDistances, isConfigured, LocationError };
