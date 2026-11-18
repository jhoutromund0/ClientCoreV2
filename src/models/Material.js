const store = require('../config/store');
const { query } = require('../config/database');
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const format = d => {
    const measureType = d.measureType === 'comprimento' ? 'comprimento' : 'quantidade';
    return {
        ...d,
        name: typeof d.name === 'string' ? d.name.trim() : '',
        measureType,
        measure: number(d.measure),
        unit: measureType === 'comprimento' ? (d.unit === 'kg' ? 'kg' : 'm') : 'un',
        unitValue: number(d.unitValue)
    };
};
const clean = d => {
    const { name, measureType, measure, unit, unitValue } = format(d);
    return { name, measureType, measure, unit, unitValue, updatedAt: new Date().toISOString() };
};
const measure = "CASE WHEN jsonb_typeof(data->'measure') = 'number' THEN (data->>'measure')::numeric ELSE 0 END";
const unitValue = "CASE WHEN jsonb_typeof(data->'unitValue') = 'number' THEN (data->>'unitValue')::numeric ELSE 0 END";

module.exports = class Material {
    static async page(after, search) {
        const page = await store.byName('materials', { after, search });
        return { ...page, items: page.items.map(format) };
    }
    static async summary(search) {
        const { rows } = await query(`
            SELECT count(*) AS count, COALESCE(sum(${measure}), 0) AS measure,
                COALESCE(sum((${measure}) * (${unitValue})), 0) AS value
            FROM materials WHERE $1 = '' OR strpos(name_key, lower($1)) > 0
                OR strpos(COALESCE(data->>'measureType', ''), lower($1)) > 0
        `, [search]);
        return rows[0];
    }
    static async catalog(search = '') {
        const page = await store.byName('materials', { search, limit: 30 });
        return page.items.map(format);
    }
    static async find(id) {
        const material = await store.find('materials', id);
        return material && format(material);
    }
    static create(d) { return store.create('materials', clean(d)); }
    static update(id, d) { return store.update('materials', id, clean(d)); }
    static delete(id) { return store.delete('materials', id); }
};
