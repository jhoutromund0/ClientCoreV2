const { validationResult } = require('express-validator');
const Client = require('../models/Client');
const TransportSettings = require('../models/TransportSettings');
const cnpjService = require('../services/cnpjService');
const clientTravelService = require('../services/clientTravelService');
const location = require('../services/locationService');
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
    const publicLookup = !location.isConfigured();
    const transportSettings = editing || publicLookup ? await TransportSettings.get() : null;
    const travel = editing ? clientTravelService.describe(clientData, transportSettings) : null;
    return res.status(errors.length ? 422 : 200).render('clients/form', {
        title: editing ? 'Editar cliente' : 'Novo cliente', clientData, errors, travel, transportSettings,
        publicLookup
    });
}

async function finishSave(req, res, client, message) {
    let flash = { type: 'success', message };
    if (req.body.publicUse === 'yes' && client.address && !location.isConfigured()) {
        try {
            const result = await clientTravelService.calculateOnSave(client, req.body.expectedRevision);
            flash = { type: result.type, message: `${message} ${result.message}` };
        } catch (error) {
            console.error({ event: 'client_travel_after_save_failed', code: error.code || error.name });
            flash = { type: 'info', message: `${message} A quilometragem ficou pendente.` };
        }
    }
    await req.setFlash(flash);
    return res.redirect('/clientes');
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
    let client;
    try {
        client = await Client.create(req.body);
    } catch (error) {
        if (error.code !== '23505')
            throw error;
        return renderForm(res, { ...emptyClient, ...req.body, id: undefined }, [duplicateIdentity(error)]);
    }
    return finishSave(req, res, client, 'Cliente cadastrado com sucesso.');
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
    let updated;
    try {
        updated = await Client.update(client.id, req.body);
        if (!updated)
            return notFound(res);
    } catch (error) {
        if (error.code !== '23505')
            throw error;
        return renderForm(res, { ...client, ...req.body, id: client.id, travel: client.travel }, [duplicateIdentity(error)]);
    }
    return finishSave(req, res, updated, 'Cliente atualizado com sucesso.');
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
