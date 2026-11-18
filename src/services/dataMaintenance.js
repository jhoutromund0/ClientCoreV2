const { query } = require('../config/database');

function prune() {
    return Promise.all([
        query(`DELETE FROM audit_log WHERE id IN (
            SELECT id FROM audit_log WHERE occurred_at < NOW() - INTERVAL '180 days'
            ORDER BY occurred_at LIMIT 10000
        )`),
        query(`DELETE FROM cnpj_lookup_cache WHERE expires_at <= NOW() AND cnpj IN (
            SELECT cnpj FROM cnpj_lookup_cache WHERE expires_at <= NOW() ORDER BY expires_at LIMIT 10000
        )`),
        query(`DELETE FROM cnpj_lookup_limits
        WHERE updated_at < NOW() - INTERVAL '1 day' AND (cooldown_until IS NULL OR cooldown_until <= NOW())
            AND key IN (SELECT key FROM cnpj_lookup_limits
                WHERE updated_at < NOW() - INTERVAL '1 day' AND (cooldown_until IS NULL OR cooldown_until <= NOW())
                ORDER BY updated_at LIMIT 10000)
        `)
    ]);
}

module.exports = { prune };
