const Client = require('../models/Client');

const render = (view, title, extra = {}) => (req, res) => res.render(view, { title, ...extra });

module.exports = {
  home: render('pages/home', 'Início'),
  about: render('pages/about', 'Sobre'),
  login: render('pages/login', 'Entrar'),
  register: render('pages/register', 'Criar conta'),
  dashboard: (req, res) => res.render('pages/dashboard', { title: 'Painel', clientCount: Client.all().length }),
  // Autenticação ainda não existe: evita enviar credenciais pela URL e informa o estado atual.
  authNotReady: (redirectTo) => (req, res) => {
    req.app.locals.flash = { type: 'info', message: 'A autenticação ainda não está conectada. Nenhum dado foi salvo.' };
    res.redirect(redirectTo);
  },
  notFound: (req, res) => res.status(404).render('pages/error', {
    title: 'Página não encontrada',
    code: 404,
    message: 'O endereço que você tentou acessar não existe ou foi movido.'
  })
};
