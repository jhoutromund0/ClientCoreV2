const app = require('./app');
const port = Number(process.env.PORT || 3000);
const server = app.listen(port, () => console.log(`Client Core disponível em http://localhost:${port}`));
server.on('error', (err) => {
    if (err.code === 'EADDRINUSE')
        console.error(`A porta ${port} já está em uso. Feche o outro processo ou defina outra PORT no .env.`);
    else
        console.error(err);
    process.exit(1);
});
