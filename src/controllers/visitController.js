const { validationResult } = require('express-validator');
const Client = require('../models/Client');
const Visit = require('../models/Visit');
const { isUuid } = require('../utils/pagination');
const SERVICES = ['Orçamento', 'Instalação', 'Manutenção', 'Suporte', 'Aquisição de equipamento'];
const monthPattern = /^(?:[1-9]\d{3})-(?:0[1-9]|1[0-2])$/;
const formatter = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit'
});

function currentMonth() {
    const parts = Object.fromEntries(formatter.formatToParts(new Date()).map(({ type, value }) => [type, value]));
    return `${parts.year}-${parts.month}`;
}

function monthAfter(value) {
    const [year, month] = value.split('-').map(Number);
    if (year === 9999 && month === 12)
        return '9999-13';
    return month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`;
}

const limitedSearch = value => typeof value === 'string' ? value.trim().slice(0, 160) : '';

function notFound(res) {
    return res.status(404).render('pages/error', {
        title: 'Visita não encontrada',
        code: 404,
        message: 'Não encontramos a visita solicitada. Ela pode ter sido excluída.'
    });
}
async function renderCalendar(req, res, { visitDraft = null, errors = [], status = 200 } = {}) {
    const requestedMonth = typeof req.query.mes === 'string' ? req.query.mes : visitDraft?.scheduledAt?.slice?.(0, 7);
    const undated = requestedMonth === 'sem-data';
    const month = typeof requestedMonth === 'string' && monthPattern.test(requestedMonth) ? requestedMonth : currentMonth();
    const search = limitedSearch(req.query.cliente);
    const [page, clients, hasUndated] = await Promise.all([
        undated ? Visit.undatedPage(search, req.query.apos) : Visit.calendarPage(`${month}-01`, `${monthAfter(month)}-01`, search, req.query.apos),
        Client.options(),
        undated || Visit.hasUndated()
    ]);
    const visits = page.items.map(({ id, clientId, clientName, description, materials, technicians, scheduledAt }) => ({
        id, clientId, clientName, description, materials, technicians, scheduledAt
    }));
    return res.status(status).render('calendar/index', {
        title: 'Calendário',
        page: { ...page, after: req.query.apos },
        month: undated ? 'sem-data' : month,
        undated,
        hasUndated,
        search,
        clients,
        services: SERVICES,
        visitDraft,
        errors,
        calendarJson: JSON.stringify({ visits, days: page.days, month, undated, currentMonth: currentMonth() }).replace(/</g, '\\u003c')
    });
}

async function payload(body) {
    let client;
    if (isUuid(body.clientId)) {
        client = await Client.find(body.clientId);
    } else if (typeof body.clientName === 'string' && body.clientName.trim()) {
        const options = await Client.options(body.clientName.trim(), true);
        if (options.length === 1)
            client = await Client.find(options[0].id);
    }
    if (!client)
        return null;
    return {
        clientId: client.id,
        clientName: client.company || client.name,
        description: body.description,
        materials: body.materials,
        technicians: body.technicians,
        scheduledAt: body.scheduledAt
    };
}

const calendarLocation = visit => {
    const month = visit.scheduledAt.slice(0, 7);
    return monthPattern.test(month) ? `/calendario?mes=${month}` : '/calendario';
};
const unknownClient = { msg: 'Selecione um cliente cadastrado nas sugestões.' };

async function save(req, res, id) {
    const errors = validationResult(req).array();
    const draft = { ...req.body, id };
    const invalid = () => renderCalendar(req, res, { status: 422, visitDraft: draft, errors });
    if (errors.length)
        return invalid();
    const data = await payload(req.body);
    if (!data) {
        errors.push(unknownClient);
        return invalid();
    }
    try {
        const visit = id ? await Visit.update(id, data) : await Visit.create(data);
        if (!visit)
            return notFound(res);
        await req.setFlash({ type: 'success', message: id ? 'Visita atualizada com sucesso.' : 'Visita agendada com sucesso.' });
        return res.redirect(calendarLocation(visit));
    } catch (error) {
        if (error.code !== '23503' && error.code !== '23001')
            throw error;
        errors.push(unknownClient);
        return invalid();
    }
}

exports.index = (req, res) => renderCalendar(req, res);
exports.clients = async (req, res) => res.json({ clients: await Client.options(limitedSearch(req.query.busca)) });
exports.create = (req, res) => save(req, res);
exports.update = async (req, res) => await Visit.find(req.params.id) ? save(req, res, req.params.id) : notFound(res);
exports.remove = async (req, res) => {
    const visit = await Visit.find(req.params.id);
    if (!visit)
        return notFound(res);
    try {
        if (!await Visit.delete(visit.id))
            return notFound(res);
    } catch (error) {
        if (error.code !== '23503' && error.code !== '23001')
            throw error;
        return res.status(409).render('pages/error', {
            title: 'Visita vinculada ao financeiro', code: 409,
            message: 'Exclua o lançamento financeiro antes de excluir a visita.'
        });
    }
    await req.setFlash({ type: 'success', message: 'Visita excluída com sucesso.' });
    return res.redirect(calendarLocation(visit));
};
exports.SERVICES = SERVICES;
