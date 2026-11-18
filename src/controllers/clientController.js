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
    const [page, settings] = await Promise.all([Client.page(req.query.apos), TransportSettings.get()]);
    res.render('clients/index', {
        title: 'Clientes',
        page: { ...page, after: req.query.apos },
        clients: page.items.map(client => ({ ...client, tripDisplay: clientTravelService.describe(client, settings) }))
    });
};
exports.createForm = async (req, res) => {
    return renderForm(res, { ...emptyClient });
};
exports.create = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty())
        return renderForm(res, { ...emptyClient, ...req.body, id: undefined }, errors.array());
    try {
        await Client.create(req.body);
    } catch (error) {
        if (error.code !== '23505')
            throw error;
        return renderForm(res, { ...emptyClient, ...req.body, id: undefined }, [duplicateIdentity(error)]);
    }
    await req.setFlash({ type: 'success', message: 'Cliente cadastrado com sucesso.' });
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
    try {
        if (!await Client.update(client.id, req.body))
            return notFound(res);
    } catch (error) {
        if (error.code !== '23505')
            throw error;
        return renderForm(res, { ...client, ...req.body, id: client.id, travel: client.travel }, [duplicateIdentity(error)]);
    }
    await req.setFlash({ type: 'success', message: 'Cliente atualizado com sucesso.' });
    res.redirect('/clientes');
};
exports.remove = async (req, res) => {
    try {
        if (!await Client.delete(req.params.id))
            return notFound(res);
    } catch (error) {
        if (error.code !== '23503' && error.code !== '23001')
            throw error;
        return res.status(409).render('pages/error', {
            title: 'Cliente vinculado a visitas', code: 409,
            message: 'Transfira ou exclua as visitas vinculadas antes de excluir este cliente.'
        });
    }
    await req.setFlash({ type: 'success', message: 'Cliente excluído com sucesso.' });
    res.redirect('/clientes');
};
// Consulta de CNPJ (CNPJá). Feita pelo servidor para respeitar o CSP e o limite de 5 consultas/min do provedor.
exports.lookupCnpj = async (req, res, next) => {
    try {
        const data = await cnpjService.lookup(req.params.cnpj, req.user.id);
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

function duplicateIdentity(error) {
    const field = error.constraint === 'clients_cnpj_unique' ? 'CNPJ' : 'e-mail';
    return { msg: `Já existe um cliente cadastrado com esse ${field}.` };
}
