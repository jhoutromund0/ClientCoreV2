const router = require('express').Router();
const finance = require('../controllers/financeController');

router.get('/', finance.index);
router.get('/atendimentos/:visitId', finance.edit);
router.post('/atendimentos/:visitId', finance.save);
router.post('/atendimentos/:visitId/excluir', finance.remove);

module.exports = router;
