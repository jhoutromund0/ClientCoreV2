const { query, write } = require('./database');
const { randomUUID } = require('node:crypto');
const { isUuid, readCursor, pageFrom } = require('../utils/pagination');
const mapping = { clients: 'clients', materials: 'materials', visits: 'visits', financial: 'financial_records' };
const preservedData = column => `CASE WHEN jsonb_typeof(${column}) = 'object'
    THEN ${column} ELSE jsonb_build_object('legacyData', ${column}) END`;

function valid(table) {
    if (!Object.hasOwn(mapping, table))
        throw new Error('Tabela inválida');
    return mapping[table];
}

const read = (row) => row ? { ...row.data, id: row.id } : null;

async function find(table, id) {
    if (!isUuid(id))
        return null;
    const { rows } = await query(`SELECT id, data FROM ${valid(table)} WHERE id = $1`, [id]);
    return read(rows[0]);
}

async function create(table, data) {
    const id = data.id || randomUUID();
    const item = { ...data, id };
    await write(`INSERT INTO ${valid(table)} (id, data) VALUES ($1, $2::jsonb)`, [id, JSON.stringify(item)]);
    return item;
}

async function update(table, id, data) {
    if (!isUuid(id))
        return null;
    const { rows } = await write(`
        UPDATE ${valid(table)} SET data = (${preservedData('data')}) || $2::jsonb
        WHERE id = $1 RETURNING id, data
    `, [id, JSON.stringify({ ...data, id })]);
    return read(rows[0]);
}

async function save(table, id, data) {
    const { rows } = await write(`
        INSERT INTO ${valid(table)} (id, data) VALUES ($1, $2::jsonb)
        ON CONFLICT (id) DO UPDATE SET data = (${preservedData(valid(table) + '.data')}) || EXCLUDED.data
        RETURNING id, data
    `, [id, JSON.stringify({ ...data, id })]);
    return read(rows[0]);
}

async function remove(table, id) {
    if (!isUuid(id))
        return false;
    const { rowCount } = await write(`DELETE FROM ${valid(table)} WHERE id = $1`, [id]);
    return rowCount > 0;
}

async function byName(table, { after, search = '', limit = 40 } = {}) {
    const [sort, id] = readCursor(after);
    const source = valid(table);
    if (source !== 'clients' && source !== 'materials')
        throw new Error('Tabela sem ordenação por nome');
    const filter = source === 'materials'
        ? "strpos(COALESCE(data->>'measureType', ''), lower($3)) > 0"
        : "strpos(lower(COALESCE(data->>'company', '')), lower($3)) > 0";
    const { rows } = await query(`
        SELECT id, data, name_key AS sort_key FROM ${source}
        WHERE ($1::text IS NULL OR (name_key, id) > ($1, $2::uuid))
            AND ($3 = '' OR strpos(name_key, lower($3)) > 0 OR ${filter})
        ORDER BY name_key, id LIMIT $4
    `, [sort, id, search, limit + 1]);
    const page = pageFrom(rows, limit);
    return { ...page, items: page.items.map(read) };
}

module.exports = { find, create, update, save, delete: remove, byName, preservedData };
