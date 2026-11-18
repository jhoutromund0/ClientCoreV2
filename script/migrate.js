const path = require('node:path');
const { readFile, readdir } = require('node:fs/promises');

const sqlDirectory = path.join(__dirname, '..', 'sql');
const migrationsDirectory = path.join(sqlDirectory, 'migrations');

async function migrate(pool) {
    const files = (await readdir(migrationsDirectory)).filter((name) => /^\d+_.+\.sql$/.test(name)).sort();
    const client = await pool.connect();
    try {
        // Uma única conexão mantém o lock durante toda a atualização.
        await client.query('SELECT pg_advisory_lock(hashtext($1))', ['clientcore.schema']);
        try {
            await client.query(await readFile(path.join(sqlDirectory, 'schema.sql'), 'utf8'));
            await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
                filename TEXT PRIMARY KEY,
                applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )`);
            const { rows } = await client.query('SELECT filename FROM schema_migrations');
            const applied = new Set(rows.map((row) => row.filename));
            const updated = [];
            for (const filename of files) {
                if (applied.has(filename))
                    continue;
                await client.query('BEGIN');
                try {
                    await client.query(await readFile(path.join(migrationsDirectory, filename), 'utf8'));
                    await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename]);
                    await client.query('COMMIT');
                } catch (error) {
                    await client.query('ROLLBACK');
                    throw new Error(`Falha na migração ${filename}`, { cause: error });
                }
                updated.push(filename);
            }
            return updated;
        } finally {
            await client.query('SELECT pg_advisory_unlock(hashtext($1))', ['clientcore.schema']);
        }
    } finally {
        client.release();
    }
}

async function main() {
    require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
    const { pool } = require('../src/config/database');
    try {
        const updated = await migrate(pool);
        console.log(updated.length ? `Migrações aplicadas: ${updated.join(', ')}` : 'O banco já está atualizado.');
    } finally {
        await pool.end();
    }
}

if (require.main === module) {
    main().catch((error) => {
        console.error(error.message, error.cause?.message || '');
        process.exitCode = 1;
    });
}

module.exports = { migrate };
