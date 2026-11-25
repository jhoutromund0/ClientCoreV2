const Client = require('../models/Client');
const Service = require('../models/Service');
const Visit = require('../models/Visit');
const VisitResources = require('../models/VisitResources');
const TransportSettings = require('../models/TransportSettings');
const visitTravel = require('../services/visitTravelService');
const { isUuid } = require('../utils/pagination');

const monthPattern = /^(?:[1-9]\d{3})-(?:0[1-9]|1[0-2])$/;
const datePattern = /^([1-9]\d{3})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const kilometersPattern = /^(\d{1,6})(?:[.,](\d{1,3}))?$/;
const saoPauloDate = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
});
const monthName = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', year: 'numeric', month: 'long' });
const text = value => typeof value === 'string' ? value.trim() : '';
const limitedSearch = value => text(value).slice(0, 160);
const list = value => value === undefined ? [] : Array.isArray(value) ? value : [value];
const kilometersField = meters => meters == null ? '' : String(meters / 1000).replace('.', ',');

function today() {
    const parts = Object.fromEntries(saoPauloDate.formatToParts(new Date()).map(({ type, value }) => [type, value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
}

function moveMonth(value, offset) {
    if ((value === '1000-01' && offset < 0) || (value === '9999-12' && offset > 0))
        return null;
    const [year, month] = value.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1 + offset, 1)).toISOString().slice(0, 7);
}

function validDate(value) {
    const match = datePattern.exec(value);
    if (!match)
        return false;
    const [year, month, day] = match.slice(1).map(Number);
    return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) === value;
}

function splitDateTime(value) {
    const date = text(value).slice(0, 10);
    const time = text(value).slice(11, 16);
    return { scheduledDate: validDate(date) ? date : '', scheduledTime: timePattern.test(time) ? time : '' };
}

function visitLabels(visit) {
    const { scheduledDate, scheduledTime } = splitDateTime(visit.scheduledAt);
    const day = scheduledDate ? scheduledDate.split('-').reverse().join('/') : 'Data a corrigir';
    return { ...visit, moment: [day, scheduledTime].filter(Boolean).join(' às '), statusLabel: Visit.statuses[visit.status] };
}

function notFound(res) {
    return res.status(404).render('pages/error', {
        title: 'Visita não encontrada', code: 404, message: 'O atendimento pode ter sido excluído.'
    });
}

function conflict(res, message) {
    return res.status(409).render('pages/error', { title: 'Não foi possível alterar a visita', code: 409, message });
}

function calendarUrl(month, client = '') {
    const query = new URLSearchParams({ mes: month });
    if (client)
        query.set('cliente', client);
    return `/calendario?${query}`;
}

function calendarDays(month, summaries, currentDate) {
    const [year, number] = month.split('-').map(Number);
    const firstWeekday = new Date(Date.UTC(year, number - 1, 1)).getUTCDay();
    const count = new Date(Date.UTC(year, number, 0)).getUTCDate();
    return Array.from({ length: firstWeekday + count }, (_, index) => {
        if (index < firstWeekday)
            return null;
        const day = index - firstWeekday + 1;
        const date = `${month}-${String(day).padStart(2, '0')}`;
        const preview = (summaries[date] || []).map(({ clientName, scheduledAt }) => ({
            clientName: text(clientName) || 'Empresa a vincular',
            time: splitDateTime(scheduledAt).scheduledTime
        }));
        return { day, date, isToday: currentDate === date, count: preview.length, preview };
    });
}

async function index(req, res) {
    const currentDate = today();
    const selected = text(req.query.mes);
    const undated = selected === 'sem-data';
    const month = monthPattern.test(selected) ? selected : currentDate.slice(0, 7);
    const search = limitedSearch(req.query.cliente);
    const previousMonth = moveMonth(month, -1);
    const nextMonth = moveMonth(month, 1);
    const [page, hasUndated] = await Promise.all([
        undated ? Visit.undatedPage(search, req.query.apos) :
            Visit.calendarPage(`${month}-01`, `${nextMonth || '9999-13'}-01`, search, req.query.apos),
        undated || Visit.hasUndated()
    ]);
    return res.render('calendar/index', {
        title: 'Calendário', page: { ...page, after: req.query.apos }, visits: page.items.map(visitLabels),
        month: undated ? 'sem-data' : month,
        monthLabel: monthName.format(new Date(`${month}-01T00:00:00Z`)),
        todayUrl: calendarUrl(currentDate.slice(0, 7)), previousUrl: previousMonth && calendarUrl(previousMonth, search),
        nextUrl: nextMonth && calendarUrl(nextMonth, search), undated, hasUndated, search,
        days: undated ? [] : calendarDays(month, page.days, currentDate),
        total: Object.values(page.days).reduce((count, visits) => count + visits.length, 0)
    });
}

