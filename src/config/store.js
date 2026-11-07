const { query } = require('./database');
const { randomUUID } = require('crypto');
const mapping = { clients: 'clients', materials: 'materials', visits: 'visits', financial: 'financial_records' };
const valid = (table) => { if (!mapping[table])
    throw new Error('Tabela inválida'); return mapping[table]; };
const read = (row) => row ? row.data : null;
module.exports = {
    async all(table) { const { rows } = await query(`SELECT data FROM ${valid(table)}`); return rows.map(read); },
    async find(table, id) { const { rows } = await query(`SELECT data FROM ${valid(table)} WHERE id=$1`, [id]); return read(rows[0]); },
    async create(table, data) { const id = data.id || randomUUID(); const item = { ...data, id }; await query(`INSERT INTO ${valid(table)} (id,data) VALUES ($1,$2::jsonb)`, [id, JSON.stringify(item)]); return item; },
    async update(table, id, data) { const previous = await this.find(table, id); if (!previous)
        return null; const item = { ...previous, ...data, id }; await query(`UPDATE ${valid(table)} SET data=$2::jsonb WHERE id=$1`, [id, JSON.stringify(item)]); return item; },
    async delete(table, id) { const { rowCount } = await query(`DELETE FROM ${valid(table)} WHERE id=$1`, [id]); return rowCount > 0; }
};
