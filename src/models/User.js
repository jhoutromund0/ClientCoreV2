const { createHash, randomBytes, scrypt, timingSafeEqual } = require('node:crypto');
const { promisify } = require('node:util');
const { query, write, withTransaction } = require('../config/database');
const { readCursor, pageFrom } = require('../utils/pagination');

const derive = promisify(scrypt);
const encodedPassword = /^scrypt:([0-9a-f]{32}):([0-9a-f]{128})$/;
const pending = 'invite:pending';
const dummySalt = 'e2bee928f4d4ab6acd9661ade99d54cbc';
const hashToken = token => createHash('sha256').update(token).digest('hex');
const randomToken = () => randomBytes(32).toString('hex');
const columns = 'id, name, email, role, active, created_at';

async function hashPassword(password) {
    const salt = randomBytes(16).toString('hex');
    const digest = await derive(password, salt, 64);
    return `scrypt:${salt}:${digest.toString('hex')}`;
}

async function verifyPassword(password, stored) {
    const parts = typeof stored === 'string' && encodedPassword.exec(stored);
    const actual = await derive(password, parts?.[1] || dummySalt, 64);
    return Boolean(parts && timingSafeEqual(actual, Buffer.from(parts[2], 'hex')));
}

async function byEmail(email) {
    const { rows } = await query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
    return rows[0] || null;
}

async function activeById(id) {
    const { rows } = await query('SELECT * FROM users WHERE id = $1 AND active', [id]);
    return rows[0] || null;
}

async function page(cursor) {
    const [sort, id] = readCursor(cursor);
    const limit = 30;
    const { rows } = await query(`
        SELECT ${columns}, name AS sort_key, password_hash = $4 AS pending
        FROM users WHERE $1::text IS NULL OR (name, id) > ($1::text, $2::uuid)
        ORDER BY name, id LIMIT $3
    `, [sort, id, limit + 1, pending]);
    return { ...pageFrom(rows, limit), after: sort === null ? null : cursor };
}

async function create({ name, email, password, role }) {
    const { rows } = await write(`
        INSERT INTO users(name, email, password_hash, role)
        VALUES ($1, $2, $3, $4) RETURNING ${columns}
    `, [name, email.toLowerCase(), await hashPassword(password), role]);
    return rows[0];
}

async function savePasswordLink(client, userId) {
    const token = randomToken();
    await client.query(`
        INSERT INTO password_links(token_hash, user_id, expires_at)
        VALUES ($1, $2, NOW() + INTERVAL '1 hour')
        ON CONFLICT (user_id) DO UPDATE SET token_hash = EXCLUDED.token_hash, expires_at = EXCLUDED.expires_at
    `, [hashToken(token), userId]);
    return token;
}

async function manage(actor, targetId, work) {
    return withTransaction(async client => {
        const { rows } = await client.query(`
            SELECT id, email, role, active, password_hash
            FROM users WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE
        `, [[actor.id, targetId || actor.id]]);
        const admin = rows.find(row => row.id === actor.id);
        if (!admin?.active || admin.role !== 'admin' || admin.password_hash !== actor.password_hash) return null;
        const target = rows.find(row => row.id === targetId?.toLowerCase());
        return work(client, target);
    });
}

async function createInvited({ name, email, role }, actor) {
    return manage(actor, null, async client => {
        const { rows } = await client.query(`
            INSERT INTO users(name, email, password_hash, role)
            VALUES ($1, $2, $3, $4) RETURNING id
        `, [name, email, pending, role]);
        return savePasswordLink(client, rows[0].id);
    });
}

async function issuePasswordLink(id, actor) {
    return manage(actor, id, async (client, target) => {
        if (!target?.active || actor.id === target.id) return null;
        return { email: target.email, token: await savePasswordLink(client, target.id) };
    });
}

async function passwordLinkAccount(token) {
    const { rows } = await query(`
        SELECT u.id, u.name, u.email FROM password_links AS link
        JOIN users AS u ON u.id = link.user_id
        WHERE link.token_hash = $1 AND link.expires_at > NOW() AND u.active
    `, [hashToken(token)]);
    return rows[0] || null;
}

async function revokeSessions(client, id, keep) {
    await client.query('DELETE FROM sessions WHERE user_id = $1 AND token_hash IS DISTINCT FROM $2', [id, keep]);
    if (keep)
        await client.query('UPDATE sessions SET csrf_token = $2 WHERE token_hash = $1', [keep, randomToken()]);
}

async function consumePasswordLink(token, account, password) {
    const passwordHash = await hashPassword(password);
    return withTransaction(async client => {
        const { rows } = await client.query('SELECT id FROM users WHERE id = $1 AND active FOR UPDATE', [account.id]);
        if (!rows.length) return false;
        const result = await client.query(`
            DELETE FROM password_links WHERE token_hash = $1 AND user_id = $2 AND expires_at > NOW()
        `, [hashToken(token), account.id]);
        if (!result.rowCount) return false;
        await client.query('UPDATE users SET password_hash = $2 WHERE id = $1', [account.id, passwordHash]);
        await revokeSessions(client, account.id, null);
        return true;
    });
}

async function changePassword(account, password, sessionHash) {
    const passwordHash = await hashPassword(password);
    return withTransaction(async client => {
        const result = await client.query(`
            UPDATE users SET password_hash = $2
            WHERE id = $1 AND password_hash = $3 AND active
        `, [account.id, passwordHash, account.password_hash]);
        if (!result.rowCount) return false;
        await client.query('DELETE FROM password_links WHERE user_id = $1', [account.id]);
        await revokeSessions(client, account.id, sessionHash);
        return true;
    });
}

async function update(id, { name, email, role, active }, keepSession, actor) {
    return manage(actor, id, async (client, previous) => {
        if (!previous) return false;
        if (previous.id === actor.id && (!active || role !== 'admin')) return false;
        await client.query(
            'UPDATE users SET name = $2, email = $3, role = $4, active = $5 WHERE id = $1',
            [id, name, email, role, active]
        );
        if (previous.email !== email || previous.role !== role || previous.active !== active) {
            await client.query('DELETE FROM password_links WHERE user_id = $1', [id]);
            await revokeSessions(client, id, keepSession);
        }
        return true;
    });
}

async function remove(id, actor) {
    return manage(actor, id, async (client, target) => {
        if (!target || actor.id === target.id) return false;
        const { rowCount } = await client.query('DELETE FROM users WHERE id = $1', [target.id]);
        return rowCount > 0;
    });
}

module.exports = {
    hashPassword, verifyPassword, byEmail, activeById, page, create, createInvited, issuePasswordLink,
    passwordLinkAccount, consumePasswordLink, changePassword, update, remove
};
