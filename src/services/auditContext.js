const { AsyncLocalStorage } = require('node:async_hooks');

const context = new AsyncLocalStorage();

function run(req, res, next) {
    context.run({
        actorId: req.user?.id ?? '',
        ip: req.ip ?? ''
    }, next);
}

module.exports = { run, current: () => context.getStore() };
