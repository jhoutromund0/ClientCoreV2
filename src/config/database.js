const { Pool } = require('pg');
const auditContext = require('../services/auditContext');
if (!process.env.DATABASE_URL)
    throw new Error('DATABASE_URL é obrigatória. Configure o PostgreSQL antes de iniciar.');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' } : false });

async function withTransaction(work) {
    const client = await pool.connect();
    let releaseError;
    try {
        await client.query('BEGIN');
        const audit = auditContext.current();
        if (audit) {
            await client.query(
                "SELECT set_config('clientcore.actor_id', $1, true), set_config('clientcore.actor_ip', $2, true)",
                [audit.actorId, audit.ip]
            );
        }
        const result = await work(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        try {
            await client.query('ROLLBACK');
        } catch (rollbackError) {
            releaseError = rollbackError;
        }
        throw error;
    } finally {
        client.release(releaseError);
    }
}

function write(sql, params) {
    return withTransaction((client) => client.query(sql, params));
}

module.exports = { pool, query: (sql, params) => pool.query(sql, params), withTransaction, write };
