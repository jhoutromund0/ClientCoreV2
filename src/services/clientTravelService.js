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

function describe(client, settings, addressError = statuses.address_not_found) {
    const address = client.address;
    if (typeof address !== 'string' || !address.trim())
        return { statusMessage: 'Informe o endereço para calcular o deslocamento.' };

    const travel = client.travel;
    if (travel?.revision !== settings.revision || travel.address !== address) {
        return {
            statusMessage: location.isConfigured()
                ? 'Cálculo de deslocamento pendente.'
                : 'Quilometragem a calcular.',
            canCalculate: true
        };
    }
    if (travel.status !== 'ready')
        return {
            statusMessage: travel.status === 'address_not_found' ? addressError : (statuses[travel.status] || 'Cálculo de deslocamento pendente.'),
            canCalculate: true
        };

    return {
        statusMessage: travel.outboundCostCents == null ? 'Tarifa por km pendente.' : '',
        outboundKm: `${kilometers.format(travel.outboundMeters / 1000)} km`,
        roundTripKm: `${kilometers.format(travel.roundTripMeters / 1000)} km`,
        outboundCost: travel.outboundCostCents == null ? '' : reais.format(travel.outboundCostCents / 100),
        roundTripCost: travel.roundTripCostCents == null ? '' : reais.format(travel.roundTripCostCents / 100)
    };
}

function travelCostCents(meters, rate) {
    if (!Number.isFinite(meters) || meters < 0 || !Number.isSafeInteger(rate) || rate < 0)
        return null;
    const millimeters = Math.round(meters * 1000);
    if (!Number.isSafeInteger(millimeters))
        return null;
    const cents = (BigInt(millimeters) * BigInt(rate) + 500000n) / 1000000n;
    const amount = Number(cents);
    return Number.isSafeInteger(amount) ? amount : null;
}

function priceRoute(travel, distances, rate) {
    const { outboundMeters, returnMeters } = distances;
    const roundTripMeters = outboundMeters + returnMeters;
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
        && Number.isFinite(result.outboundMeters) && Number.isFinite(result.returnMeters);
}

async function resolveTravel(travel, origin, rate, service) {
    if (!origin)
        return { ...travel, status: 'origin_not_found' };

    travel.destination ??= travel.address === travel.originAddress ? origin : await service.geocode(travel.address);
    if (!travel.destination)
        return { ...travel, status: 'address_not_found' };

    const distances = await service.drivingDistances(origin, travel.destination);
    return distances ? priceRoute(travel, distances, rate) : { ...travel, status: 'route_not_found' };
}

function retryDelay(error) {
    return Math.min(2147483647, Math.max(60, error.retryAfter || 0) * 1000);
}

async function processBatch(run) {
    const settings = await TransportSettings.get(run);
    const jobs = [];
    async function collect(cachedOrigin, limit) {
        for (const store of [Client, VisitTravel]) {
            for (const record of await store.pendingTravel(settings.revision, limit, cachedOrigin, run))
                jobs.push({ store, record });
        }
    }
    await collect(settings.originAddress, 25);
    if (!jobs.length && location.isConfigured())
        await collect(null, 5);
    const routes = new Map();
    let origin;
    for (const { store, record } of jobs) {
        const { address } = record;
        const previous = [record.travel, record.clientTravel].find(result => result?.address === address);
        const reusable = [routes.get(address), record.travel, record.clientTravel].find(result =>
            reusableRoute(result, address, settings.originAddress));
        const travel = {
            revision: settings.revision,
            address,
            originAddress: settings.originAddress,
            destination: reusable?.destination ?? previous?.destination ?? null
        };

        let result;
        try {
            if (reusable) {
                result = priceRoute(travel, reusable, settings.rateCentsPerKm);
            } else {
                if (origin === undefined)
                    origin = await location.geocode(settings.originAddress);
                result = await resolveTravel(travel, origin, settings.rateCentsPerKm, location);
            }
        } catch (error) {
            if (!(error instanceof location.LocationError))
                throw error;
            const delay = retryDelay(error);
            await store.saveTravel(record.id, address, {
                ...travel, status: 'temporarily_unavailable', retryAfter: Date.now() + delay
            }, run);
            return delay;
        }

        if (result.status === 'ready')
            routes.set(address, result);
        await store.saveTravel(record.id, address, result, run);
    }
    return jobs.length ? 1000 : 5000;
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

function refreshPendingTravel() {
    return withTravelLock(processBatch, 5000);
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
        const { originAddress, revision, rateCentsPerKm } = settings;
        if (expectedAddress !== address || expectedRevision !== revision)
            return changed;

        const reusable = reusableRoute(previous, address, originAddress);
        const publicLookup = !location.isConfigured();
        const sameRoute = previous?.address === address && previous.originAddress === originAddress;
        if (!reusable && publicLookup && !publicUse)
            return { type: 'error', message: 'Confirme que os endereços são públicos e a consulta é para uso não comercial.' };
        if (sameRoute && previous.status === 'temporarily_unavailable' && previous.retryAfter > Date.now())
            return { type: 'error', message: statuses.temporarily_unavailable };

        const travel = { address, originAddress, revision, destination: sameRoute ? previous.destination : null };
        let result;
        try {
            if (reusable) {
                result = priceRoute(travel, previous, rateCentsPerKm);
            } else {
                const service = publicLookup ? location.publicServices : location;
                const origin = await service.geocode(originAddress);
                result = await resolveTravel(travel, origin, rateCentsPerKm, service);
            }
        } catch (error) {
            if (!(error instanceof location.LocationError))
                throw error;
            result = { ...travel, status: 'temporarily_unavailable', retryAfter: Date.now() + retryDelay(error) };
        }
        if (!await Client.saveTravel(id, address, result, run))
            return changed;
        if (result.status === 'ready')
            return { type: 'success', message: 'Quilometragem do cliente calculada.' };
        return { type: 'error', message: statuses[result.status] };
    }, busy);
}

function start() {
    let stopped = false;
    let timer;
    let running;
    async function tick() {
        let delay = 60000;
        try {
            delay = await refreshPendingTravel();
        } catch (error) {
            console.error('Não foi possível atualizar as rotas dos atendimentos e clientes.', error.code || error.name);
        } finally {
            if (!stopped)
                timer = setTimeout(run, delay).unref();
        }
    }
    function run() {
        running = tick();
    }
    timer = setTimeout(run, 0).unref();
    return () => {
        stopped = true;
        clearTimeout(timer);
        return running;
    };
}

module.exports = { describe, calculateClientTravel, refreshPendingTravel, start, travelCostCents };
