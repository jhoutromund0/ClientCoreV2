const { query } = require('../config/database');
const { initialRevision } = require('./TransportSettings');

const usableAddress = (column) => `CASE WHEN jsonb_typeof(${column}->'address') = 'string'
    THEN NULLIF(btrim(${column}->>'address'), '') END`;
const address = `COALESCE(${usableAddress('v.data')}, ${usableAddress('c.data')})`;
const routable = `v.client_id IS NOT NULL AND clientcore_valid_day(v.scheduled_day)
    AND jsonb_typeof(v.data->'clientName') = 'string' AND btrim(v.data->>'clientName') <> ''
    AND COALESCE(v.data->>'status', 'agendada') <> 'cancelada'`;

async function pendingTravel(revision, limit, cachedOrigin, run = query) {
    const { rows } = await run(`
        SELECT v.id, site.address, v.data->'travel' AS travel, c.data->'travel' AS "clientTravel"
        FROM visits v JOIN clients c ON c.id = v.client_id
        CROSS JOIN LATERAL (SELECT ${address} AS address) site
        WHERE ${routable} AND site.address IS NOT NULL
            AND (v.data#>>'{travel,revision}' IS DISTINCT FROM $1
                OR v.data#>>'{travel,address}' IS DISTINCT FROM site.address
                OR (v.data#>>'{travel,status}' = 'temporarily_unavailable'
                    AND CASE WHEN v.data#>>'{travel,retryAfter}' ~ '^[0-9]{1,18}$'
                        THEN (v.data#>>'{travel,retryAfter}')::bigint ELSE 0 END <= $3))
            AND ($4::text IS NULL OR (
                (v.data#>>'{travel,status}' = 'ready' AND v.data#>>'{travel,originAddress}' = $4
                    AND v.data#>>'{travel,address}' = site.address)
                OR (c.data#>>'{travel,status}' = 'ready' AND c.data#>>'{travel,originAddress}' = $4
                    AND c.data#>>'{travel,address}' = site.address)
            ))
        ORDER BY v.scheduled_day DESC, v.id LIMIT $2
    `, [revision, limit, Date.now(), cachedOrigin]);
    return rows;
}

async function saveTravel(id, expectedAddress, travel, run = query) {
    const { rowCount } = await run(`
        UPDATE visits v SET data = jsonb_set(v.data, '{travel}', $3::jsonb)
        FROM clients c WHERE v.id = $1 AND c.id = v.client_id AND ${routable}
            AND ${address} = $2
            AND COALESCE((SELECT revision::text FROM transport_settings WHERE id FOR SHARE), $4) = $5
    `, [id, expectedAddress, travel, initialRevision, travel.revision]);
    return rowCount > 0;
}

module.exports = { pendingTravel, saveTravel };
