const FinancialRecord = require('../models/FinancialRecord');
const Material = require('../models/Material');
const Visit = require('../models/Visit');
const TransportSettings = require('../models/TransportSettings');
const travelService = require('../services/visitTravelService');
const { withTransaction } = require('../config/database');
const { isUuid } = require('../utils/pagination');

const statuses = { pendente: 'Pendente', aprovado: 'Aprovado', recusado: 'Recusado' };
const units = ['un', 'm', 'kg'];
const origins = { estoque: 'Estoque', compra: 'Compra para o cliente' };
const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const distance = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
const formatMoney = (amount) => money.format(amount / 100);
const formatKm = (meters) => `${distance.format(meters / 1000)} km`;
const inputMoney = (amount) => ((amount ?? 0) / 100).toFixed(2);
const text = (value) => typeof value === 'string' ? value.trim() : '';
const list = (value) => Array.isArray(value) ? value : value === undefined ? [] : [value];

function decimal(value, pattern, scale) {
    const match = pattern.exec(value);
    return match ? Number(match[1]) * 10 ** scale + Number((match[2] || '').padEnd(scale, '0')) : NaN;
}

const cents = (value) => decimal(value, /^(\d{1,6})(?:[.,](\d{1,2}))?$/, 2);
const thousandths = (value) => decimal(value, /^(\d{1,4})(?:[.,](\d{1,3}))?$/, 3);

function materialTotals(items) {
    let cost = 0n;
    let charge = 0n;
    for (const item of items) {
        if (![item.quantity, item.cost, item.price].every(Number.isSafeInteger))
            return { cost: NaN, charge: NaN };
        const quantity = BigInt(item.quantity);
        cost += (quantity * BigInt(item.cost) + 500n) / 1000n;
        charge += (quantity * BigInt(item.price) + 500n) / 1000n;
    }
    return { cost: Number(cost), charge: Number(charge) };
}

function inventoryItems(resources, quantityField) {
    return resources.filter(item => item[quantityField] > 0).map(item => ({
        materialId: item.materialId, name: item.name, origin: 'estoque', unit: item.unit,
        quantity: Math.round(item[quantityField] * 1000), cost: item.unitCostCents, price: item.unitPriceCents
    }));
}

async function loadState(visit, client) {
    const run = client?.query.bind(client);
    const record = await FinancialRecord.find(visit.id, run);
    const materials = visit.materialsUsed;
    const settings = await TransportSettings.get(run);
    const finalized = visit.status === 'concluida' || !visit.hasOperationalStatus;
    const billed = record?.billingFinalized === true;
    const planned = finalized || visit.status === 'cancelada' ? [] : inventoryItems(materials, 'plannedQuantity');
    const inventory = billed ? record.inventoryItems : inventoryItems(materials, 'consumedQuantity');
    return {
        record, planned, inventory, finalized,
        isBudget: visit.description === 'Orçamento' || Object.hasOwn(statuses, record?.status),
        travel: billed ? record.travel : travelService.snapshot(visit, settings),
        travelDescription: billed ? { statusMessage: 'O lançamento foi salvo sem um custo de deslocamento calculado.' } : travelService.describe(visit, settings),
        inventoryTotals: materialTotals(inventory)
    };
}

function restoreDraft(visit, record) {
    const followsService = record?.billingFinalized === false && record.usesServicePrice;
    return {
        labor: inputMoney(followsService ? visit.servicePriceCents : record?.labor ?? visit.servicePriceCents),
        received: inputMoney(record?.received),
        travelCharge: inputMoney(record?.travelCharge),
        otherCost: inputMoney(record?.otherCost),
        status: record?.status || 'pendente',
        items: (record?.items || []).map(item => ({
            ...item, quantity: String(item.quantity / 1000), cost: inputMoney(item.cost), price: inputMoney(item.price)
        }))
    };
}

function notFound(res) {
    return res.status(404).render('pages/error', {
        title: 'Atendimento não encontrado', code: 404,
        message: 'Selecione um atendimento existente no calendário ou na lista de visitas.'
    });
}

async function renderForm(res, visit, state, draft, errors = [], status = errors.length ? 422 : 200) {
    return res.status(status).render('finance/form', {
        title: 'Financeiro do atendimento', visit, state, draft, errors, statuses, units, origins,
        formatKm, formatMoney, materials: visit.status === 'cancelada' ? [] : await Material.catalog()
    });
}

function parseDraft(body, previous, errors) {
    const fields = ['name', 'origin', 'unit', 'quantity', 'cost', 'price'];
    const columns = fields.map(field => list(body[field]));
    const rowCount = columns[0].length;
    if (rowCount > 25 || columns.some(column => column.length !== rowCount))
        errors.push('Informe até 25 itens avulsos com todos os campos preenchidos.');
    return {
        labor: text(body.labor), received: text(body.received), status: text(body.status),
        otherCost: body.otherCost === undefined ? inputMoney(previous?.otherCost) : text(body.otherCost),
        travelCharge: body.travelCharge === undefined ? inputMoney(previous?.travelCharge) : text(body.travelCharge),
        items: columns[0].slice(0, 25).map((_, index) => Object.fromEntries(
            fields.map((field, column) => [field, text(columns[column][index])])
        ))
    };
}

