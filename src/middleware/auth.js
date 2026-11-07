const crypto = require('crypto');
const { query } = require('../config/database');
const secret = process.env.SESSION_SECRET;
if (!secret || secret.length < 32)
    throw new Error('SESSION_SECRET deve conter pelo menos 32 caracteres');
const hash = t => crypto.createHash('sha256').update(t).digest('hex');
const sign = t => crypto.createHmac('sha256', secret).update(t).digest('hex');
const cookieName = 'cc_session';
function cookie(req) { const entry = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith(cookieName + '=')); return entry ? decodeURIComponent(entry.slice(cookieName.length + 1)) : ''; }
function setCookie(res, value, expires) { res.cookie(cookieName, value, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: expires ? 7 * 86400000 : undefined }); }
async function load(req, res, next) {
    try {
        req.user = null;
        req.sessionToken = null;
        req.csrfToken = null;
        const raw = cookie(req);
        const [token, signature] = raw.split('.');
        if (token && signature && token.length === 64 && signature.length === 64 && crypto.timingSafeEqual(Buffer.from(sign(token)), Buffer.from(signature))) {
            const { rows } = await query('SELECT u.id,u.name,u.email,u.role,s.csrf_token FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>NOW() AND u.active=true', [hash(token)]);
            if (rows[0]) {
                req.user = rows[0];
                req.sessionToken = token;
                req.csrfToken = rows[0].csrf_token;
            }
        }
        res.locals.user = req.user;
        res.locals.csrfToken = req.csrfToken;
        next();
    }
    catch (e) {
        next(e);
    }
}
async function create(req, res, user) { const token = crypto.randomBytes(32).toString('hex'); const csrf = crypto.randomBytes(32).toString('hex'); await query('INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$2,$3,NOW()+INTERVAL \'7 days\')', [hash(token), user.id, csrf]); setCookie(res, token + '.' + sign(token), true); }
async function destroy(req, res) { if (req.sessionToken)
    await query('DELETE FROM sessions WHERE token_hash=$1', [hash(req.sessionToken)]); res.clearCookie(cookieName, { path: '/' }); }
function requireAuth(req, res, next) { if (!req.user)
    return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl)); next(); }
function requireRole(role) { return (req, res, next) => { if (!req.user)
    return res.redirect('/login'); if (req.user.role !== role)
    return res.status(403).render('pages/error', { title: 'Acesso negado', code: 403, message: 'Seu perfil não tem permissão para acessar esta área.' }); next(); }; }

function csrf(req, res, next) {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        return next();
    }

    const origin = req.get('origin');
    if (origin) {
        try {
            const originUrl = new URL(origin);
            const expectedHost = req.get('host');

            const allowedHosts = [
                expectedHost,
                process.env.APP_URL ? new URL(process.env.APP_URL).host : null
            ].filter(Boolean);

            if (!['https:', 'http:'].includes(originUrl.protocol) ||
                !allowedHosts.includes(originUrl.host)) {
                return res.status(403).send('Origem inválida');
            }
        } catch {
            return res.status(403).send('Origem inválida');
        }
    }

    if (!req.user) {
        return next();
    }

    const value = req.body ? req.body._csrf : null;

    if (
        typeof value !== 'string' ||
        !req.csrfToken ||
        value.length !== req.csrfToken.length ||
        !crypto.timingSafeEqual(Buffer.from(value), Buffer.from(req.csrfToken))
    ) {
        return res.status(403).send('Token de segurança inválido');
    }

    next();
}

module.exports = { load, create, destroy, requireAuth, requireRole, csrf };
