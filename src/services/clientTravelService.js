const { setTimeout: delay } = require('node:timers/promises');
const { pool } = require('../config/database');
const Client = require('../models/Client');
const VisitTravel = require('../models/VisitTravel');
const TransportSettings = require('../models/TransportSettings');
const location = require('./locationService');

const kilometers = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
const reais = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const statuses = {
    address_not_found: 'Endereço do cliente não localizado. Confira o cadastro.',
    origin_not_found: 'Endereço da empresa não localizado. Confira as configurações.',
    route_not_found: 'Rota de carro indisponível para este endereço.',
    temporarily_unavailable: 'Serviço de rotas indisponível. Tente novamente mais tarde.'
};
const pending = { statusMessage: 'Quilometragem a calcular.', canCalculate: true };

const validMeters = meters => Number.isFinite(meters) && meters >= 0 && Number.isSafeInteger(Math.round(meters * 1000));
const kilometersToMeters = km => Math.round(km * 1000000) / 1000;

function describe(client, settings, addressError = statuses.address_not_found) {
    const address = client.address;
    if (typeof address !== 'string' || !address.trim())
        return { statusMessage: 'Informe o endereço para calcular o deslocamento.' };

    const travel = client.travel;
    if (travel?.revision !== settings.revision || travel.address !== address)
        return pending;
    if (travel.status !== 'ready')
        return {
            statusMessage: travel.status === 'address_not_found' ? addressError : (statuses[travel.status] || pending.statusMessage),
            canCalculate: true
        };
    if (!validMeters(travel.outboundMeters) || !validMeters(travel.roundTripMeters)
        || travel.roundTripMeters < travel.outboundMeters)
        return pending;

    return {
        statusMessage: travel.outboundCostCents == null ? 'Tarifa por km pendente.' : '',
        outboundKm: `${kilometers.format(travel.outboundMeters / 1000)} km`,
        roundTripKm: `${kilometers.format(travel.roundTripMeters / 1000)} km`,
        outboundCost: travel.outboundCostCents == null ? '' : reais.format(travel.outboundCostCents / 100),
        roundTripCost: travel.roundTripCostCents == null ? '' : reais.format(travel.roundTripCostCents / 100)
    };
}

function travelCostCents(meters, rate) {
    if (!validMeters(meters) || !Number.isSafeInteger(rate) || rate < 0)
        return null;
    const millimeters = Math.round(meters * 1000);
    const cents = (BigInt(millimeters) * BigInt(rate) + 500000n) / 1000000n;
    const amount = Number(cents);
    return Number.isSafeInteger(amount) ? amount : null;
}

function priceRoute(travel, distances, rate) {
    const { outboundMeters, returnMeters } = distances;
    const roundTripMeters = Math.round((outboundMeters + returnMeters) * 1000) / 1000;
    return {
        ...travel,
        status: 'ready',
        outboundMeters,
        returnMeters,
        roundTripMeters,
        outboundCostCents: travelCostCents(outboundMeters, rate),
        roundTripCostCents: travelCostCents(roundTripMeters, rate)
    };
}

function reusableRoute(result, address, originAddress) {
    return result?.address === address && result.originAddress === originAddress && result.status === 'ready'
        && validMeters(result.outboundMeters) && validMeters(result.returnMeters)
        && validMeters(result.outboundMeters + result.returnMeters);
}

async function resolveTravel(address, settings, reusable, distanceKm) {
    const { originAddress, revision, rateCentsPerKm } = settings;
    const travel = { address, originAddress, revision };
    if (reusable)
        return priceRoute(travel, reusable, rateCentsPerKm);

    try {
        const outboundKm = await distanceKm(originAddress, address);
        if (outboundKm === null)
            return { ...travel, status: 'route_not_found' };
        const returnKm = address === originAddress ? outboundKm : await distanceKm(address, originAddress);
        if (returnKm === null)
            return { ...travel, status: 'route_not_found' };
        const outboundMeters = kilometersToMeters(outboundKm);
        const returnMeters = kilometersToMeters(returnKm);
        return priceRoute(travel, { outboundMeters, returnMeters }, rateCentsPerKm);
    } catch (error) {
        if (!(error instanceof location.LocationError))
            throw error;
        if (error.reason)
            return { ...travel, status: error.reason };
        const delay = Math.min(2147483647, Math.max(60, error.retryAfter || 0) * 1000);
        return { ...travel, status: 'temporarily_unavailable', retryAfter: Date.now() + delay };
    }
}

