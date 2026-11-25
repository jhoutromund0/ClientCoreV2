const User = require('../models/User');
const auth = require('../middleware/auth');
const input = require('../services/accountValidation');
const passwordPolicy = require('../services/passwordPolicy');
const throttle = require('../services/loginThrottle');
const { isUuid } = require('../utils/pagination');

const usersPath = '/configuracoes/usuarios';
const accountPath = '/conta';
const setupPath = '/acesso/definir-senha';
const invalidLink = 'O link expirou ou já foi usado. Solicite um novo link ao administrador.';
const invalidCredentials = 'E-mail ou senha inválidos.';
const invalidAccount = { error: 'Confira nome, e-mail, perfil e tarifa por quilômetro.', status: 422 };
const unavailableAccount = { error: 'A conta não está disponível.', status: 404 };
const missingLinkOrigin = { error: 'Configure o endereço público do aplicativo para gerar links.', status: 503 };
const retryMessage = 'Aguarde antes de tentar novamente.';
const date = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' });

function safeNext(value) {
    if (typeof value !== 'string' || value.length > 1000 || !/^\/(?![\\/])/.test(value) ||
        /[\x00-\x1f\x7f\\]/.test(value))
        return '/dashboard';
    return value;
}

function renderLogin(res, { next, error = '', status = 200 }) {
    return res.status(status).render('pages/login', { title: 'Entrar', next, error });
}

function limitResponse(req, res, kind, seconds) {
    throttle.report(req, kind + '_throttled');
    res.set('Retry-After', String(seconds));
    return { error: retryMessage, status: 429 };
}

exports.loginPage = (req, res) => req.user ? res.redirect('/dashboard') :
    renderLogin(res, { next: safeNext(req.query.next) });

exports.login = async (req, res) => {
    if (req.user) return res.redirect(303, '/dashboard');
    const next = safeNext(req.body?.next);
    const email = input.loginAddress(req.body?.email);
    const password = req.body?.password;
    const seconds = await throttle.start(req, 'login', email || '');
    if (seconds) return renderLogin(res, { next, ...limitResponse(req, res, 'login', seconds) });
    if (email && passwordPolicy.input(password)) {
        const account = await User.byEmail(email);
        const valid = await User.verifyPassword(password, account?.active ? account.password_hash : null);
        if (valid && await auth.create(req, res, account)) {
            await throttle.success('login', email);
            return res.redirect(303, next);
        }
    }
    throttle.report(req, 'login_failed');
    return renderLogin(res, { next, error: invalidCredentials, status: 401 });
};

exports.logout = async (req, res) => {
    await auth.destroy(req, res);
    return res.redirect(303, '/');
};

function withPasswordConfirmation(render, action) {
    return async (req, res) => {
        const userId = req.user.id;
        const seconds = await throttle.start(req, 'reauth', userId);
        if (seconds) return render(req, res, limitResponse(req, res, 'reauth', seconds));

        const password = req.body?.currentPassword;
        if (passwordPolicy.input(password)) {
            const account = await User.activeById(userId);
            if (await User.verifyPassword(password, account?.password_hash)) {
                await throttle.success('reauth', userId);
                return action(req, res, account);
            }
        }
        throttle.report(req, 'reauth_failed');
        return render(req, res, { error: 'Confirme a ação com sua senha atual.', status: 422 });
    };
}

async function renderUsers(req, res, { error = null, status = 200, link = null } = {}) {
    const page = await User.page(req.query.apos);
    return res.status(status).render('users/index', { title: 'Usuários do sistema', users: page.items, page, error, link });
}

function renderLink(req, res, origin, token, email) {
    const url = new URL(setupPath, origin);
    url.searchParams.set('token', token);
    return renderUsers(req, res, { link: { url: url.href, email } });
}

exports.users = (req, res) => renderUsers(req, res);

exports.createUser = withPasswordConfirmation(renderUsers, async (req, res, account) => {
    const form = await input.account(req.body);
    if (!form) return renderUsers(req, res, invalidAccount);
    const origin = auth.linkOrigin(req);
    if (!origin)
        return renderUsers(req, res, missingLinkOrigin);

    try {
        const token = await User.createInvited(form, account);
        if (!token)
            return renderUsers(req, res, { error: 'Confirme seu acesso de administrador novamente.', status: 409 });
        return renderLink(req, res, origin, token, form.email);
    } catch (error) {
        if (error.code === '23505')
            return renderUsers(req, res, { error: 'Não foi possível criar a conta com os dados informados.', status: 422 });
        throw error;
    }
});

exports.updateUser = withPasswordConfirmation(renderUsers, async (req, res, account) => {
    const id = req.params.id;
    const form = await input.account(req.body);
    const active = req.body?.active === 'on';
    if (!form || !isUuid(id))
        return renderUsers(req, res, invalidAccount);
    const own = id.toLowerCase() === req.user.id;
    if (own && (!active || form.role !== 'admin')) {
        return renderUsers(req, res, { error: 'Você não pode retirar seu próprio acesso de administrador.', status: 422 });
    }

    try {
        if (!await User.update(id, { ...form, active }, own ? req.session.hash : null, account))
            return renderUsers(req, res, unavailableAccount);
    } catch (error) {
        if (error.code === '23505')
            return renderUsers(req, res, { error: 'Não foi possível atualizar a conta com os dados informados.', status: 422 });
        throw error;
    }
    await req.setFlash({ type: 'success', message: 'Conta atualizada.' });
    return res.redirect(303, usersPath);
});

