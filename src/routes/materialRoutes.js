const wrap = require('../middleware/asyncHandler');
const router = require('express').Router();
const { body } = require('express-validator');
const materials = require('../controllers/materialController');
const scalar = value => typeof value === 'string' || typeof value === 'number';
const validateMaterial = [
    body('name').isString().withMessage('Informe o nome do material.').bail().trim().notEmpty().withMessage('Informe o nome do material.').isLength({ max: 120 }).withMessage('O nome deve ter até 120 caracteres.'),
    body('measureType').isString().bail().isIn(['quantidade', 'comprimento']).withMessage('Selecione quantidade ou comprimento.'),
    body('measure').custom(scalar).bail().isFloat({ min: 0, max: 1000000 }).withMessage('Informe um saldo entre zero e 1.000.000.'),
    body('unit').optional({ values: 'falsy' }).isString().bail().isIn(['m', 'kg', 'un']).withMessage('Selecione metro ou kg.'),
    body('unitValue').custom(scalar).bail().isFloat({ min: 0, max: 100000000 }).withMessage('Informe um custo unitário válido.'),
    body('unitPrice').optional({ values: 'falsy' }).custom((value, { req }) => req.user.role !== 'admin' ||
        (scalar(value) && /^\d{1,9}(?:\.\d{1,2})?$/.test(String(value)) && Number(value) <= 100000000))
        .withMessage('Informe um preço unitário válido.'),
    body('revision').optional({ values: 'falsy' }).isString().bail().isUUID().withMessage('Recarregue a página para atualizar o estoque.')
];
router.get('/', wrap(materials.index));
router.post('/', validateMaterial, wrap(materials.create));
router.get('/:id/editar', wrap(materials.editForm));
router.post('/:id', validateMaterial, wrap(materials.update));
router.post('/:id/excluir', wrap(materials.remove));
module.exports = router;
