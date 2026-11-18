const path = require('node:path');
const { readFile, readdir } = require('node:fs/promises');

const sqlDirectory = path.join(__dirname, '..', 'sql');
const migrationsDirectory = path.join(sqlDirectory, 'migrations');

async function migrationFiles() {
    return (await readdir(migrationsDirectory)).filter((name) => /^\d+_.+\.sql$/.test(name)).sort();
}

async function pendingMigrations(connection) {
    const files = await migrationFiles();
    const { rows: [schema] } = await connection.query("SELECT to_regclass('schema_migrations') IS NOT NULL AS initialized");
    if (!schema.initialized)
        return files;
    const { rows } = await connection.query('SELECT filename FROM schema_migrations');
    const applied = new Set(rows.map(row => row.filename));
    return files.filter(filename => !applied.has(filename));
}

async function migrate(pool) {
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
            const updated = [];
            for (const filename of await pendingMigrations(client)) {
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

module.exports = { migrate, pendingMigrations };
