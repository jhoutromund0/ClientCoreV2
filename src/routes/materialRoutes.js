const router = require('express').Router();
const { body } = require('express-validator');
const materials = require('../controllers/materialController');

const validateMaterial = [
  body('name').isString().withMessage('Informe o nome do material.').bail().trim().notEmpty().withMessage('Informe o nome do material.').isLength({ max: 120 }).withMessage('O nome deve ter até 120 caracteres.'),
  body('measureType').isIn(['quantidade', 'comprimento']).withMessage('Selecione quantidade ou comprimento.'),
  body('measure').isFloat({ gt: 0, max: 1000000 }).withMessage('Informe uma medida maior que zero.'),
  body('unit').optional({ checkFalsy: true }).isIn(['m', 'kg', 'un']).withMessage('Selecione metro ou kg.'),
  body('unitValue').isFloat({ min: 0, max: 100000000 }).withMessage('Informe um valor unitário válido.')
];

router.get('/', materials.index);
router.post('/', validateMaterial, materials.create);
router.get('/:id/editar', materials.editForm);
router.post('/:id', validateMaterial, materials.update);
router.post('/:id/excluir', materials.remove);

module.exports = router;
