const Service = require('../models/Service');

const path = '/configuracoes/servicos';
const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

const text = value => typeof value === 'string' ? value.trim() : '';

function notFound(res) {
    return res.status(404).render('pages/error', {
        title: 'Serviço não encontrado', code: 404, message: 'O serviço solicitado está indisponível.'
    });
}

async function renderIndex(req, res, { service = null, errors = [], status = 200 } = {}) {
    const search = text(req.query.busca).slice(0, 120);
    const page = await Service.page(req.query.apos, search);
    return res.status(status).render('services/index', {
        title: 'Serviços', page, search, service, errors, formatPrice: cents => money.format(cents / 100)
    });
}

exports.index = (req, res) => renderIndex(req, res);

exports.edit = async (req, res) => {
    const service = await Service.find(req.params.id);
    if (!service)
        return notFound(res);
    return renderIndex(req, res, {
        service: { ...service, price: (service.priceCents / 100).toFixed(2).replace('.', ',') }
    });
};

async function save(req, res, id) {
    const draft = { id, name: text(req.body.name), description: text(req.body.description), price: text(req.body.price) };
    const match = /^(\d{1,6})(?:[.,](\d{1,2}))?$/.exec(draft.price);
    const errors = [];
    if (!draft.name || draft.name.length > 120)
        errors.push('Informe um nome com até 120 caracteres.');
    if (!draft.description || draft.description.length > 2000)
        errors.push('Informe uma descrição com até 2.000 caracteres.');
    if (!match)
        errors.push('Informe um valor em reais com até duas casas decimais.');
    if (errors.length)
        return renderIndex(req, res, { service: draft, errors, status: 422 });

    const priceCents = Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0'));
    try {
        const data = { name: draft.name, description: draft.description, priceCents };
        const saved = id ? await Service.update(id, data) : await Service.create(data);
        if (!saved)
            return notFound(res);
    } catch (error) {
        if (error.code !== '23505' || error.constraint !== 'services_name_unique')
            throw error;
        return renderIndex(req, res, { service: draft, errors: ['Já existe um serviço com esse nome.'], status: 422 });
    }
    await req.setFlash({ type: 'success', message: id ? 'Serviço atualizado.' : 'Serviço cadastrado.' });
    return res.redirect(303, path);
}

exports.create = (req, res) => save(req, res, null);
exports.update = async (req, res) => {
    if (!await Service.find(req.params.id))
        return notFound(res);
    return save(req, res, req.params.id);
};

exports.setActive = active => async (req, res) => {
    if (!await Service.setActive(req.params.id, active))
        return notFound(res);
    await req.setFlash({ type: 'success', message: active ? 'Serviço reativado.' : 'Serviço desativado.' });
    return res.redirect(303, path);
};
