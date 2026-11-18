const store = require('../config/store');
const { query, withTransaction } = require('../config/database');
const { isUuid } = require('../utils/pagination');
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const format = d => {
    const measureType = d.measureType === 'comprimento' ? 'comprimento' : 'quantidade';
    return {
        ...d,
        name: typeof d.name === 'string' ? d.name.trim() : '',
        measureType,
        measure: number(d.measure),
        unit: measureType === 'comprimento' ? (d.unit === 'kg' ? 'kg' : 'm') : 'un',
        unitValue: number(d.unitValue),
        unitPrice: number(d.unitPrice)
    };
};
const clean = d => {
    const { name, measureType, measure, unit, unitValue, unitPrice } = format(d);
    return { name, measureType, measure, unit, unitValue, unitPrice, updatedAt: new Date().toISOString() };
};
const measure = "CASE WHEN jsonb_typeof(data->'measure') = 'number' THEN (data->>'measure')::numeric ELSE 0 END";
const unitValue = "CASE WHEN jsonb_typeof(data->'unitValue') = 'number' THEN (data->>'unitValue')::numeric ELSE 0 END";

class ConflictError extends Error {}

module.exports = class Material {
    static ConflictError = ConflictError;
    static format = format;
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
        if (!isUuid(id))
            return null;
        const { rows: [row] } = await query('SELECT id, data, inventory_revision FROM materials WHERE id = $1', [id]);
        return row ? format({ ...row.data, id: row.id, revision: row.inventory_revision }) : null;
    }
    static create(d) { return store.create('materials', clean(d)); }
    static async update(id, d) {
        if (!isUuid(id))
            return null;
        return withTransaction(async (client) => {
            const { rows: [row] } = await client.query(`SELECT id, data, inventory_revision FROM materials
                WHERE id = $1 FOR UPDATE`, [id]);
            if (!row)
                return null;
            if (d.revision && d.revision !== row.inventory_revision)
                throw new ConflictError('O material mudou desde que esta página foi aberta. Confira os dados e tente novamente.');
            const current = format(row.data || {});
            const next = clean({ ...d, unitPrice: d.unitPrice ?? current.unitPrice });
            if (next.unit !== current.unit) {
                const linked = await client.query('SELECT 1 FROM visit_materials WHERE material_id = $1 LIMIT 1', [id]);
                if (linked.rowCount)
                    throw new ConflictError('A unidade de um material vinculado a uma visita não pode ser alterada.');
            }
            const { rows: [saved] } = await client.query(`UPDATE materials
                SET data = (${store.preservedData('data')}) || $2::jsonb WHERE id = $1 RETURNING id, data, inventory_revision`,
            [id, JSON.stringify({ ...next, id: row.id })]);
            return format({ ...saved.data, id: saved.id, revision: saved.inventory_revision });
        });
    }
    static delete(id) { return store.delete('materials', id); }
};
