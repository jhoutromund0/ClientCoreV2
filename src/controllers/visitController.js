const { validationResult } = require('express-validator');
const Client = require('../models/Client');
const Visit = require('../models/Visit');
const FinancialRecord = require('../models/FinancialRecord');
const SERVICES = ['Orçamento', 'Instalação', 'Manutenção', 'Suporte', 'Aquisição de equipamento'];
function notFound(res) {
    return res.status(404).render('pages/error', {
        title: 'Visita não encontrada',
        code: 404,
        message: 'Não encontramos a visita solicitada. Ela pode ter sido excluída.'
    });
}
async function clientOptions() {
    return (await Client.all()).map((client) => ({
        id: client.id,
        label: client.company || client.name
    }));
}
async function matchClient(name) {
    const wanted = name.trim().toLocaleLowerCase('pt-BR');
    return (await Client.all()).find((client) => {
        const label = (client.company || client.name).trim().toLocaleLowerCase('pt-BR');
        return label === wanted || client.name.trim().toLocaleLowerCase('pt-BR') === wanted;
    }) || null;
}
async function renderCalendar(res, { visitDraft = null, errors = [], status = 200 } = {}) {
    const visits = (await Visit.all()).map((visit) => ({
        id: visit.id,
        clientId: visit.clientId,
        clientName: visit.clientName,
        description: visit.description,
        materials: visit.materials,
        technicians: visit.technicians,
        scheduledAt: visit.scheduledAt
    }));
    return res.status(status).render('calendar/index', {
        title: 'Calendário',
        visits,
        clients: await clientOptions(),
        services: SERVICES,
        visitDraft,
        errors,
        calendarJson: JSON.stringify({ visits, clients: await clientOptions() }).replace(/</g, '\\u003c')
    });
}
async function payload(body) {
    const client = await matchClient(body.clientName || '');
    return {
        clientId: client ? client.id : '',
        clientName: body.clientName,
        description: body.description,
        materials: body.materials,
        technicians: body.technicians,
        scheduledAt: body.scheduledAt
    };
}
exports.index = async (req, res) => renderCalendar(res);
exports.create = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return renderCalendar(res, { status: 422, visitDraft: { ...req.body }, errors: errors.array() });
    }
    await Visit.create(await payload(req.body));
    req.app.locals.flash = { type: 'success', message: 'Visita agendada com sucesso.' };
    res.redirect('/calendario');
};
exports.update = async (req, res) => {
    const visit = await Visit.find(req.params.id);
    if (!visit)
        return notFound(res);
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return renderCalendar(res, {
            status: 422,
            visitDraft: { ...req.body, id: visit.id },
            errors: errors.array()
        });
    }
    await Visit.update(visit.id, await payload(req.body));
    req.app.locals.flash = { type: 'success', message: 'Visita atualizada com sucesso.' };
    res.redirect('/calendario');
};
exports.remove = async (req, res) => {
    if (await FinancialRecord.find(req.params.id)) {
        req.app.locals.flash = { type: 'error', message: 'Exclua o lançamento financeiro antes de excluir a visita.' };
        return res.redirect('/calendario');
    }
    if (!await Visit.delete(req.params.id))
        return notFound(res);
    req.app.locals.flash = { type: 'success', message: 'Visita excluída com sucesso.' };
    res.redirect('/calendario');
};
exports.SERVICES = SERVICES;
