const { Pool } = require('pg');
if (!process.env.DATABASE_URL)
    throw new Error('DATABASE_URL é obrigatória. Configure o PostgreSQL antes de iniciar.');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' } : false });
module.exports = { pool, query: (sql, params) => pool.query(sql, params) };
