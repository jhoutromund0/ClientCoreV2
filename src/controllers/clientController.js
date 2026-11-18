const { validationResult } = require('express-validator');
const Client = require('../models/Client');
const TransportSettings = require('../models/TransportSettings');
const cnpjService = require('../services/cnpjService');
const clientTravelService = require('../services/clientTravelService');
const emptyClient = { name: '', company: '', cnpj: '', email: '', phone: '', address: '', establishmentType: '' };
function notFound(res) {
    return res.status(404).render('pages/error', {
        title: 'Cliente não encontrado',
        code: 404,
        message: 'Não encontramos o cliente solicitado. Ele pode ter sido excluído.'
    });
}
async function renderForm(res, clientData, errors = []) {
    const editing = Boolean(clientData.id);
    const travel = editing ? clientTravelService.describe(clientData, await TransportSettings.get()) : null;
    return res.status(errors.length ? 422 : 200).render('clients/form', {
        title: editing ? 'Editar cliente' : 'Novo cliente', clientData, errors, travel
    });
}
exports.index = async (req, res) => {
    const [clients, settings] = await Promise.all([Client.all(), TransportSettings.get()]);
    res.render('clients/index', {
        title: 'Clientes',
        clients: clients.map(client => ({ ...client, tripDisplay: clientTravelService.describe(client, settings) }))
    });
};
exports.createForm = async (req, res) => {
    return renderForm(res, { ...emptyClient });
};
exports.create = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty())
        return renderForm(res, { ...emptyClient, ...req.body, id: undefined }, errors.array());
    await Client.create(req.body);
    req.app.locals.flash = { type: 'success', message: 'Cliente cadastrado com sucesso.' };
    res.redirect('/clientes');
};
exports.editForm = async (req, res) => {
    const client = await Client.find(req.params.id);
    if (!client)
        return notFound(res);
    return renderForm(res, client);
};
exports.update = async (req, res) => {
    const client = await Client.find(req.params.id);
    if (!client)
        return notFound(res);
    const errors = validationResult(req);
    if (!errors.isEmpty())
        return renderForm(res, { ...client, ...req.body, id: client.id, travel: client.travel }, errors.array());
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
