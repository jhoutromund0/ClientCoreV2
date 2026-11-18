const wrap = require('../middleware/asyncHandler');
const router = require('express').Router();
const { body } = require('express-validator');
const visits = require('../controllers/visitController');
const validateVisit = [
    body('scheduledAt').isString().withMessage('Informe a data da visita.').bail()
        .matches(/^[1-9]\d{3}-\d{2}-\d{2}(?:$|T)/).withMessage('Informe a data da visita.').bail()
        .isISO8601({ strict: true }).withMessage('Informe a data da visita.'),
    body('clientId').optional({ values: 'falsy' }).isString().bail().isUUID().withMessage('Selecione um cliente cadastrado.'),
    body('clientName').optional({ values: 'falsy' }).isString().bail().trim().isLength({ max: 340 }).withMessage('O cliente deve ter até 340 caracteres.'),
    body('description').isString().bail().isIn(visits.SERVICES).withMessage('Selecione o serviço que será realizado.'),
    body('materials').optional({ checkFalsy: true }).isString().bail().trim().isLength({ max: 2000 }).withMessage('Os materiais devem ter até 2000 caracteres.'),
    body('technicians').optional({ checkFalsy: true }).isString().bail().trim().isLength({ max: 240 }).withMessage('Os técnicos devem ter até 240 caracteres.')
];
router.get('/', wrap(visits.index));
router.get('/clientes', wrap(visits.clients));
router.post('/', validateVisit, wrap(visits.create));
router.post('/:id/excluir', wrap(visits.remove));
router.post('/:id', validateVisit, wrap(visits.update));
module.exports = router;
