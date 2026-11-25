const dashboardService = require('../services/dashboardService');
const render = (view, title) => (req, res) => res.render(view, { title });
module.exports = {
    home: render('pages/home', 'Início'),
    about: render('pages/about', 'Sobre'),
    dashboard: async (req, res) => res.render('pages/dashboard', {
        title: 'Dashboard',
        dashboard: await dashboardService.load(req.query.periodo)
    }),
    notFound: (req, res) => res.status(404).render('pages/error', {
        title: 'Página não encontrada',
        code: 404,
        message: 'O endereço que você tentou acessar não existe ou foi movido.'
    })
};
