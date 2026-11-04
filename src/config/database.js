/**
 * Preparação para MySQL. A conexão só é aberta quando DB_ENABLED=true.
 * Nunca armazene credenciais reais no código-fonte.
 */
const mysql = require('mysql2/promise');

let pool;
function getPool() {
  if (process.env.DB_ENABLED !== 'true') {
    throw new Error('MySQL ainda não habilitado. Defina DB_ENABLED=true após configurar o banco.');
  }
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT || 3306),
      database: process.env.DB_NAME || 'client_core',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      waitForConnections: true,
      connectionLimit: 10,
      charset: 'utf8mb4'
    });
  }
  return pool;
}
module.exports = { getPool };
