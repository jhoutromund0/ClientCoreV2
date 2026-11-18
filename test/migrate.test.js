const assert = require('node:assert/strict');
const path = require('node:path');
const { readFile } = require('node:fs/promises');
const { test } = require('node:test');
const { Pool } = require('pg');
const { PGlite } = require('@electric-sql/pglite');
const { pgcrypto } = require('@electric-sql/pglite/contrib/pgcrypto');
const { createPgConfig } = require('@electric-sql/pglite/node-postgres');
const { migrate } = require('../script/migrate');

test('upgrades legacy records without discarding customer or financial data', async (context) => {
    const engine = new PGlite({ extensions: { pgcrypto } });
    const pool = new Pool({ ...createPgConfig(engine), max: 1 });
    context.after(async () => {
        await pool.end();
        await engine.close();
    });

    const userEmail = 'admin-legado@example.test';
    const clientId = '00000000-0000-4000-8000-000000000001';
    const duplicateId = '00000000-0000-4000-8000-000000000002';
    const visitId = '00000000-0000-4000-8000-000000000003';
    const unmatchedId = '00000000-0000-4000-8000-000000000004';
    const orphanId = '00000000-0000-4000-8000-000000000005';
    await pool.query(await readFile(path.join(__dirname, '..', 'sql', 'schema.sql'), 'utf8'));
    const { rows: [user] } = await pool.query(`
        INSERT INTO users(name, email, password_hash, role) VALUES ('Admin legado', $1, 'hash de teste', 'admin') RETURNING id
    `, [userEmail]);
    await pool.query(`
        INSERT INTO sessions(token_hash, user_id, csrf_token, expires_at) VALUES ($1, $2, $3, NOW() + INTERVAL '1 day')
    `, ['a'.repeat(64), user.id, 'b'.repeat(64)]);
    await pool.query('INSERT INTO clients(id, data) VALUES ($1, $2), ($3, $4)', [
        clientId, { name: 'Cliente antigo', cnpj: '04.252.011/0001-10', email: 'cliente@example.test' },
        duplicateId, { cnpj: '04252011000110', email: 'CLIENTE@example.test' }
    ]);
    await pool.query('INSERT INTO visits(id, data) VALUES ($1, $2), ($3, $4)', [
        visitId, { clientName: 'Cliente antigo', scheduledAt: '2026-11-13T10:00' },
        unmatchedId, { clientName: 'Sem correspondência' }
    ]);
    const orphan = { labor: 200, notes: 'Lançamento legado' };
    await pool.query('INSERT INTO financial_records(id, data) VALUES ($1, $2), ($3, $4)', [
        visitId, { labor: 100 }, orphanId, orphan
    ]);

    await migrate(pool);
    assert.deepEqual(await migrate(pool), []);
    assert.equal((await pool.query('SELECT id FROM clients')).rowCount, 2);
    assert.deepEqual((await pool.query('SELECT id, client_id FROM visits ORDER BY id')).rows, [
        { id: visitId, client_id: clientId }, { id: unmatchedId, client_id: null }
    ]);
    assert.deepEqual((await pool.query('SELECT id FROM financial_records')).rows, [{ id: visitId }]);
    assert.deepEqual((await pool.query('SELECT id, data FROM legacy_financial_records')).rows, [{ id: orphanId, data: orphan }]);
    assert.equal((await pool.query('SELECT token_hash FROM sessions')).rowCount, 0);
    assert.deepEqual((await pool.query('SELECT id, email FROM users')).rows, [{ id: user.id, email: userEmail }]);
    await assert.rejects(pool.query('INSERT INTO clients (id, data) VALUES (gen_random_uuid(), $1)', [
        { name: 'Cliente novo', cnpj: '04252011000110' }
    ]), { code: '23505' });
});
