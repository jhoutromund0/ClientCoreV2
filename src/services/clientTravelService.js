const { pool } = require('../config/database');
const Client = require('../models/Client');
const TransportSettings = require('../models/TransportSettings');
const location = require('./locationService');

const kilometers = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
const reais = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const statuses = {
    address_not_found: 'Endereço do cliente não localizado. Confira o cadastro.',
    origin_not_found: 'Endereço da empresa não localizado. Confira as configurações.',
    route_not_found: 'Rota de carro indisponível para este endereço.',
    temporarily_unavailable: 'Serviço de rotas indisponível. O cálculo será tentado novamente.'
};

function describe(client, settings) {
    const address = client.address;
    if (typeof address !== 'string' || !address.trim())
        return { statusMessage: 'Informe o endereço para calcular o deslocamento.' };

    const travel = client.travel;
    if (travel?.revision !== settings.revision || travel.address !== address) {
        return {
            statusMessage: location.isConfigured()
                ? 'Cálculo de deslocamento pendente.'
                : 'Aguardando configuração do serviço de rotas.'
        };
    }
    if (travel.status !== 'ready')
        return { statusMessage: statuses[travel.status] || 'Cálculo de deslocamento pendente.' };

    return {
        statusMessage: travel.outboundCostCents == null ? 'Tarifa por km pendente.' : '',
        outboundKm: `${kilometers.format(travel.outboundMeters / 1000)} km`,
        roundTripKm: `${kilometers.format(travel.roundTripMeters / 1000)} km`,
        outboundCost: travel.outboundCostCents == null ? '' : reais.format(travel.outboundCostCents / 100),
        roundTripCost: travel.roundTripCostCents == null ? '' : reais.format(travel.roundTripCostCents / 100)
    };
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
        outboundCostCents: rate == null ? null : Math.round(outboundMeters * rate / 1000),
        roundTripCostCents: rate == null ? null : Math.round(roundTripMeters * rate / 1000)
    };
}

async function processBatch() {
    const settings = await TransportSettings.get();
    const cached = await Client.pendingTravel(settings.revision, 25, settings.originAddress);
    const clients = cached.length || !location.isConfigured() ? cached : await Client.pendingTravel(settings.revision);
    let origin;
    for (const client of clients) {
        const address = client.address;
        const previous = client.travel?.address === address ? client.travel : null;
        const travel = {
            revision: settings.revision,
            address,
            originAddress: settings.originAddress,
            destination: previous?.destination ?? null
        };

        let result;
        try {
            if (previous?.originAddress === settings.originAddress && previous.status === 'ready') {
                result = priceRoute(travel, previous, settings.rateCentsPerKm);
            } else {
                if (origin === undefined)
                    origin = await location.geocode(settings.originAddress);
                if (!origin) {
                    result = { ...travel, status: 'origin_not_found' };
                } else {
                    travel.destination ??= address === settings.originAddress ? origin : await location.geocode(address);
                    if (!travel.destination) {
                        result = { ...travel, status: 'address_not_found' };
                    } else {
                        const distances = await location.drivingDistances(origin, travel.destination);
                        result = distances ? priceRoute(travel, distances, settings.rateCentsPerKm)
                            : { ...travel, status: 'route_not_found' };
                    }
                }
            }
        } catch (error) {
            if (!(error instanceof location.LocationError))
                throw error;
            const delay = Math.min(2147483647, Math.max(60, error.retryAfter || 0) * 1000);
            await Client.saveTravel(client.id, address, {
                ...travel, status: 'temporarily_unavailable', retryAfter: Date.now() + delay
            });
            return delay;
        }

        if (!await Client.saveTravel(client.id, address, result))
            break;
    }
    return clients.length ? 1000 : 5000;
}

async function refreshPendingTravel() {
    // A sessão que segura o lock fica reservada até o lote terminar.
    const connection = await pool.connect();
    const lockKey = 'clientcore.transport';
    let locked = false;
    let releaseError;
    try {
        const { rows } = await connection.query('SELECT pg_try_advisory_lock(hashtext($1)) AS locked', [lockKey]);
        locked = rows[0].locked;
        return locked ? await processBatch() : 5000;
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

function start() {
    let stopped = false;
    let timer;
    async function tick() {
        let delay = 60000;
        try {
            delay = await refreshPendingTravel();
        } catch (error) {
            console.error('Não foi possível atualizar as rotas de clientes.', error.code || error.name);
        } finally {
            if (!stopped)
                timer = setTimeout(tick, delay).unref();
        }
    }
    timer = setTimeout(tick, 0).unref();
    return () => {
        stopped = true;
        clearTimeout(timer);
    };
}

module.exports = { describe, refreshPendingTravel, start };
