const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const express = require('express');
const helmet = require('helmet');
const expressLayouts = require('express-ejs-layouts');
const pageRoutes = require('./routes/pageRoutes');
const clientRoutes = require('./routes/clientRoutes');
const materialRoutes = require('./routes/materialRoutes');
const visitRoutes = require('./routes/visitRoutes');
const financeRoutes = require('./routes/financeRoutes');
const settingsRoutes = require('./routes/settingsRoutes');
const pageController = require('./controllers/pageController');
const auth = require('./middleware/auth');
const authRoutes = require('./routes/authRoutes');
const auditContext = require('./services/auditContext');
const app = express();
const isProduction = process.env.NODE_ENV === 'production';
const proxyHops = Number(process.env.TRUST_PROXY_HOPS || 0);
if (!Number.isSafeInteger(proxyHops) || proxyHops < 0)
    throw new Error('TRUST_PROXY_HOPS deve ser um número inteiro de saltos confiáveis.');
if (proxyHops)
    app.set('trust proxy', proxyHops);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('layout', 'layouts/main');
app.use(expressLayouts);
const cspDirectives = { 'style-src': ["'self'"], 'font-src': ["'self'"] };
if (!isProduction)
    cspDirectives['upgrade-insecure-requests'] = null;
app.use(helmet({ contentSecurityPolicy: { directives: cspDirectives }, hsts: isProduction }));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use((req, res, next) => {
    Object.assign(res.locals, { currentPath: req.path, flash: null, user: null, csrfToken: null });
    res.set({ 'Cache-Control': 'no-store', Pragma: 'no-cache' });
    next();
});
app.use(express.urlencoded({ extended: false, limit: '50kb' }));
app.use(express.json({ limit: '50kb' }));
app.use(auth.load);
app.use(auth.csrf);
app.use(auditContext.run);
app.use(authRoutes);
app.use('/', pageRoutes);
app.use('/clientes', auth.requireAuth, clientRoutes);
app.use('/materiais', auth.requireAuth, materialRoutes);
app.use('/calendario', auth.requireAuth, visitRoutes);
app.use('/financeiro', auth.requireRole('admin'), financeRoutes);
app.use('/configuracoes', auth.requireRole('admin'), settingsRoutes);
app.use((req, res) => pageController.notFound(req, res));
app.use((err, req, res, next) => {
    if (res.headersSent)
        return next(err);
    const status = err.status >= 400 && err.status < 500 ? err.status : 500;
    console.error({ event: 'request_error', method: req.method, status, code: err.code || err.type || err.name });
    const message = status === 500
        ? (process.env.NODE_ENV === 'development' ? err.message : 'Ocorreu um erro inesperado.')
        : 'Requisição inválida. Verifique os dados enviados e tente novamente.';
    res.status(status).render('pages/error', { title: status === 500 ? 'Erro interno' : 'Requisição inválida', code: status, message });
});
module.exports = app;
