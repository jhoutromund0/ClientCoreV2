const crypto = require('crypto');
const { promisify } = require('util');
const scrypt = promisify(crypto.scrypt);
const { query } = require('../config/database');
async function hashPassword(password) { const salt = crypto.randomBytes(16).toString('hex'); const hash = await scrypt(password, salt, 64); return `scrypt:${salt}:${hash.toString('hex')}`; }
async function verifyPassword(password, stored) { if (!stored || !stored.startsWith('scrypt:'))
    return false; const [, salt, expected] = stored.split(':'); const actual = await scrypt(password, salt, 64); return expected.length === 128 && crypto.timingSafeEqual(actual, Buffer.from(expected, 'hex')); }
const publicUser = r => r && ({ id: r.id, name: r.name, email: r.email, role: r.role, active: r.active, created_at: r.created_at });
module.exports = { hashPassword, verifyPassword, publicUser,
    async byEmail(email) { const { rows } = await query('SELECT * FROM users WHERE email=$1', [email.toLowerCase()]); return rows[0] || null; },
    async all() { const { rows } = await query('SELECT id,name,email,role,active,created_at FROM users ORDER BY name'); return rows; },
    async create({ name, email, password, role }) { const { rows } = await query('INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id,name,email,role,active,created_at', [name, email.toLowerCase(), await hashPassword(password), role]); return rows[0]; },
    async update(id, { name, email, role, active, password }) { const hash = password ? await hashPassword(password) : null; const { rows } = await query('UPDATE users SET name=$2,email=$3,role=$4,active=$5,password_hash=COALESCE($6,password_hash) WHERE id=$1 RETURNING id,name,email,role,active,created_at', [id, name, email.toLowerCase(), role, active, hash]); return rows[0]; },
    async remove(id) { const { rowCount } = await query('DELETE FROM users WHERE id=$1', [id]); return rowCount > 0; }
};
