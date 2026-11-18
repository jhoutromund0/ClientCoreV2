const router = require('express').Router();
const settings = require('../controllers/settingsController');
const users = require('../controllers/authController');
const wrap = require('../middleware/asyncHandler');

router.get('/', wrap(settings.index));
router.post('/', wrap(settings.save));
router.get('/usuarios', wrap(users.users));
router.post('/usuarios', wrap(users.createUser));
router.post('/usuarios/:id', wrap(users.updateUser));
router.post('/usuarios/:id/excluir', wrap(users.removeUser));

module.exports = router;
