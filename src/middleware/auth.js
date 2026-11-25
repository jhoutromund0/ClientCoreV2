const { createHash, createHmac, randomBytes, timingSafeEqual } = require('node:crypto');
const { query, withTransaction } = require('../config/database');
const { report } = require('../services/loginThrottle');
const asyncHandler = require('./asyncHandler');

const secret = process.env.SESSION_SECRET;
if (!secret || secret.length < 32)
    throw new Error('SESSION_SECRET deve conter pelo menos 32 caracteres');

const secure = process.env.NODE_ENV === 'production';
const renderTerminatesHttps = secure && process.env.RENDER === 'true';
const cookieOptions = { httpOnly: true, secure, sameSite: 'lax', path: '/' };
const cookieName = secure ? '__Host-cc_session' : 'cc_session';
const formCookieName = secure ? '__Host-cc_form' : 'cc_form';
const firstLoginPath = '/acesso/primeiro-acesso';
const formPaths = new Set(['/login', '/acesso/definir-senha']);
const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);
const idleMinutes = 30;
const absoluteHours = 12;
const maxSessions = 5;
const csrfPeriod = 15 * 60 * 1000;
const appOrigin = process.env.APP_URL ? parseOrigin(process.env.APP_URL, secure) : null;
const hexToken = /^[0-9a-f]{64}$/;
const hash = value => createHash('sha256').update(value).digest('hex');
const randomToken = () => randomBytes(32).toString('hex');
const sign = value => createHmac('sha256', secret).update(value).digest('hex');
const normalizedPath = req => req.path.toLowerCase().replace(/\/$/, '');
const isFormPath = req => formPaths.has(normalizedPath(req));

function parseOrigin(value, requireHttps = false) {
    const message = 'APP_URL deve conter a origem HTTP(S) do aplicativo, com HTTPS em produção.';
    let url;
    try {
        url = new URL(value);
    } catch {
        throw new Error(message);
    }
    if (!['https:', 'http:'].includes(url.protocol) || (requireHttps && url.protocol !== 'https:') ||
        url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
        throw new Error(message);
    }
    return url.origin;
}

function requestOrigin(req) {
    try {
        const protocol = renderTerminatesHttps ? 'https' : req.protocol;
        return parseOrigin(`${protocol}://${req.get('host')}`, secure);
    } catch {
        return null;
    }
}

function linkOrigin(req) {
    return appOrigin || (secure ? null : requestOrigin(req));
}

function matches(value, expected) {
    return typeof value === 'string' && value.length === 64 && hexToken.test(value) &&
        timingSafeEqual(Buffer.from(value, 'hex'), Buffer.from(expected, 'hex'));
}

function readCookie(req, name) {
    const prefix = name + '=';
    const entry = (req.headers.cookie || '').split(';').map(value => value.trim())
        .find(value => value.startsWith(prefix));
    if (!entry) return null;
    const [value, signature, extra] = entry.slice(prefix.length).split('.');
    return extra === undefined && hexToken.test(value) && matches(signature, sign(name + ':' + value)) ? value : null;
}

function setCookie(res, name, value, maxAge) {
    res.cookie(name, value + '.' + sign(name + ':' + value), { ...cookieOptions, maxAge });
}

function setSessionCookie(res, token, expiresAt) {
    setCookie(res, cookieName, token, Math.max(0, expiresAt - Date.now()));
}

function formToken(seed, nonce, bucket) {
    return nonce + sign(`csrf:${seed}:${bucket}:${nonce}`).slice(0, 32);
}

function applyCsrf(req, res, seed) {
    req.csrfSeed = seed;
    const nonce = randomBytes(16).toString('hex');
    res.locals.csrfToken = formToken(seed, nonce, Math.floor(Date.now() / csrfPeriod));
}

