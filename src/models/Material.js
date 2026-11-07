const store = require('../config/store');
const clean = d => { const measureType = d.measureType === 'comprimento' ? 'comprimento' : 'quantidade'; return { name: String(d.name || '').trim(), measureType, measure: Number(d.measure) || 0, unit: measureType === 'comprimento' ? (d.unit === 'kg' ? 'kg' : 'm') : 'un', unitValue: Number(d.unitValue) || 0, updatedAt: new Date().toISOString() }; };
module.exports = class Material {
    static async all() { return (await store.all('materials')).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')); }
    static find(id) { return store.find('materials', id); }
    static create(d) { return store.create('materials', clean(d)); }
    static update(id, d) { return store.update('materials', id, clean(d)); }
    static delete(id) { return store.delete('materials', id); }
};
