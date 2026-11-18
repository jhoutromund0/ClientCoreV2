const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { once } = require('node:events');
const { createServer, request } = require('node:http');
const { after, before, test } = require('node:test');
const { PGlite } = require('@electric-sql/pglite');
const { pgcrypto } = require('@electric-sql/pglite/contrib/pgcrypto');
const { createPgConfig } = require('@electric-sql/pglite/node-postgres');
const { migrate } = require('../script/migrate');

const admin = { name: 'Admin de testes', email: 'admin@example.test', password: 'admin com senha exclusiva 230!', role: 'admin' };
const analyst = { name: 'Analista de testes', email: 'analista@example.test', password: 'analista com senha exclusiva 231!', role: 'analista' };
const client = { name: 'Cliente de testes', cnpj: '04.252.011/0001-10', email: 'cliente@example.test' };
let engine;
let pool;
let server;
let origin;

before(async () => {
    engine = new PGlite({ extensions: { pgcrypto } });
    server = createServer();
    await once(server.listen(0, '127.0.0.1'), 'listening');
    origin = `http://127.0.0.1:${server.address().port}`;
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = 'postgresql://test@127.0.0.1:1/clientcore_test';
    process.env.DB_SSL = 'false';
    process.env.SESSION_SECRET = randomBytes(32).toString('hex');
    process.env.APP_URL = origin;
    process.env.TRUST_PROXY_HOPS = '0';
    process.env.PASSWORD_BREACH_CHECK = 'false';
    process.env.CNPJA_BASE_URL = 'http://127.0.0.1:1/office';
    process.env.NOMINATIM_BASE_URL = '';
    process.env.OSRM_BASE_URL = '';

    ({ pool } = require('../src/config/database'));
    // Run the app's usual pool and SQL against the in-process database.
    Object.assign(pool.options, createPgConfig(engine), { connectionString: undefined, max: 1, ssl: false });
    assert.ok((await migrate(pool)).length > 0);
    assert.deepEqual(await migrate(pool), []);

    const User = require('../src/models/User');
    await User.create(admin);
    await User.create(analyst);
    server.on('request', require('../src/app'));
});

after(async () => {
    if (server?.listening)
        await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await pool?.end();
    await engine?.close();
});

function postForms(html) {
    return [...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)]
        .filter(([, attributes]) => /\bmethod="post"/i.test(attributes))
        .map(([, attributes, body]) => {
            const action = /\baction="([^"]+)"/.exec(attributes)?.[1];
            const tokens = [...body.matchAll(/<input\b[^>]*\bname="_csrf"[^>]*>/g)];
            const csrf = tokens.length === 1 && /\bvalue="([A-Za-z0-9._-]+)"/.exec(tokens[0][0])?.[1];
            assert.match(action ?? '', /^\/[\w/?.&=;-]*$/, 'POST form must have a valid action');
            assert.ok(csrf, `POST ${action} must have one valid CSRF field inside the form`);
            return { action, csrf };
        });
}

function browser() {
    const cookies = new Map();

    async function send(path, fields, { sendOrigin = true } = {}) {
        const form = new URLSearchParams();
        for (const [name, values] of Object.entries(fields ?? {})) {
            for (const value of Array.isArray(values) ? values : [values])
                form.append(name, value);
        }
        const body = fields ? form.toString() : undefined;
        const headers = { Cookie: [...cookies.values()].join('; ') };
        if (body !== undefined) {
            if (sendOrigin) headers.Origin = origin;
            headers['Content-Type'] = 'application/x-www-form-urlencoded';
            headers['Content-Length'] = Buffer.byteLength(body);
        }

        return new Promise((resolve, reject) => {
            const req = request(new URL(path, origin), { method: fields ? 'POST' : 'GET', headers }, res => {
                for (const cookie of res.headers['set-cookie'] ?? []) {
                    const pair = cookie.split(';')[0];
                    const name = pair.slice(0, pair.indexOf('='));
                    if (pair === `${name}=`)
                        cookies.delete(name);
                    else
                        cookies.set(name, pair);
                }
                let html = '';
                res.setEncoding('utf8');
                res.on('data', chunk => { html += chunk; });
                res.on('error', reject);
                res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, html }));
            });
            req.on('error', reject);
            req.end(body);
        });
    }

    async function page(path) {
        const response = await send(path);
        assert.equal(response.status, 200, `GET ${path}`);
        return { ...response, forms: postForms(response.html) };
    }

    async function submit(path, action, fields = {}, options) {
        const { forms } = await page(path);
        const form = forms.find(item => item.action === action);
        assert.ok(form, `POST ${action} form on ${path}`);
        return send(action, { ...fields, _csrf: form.csrf }, options);
    }

    async function login({ email, password }) {
        const response = await submit('/login', '/login', { email, password });
        assert.equal(response.status, 303);
        assert.equal(response.headers.location, '/dashboard');
    }

    return { send, page, submit, login };
}

