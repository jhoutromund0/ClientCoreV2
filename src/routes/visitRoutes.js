const wrap = require('../middleware/asyncHandler');
const router = require('express').Router();
const visits = require('../controllers/visitController');

router.get('/', wrap(visits.index));
router.get('/nova', wrap(visits.newForm));
router.get('/clientes', wrap(visits.clients));
router.get('/servicos', wrap(visits.services));
router.get('/responsaveis', wrap(visits.assignees));
router.get('/materiais', wrap(visits.materials));
router.get('/:id/editar', wrap(visits.editForm));
router.post('/', wrap(visits.create));
router.post('/:id/cancelar', wrap(visits.cancel));
router.post('/:id/excluir', wrap(visits.remove));
router.post('/:id', wrap(visits.update));

module.exports = router;
