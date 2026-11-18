const { randomUUID } = require('node:crypto');
const { query, write } = require('../config/database');

const defaults = Object.freeze({
    originAddress: 'R. Heitor Lacerda Guedes, 1000 - Cidade Satélite Íris, Campinas - SP, 13059-581, Brazil',
    rateCentsPerKm: null,
    revision: 'initial'
});
const columns = 'origin_address AS "originAddress", rate_cents_per_km AS "rateCentsPerKm", revision';

async function get() {
    const { rows } = await query(`SELECT ${columns} FROM transport_settings WHERE id`);
    return rows[0] ?? defaults;
}

async function save({ originAddress, rateCentsPerKm }) {
    const { rows } = await write(`
        INSERT INTO transport_settings (origin_address, rate_cents_per_km, revision)
        VALUES ($1, $2, $3)
        ON CONFLICT (id) DO UPDATE SET
            origin_address = EXCLUDED.origin_address,
            rate_cents_per_km = EXCLUDED.rate_cents_per_km,
            revision = CASE
                WHEN transport_settings.origin_address IS DISTINCT FROM EXCLUDED.origin_address
                    OR transport_settings.rate_cents_per_km IS DISTINCT FROM EXCLUDED.rate_cents_per_km
                THEN EXCLUDED.revision
                ELSE transport_settings.revision
            END
        RETURNING ${columns}
    `, [originAddress, rateCentsPerKm, randomUUID()]);
    return rows[0];
}

module.exports = { get, save, initialRevision: defaults.revision };