exports.removeUser = withPasswordConfirmation(renderUsers, async (req, res, account) => {
    const id = req.params.id;
    if (!isUuid(id) || id.toLowerCase() === req.user.id)
        return renderUsers(req, res, { error: 'Selecione outra conta para excluir.', status: 422 });
    try {
        if (!await User.remove(id, account))
            return renderUsers(req, res, unavailableAccount);
    } catch (error) {
        if (!['23503', '23001'].includes(error.code))
            throw error;
        return renderUsers(req, res, { error: 'Esta conta está vinculada a visitas. Desative-a para preservar o histórico.', status: 409 });
    }
    await req.setFlash({ type: 'success', message: 'Conta excluída.' });
    return res.redirect(303, usersPath);
});

exports.recoverUser = withPasswordConfirmation(renderUsers, async (req, res, account) => {
    const id = req.params.id;
    if (!isUuid(id) || id.toLowerCase() === req.user.id)
        return renderUsers(req, res, { error: 'Selecione outra conta para recuperar.', status: 422 });
    const origin = auth.linkOrigin(req);
    if (!origin)
        return renderUsers(req, res, missingLinkOrigin);
    const issued = await User.issuePasswordLink(id, account);
    if (!issued)
        return renderUsers(req, res, unavailableAccount);
    return renderLink(req, res, origin, issued.token, issued.email);
});

async function renderAccount(req, res, { error = null, status = 200 } = {}) {
    const sessions = (await auth.list(req)).map(session => ({
        ...session,
        current: session.id === req.session.id,
        created: date.format(session.created_at),
        lastSeen: date.format(session.last_seen_at)
    }));
    return res.status(status).render('users/account', { title: 'Minha conta', sessions, error });
}

exports.account = (req, res) => renderAccount(req, res);

async function validatePassword(req, account) {
    const { password, confirmPassword } = req.body || {};
    if (password !== confirmPassword)
        return { error: 'Confirme a mesma senha nos dois campos.', status: 422 };
    const issue = await passwordPolicy.validate(password, account);
    return issue && { error: issue.message, status: issue.status || 422 };
}

exports.changePassword = withPasswordConfirmation(renderAccount, async (req, res, account) => {
    if (req.body.password === req.body.currentPassword)
        return renderAccount(req, res, { error: 'Escolha uma senha diferente da atual.', status: 422 });
    const issue = await validatePassword(req, account);
    if (issue) return renderAccount(req, res, issue);
    if (!await User.changePassword(account, req.body.password, req.session.hash))
        return renderAccount(req, res, { error: 'A conta foi alterada. Entre novamente para trocar a senha.', status: 409 });
    await req.setFlash({ type: 'success', message: 'Senha alterada e outras sessões encerradas.' });
    return res.redirect(303, accountPath);
});

exports.endSession = async (req, res) => {
    const id = req.params.id;
    if (!isUuid(id))
        return renderAccount(req, res, { error: 'Sessão inválida.', status: 422 });
    if (id.toLowerCase() === req.session.id) return exports.logout(req, res);
    await auth.destroyById(req, id);
    return res.redirect(303, accountPath);
};

exports.endAllSessions = async (req, res) => {
    await auth.destroyAll(req, res);
    return res.redirect(303, '/login');
};

function renderSetup(res, { token = null, error = null, status = 200 } = {}) {
    return res.status(status).render('users/password', { title: 'Definir senha', token, error });
}

function findPasswordLink(token) {
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return null;
    return User.passwordLinkAccount(token);
}

exports.setupPage = async (req, res) => {
    if (req.user)
        return renderSetup(res, { error: 'Abra o link em uma janela privada ou saia da sua conta antes de continuar.' });
    const token = req.query.token;
    if (!await findPasswordLink(token)) return renderSetup(res, { error: invalidLink, status: 410 });
    return renderSetup(res, { token });
};

exports.setupPassword = async (req, res) => {
    if (req.user) return res.redirect(303, accountPath);
    const token = req.body?.token;
    const account = await findPasswordLink(token);
    if (!account) return renderSetup(res, { error: invalidLink, status: 410 });

    const seconds = await throttle.start(req, 'password_setup', account.id);
    if (seconds) return renderSetup(res, { token, ...limitResponse(req, res, 'password_setup', seconds) });
    const issue = await validatePassword(req, account);
    if (issue) return renderSetup(res, { token, ...issue });
    if (!await User.consumePasswordLink(token, account, req.body.password))
        return renderSetup(res, { error: invalidLink, status: 410 });
    await throttle.success('password_setup', account.id);
    return res.redirect(303, '/login');
};