async function takeFlash(sessionHash) {
    const { rows } = await query(`
        UPDATE sessions AS s SET flash = NULL
        FROM (SELECT token_hash, flash FROM sessions WHERE token_hash = $1 AND flash IS NOT NULL FOR UPDATE) AS saved
        WHERE s.token_hash = saved.token_hash RETURNING saved.flash
    `, [sessionHash]);
    return rows[0]?.flash || null;
}

async function loadSession(req, res, next) {
    const token = readCookie(req, cookieName);
    if (!token) return;

    const sessionHash = hash(token);
    const { rows: [session] } = await query(`
        UPDATE sessions AS s SET
            last_seen_at = GREATEST(s.last_seen_at, NOW()),
            expires_at = LEAST(GREATEST(s.expires_at, NOW() + make_interval(mins => $2)), s.absolute_expires_at)
        FROM users AS u
        WHERE s.token_hash = $1 AND s.user_id = u.id AND u.active
            AND s.expires_at > NOW() AND s.absolute_expires_at > NOW()
        RETURNING u.id, u.name, u.email, u.role, u.must_change_password, s.id AS session_id, s.csrf_token, s.expires_at
    `, [sessionHash, idleMinutes]);
    if (!session) {
        res.clearCookie(cookieName, cookieOptions);
        return;
    }

    const { id, name, email, role, must_change_password: mustChangePassword } = session;
    req.user = res.locals.user = { id, name, email, role, mustChangePassword };
    req.session = { id: session.session_id, hash: sessionHash, expiresAt: session.expires_at };
    applyCsrf(req, res, session.csrf_token);
    setSessionCookie(res, token, session.expires_at);

    if (req.method !== 'GET') return;
    const render = res.render.bind(res);
    res.render = (view, options, callback) => takeFlash(sessionHash).then(flash => {
        res.locals.flash = flash;
        render(view, options, callback);
    }, error => {
        res.render = render;
        next(error);
    });
}

const load = asyncHandler(async (req, res, next) => {
    Object.assign(req, { user: null, session: null, csrfSeed: null });
    Object.assign(res.locals, { user: null, csrfToken: null });
    req.setFlash = async flash => {
        if (req.session)
            await query('UPDATE sessions SET flash = $2 WHERE token_hash = $1', [req.session.hash, flash]);
    };

    await loadSession(req, res, next);
    if (isFormPath(req)) {
        res.set('Cache-Control', 'no-store');
        if (!req.user) {
            let seed = readCookie(req, formCookieName);
            if (safeMethods.has(req.method)) {
                seed ||= randomToken();
                setCookie(res, formCookieName, seed, csrfPeriod * 2);
            }
            if (seed) applyCsrf(req, res, seed);
        }
    }
    next();
});

async function create(req, res, user) {
    const token = randomToken();
    const tokenHash = hash(token);
    const session = await withTransaction(async client => {
        const { rows: current } = await client.query(
            'SELECT id FROM users WHERE id = $1 AND active AND password_hash = $2 AND name = $3 FOR UPDATE',
            [user.id, user.password_hash, user.name]
        );
        if (!current.length) return null;
        const { rows } = await client.query(`
            INSERT INTO sessions(token_hash, user_id, csrf_token, expires_at, absolute_expires_at, user_agent, ip)
            VALUES ($1, $2, $3, NOW() + make_interval(mins => $4),
                NOW() + make_interval(hours => $5), $6, $7)
            RETURNING expires_at
        `, [tokenHash, user.id, randomToken(), idleMinutes, absoluteHours,
            req.get('user-agent')?.slice(0, 512) || null, req.ip || null]);
        await client.query(`
            DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2 AND (
                expires_at <= NOW() OR token_hash IN (
                    SELECT token_hash FROM sessions WHERE user_id = $1 AND token_hash <> $2
                        AND expires_at > NOW()
                    ORDER BY last_seen_at DESC, created_at DESC, id DESC OFFSET $3
                )
            )
        `, [user.id, tokenHash, maxSessions - 1]);
        return rows[0];
    });
    if (!session) return false;
    setSessionCookie(res, token, session.expires_at);
    res.clearCookie(formCookieName, cookieOptions);
    return true;
}

