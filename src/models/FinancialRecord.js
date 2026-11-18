const store = require('../config/store');
const cents = (value) => Number.isSafeInteger(value) && value >= 0 ? value : 0;

function format(record) {
    if (!record)
        return null;
    const items = Array.isArray(record.items) ? record.items.filter(item => item && typeof item === 'object') : [];
    return {
        ...record,
        status: typeof record.status === 'string' ? record.status : 'pendente',
        labor: cents(record.labor), received: cents(record.received), cost: cents(record.cost), charge: cents(record.charge),
        items: items.map(item => ({
            name: typeof item.name === 'string' ? item.name : '',
            origin: item.origin, unit: item.unit, quantity: cents(item.quantity),
            cost: cents(item.cost), price: cents(item.price)
        }))
    };
}

module.exports = class FinancialRecord {
    static format = format;
    static async find(id) { return format(await store.find('financial', id)); }
    static save(id, data) { return store.save('financial', id, data); }
    static delete(id) { return store.delete('financial', id); }
};
