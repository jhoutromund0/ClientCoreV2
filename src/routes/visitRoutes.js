const wrap = require('../middleware/asyncHandler');
const router = require('express').Router();
const { body } = require('express-validator');
const visits = require('../controllers/visitController');
const validateVisit = [
    body('scheduledAt').isISO8601({ strict: true }).withMessage('Informe a data da visita.'),
    body('clientName').isString().withMessage('Informe o cliente.').bail().trim().notEmpty().withMessage('Informe o cliente.').isLength({ max: 160 }).withMessage('O cliente deve ter até 160 caracteres.'),
    body('description').isIn(visits.SERVICES).withMessage('Selecione o serviço que será realizado.'),
    body('materials').optional({ checkFalsy: true }).isString().bail().trim().isLength({ max: 2000 }).withMessage('Os materiais devem ter até 2000 caracteres.'),
    body('technicians').optional({ checkFalsy: true }).isString().bail().trim().isLength({ max: 240 }).withMessage('Os técnicos devem ter até 240 caracteres.')
];
router.get('/', wrap(visits.index));
router.post('/', validateVisit, wrap(visits.create));
router.post('/:id/excluir', wrap(visits.remove));
router.post('/:id', validateVisit, wrap(visits.update));
module.exports = router;