function serviceOptions(services, user) {
    return services.map(({ id, name, priceCents }) => ({ id, name, ...(user.role === 'admin' ? { priceCents } : {}) }));
}

function mergeOptions(first, existing) {
    const options = new Map(first.map(option => [option.id, option]));
    for (const option of existing)
        if (!options.has(option.id))
            options.set(option.id, option);
    return [...options.values()];
}

function formDraft(visit, requestedDay, selectedClient) {
    const scheduled = visit ? splitDateTime(visit.scheduledAt) : {
        scheduledDate: validDate(requestedDay) ? requestedDay : today(), scheduledTime: ''
    };
    return {
        ...scheduled,
        id: visit?.id,
        revision: visit?.revision || '',
        clientId: visit?.clientId || selectedClient?.id || '',
        clientName: visit?.clientName || selectedClient?.company || selectedClient?.name || '',
        serviceId: visit?.serviceId || '',
        description: visit?.description || '',
        servicePrice: '',
        address: visit?.address || selectedClient?.address || '',
        status: visit?.status || 'agendada',
        assigneeIds: visit?.assignees.map(({ id }) => id) || [],
        travelPayeeId: visit?.travelPayeeId || '',
        outboundKm: kilometersField(visit?.manualTravel?.outboundMeters),
        roundTripKm: kilometersField(visit?.manualTravel?.roundTripMeters),
        materials: visit?.materialsUsed.map(line => ({
            materialId: line.materialId,
            plannedQuantity: String(line.plannedQuantity), usedQuantity: String(line.usedQuantity)
        })) || []
    };
}

function returnUrl(source, { id, scheduledAt, scheduledDate } = {}) {
    if (source === 'visitas')
        return id ? `/visitas/${id}` : '/visitas';
    const month = (scheduledAt || scheduledDate || '').slice(0, 7);
    return monthPattern.test(month) ? calendarUrl(month) : '/calendario';
}

async function renderForm(req, res, draft, visit, errors = [], code = 200) {
    const source = (req.body?.retorno || req.query.retorno) === 'visitas' ? 'visitas' : '';
    const [clientsFound, servicesFound, assigneesFound, materialsFound, selectedClient, selectedService, selectedAssignees, selectedMaterials] = await Promise.all([
        Client.options(), Service.catalog(), VisitResources.searchAssignees(), VisitResources.searchMaterials(),
        draft.clientId ? Client.find(draft.clientId) : null,
        draft.serviceId ? Service.find(draft.serviceId) : null,
        VisitResources.findAssignees(draft.assigneeIds),
        VisitResources.findMaterials(draft.materials.map(line => line.materialId))
    ]);
    const selectedClientOption = selectedClient && {
        id: selectedClient.id, label: selectedClient.company || selectedClient.name, address: selectedClient.address
    };
    const extras = (visit?.materialsUsed || []).map(({ materialId, name, unit }) => ({ id: materialId, name, unit }));
    const services = serviceOptions(mergeOptions(servicesFound, selectedService ? [selectedService] : []), req.user);
    return res.status(code).render('visits/form', {
        title: visit ? 'Editar visita' : 'Nova visita', visit, draft, errors, services,
        clients: mergeOptions(clientsFound, selectedClientOption ? [selectedClientOption] : []),
        assignees: mergeOptions(assigneesFound, [...(visit?.assignees || []), ...selectedAssignees]),
        materials: mergeOptions(materialsFound, [...extras, ...selectedMaterials]),
        canPrice: req.user.role === 'admin', source,
        returnTo: returnUrl(source, visit || draft), statuses: Visit.statuses
    });
}

function draftFromBody(body, visit) {
    const official = Object.hasOwn(body, 'recursos');
    const scheduled = Object.hasOwn(body, 'scheduledDate') ? {
        scheduledDate: text(body.scheduledDate), scheduledTime: text(body.scheduledTime)
    } : splitDateTime(body.scheduledAt);
    const materialIds = list(body.materialId);
    const planned = list(body.plannedQuantity);
    const used = list(body.usedQuantity);
    return {
        ...scheduled,
        id: visit?.id,
        revision: typeof body.revision === 'string' ? body.revision : undefined,
        clientId: text(body.clientId).toLowerCase(),
        clientName: text(body.clientName),
        serviceId: text(body.serviceId).toLowerCase(),
        description: text(body.description),
        servicePrice: text(body.servicePrice),
        address: Object.hasOwn(body, 'address') ? text(body.address) : undefined,
        status: text(body.status) || visit?.status || 'agendada',
        confirmed: body.confirmConsumption === 'on',
        assigneeIds: list(body.assigneeId).slice(0, 21).map(id => text(id).toLowerCase()),
        travelPayeeId: body.travelPayeeId === undefined ? visit?.travelPayeeId || '' : text(body.travelPayeeId).toLowerCase(),
        outboundKm: body.outboundKm === undefined ? kilometersField(visit?.manualTravel?.outboundMeters) : text(body.outboundKm),
        roundTripKm: body.roundTripKm === undefined ? kilometersField(visit?.manualTravel?.roundTripMeters) : text(body.roundTripKm),
        materials: materialIds.slice(0, 26).map((materialId, index) => ({
            materialId: text(materialId).toLowerCase(), plannedQuantity: text(planned[index]), usedQuantity: text(used[index])
        })),
        materialsMalformed: planned.length !== materialIds.length || used.length !== materialIds.length,
        official
    };
}