async function rotate(req, res, change) {
    const token = randomToken();
    const newHash = hash(token);
    if (!await change(req.session.hash, newHash)) return false;
    req.session.hash = newHash;
    setSessionCookie(res, token, req.session.expiresAt);
    return true;
}

async function list(req) {
    const { rows } = await query(`
        SELECT id, created_at, last_seen_at, user_agent, ip
        FROM sessions WHERE user_id = $1 AND expires_at > NOW()
        ORDER BY last_seen_at DESC, created_at DESC
    `, [req.user.id]);
    return rows;
}

async function destroy(req, res) {
    if (req.session)
        await query('DELETE FROM sessions WHERE token_hash = $1', [req.session.hash]);
    res.clearCookie(cookieName, cookieOptions);
}

async function destroyById(req, id) {
    await query('DELETE FROM sessions WHERE id = $1 AND user_id = $2', [id, req.user.id]);
}

async function destroyAll(req, res) {
    await withTransaction(async client => {
        await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [req.user.id]);
        await client.query('DELETE FROM sessions WHERE user_id = $1', [req.user.id]);
    });
    res.clearCookie(cookieName, cookieOptions);
}

async function cleanupExpired() {
    await query('DELETE FROM sessions WHERE expires_at <= NOW()');
    await query('DELETE FROM login_attempts WHERE window_started_at <= NOW() - INTERVAL \'15 minutes\'');
    await query('DELETE FROM password_links WHERE expires_at <= NOW()');
}

function requireAuth(req, res, next) {
    if (!req.user) {
        res.set('Cache-Control', 'no-store');
        return res.redirect(req.method === 'GET' ? '/login?next=' + encodeURIComponent(req.originalUrl) : '/login');
    }
    next();
}

function requirePasswordChange(req, res, next) {
    const path = normalizedPath(req);
    if (req.user?.mustChangePassword && path !== firstLoginPath && path !== '/sair')
        return res.redirect(303, firstLoginPath);
    next();
}

function requireRole(role) {
    return (req, res, next) => requireAuth(req, res, () => {
        if (req.user.role !== role)
            return res.status(403).render('pages/error', {
                title: 'Acesso negado', code: 403, message: 'Seu perfil não tem permissão para acessar esta área.'
            });
        next();
    });
}

function rejectCsrf(req, res, event) {
    report(req, event);
    return res.status(403).render('pages/error', {
        title: 'Formulário não autorizado',
        code: 403,
        message: 'Recarregue a página do formulário e tente enviar novamente.'
    });
}

function csrf(req, res, next) {
    if (safeMethods.has(req.method)) return next();

    const origin = req.get('origin');
    const fetchSite = req.get('sec-fetch-site');
    const requiresToken = Boolean(req.user) || isFormPath(req);
    // O proxy pode reescrever o endereço recebido pelo servidor. O token continua obrigatório para o formulário.
    const sameOriginForm = requiresToken && fetchSite === 'same-origin';
    if (fetchSite === 'cross-site' || (origin && !sameOriginForm && origin !== appOrigin && origin !== requestOrigin(req)))
        return rejectCsrf(req, res, 'csrf_origin_rejected');
    if (!requiresToken) return next();

    const value = req.body?._csrf;
    const bucket = Math.floor(Date.now() / csrfPeriod);
    const nonce = typeof value === 'string' && value.length === 64 ? value.slice(0, 32) : null;
    if (!req.csrfSeed || !nonce || !(matches(value, formToken(req.csrfSeed, nonce, bucket)) ||
        matches(value, formToken(req.csrfSeed, nonce, bucket - 1))))
        return rejectCsrf(req, res, 'csrf_token_rejected');

    next();
}

module.exports = {
    load, create, rotate, destroy, destroyById, destroyAll, cleanupExpired, list, requireAuth,
    requirePasswordChange, requireRole, csrf, linkOrigin, firstLoginPath
};
