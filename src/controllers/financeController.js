const FinancialRecord = require('../models/FinancialRecord');
const Material = require('../models/Material');
const Visit = require('../models/Visit');
const statuses = { pendente: 'Pendente', aprovado: 'Aprovado', recusado: 'Recusado' };
const units = ['un', 'm', 'kg'];
const origins = { estoque: 'Estoque', compra: 'Compra para o cliente' };
const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const formatMoney = (cents) => money.format(cents / 100);
const text = (value) => typeof value === 'string' ? value.trim() : '';
const list = (value) => Array.isArray(value) ? value : value === undefined ? [] : [value];
function cents(value) {
    const match = /^(\d{1,6})(?:[.,](\d{1,2}))?$/.exec(text(value));
    return match ? Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0')) : NaN;
}
function totals(labor, items) {
    const cost = items.reduce((sum, item) => sum + Math.round(item.quantity * item.cost / 1000), 0);
    const charges = items.reduce((sum, item) => sum + Math.round(item.quantity * item.price / 1000), 0);
    return { cost, charge: labor + charges };
}
function notFound(res) {
    return res.status(404).render('pages/error', {
        title: 'Atendimento não encontrado',
        code: 404,
        message: 'Selecione um atendimento existente no calendário.'
    });
}
async function renderForm(res, visit, draft, errors = []) {
    return res.status(errors.length ? 422 : 200).render('finance/form', {
        title: 'Financeiro do atendimento',
        visit, draft, errors, statuses, units, origins,
        hasRecord: Boolean(await FinancialRecord.find(visit.id)),
        materials: await Material.all()
    });
}
exports.index = async (req, res) => {
    const entries = await Promise.all((await Visit.all()).map(async (visit) => ({ visit, record: await FinancialRecord.find(visit.id) })));
    res.render('finance/index', { title: 'Financeiro', entries, statuses, formatMoney });
};
exports.edit = async (req, res) => {
    const visit = await Visit.find(req.params.visitId);
    if (!visit)
        return notFound(res);
    const record = await FinancialRecord.find(visit.id);
    const draft = record ? {
        labor: (record.labor / 100).toFixed(2),
        received: (record.received / 100).toFixed(2),
        status: record.status,
        items: record.items.map((item) => ({
            ...item,
            quantity: String(item.quantity / 1000),
            cost: (item.cost / 100).toFixed(2),
            price: (item.price / 100).toFixed(2)
        }))
    } : { labor: '0.00', received: '0.00', status: 'pendente', items: [] };
    return renderForm(res, visit, draft);
};
exports.save = async (req, res) => {
    const visit = await Visit.find(req.params.visitId);
    if (!visit)
        return notFound(res);
    const { body } = req;
    const fields = ['name', 'origin', 'unit', 'quantity', 'cost', 'price'];
    const columns = fields.map((field) => list(body[field]));
    const rowCount = columns[0].length;
    const errors = [];
    if (rowCount > 25 || columns.some((column) => column.length !== rowCount)) {
        errors.push('Informe até 25 materiais com todos os campos de cada item.');
    }
    const draft = {
        labor: text(body.labor),
        received: text(body.received),
        status: text(body.status),
        items: columns[0].slice(0, 25).map((_, index) => Object.fromEntries(fields.map((field, column) => [field, text(columns[column][index])])))
    };
    const labor = cents(draft.labor);
    const received = cents(draft.received);
    if (!Number.isFinite(labor) || !Number.isFinite(received)) {
        errors.push('Informe valores válidos para o serviço e o recebimento.');
    }
    const status = visit.description === 'Orçamento' ? draft.status : 'servico';
    if (visit.description === 'Orçamento' && !Object.hasOwn(statuses, status)) {
        errors.push('Selecione a situação do orçamento.');
    }
    if ((status === 'pendente' || status === 'recusado') && received > 0) {
        errors.push('Aprove o orçamento antes de registrar um recebimento.');
    }
    const items = draft.items.map((item, index) => {
        const measure = /^\d{1,4}(?:[.,]\d{1,3})?$/.test(item.quantity)
            ? Number(item.quantity.replace(',', '.')) : NaN;
        const quantity = Math.round(measure * 1000);
        const cost = cents(item.cost);
        const price = cents(item.price);
        if (!item.name || item.name.length > 120 || !units.includes(item.unit)
            || !Object.hasOwn(origins, item.origin) || !(quantity > 0)
            || (item.unit === 'un' && quantity % 1000 !== 0)
            || !Number.isFinite(cost) || !Number.isFinite(price)) {
            errors.push(`Confira os dados do material ${index + 1}. Use uma quantidade inteira para a unidade un.`);
        }
        return { ...item, quantity, cost, price };
    });
    const summary = totals(labor, items);
    if (received > summary.charge)
        errors.push('O valor recebido deve ser menor ou igual ao total a cobrar.');
    if (errors.length)
        return renderForm(res, visit, draft, errors);
    await FinancialRecord.save(visit.id, { labor, received, status, items, ...summary });
    req.app.locals.flash = { type: 'success', message: 'Lançamento financeiro salvo.' };
    res.redirect('/financeiro');
};
exports.remove = async (req, res) => {
    await FinancialRecord.delete(req.params.visitId);
    req.app.locals.flash = { type: 'success', message: 'Lançamento financeiro excluído.' };
    res.redirect('/financeiro');
};