function validate(draft, body, visit, canPrice) {
    const errors = [];
    if (!validDate(draft.scheduledDate))
        errors.push('Informe uma data válida.');
    if ((draft.scheduledTime || (draft.official && !visit)) && !timePattern.test(draft.scheduledTime))
        errors.push('Informe o horário da visita.');
    if ((draft.clientId && !isUuid(draft.clientId)) || (!draft.clientId && !draft.clientName))
        errors.push('Selecione um cliente cadastrado.');
    if ((draft.serviceId && !isUuid(draft.serviceId)) || (draft.official && !visit && !draft.serviceId))
        errors.push('Selecione um serviço ativo.');
    if ((draft.address && draft.address.length > 300) || (body.address !== undefined && typeof body.address !== 'string'))
        errors.push('Informe um endereço com até 300 caracteres.');
    if (!Object.hasOwn(Visit.statuses, draft.status) || (body.status !== undefined && typeof body.status !== 'string'))
        errors.push('Selecione uma situação válida.');
    if (draft.servicePrice && (!canPrice || !/^\d{1,6}(?:[.,]\d{1,2})?$/.test(draft.servicePrice)))
        errors.push('O valor do serviço é informado por um administrador em reais, com até duas casas decimais.');
    if (body.servicePrice !== undefined && typeof body.servicePrice !== 'string')
        errors.push('Informe um valor de serviço válido.');
    if (draft.official && (
        draft.materialsMalformed || draft.materials.length > 25 || draft.assigneeIds.length > 20 ||
        draft.assigneeIds.some(id => !isUuid(id)) || draft.materials.some(line => !isUuid(line.materialId))
    ))
        errors.push('Confira os responsáveis e selecione até 25 materiais válidos.');
    if (body.travelPayeeId !== undefined && (typeof body.travelPayeeId !== 'string' || !draft.official
        || (draft.travelPayeeId && !draft.assigneeIds.includes(draft.travelPayeeId))))
        errors.push('Escolha um responsável da visita para receber o deslocamento.');
    return errors;
}