async function processBatch(run, signal) {
    const settings = await TransportSettings.get(run);
    const configured = location.isConfigured();
    const jobs = [];
    async function collect(cachedOrigin, limit) {
        for (const store of [Client, VisitTravel]) {
            for (const record of await store.pendingTravel(settings.revision, limit, cachedOrigin, run))
                jobs.push({ store, record });
        }
    }
    await collect(settings.originAddress, 25);
    if (!jobs.length && configured)
        await collect(null, 5);
    const routes = new Map();
    const distanceKm = location.createDistanceLookup({ signal });
    let worked = false;
    for (const { store, record } of jobs) {
        signal.throwIfAborted();
        const { address } = record;
        const reusable = [routes.get(address), record.travel, record.clientTravel].find(result =>
            reusableRoute(result, address, settings.originAddress));
        if (!reusable && !configured)
            continue;
        const result = await resolveTravel(address, settings, reusable, distanceKm);
        signal.throwIfAborted();
        if (result.status === 'ready')
            routes.set(address, result);
        worked = await store.saveTravel(record.id, address, result, run) || worked;
        if (result.status === 'temporarily_unavailable')
            return Math.max(0, result.retryAfter - Date.now());
    }
    return worked ? 1000 : 5000;
}

async function withTravelLock(work, busy) {
    // A sessão que segura o lock fica reservada até o lote terminar.
    const connection = await pool.connect();
    const lockKey = 'clientcore.transport';
    let locked = false;
    let releaseError;
    try {
        const { rows } = await connection.query('SELECT pg_try_advisory_lock(hashtext($1)) AS locked', [lockKey]);
        locked = rows[0].locked;
        return locked ? await work(connection.query.bind(connection)) : busy;
    } finally {
        if (locked) {
            try {
                await connection.query('SELECT pg_advisory_unlock(hashtext($1))', [lockKey]);
            } catch (error) {
                releaseError = error;
            }
        }
        connection.release(releaseError);
    }
}

async function calculateClientTravel(id, { publicUse, expectedAddress, expectedRevision }) {
    const changed = { type: 'error', message: 'Os dados do deslocamento mudaram. Confira os endereços e tente novamente.' };
    const busy = { type: 'info', message: 'Há outro deslocamento em cálculo. Tente novamente em instantes.' };
    return withTravelLock(async run => {
        const client = await Client.find(id, run);
        if (!client)
            return null;
        const { address, travel: previous } = client;
        if (!address)
            return { type: 'error', message: 'Cadastre o endereço do cliente antes de calcular a quilometragem.' };
        const settings = await TransportSettings.get(run);
        const { originAddress, revision } = settings;
        if (expectedAddress !== address || expectedRevision !== revision)
            return changed;

        const reusable = reusableRoute(previous, address, originAddress);
        const publicLookup = !location.isConfigured();
        const sameRoute = previous?.address === address && previous.originAddress === originAddress;
        if (!reusable && publicLookup && !publicUse)
            return { type: 'error', message: 'Confirme que os endereços são públicos e a consulta é para uso não comercial.' };
        if (sameRoute && previous.status === 'temporarily_unavailable' && previous.retryAfter > Date.now())
            return { type: 'error', message: statuses.temporarily_unavailable };

        const distanceKm = location.createDistanceLookup({ publicLookup });
        const result = await resolveTravel(address, settings, reusable ? previous : null, distanceKm);
        if (!await Client.saveTravel(id, address, result, run))
            return changed;
        if (result.status === 'ready')
            return { type: 'success', message: 'Quilometragem do cliente calculada.' };
        return { type: 'error', message: statuses[result.status] };
    }, busy);
}

async function runWorker(signal) {
    let wait = 0;
    while (!signal.aborted) {
        try {
            await delay(wait, undefined, { signal, ref: false });
            wait = await withTravelLock(run => processBatch(run, signal), 5000);
        } catch (error) {
            if (signal.aborted)
                return;
            console.error('Não foi possível atualizar as rotas dos atendimentos e clientes.', error.code || error.name);
            wait = 60000;
        }
    }
}

function start() {
    const stop = new AbortController();
    const running = runWorker(stop.signal);
    return () => {
        stop.abort();
        return running;
    };
}

module.exports = { describe, calculateClientTravel, start, travelCostCents };
