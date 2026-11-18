const app = require('./app');
const { pool } = require('./config/database');
const auth = require('./middleware/auth');
const clientTravelService = require('./services/clientTravelService');
const dataMaintenance = require('./services/dataMaintenance');
const port = Number(process.env.PORT || 3000);
let stopTravel;
let cleanupTimer;
let cleanup;
let closing = false;

function cleanExpiredData() {
    if (cleanup)
        return;
    cleanup = Promise.allSettled([auth.cleanupExpired(), dataMaintenance.prune()]).then((results) => {
        for (const result of results) {
            if (result.status === 'rejected') {
                const { reason } = result;
                console.error('Falha na limpeza periódica.', reason.code || reason.name);
            }
        }
    }).finally(() => { cleanup = null; });
}

const server = app.listen(port, () => {
    console.log(`Client Core disponível em http://localhost:${server.address().port}`);
    stopTravel = clientTravelService.start();
    cleanExpiredData();
    cleanupTimer = setInterval(cleanExpiredData, 60 * 60 * 1000).unref();
});

async function shutdown() {
    if (closing)
        return;
    closing = true;
    clearInterval(cleanupTimer);
    const deadline = setTimeout(() => {
        console.error('O encerramento excedeu o limite de 15 segundos.');
        process.exit(1);
    }, 15000);
    const closed = new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
        server.closeIdleConnections?.();
    });
    try {
        const results = await Promise.allSettled([closed, stopTravel?.(), cleanup]);
        await pool.end();
        const failure = results.find((result) => result.status === 'rejected');
        if (failure)
            throw failure.reason;
    } catch (error) {
        console.error('Erro ao encerrar o Client Core.', error.code || error.name);
        process.exitCode = 1;
    } finally {
        clearTimeout(deadline);
    }
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
server.on('error', (err) => {
    if (err.code === 'EADDRINUSE')
        console.error(`A porta ${port} já está em uso. Feche o outro processo ou defina outra PORT no .env.`);
    else
        console.error(err);
    process.exit(1);
});
