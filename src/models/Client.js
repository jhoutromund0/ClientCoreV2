const store = require('../config/store');
const text = v => typeof v === 'string' ? v.trim() : '';
const clean = d => ({ name: text(d.name), cnpj: text(d.cnpj), email: text(d.email), phone: text(d.phone), company: text(d.company) });
module.exports = class Client {
    static async all() { return (await store.all('clients')).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')); }
    static find(id) { return store.find('clients', id); }
    static create(d) { return store.create('clients', { ...clean(d), createdAt: new Date().toISOString() }); }
    static update(id, d) { return store.update('clients', id, clean(d)); }
    static delete(id) { return store.delete('clients', id); }
};