test('renders authenticated pages for the authorized roles and signs out through the form', async () => {
    const visitor = browser();
    await visitor.page('/');
    await visitor.page('/sobre');
    const privatePage = await visitor.send('/dashboard');
    assert.equal(privatePage.status, 302);
    assert.match(privatePage.headers.location, /^\/login(?:\?|$)/);
    assert.equal((await visitor.send('/pagina-ausente')).status, 404);

    const adminBrowser = browser();
    await adminBrowser.login(admin);
    for (const path of ['/dashboard', '/clientes', '/clientes/novo', '/materiais', '/calendario', '/financeiro', '/configuracoes', '/configuracoes/usuarios', '/conta']) {
        const page = await adminBrowser.page(path);
        assert.ok(page.forms.some(form => form.action === '/sair'), `Logout form on ${path}`);
    }

    const analystBrowser = browser();
    await analystBrowser.login(analyst);
    await analystBrowser.page('/dashboard');
    await analystBrowser.page('/conta');
    assert.equal((await analystBrowser.send('/financeiro')).status, 403);
    assert.equal((await analystBrowser.send('/configuracoes/usuarios')).status, 403);
    const logout = await analystBrowser.submit('/dashboard', '/sair', {}, { sendOrigin: false });
    assert.equal(logout.status, 303);
    assert.equal(logout.headers.location, '/');
    assert.equal((await analystBrowser.send('/dashboard')).status, 302);
    const dashboard = await adminBrowser.page('/dashboard');
    assert.equal(dashboard.headers['cache-control'], 'no-store');
    const csp = dashboard.headers['content-security-policy'];
    assert.match(csp, /(?:^|;)script-src 'self'(?:;|$)/);
    assert.match(csp, /(?:^|;)style-src 'self'(?:;|$)/);
    assert.doesNotMatch(csp, /unsafe-inline|cdn\.tailwindcss\.com/);
});

test('shows a success message once and only to the session that made the change', async () => {
    const adminBrowser = browser();
    const analystBrowser = browser();
    await adminBrowser.login(admin);
    await analystBrowser.login(analyst);
    const saved = await adminBrowser.submit('/configuracoes', '/configuracoes', {
        originAddress: 'Rua dos Testes, 100, Campinas, SP', rate: '1,25'
    });
    assert.equal(saved.status, 302);
    assert.equal(saved.headers.location, '/configuracoes');

    const message = /Configurações de deslocamento salvas/;
    assert.doesNotMatch((await analystBrowser.page('/dashboard')).html, message);
    const settings = await adminBrowser.page('/configuracoes');
    assert.match(settings.html, message);
    assert.match(settings.html, /value="1,25"/);
    assert.doesNotMatch((await adminBrowser.page('/configuracoes')).html, message);
});

