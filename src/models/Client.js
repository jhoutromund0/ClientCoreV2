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
    static async page(after) {
        const page = await store.byName('clients', { after });
        return { ...page, items: page.items.map(client => ({ ...client, ...clean(client) })) };
    }
    static async find(id) {
        const client = await store.find('clients', id);
        return client && { ...client, ...clean(client) };
    }
    static create(d) { return store.create('clients', { ...clean(d), createdAt: new Date().toISOString() }); }
    static update(id, d) { return store.update('clients', id, clean(d)); }
    static delete(id) { return store.delete('clients', id); }

    static async options(search = '', exact = false) {
        const { rows } = await query(`
            WITH options AS (
                SELECT id, name_key, lower(btrim(COALESCE(data->>'company', ''))) AS company_key,
                    CASE WHEN data->>'company' IS NULL OR btrim(data->>'company') = '' OR lower(btrim(data->>'company')) = name_key
                        THEN btrim(data->>'name')
                        ELSE btrim(data->>'company') || ' — ' || btrim(data->>'name')
                    END AS display, COALESCE(data->>'cnpj', '') AS cnpj
                FROM clients WHERE name_key <> '' AND jsonb_typeof(data->'name') = 'string'
            ), matches AS (
                SELECT * FROM options WHERE $1 = '' OR CASE WHEN $2::boolean
                    THEN lower($1) IN (name_key, company_key, lower(display))
                    ELSE strpos(name_key, lower($1)) > 0 OR strpos(company_key, lower($1)) > 0
                        OR strpos(lower(display), lower($1)) > 0 OR strpos(lower(cnpj), lower($1)) > 0
                END
                ORDER BY name_key, id LIMIT $3
            )
            SELECT id, cnpj, CASE WHEN count(*) OVER (PARTITION BY display) > 1
                THEN concat_ws(' · ', display, NULLIF(cnpj, ''), left(id::text, 8))
                ELSE display END AS label
            FROM matches
            ORDER BY name_key, id
        `, [search, exact, exact ? 2 : 20]);
        return rows;
    }

    static async pendingTravel(revision, limit = 25, cachedOrigin = null, run = query) {
        const { rows } = await run(`
            SELECT data || jsonb_build_object('id', id) AS data FROM clients
            WHERE jsonb_typeof(data->'address') = 'string' AND data->>'address' ~ '[^[:space:]]'
                AND jsonb_typeof(data->'name') = 'string' AND name_key <> ''
                AND (cnpj_key IS NULL OR cnpj_key ~ '^[A-Z0-9]{12}[0-9]{2}$')
                AND (data#>>'{travel,revision}' IS DISTINCT FROM $1
                    OR data#>>'{travel,address}' IS DISTINCT FROM data->>'address'
                    OR (data#>>'{travel,status}' = 'temporarily_unavailable'
                        AND CASE WHEN data#>>'{travel,retryAfter}' ~ '^[0-9]{1,18}$'
                            THEN (data#>>'{travel,retryAfter}')::bigint ELSE 0 END <= $3))
                AND ($4::text IS NULL OR (data#>>'{travel,status}' = 'ready'
                    AND data#>>'{travel,originAddress}' = $4
                    AND data#>>'{travel,address}' = data->>'address'))
            ORDER BY id
            LIMIT $2
        `, [revision, limit, Date.now(), cachedOrigin]);
        return rows.map(row => row.data);
    }

    static async saveTravel(id, address, travel, run = query) {
        const { rowCount } = await run(`
            UPDATE clients
            SET data = jsonb_set(data, '{travel}', $3::jsonb)
            WHERE id = $1 AND data->>'address' = $2 AND jsonb_typeof(data->'name') = 'string'
                AND name_key <> '' AND (cnpj_key IS NULL OR cnpj_key ~ '^[A-Z0-9]{12}[0-9]{2}$')
                AND COALESCE((SELECT revision::text FROM transport_settings WHERE id FOR SHARE), $4) = $5
        `, [id, address, JSON.stringify(travel), initialRevision, travel.revision]);
        return rowCount > 0;
    }
};