function parseItems(rows, errors) {
    return rows.map((item, index) => {
        const quantity = thousandths(item.quantity);
        const cost = cents(item.cost);
        const price = cents(item.price);
        if (!item.name || item.name.length > 120 || !units.includes(item.unit) || !Object.hasOwn(origins, item.origin)
            || !(quantity > 0) || (item.unit === 'un' && quantity % 1000 !== 0)
            || !Number.isFinite(cost) || !Number.isFinite(price)) {
            errors.push(`Confira os dados do item ${index + 1}. A unidade un exige quantidade inteira.`);
        }
        return { ...item, quantity, cost, price };
    });
}

async function lockedVisit(client, id) {
    if (!isUuid(id))
        return null;
    const { rowCount } = await client.query('SELECT id FROM visits WHERE id = $1 FOR UPDATE', [id]);
    return rowCount ? Visit.find(id, client) : null;
}

exports.index = async (req, res) => {
    const [page, balance] = await Promise.all([Visit.financePage(req.query.apos), FinancialRecord.balance()]);
    const entries = page.items.map(({ visit, record }) => ({ visit, record: FinancialRecord.format(record) }));
    res.render('finance/index', { title: 'Financeiro', entries, page: { ...page, after: req.query.apos }, statuses, formatMoney, balance });
};

exports.catalog = async (req, res) => {
    const search = text(req.query.busca).slice(0, 120);
    const materials = (await Material.catalog(search)).map(({ id, name, unit, unitValue, unitPrice }) => ({ id, name, unit, unitValue, unitPrice }));
    res.json({ materials });
};

exports.edit = async (req, res) => {
    const visit = await Visit.find(req.params.visitId);
    if (!visit)
        return notFound(res);
    const state = await loadState(visit);
    return renderForm(res, visit, state, restoreDraft(visit, state.record));
};

exports.save = async (req, res) => {
    const result = await withTransaction(async client => {
        const visit = await lockedVisit(client, req.params.visitId);
        if (!visit)
            return null;
        const state = await loadState(visit, client);
        const errors = [];
        const draft = parseDraft(req.body || {}, state.record, errors);
        const failure = (status) => ({ visit, state, draft, errors, status });
        if (visit.status === 'cancelada') {
            errors.push('O atendimento foi cancelado.');
            return failure(409);
        }
        const labor = cents(draft.labor);
        const received = cents(draft.received);
        const travelCharge = cents(draft.travelCharge);
        const otherCost = cents(draft.otherCost);
        const travelCost = state.travel?.costCents ?? 0;
        if ([labor, received, travelCharge, otherCost].some(value => !Number.isFinite(value)))
            errors.push('Informe valores válidos para serviço, deslocamento, despesas e recebimento.');
        const status = state.isBudget ? draft.status : 'servico';
        if (state.isBudget && !Object.hasOwn(statuses, status))
            errors.push('Selecione a situação do orçamento.');
        if (received > 0 && (!state.finalized || status === 'pendente' || status === 'recusado'))
            errors.push('Conclua o atendimento e aprove o orçamento, quando aplicável, antes de registrar recebimentos.');
        const items = parseItems(draft.items, errors);
        const supplemental = materialTotals(items);
        const materialCost = state.inventoryTotals.cost + supplemental.cost;
        const materialCharge = state.inventoryTotals.charge + supplemental.charge;
        const charge = labor + materialCharge + travelCharge;
        const cost = materialCost + travelCost + otherCost;
        if (received > charge)
            errors.push('O valor recebido deve ser menor ou igual ao total a cobrar.');
        if (!errors.length && (![charge, cost].every(Number.isSafeInteger) || charge < 0 || cost < 0))
            errors.push('Os totais excedem a precisão suportada. Confira as quantidades e os valores unitários.');
        if (errors.length)
            return failure(422);
        await FinancialRecord.save(visit.id, {
            labor, received, status, items, inventoryItems: state.inventory, travel: state.travel,
            travelCharge, travelCost, otherCost, materialCost, materialCharge, charge, cost,
            billingFinalized: state.finalized, usesServicePrice: labor === visit.servicePriceCents
        }, client.query.bind(client));
        return { saved: true };
    });
    if (!result)
        return notFound(res);
    if (!result.saved)
        return renderForm(res, result.visit, result.state, result.draft, result.errors, result.status);
    await req.setFlash({ type: 'success', message: 'Lançamento financeiro salvo.' });
    return res.redirect('/financeiro');
};

exports.remove = async (req, res) => {
    const removed = await withTransaction(async client => {
        const visit = await lockedVisit(client, req.params.visitId);
        return visit && FinancialRecord.delete(visit.id, client.query.bind(client));
    });
    if (!removed)
        return notFound(res);
    await req.setFlash({ type: 'success', message: 'Lançamento financeiro excluído.' });
    return res.redirect('/financeiro');
};