test('submits client, stock, calendar and finance forms and preserves linked records', async () => {
    const adminBrowser = browser();
    await adminBrowser.login(admin);
    assert.equal((await adminBrowser.submit('/clientes/novo', '/clientes', client)).status, 302);
    const { rows: [savedClient] } = await pool.query("SELECT id FROM clients WHERE data->>'email'=$1", [client.email]);
    const clientEdit = `/clientes/${savedClient.id}/editar`;
    await adminBrowser.page(clientEdit);
    const duplicateCnpj = await adminBrowser.submit('/clientes/novo', '/clientes', {
        name: 'CNPJ duplicado', email: 'outro@example.test', cnpj: '04252011000110'
    });
    assert.equal(duplicateCnpj.status, 422);
    postForms(duplicateCnpj.html);
    const duplicateEmail = await adminBrowser.submit('/clientes/novo', '/clientes', {
        name: 'E-mail duplicado', email: client.email.toUpperCase()
    });
    assert.equal(duplicateEmail.status, 422);

    const material = { name: 'Cabo do catálogo', measureType: 'comprimento', measure: '100', unit: 'm', unitValue: '2.50' };
    assert.equal((await adminBrowser.submit('/materiais', '/materiais', material)).status, 302);
    const { rows: [savedMaterial] } = await pool.query("SELECT id FROM materials WHERE data->>'name'=$1", [material.name]);
    const materialEdit = `/materiais/${savedMaterial.id}/editar`;
    assert.equal((await adminBrowser.submit(materialEdit, `/materiais/${savedMaterial.id}`, { ...material, measure: '120' })).status, 302);

    const visit = { clientId: savedClient.id, scheduledAt: '2026-11-18T10:00', description: 'Instalação' };
    const calendarPath = '/calendario?mes=2026-11';
    assert.equal((await adminBrowser.submit(calendarPath, '/calendario', visit)).status, 302);
    const { rows: [savedVisit] } = await pool.query("SELECT id FROM visits WHERE data->>'clientId'=$1", [savedClient.id]);
    assert.match((await adminBrowser.page(calendarPath)).html, new RegExp(savedVisit.id));
    assert.doesNotMatch((await adminBrowser.page('/calendario?mes=2026-12')).html, new RegExp(savedVisit.id));
    const financePath = `/financeiro/atendimentos/${savedVisit.id}`;
    const financePage = await adminBrowser.page(financePath);
    assert.match(financePage.html, /src="\/js\/finance\.js"/);
    assert.match(financePage.html, /Cabo do catálogo/);
    assert.equal((await adminBrowser.send('/js/finance.js')).status, 200);
    const catalog = await adminBrowser.send('/financeiro/materiais?busca=Cabo');
    assert.equal(catalog.status, 200);
    assert.deepEqual(JSON.parse(catalog.html).materials, [{
        id: savedMaterial.id, name: material.name, unit: 'm', unitValue: 2.5
    }]);

    const finance = { labor: '100,00', received: '20,00', name: material.name, origin: 'estoque', unit: 'm', quantity: '2,5', cost: '2,50', price: '5,10' };
    assert.equal((await adminBrowser.submit(financePath, financePath, finance)).status, 302);
    const { rows: [financialRecord] } = await pool.query('SELECT data FROM financial_records WHERE id=$1', [savedVisit.id]);
    assert.equal(financialRecord.data.cost, 625);
    assert.equal(financialRecord.data.charge, 11275);
    assert.match((await adminBrowser.page(financePath)).html, /Excluir lançamento/);
    assert.match((await adminBrowser.page('/financeiro')).html, /Cliente de testes/);

    const clientDelete = `/clientes/${savedClient.id}/excluir`;
    assert.equal((await adminBrowser.submit('/clientes', clientDelete)).status, 409);
    assert.equal((await pool.query('SELECT id FROM clients WHERE id=$1', [savedClient.id])).rowCount, 1);

    const visitDelete = `/calendario/${savedVisit.id}/excluir`;
    const calendar = await adminBrowser.page(calendarPath);
    const calendarToken = calendar.forms.find(form => form.action === '/calendario').csrf;
    assert.equal((await adminBrowser.send(visitDelete, { _csrf: calendarToken })).status, 409);
    assert.equal((await pool.query('SELECT id FROM visits WHERE id=$1', [savedVisit.id])).rowCount, 1);

    assert.equal((await adminBrowser.submit(financePath, `${financePath}/excluir`)).status, 302);
    assert.equal((await adminBrowser.send(visitDelete, { _csrf: calendarToken })).status, 302);
    assert.equal((await pool.query('SELECT id FROM visits WHERE id=$1', [savedVisit.id])).rowCount, 0);
    assert.equal((await adminBrowser.submit('/clientes', clientDelete)).status, 302);
    assert.equal((await pool.query('SELECT id FROM clients WHERE id=$1', [savedClient.id])).rowCount, 0);
    assert.equal((await adminBrowser.submit('/materiais', `/materiais/${savedMaterial.id}/excluir`)).status, 302);

    const { rows: audit } = await pool.query(`
        SELECT audit_log.action, users.email FROM audit_log JOIN users ON audit_log.actor_id=users.id
        WHERE audit_log.entity='financial_records' AND audit_log.entity_id=$1 ORDER BY audit_log.id
    `, [savedVisit.id]);
    assert.deepEqual(audit, [{ action: 'insert', email: admin.email }, { action: 'delete', email: admin.email }]);
});