function priceCents(value) {
    if (!value)
        return undefined;
    const [whole, fraction = ''] = value.replace(',', '.').split('.');
    return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

function mileageFromBody(draft, body, errors) {
    if (body.outboundKm === undefined && body.roundTripKm === undefined)
        return undefined;
    if (typeof body.outboundKm !== 'string' || typeof body.roundTripKm !== 'string') {
        errors.push('Informe a quilometragem de ida e a total.');
        return null;
    }
    if (!draft.outboundKm && !draft.roundTripKm)
        return null;

    const toMeters = value => {
        const match = kilometersPattern.exec(value);
        return match ? Number(match[1]) * 1000 + Number((match[2] || '').padEnd(3, '0')) : NaN;
    };
    const outboundMeters = toMeters(draft.outboundKm);
    const roundTripMeters = toMeters(draft.roundTripKm);
    if (!Number.isFinite(outboundMeters) || !Number.isFinite(roundTripMeters))
        errors.push('Preencha as duas distâncias em quilômetros com até três casas decimais.');
    else if (roundTripMeters < outboundMeters)
        errors.push('A quilometragem total deve ser igual ou superior à distância de ida.');
    return { outboundMeters, roundTripMeters };
}

async function save(req, res, visit) {
    const body = req.body || {};
    const draft = draftFromBody(body, visit);
    const errors = validate(draft, body, visit, req.user.role === 'admin');
    const manualTravel = mileageFromBody(draft, body, errors);
    if (!draft.clientId && draft.clientName && draft.clientName.length <= 340) {
        const options = await Client.options(draft.clientName, true);
        if (options.length === 1)
            draft.clientId = options[0].id;
    }
    if (!draft.clientId && !errors.length)
        errors.push('Selecione um cliente cadastrado.');
    if (errors.length)
        return renderForm(req, res, draft, visit, errors, 422);

    try {
        const { clientId, serviceId, status, address, revision, confirmed, description } = draft;
        const data = {
            clientId, serviceId, status, address, revision, confirmed, description,
            requireAddress: draft.official && !visit,
            scheduledAt: draft.scheduledTime ? `${draft.scheduledDate}T${draft.scheduledTime}` : draft.scheduledDate,
            servicePriceCents: priceCents(draft.servicePrice),
            manualTravel,
            resources: draft.official ? {
                assigneeIds: draft.assigneeIds, materials: draft.materials,
                travelPayeeId: body.travelPayeeId === undefined ? undefined : draft.travelPayeeId || null
            } : undefined,
            materials: text(body.materials).slice(0, 2000), technicians: text(body.technicians).slice(0, 240)
        };
        const saved = visit ? await Visit.update(visit.id, data) : await Visit.create(data);
        if (!saved)
            return notFound(res);
        const message = saved.status === 'concluida' ? 'Visita concluída e estoque atualizado.' :
            visit ? 'Visita atualizada com sucesso.' : 'Visita agendada com sucesso.';
        await req.setFlash({ type: 'success', message });
        return res.redirect(returnUrl(text(body.retorno), saved));
    } catch (error) {
        if (error instanceof Visit.ConflictError)
            return conflict(res, error.message);
        if (error instanceof Visit.ValidationError || error instanceof VisitResources.ValidationError)
            return renderForm(req, res, draft, visit, [error.message], 422);
        if (error.code === '23503' || error.code === '23001')
            return renderForm(req, res, draft, visit, ['Um dos registros foi alterado. Confira cliente, serviço, responsáveis e materiais.'], 422);
        throw error;
    }
}

async function newForm(req, res) {
    const selectedClient = req.query.cliente ? await Client.find(req.query.cliente) : null;
    return renderForm(req, res, formDraft(null, text(req.query.data), selectedClient), null);
}

async function editForm(req, res) {
    const visit = await Visit.find(req.params.id);
    if (!visit)
        return notFound(res);
    if (visit.billingFinalized)
        return conflict(res, 'O lançamento financeiro desta visita precisa ser removido por um administrador antes da edição.');
    return renderForm(req, res, formDraft(visit), visit);
}

async function cancel(req, res) {
    try {
        const visit = await Visit.cancel(req.params.id, req.body?.revision);
        if (!visit)
            return notFound(res);
        await req.setFlash({ type: 'success', message: 'Visita cancelada.' });
        return res.redirect(returnUrl(text(req.body?.retorno), visit));
    } catch (error) {
        if (error instanceof Visit.ConflictError)
            return conflict(res, error.message);
        throw error;
    }
}

async function remove(req, res) {
    let visit;
    try {
        visit = await Visit.remove(req.params.id);
        if (!visit)
            return notFound(res);
    } catch (error) {
        if (error instanceof Visit.ConflictError)
            return conflict(res, error.message);
        if (error.code === '23503' || error.code === '23001')
            return conflict(res, 'Exclua o lançamento financeiro antes de excluir a visita.');
        throw error;
    }
    await req.setFlash({ type: 'success', message: 'Visita excluída com sucesso.' });
    return res.redirect(returnUrl(text(req.body?.retorno), { scheduledAt: visit.scheduledAt }));
}

async function operationalIndex(req, res) {
    const search = limitedSearch(req.query.cliente);
    const requestedStatus = text(req.query.situacao);
    const status = Object.hasOwn(Visit.statuses, requestedStatus) ? requestedStatus : '';
    const [page, settings] = await Promise.all([Visit.operationalPage(search, status, req.query.apos), TransportSettings.get()]);
    const visits = page.items.map(visit => ({ ...visitLabels(visit), tripDisplay: visitTravel.describe(visit, settings) }));
    return res.render('visits/index', { title: 'Visitas', page: { ...page, after: req.query.apos }, visits, search, status, statuses: Visit.statuses });
}

async function operationalDetail(req, res) {
    const visit = await Visit.find(req.params.id);
    if (!visit)
        return notFound(res);
    const tripDisplay = visitTravel.describe(visit, await TransportSettings.get());
    return res.render('visits/detail', { title: 'Visita técnica', visit: visitLabels(visit), tripDisplay, agendaUrl: returnUrl('', visit) });
}

module.exports = {
    index, newForm, editForm, cancel, remove, operationalIndex, operationalDetail,
    clients: async (req, res) => res.json({ clients: await Client.options(limitedSearch(req.query.busca)) }),
    services: async (req, res) => res.json({ options: serviceOptions(await Service.catalog(limitedSearch(req.query.busca)), req.user) }),
    assignees: async (req, res) => res.json({ options: await VisitResources.searchAssignees(limitedSearch(req.query.busca)) }),
    materials: async (req, res) => res.json({ options: await VisitResources.searchMaterials(limitedSearch(req.query.busca)) }),
    create: (req, res) => save(req, res, null),
    update: async (req, res) => {
        const visit = await Visit.find(req.params.id);
        return visit ? save(req, res, visit) : notFound(res);
    }
};
