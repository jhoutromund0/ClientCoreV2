const store = require('../config/store');
const { query } = require('../config/database');
const cents = (value) => Number.isSafeInteger(value) && value >= 0 ? value : 0;

function formatItems(items) {
    return Array.isArray(items) ? items.filter(item => item && typeof item === 'object').map(item => ({
        materialId: item.materialId,
        name: typeof item.name === 'string' ? item.name : '',
        origin: item.origin, unit: item.unit, quantity: cents(item.quantity),
        cost: cents(item.cost), price: cents(item.price)
    })) : [];
}

function format(record) {
    if (!record)
        return null;
    return {
        ...record,
        status: typeof record.status === 'string' ? record.status : 'pendente',
        labor: cents(record.labor), received: cents(record.received), cost: cents(record.cost), charge: cents(record.charge),
        otherCost: cents(record.otherCost), travelCharge: cents(record.travelCharge), travelCost: cents(record.travelCost),
        inventoryItems: formatItems(record.inventoryItems),
        items: formatItems(record.items),
        travel: record.travel && [record.travel.outboundMeters, record.travel.roundTripMeters].every(value => Number.isFinite(value) && value >= 0)
            ? record.travel : null
    };
}

async function balance() {
    const { rows: [totals] } = await query(`
        SELECT COALESCE(sum(CASE WHEN clientcore_nonnegative_integer(f.data->'received') THEN (f.data->>'received')::numeric END), 0) AS received,
               COALESCE(sum(CASE WHEN clientcore_nonnegative_integer(f.data->'cost') THEN (f.data->>'cost')::numeric END), 0) AS cost
        FROM financial_records f JOIN visits v ON v.id = f.id
        WHERE f.data->>'status' IN ('servico', 'aprovado')
            AND COALESCE(f.data->>'billingFinalized', 'true') = 'true'
            AND COALESCE(v.data->>'status', '') <> 'cancelada'
    `);
    const received = Number(totals.received);
    const cost = Number(totals.cost);
    return { received, cost, balance: received - cost };
}

module.exports = class FinancialRecord {
    static format = format;
    static balance = balance;
    static async find(id, run) { return format(await store.find('financial', id, run)); }
    static save(id, data, run) { return store.save('financial', id, data, run); }
    static delete(id, run) { return store.delete('financial', id, run); }
};
