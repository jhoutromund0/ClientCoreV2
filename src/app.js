const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.var') });
const express = require('express');
const helmet = require('helmet');
const expressLayouts = require('express-ejs-layouts');
const pageRoutes = require('./routes/pageRoutes');
const clientRoutes = require('./routes/clientRoutes');
const materialRoutes = require('./routes/materialRoutes');
const visitRoutes = require('./routes/visitRoutes');
const financeRoutes = require('./routes/financeRoutes');
const pageController = require('./controllers/pageController');
const auth = require('./middleware/auth');
const authRoutes = require('./routes/authRoutes');
const app = express();
if (process.env.NODE_ENV === 'production')
    app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('layout', 'layouts/main');
app.use(expressLayouts);
app.locals.flash = null;
const isProduction = process.env.NODE_ENV === 'production';
const cspDirectives = { ...helmet.contentSecurityPolicy.getDefaultDirectives(), 'script-src': ["'self'", "'unsafe-inline'", 'https://cdn.tailwindcss.com'], 'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'], 'font-src': ["'self'", 'https://fonts.gstatic.com', 'data:'] };
// Em ambiente local (http://localhost) não forçamos HTTPS: isso quebraria CSS/JS em alguns navegadores (ex.: Safari).
if (!isProduction)
    cspDirectives['upgrade-insecure-requests'] = null; // null remove a diretiva padrão do helmet
app.use(helmet({ contentSecurityPolicy: { directives: cspDirectives }, hsts: isProduction }));
// Variáveis padrão das views: precisam existir antes dos parsers para a página de erro nunca quebrar.
app.use((req, res, next) => { res.locals.currentPath = req.path; res.locals.flash = null; next(); });
app.use(express.urlencoded({ extended: false, limit: '50kb' }));
app.use(express.json({ limit: '50kb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use((req, res, next) => { res.locals.flash = app.locals.flash; app.locals.flash = null; next(); });
app.use(auth.load);
app.use(auth.csrf);
app.use((req, res, next) => { if (!req.user || !req.csrfToken)
    return next(); const original = res.render.bind(res); res.render = (view, locals = {}, callback) => original(view, { ...locals, csrfToken: req.csrfToken }, callback); next(); });
app.use(authRoutes);
app.use('/', pageRoutes);
app.use('/clientes', auth.requireAuth, clientRoutes);
app.use('/materiais', auth.requireAuth, materialRoutes);
app.use('/calendario', auth.requireAuth, visitRoutes);
app.use('/financeiro', auth.requireRole('admin'), financeRoutes);
app.use((req, res) => pageController.notFound(req, res));
app.use((err, req, res, next) => {
    if (res.headersSent)
        return next(err);
    const status = err.status >= 400 && err.status < 500 ? err.status : 500;
    console.error(err);
    const message = status === 500
        ? (process.env.NODE_ENV === 'development' ? err.message : 'Ocorreu um erro inesperado.')
        : 'Requisição inválida. Verifique os dados enviados e tente novamente.';
    res.status(status).render('pages/error', { title: status === 500 ? 'Erro interno' : 'Requisição inválida', code: status, message });
});
module.exports = app;
