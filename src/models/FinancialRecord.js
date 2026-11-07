const store = require('../config/store');
module.exports = class FinancialRecord {
    static find(id) { return store.find('financial', id); }
    static async save(id, data) { const existing = await store.find('financial', id); return existing ? store.update('financial', id, data) : store.create('financial', { ...data, id }); }
    static delete(id) { return store.delete('financial', id); }
};
