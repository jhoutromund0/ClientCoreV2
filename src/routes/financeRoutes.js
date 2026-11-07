const wrap = require('../middleware/asyncHandler');
const router = require('express').Router();
const finance = require('../controllers/financeController');
router.get('/', wrap(finance.index));
router.get('/atendimentos/:visitId', wrap(finance.edit));
router.post('/atendimentos/:visitId', wrap(finance.save));
router.post('/atendimentos/:visitId/excluir', wrap(finance.remove));
module.exports = router;
