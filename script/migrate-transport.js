const { readFile } = require('node:fs/promises');
const path = require('node:path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function migrate() {
    const { pool, query } = require('../src/config/database');
    try {
        const { rows } = await query("SELECT to_regclass('clients') AS clients");
        if (!rows[0].clients)
            throw new Error('A tabela de clientes está ausente. Inicialize o banco do ClientCore com sql/schema.sql.');

        const migration = path.join(__dirname, '..', 'sql', 'migrations', '001_transport_settings.sql');
        const sql = await readFile(migration, 'utf8');
        await query(`BEGIN;\n${sql}\nCOMMIT;`);
        await query('SELECT id, origin_address, rate_cents_per_km, revision FROM transport_settings LIMIT 0');
        console.log('Tabela de configurações de deslocamento verificada.');
    } finally {
        await pool.end();
    }
}

migrate().catch(error => {
    console.error('Falha ao migrar o banco de dados:', error.message);
    process.exitCode = 1;
});