test('changes a password with reauthentication and ends the other sessions', async () => {
    const activeBrowser = browser();
    const otherBrowser = browser();
    await activeBrowser.login(analyst);
    await otherBrowser.login(analyst);
    const password = 'senha renovada e exclusiva de teste! 246';
    const changed = await activeBrowser.submit('/conta', '/conta/senha', {
        currentPassword: analyst.password, password, confirmPassword: password
    });
    assert.equal(changed.status, 303);
    assert.equal(changed.headers.location, '/conta');
    await activeBrowser.page('/conta');
    const revoked = await otherBrowser.send('/dashboard');
    assert.equal(revoked.status, 302);
    assert.match(revoked.headers.location, /^\/login(?:\?|$)/);
    await browser().login({ ...analyst, password });
});

test('lets an invited analyst set an initial password and sign in', async () => {
    const adminBrowser = browser();
    await adminBrowser.login(admin);
    const email = 'convidado@example.test';
    const usersPath = '/configuracoes/usuarios';
    const invite = await adminBrowser.submit(usersPath, usersPath, {
        name: 'Profissional Convidado', email, role: 'analista', currentPassword: admin.password
    });
    assert.equal(invite.status, 200);
    assert.equal(invite.headers['referrer-policy'], 'no-referrer');
    const link = /<input readonly type="text" value="([^"]+)"/.exec(invite.html)?.[1];
    assert.ok(link, 'Admin can share the invitation link from the users page');
    const setup = new URL(link);
    assert.equal(setup.origin, origin);
    assert.equal(setup.pathname, '/acesso/definir-senha');
    const token = setup.searchParams.get('token');
    assert.match(token ?? '', /^[a-f0-9]{64}$/);

    const invited = browser();
    const password = 'livro verde escolhido na biblioteca 94!';
    const setupUrl = setup.pathname + setup.search;
    const updated = await invited.submit(setupUrl, setup.pathname, { token, password, confirmPassword: password });
    assert.equal(updated.status, 303);
    assert.equal(updated.headers.location, '/login');
    assert.equal((await invited.send(setupUrl)).status, 410);
    await invited.login({ email, password });
    await invited.page('/dashboard');
});

test('caps active sessions, renews the inactivity deadline and removes expired rows', async () => {
    const account = { ...analyst, email: 'sessoes@example.test' };
    const { id } = await require('../src/models/User').create(account);
    const browsers = Array.from({ length: 6 }, browser);
    for (const session of browsers)
        await session.login(account);

    const { rows: sessions } = await pool.query(`
        SELECT id, absolute_expires_at, EXTRACT(EPOCH FROM (absolute_expires_at - created_at))::int AS lifetime
        FROM sessions WHERE user_id=$1 ORDER BY created_at DESC, id DESC
    `, [id]);
    assert.equal(sessions.length, 5);
    assert.equal(sessions[0].lifetime, 12 * 60 * 60);
    assert.equal((await browsers[0].send('/dashboard')).status, 302);

    const latest = browsers[5];
    await pool.query("UPDATE sessions SET expires_at=NOW() + INTERVAL '1 minute' WHERE id=$1", [sessions[0].id]);
    await latest.page('/conta');
    const { rows: [renewed] } = await pool.query(`
        SELECT absolute_expires_at, EXTRACT(EPOCH FROM (expires_at - last_seen_at))::int AS idle_timeout
        FROM sessions WHERE id=$1
    `, [sessions[0].id]);
    assert.deepEqual(renewed.absolute_expires_at, sessions[0].absolute_expires_at);
    assert.equal(renewed.idle_timeout, 30 * 60);

    await pool.query("UPDATE sessions SET expires_at=NOW() - INTERVAL '1 second' WHERE user_id=$1", [id]);
    assert.equal((await latest.send('/dashboard')).status, 302);
    await require('../src/middleware/auth').cleanupExpired();
    assert.equal((await pool.query('SELECT id FROM sessions WHERE user_id=$1', [id])).rowCount, 0);
});
