const { validationResult } = require('express-validator');
const Material = require('../models/Material');
const emptyMaterial = { name: '', measureType: 'quantidade', measure: '', unit: 'm', unitValue: '', unitPrice: '' };

function fields(req) {
    const { name, measureType, measure, unit, unitValue, unitPrice, revision } = req.body;
    return { name, measureType, measure, unit, unitValue, revision,
        unitPrice: req.user.role === 'admin' ? unitPrice : undefined };
}
function notFound(res) {
    return res.status(404).render('pages/error', {
        title: 'Material não encontrado',
        code: 404,
        message: 'Não encontramos o material solicitado. Ele pode ter sido excluído.'
    });
}
async function renderIndex(req, res, { materialData = null, errors = [], status = 200 } = {}) {
    const search = typeof req.query.busca === 'string' ? req.query.busca.trim().slice(0, 120) : '';
    const [page, summary] = await Promise.all([Material.page(req.query.apos, search), Material.summary(search)]);
    return res.status(status).render('materials/index', {
        title: 'Materiais',
        materials: page.items,
        page: { ...page, after: req.query.apos },
        search,
        summary,
        materialData,
        errors
    });
}
exports.index = (req, res) => renderIndex(req, res);
exports.editForm = async (req, res) => {
    const item = await Material.find(req.params.id);
    if (!item)
        return notFound(res);
    return renderIndex(req, res, { materialData: item });
};
exports.create = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return renderIndex(req, res, {
            status: 422,
            materialData: { ...emptyMaterial, ...fields(req), id: undefined, revision: undefined },
            errors: errors.array()
        });
    }
    await Material.create(fields(req));
    await req.setFlash({ type: 'success', message: 'Material cadastrado com sucesso.' });
    res.redirect('/materiais');
};
exports.update = async (req, res) => {
    const item = await Material.find(req.params.id);
    if (!item)
        return notFound(res);
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return renderIndex(req, res, {
            status: 422,
            materialData: { ...item, ...fields(req), id: item.id, revision: item.revision },
            errors: errors.array()
        });
    }
    try {
        const draft = fields(req);
        if (!await Material.update(item.id, { ...draft, revision: draft.revision || item.revision }))
            return notFound(res);
    } catch (error) {
        if (!(error instanceof Material.ConflictError))
            throw error;
        const current = await Material.find(item.id);
        if (!current)
            return notFound(res);
        return renderIndex(req, res, { status: 409, materialData: current, errors: [{ msg: error.message }] });
    }
    await req.setFlash({ type: 'success', message: 'Material atualizado com sucesso.' });
    res.redirect('/materiais');
};
exports.remove = async (req, res) => {
    try {
        if (!await Material.delete(req.params.id))
            return notFound(res);
    } catch (error) {
        if (!['23503', '23001'].includes(error.code))
            throw error;
        return res.status(409).render('pages/error', { title: 'Material vinculado a uma visita', code: 409,
            message: 'Itens usados em visitas permanecem cadastrados para preservar o histórico.' });
    }
    await req.setFlash({ type: 'success', message: 'Material excluído com sucesso.' });
    res.redirect('/materiais');
};
