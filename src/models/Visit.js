const store = require('../config/store');
const clean = d => Object.fromEntries(['clientId', 'clientName', 'description', 'materials', 'technicians', 'scheduledAt'].map(k => [k, String(d[k] || '').trim()]));
module.exports = class Visit {
    static async all() { return (await store.all('visits')).sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt) || a.clientName.localeCompare(b.clientName, 'pt-BR')); }
    static find(id) { return store.find('visits', id); }
    static create(d) { const now = new Date().toISOString(); return store.create('visits', { ...clean(d), createdAt: now, updatedAt: now }); }
    static update(id, d) { return store.update('visits', id, { ...clean(d), updatedAt: new Date().toISOString() }); }
    static delete(id) { return store.delete('visits', id); }
};
