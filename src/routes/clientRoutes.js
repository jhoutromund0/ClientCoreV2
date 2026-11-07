const wrap = require('../middleware/asyncHandler');
const router = require('express').Router();
const { body } = require('express-validator');
const clients = require('../controllers/clientController');
const { isValidCnpj } = require('../services/cnpjService');
const optionalText = (field, max, label) => body(field).optional({ checkFalsy: true }).isString().withMessage(`Valor inválido para ${label}.`).bail().trim().isLength({ max }).withMessage(`${label} deve ter até ${max} caracteres.`);
const validateClient = [
    body('name').isString().withMessage('Informe o nome do cliente.').bail().trim().notEmpty().withMessage('Informe o nome do cliente.').isLength({ max: 120 }).withMessage('O nome deve ter até 120 caracteres.'),
    body('email').optional({ checkFalsy: true }).isString().bail().isEmail().withMessage('Informe um e-mail válido.').isLength({ max: 160 }).withMessage('O e-mail deve ter até 160 caracteres.'),
    optionalText('company', 160, 'Empresa'),
    optionalText('cnpj', 18, 'CNPJ').custom((value) => !value || isValidCnpj(value)).withMessage('Informe um CNPJ válido.'),
    optionalText('phone', 20, 'Telefone')
];
router.get('/', wrap(clients.index));
router.get('/novo', wrap(clients.createForm));
router.get('/consulta-cnpj/:cnpj', wrap(clients.lookupCnpj));
router.post('/', validateClient, wrap(clients.create));
router.get('/:id/editar', wrap(clients.editForm));
router.post('/:id', validateClient, wrap(clients.update));
router.post('/:id/excluir', wrap(clients.remove));
module.exports = router;
