const { validationResult } = require('express-validator');
const Client = require('../models/Client');
const cnpjService = require('../services/cnpjService');
const emptyClient = { name: '', company: '', cnpj: '', email: '', phone: '' };
function notFound(res) {
    return res.status(404).render('pages/error', {
        title: 'Cliente não encontrado',
        code: 404,
        message: 'Não encontramos o cliente solicitado. Ele pode ter sido excluído.'
    });
}
exports.index = async (req, res) => {
    res.render('clients/index', { title: 'Clientes', clients: await Client.all() });
};
exports.createForm = async (req, res) => {
    res.render('clients/form', { title: 'Novo cliente', clientData: { ...emptyClient }, errors: [] });
};
exports.create = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(422).render('clients/form', {
            title: 'Novo cliente',
            clientData: { ...emptyClient, ...req.body },
            errors: errors.array()
        });
    }
    await Client.create(req.body);
    req.app.locals.flash = { type: 'success', message: 'Cliente cadastrado com sucesso.' };
    res.redirect('/clientes');
};
exports.editForm = async (req, res) => {
    const client = await Client.find(req.params.id);
    if (!client)
        return notFound(res);
    res.render('clients/form', { title: 'Editar cliente', clientData: client, errors: [] });
};
exports.update = async (req, res) => {
    const client = await Client.find(req.params.id);
    if (!client)
        return notFound(res);
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(422).render('clients/form', {
            title: 'Editar cliente',
            clientData: { ...client, ...req.body, id: client.id },
            errors: errors.array()
        });
    }
    await Client.update(client.id, req.body);
    req.app.locals.flash = { type: 'success', message: 'Cliente atualizado com sucesso.' };
    res.redirect('/clientes');
};
exports.remove = async (req, res) => {
    if (!await Client.delete(req.params.id))
        return notFound(res);
    req.app.locals.flash = { type: 'success', message: 'Cliente excluído com sucesso.' };
    res.redirect('/clientes');
};
// Consulta de CNPJ (CNPJá). Feita pelo servidor para respeitar o CSP e o limite de 5 consultas/min do provedor.
exports.lookupCnpj = async (req, res, next) => {
    try {
        const data = await cnpjService.lookup(req.params.cnpj);
        res.json({ data });
    }
    catch (err) {
        if (!(err instanceof cnpjService.CnpjError))
            return next(err);
        if (err.retryAfter)
            res.set('Retry-After', String(err.retryAfter));
        res.status(err.status).json({ error: err.message });
    }
};
