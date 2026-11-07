const router = require('express').Router();
const pages = require('../controllers/pageController');
router.get('/', pages.home);
router.get('/sobre', pages.about);
router.get('/painel', require('../middleware/auth').requireAuth, require('../middleware/asyncHandler')(pages.dashboard));
module.exports = router;
