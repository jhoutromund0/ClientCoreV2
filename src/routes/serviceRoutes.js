const router = require('express').Router();
const wrap = require('../middleware/asyncHandler');
const service = require('../controllers/serviceController');

router.get('/', wrap(service.index));
router.post('/', wrap(service.create));
router.get('/:id/editar', wrap(service.edit));
router.post('/:id', wrap(service.update));
router.post('/:id/desativar', wrap(service.setActive(false)));
router.post('/:id/reativar', wrap(service.setActive(true)));

module.exports = router;
