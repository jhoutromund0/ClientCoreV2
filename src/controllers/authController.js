const User = require('../models/User');
const auth = require('../middleware/auth');
const render = (res, error = '', status = 200) => res.status(status).render('pages/login', { title: 'Entrar', error });
exports.loginPage = (req, res) => req.user ? res.redirect('/painel') : render(res);
exports.login = async (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    if (email.length > 254 || password.length > 200)
        return render(res, 'Credenciais inválidas.', 401);
    const user = await User.byEmail(email);
    if (!user || !user.active || !await User.verifyPassword(password, user.password_hash))
        return render(res, 'E-mail ou senha inválidos.', 401);
    await auth.create(req, res, user);
    return res.redirect('/painel');
};
exports.logout = async (req, res) => { await auth.destroy(req, res); res.redirect('/'); };
exports.users = async (req, res) => res.render('users/index', { title: 'Usuários do sistema', users: await User.all(), error: null });
exports.createUser = async (req, res) => {
    const { name, email, password, role } = req.body;
    const fail = async (message, status = 422) => res.status(status).render('users/index', { title: 'Usuários do sistema', users: await User.all(), error: message });
    if (typeof name !== 'string' || name.trim().length < 2 || name.length > 120 || typeof email !== 'string' || !/^\S+@\S+\.\S+$/.test(email) || email.length > 254 || typeof password !== 'string' || password.length < 12 || password.length > 200 || !['admin', 'analista'].includes(role))
        return fail('Confira nome, e-mail, perfil e senha (mínimo 12 caracteres).');
    try {
        await User.create({ name: name.trim(), email: email.trim(), password, role });
        res.redirect('/usuarios');
    }
    catch (e) {
        if (e.code === '23505')
            return fail('E-mail já cadastrado.');
        throw e;
    }
};
exports.updateUser = async (req, res) => {
    const { name, email, role, password } = req.body;
    const active = req.body.active === 'on';
    const fail = async (msg) => res.status(422).render('users/index', { title: 'Usuários do sistema', users: await User.all(), error: msg });
    if (typeof name !== 'string' || name.trim().length < 2 || name.length > 120 || typeof email !== 'string' || !/^\S+@\S+\.\S+$/.test(email) || !['admin', 'analista'].includes(role) || password && password.length < 12)
        return fail('Dados inválidos.');
    if (req.params.id === req.user.id && (!active || role !== 'admin'))
        return fail('Você não pode retirar seu próprio acesso de administrador.');
    try {
        await User.update(req.params.id, { name: name.trim(), email: email.trim(), role, active, password });
        res.redirect('/usuarios');
    }
    catch (e) {
        if (e.code === '23505')
            return fail('E-mail já cadastrado.');
        throw e;
    }
};
exports.removeUser = async (req, res) => { if (req.params.id === req.user.id)
    return res.status(400).send('Não é possível excluir a própria conta.'); await User.remove(req.params.id); res.redirect('/usuarios'); };
