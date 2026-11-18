const clientTravel = require('./clientTravelService');

function snapshot(visit, settings) {
    const travel = visit.travel;
    if (travel?.status !== 'ready' || travel.address !== visit.address || travel.revision !== settings.revision)
        return null;
    if (![travel.outboundMeters, travel.roundTripMeters].every(value => Number.isFinite(value) && value >= 0))
        return null;
    return {
        originAddress: settings.originAddress,
        destinationAddress: visit.address,
        outboundMeters: travel.outboundMeters,
        roundTripMeters: travel.roundTripMeters,
        rateCentsPerKm: settings.rateCentsPerKm,
        costCents: Number.isSafeInteger(travel.roundTripCostCents) ? travel.roundTripCostCents : null
    };
}

function describe(visit, settings) {
    return clientTravel.describe(visit, settings, 'Endereço do atendimento não localizado. Confira os dados da visita.');
}

module.exports = { snapshot, describe };
