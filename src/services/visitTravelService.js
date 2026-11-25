const clientTravel = require('./clientTravelService');

const kilometers = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 });
const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const formatKm = meters => `${kilometers.format(meters / 1000)} km`;
const formatMoney = cents => Number.isSafeInteger(cents) ? money.format(cents / 100) : '';

function hasDistances(trip) {
    return trip && [trip.outboundMeters, trip.roundTripMeters].every(value =>
        Number.isFinite(value) && value >= 0 && Number.isSafeInteger(Math.round(value))
    ) && trip.roundTripMeters >= trip.outboundMeters;
}

function reimbursement(visit, settings) {
    const assignees = visit.assignees || [];
    const payee = visit.travelPayeeId ? assignees.find(person => person.id === visit.travelPayeeId) :
        (assignees.length === 1 ? assignees[0] : null);
    const personalRate = payee?.mileageRateCentsPerKm;
    return {
        payeeId: payee?.id ?? null,
        payeeName: payee?.name ?? null,
        rateCentsPerKm: personalRate ?? settings.rateCentsPerKm,
        rateSource: personalRate == null ? 'company' : 'user'
    };
}

function routeDistances(visit, settings) {
    const route = visit.travel;
    if (hasDistances(route) && route.status === 'ready' && route.address === visit.address &&
        (route.originAddress === settings.originAddress || (!route.originAddress && route.revision === settings.revision)))
        return route;
    return null;
}

function snapshot(visit, settings) {
    if (visit.status === 'cancelada')
        return null;
    const manual = hasDistances(visit.manualTravel);
    const distances = manual ? visit.manualTravel : routeDistances(visit, settings);
    if (!distances)
        return null;
    const { outboundMeters, roundTripMeters } = distances;
    const payment = reimbursement(visit, settings);
    const costCents = clientTravel.travelCostCents(roundTripMeters, payment.rateCentsPerKm);
    return {
        originAddress: settings.originAddress,
        destinationAddress: visit.address,
        outboundMeters, roundTripMeters, costCents,
        source: manual ? 'manual' : 'route',
        ...payment
    };
}

function recordedOrCurrent(visit, settings) {
    if (visit.status === 'cancelada')
        return null;
    if (visit.billingFinalized)
        return hasDistances(visit.billedTravel) ? visit.billedTravel : null;
    return snapshot(visit, settings);
}

function describe(visit, settings) {
    const trip = recordedOrCurrent(visit, settings);
    const payment = trip || (visit.billingFinalized ? {} : reimbursement(visit, settings));
    const display = {
        rate: formatMoney(payment.rateCentsPerKm),
        rateSource: payment.rateSource,
        payeeName: payment.payeeName,
        needsPayee: !visit.billingFinalized && visit.status !== 'cancelada' &&
            visit.assignees?.length > 1 && !payment.payeeId
    };
    if (!trip) {
        const statusMessage = visit.status === 'cancelada' ? 'Deslocamento cancelado.' :
            visit.billingFinalized ? 'Quilometragem ausente no lançamento.' :
                clientTravel.describe(visit, settings, 'Endereço do atendimento não localizado. Confira os dados da visita.').statusMessage;
        return { ...display, statusMessage };
    }
    return {
        ...display,
        outboundKm: formatKm(trip.outboundMeters),
        roundTripKm: formatKm(trip.roundTripMeters),
        amount: formatMoney(trip.costCents),
        manual: trip.source === 'manual',
        statusMessage: trip.costCents == null ? 'Tarifa por km pendente.' : ''
    };
}

module.exports = { snapshot, recordedOrCurrent, describe };
