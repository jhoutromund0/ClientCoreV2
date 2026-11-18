const router = require('express').Router();
const pages = require('../controllers/pageController');
const { requireAuth } = require('../middleware/auth');
const wrap = require('../middleware/asyncHandler');

const goToDashboard = (req, res) => res.redirect('/dashboard');
const publicPage = (render) => (req, res) => req.user ? goToDashboard(req, res) : render(req, res);

router.get('/', publicPage(pages.home));
router.get('/sobre', publicPage(pages.about));
router.get('/dashboard', requireAuth, wrap(pages.dashboard));
router.get('/painel', requireAuth, goToDashboard);
module.exports = router;
