const store = require('../config/store');
const { query } = require('../config/database');
const { initialRevision } = require('./TransportSettings');
const text = v => typeof v === 'string' ? v.trim() : '';
const clean = d => ({
    name: text(d.name),
    cnpj: text(d.cnpj),
    email: text(d.email),
    phone: text(d.phone),
    company: text(d.company),
    address: text(d.address),
    establishmentType: text(d.establishmentType)
});
module.exports = class Client {
    static async all() { return (await store.all('clients')).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')); }
    static find(id) { return store.find('clients', id); }
    static create(d) { return store.create('clients', { ...clean(d), createdAt: new Date().toISOString() }); }
    static async update(id, d) {
        const { rows } = await query(`
            UPDATE clients
            SET data = data || $2::jsonb || jsonb_build_object('id', id)
            WHERE id = $1
            RETURNING data
        `, [id, JSON.stringify(clean(d))]);
        return rows[0]?.data ?? null;
    }
    static delete(id) { return store.delete('clients', id); }

    static async pendingTravel(revision, limit = 25, cachedOrigin = null) {
        const { rows } = await query(`
            SELECT data || jsonb_build_object('id', id) AS data FROM clients
            WHERE jsonb_typeof(data->'address') = 'string' AND data->>'address' ~ '[^[:space:]]'
                AND (data#>>'{travel,revision}' IS DISTINCT FROM $1
                    OR data#>>'{travel,address}' IS DISTINCT FROM data->>'address'
                    OR (data#>>'{travel,status}' = 'temporarily_unavailable'
                        AND COALESCE((data#>>'{travel,retryAfter}')::bigint, 0) <= $3))
                AND ($4::text IS NULL OR (data#>>'{travel,status}' = 'ready'
                    AND data#>>'{travel,originAddress}' = $4
                    AND data#>>'{travel,address}' = data->>'address'))
            ORDER BY id
            LIMIT $2
        `, [revision, limit, Date.now(), cachedOrigin]);
        return rows.map(row => row.data);
    }

    static async saveTravel(id, address, travel) {
        const { rowCount } = await query(`
            UPDATE clients
            SET data = jsonb_set(data, '{travel}', $3::jsonb)
            WHERE id = $1 AND data->>'address' = $2
                AND COALESCE((SELECT revision::text FROM transport_settings WHERE id FOR SHARE), $4) = $5
        `, [id, address, JSON.stringify(travel), initialRevision, travel.revision]);
        return rowCount > 0;
    }
};
