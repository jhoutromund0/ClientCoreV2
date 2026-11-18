const { validationResult } = require('express-validator');
const Material = require('../models/Material');
const emptyMaterial = { name: '', measureType: 'quantidade', measure: '', unit: 'm', unitValue: '' };
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
            materialData: { ...emptyMaterial, ...req.body, id: undefined },
            errors: errors.array()
        });
    }
    await Material.create(req.body);
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
            materialData: { ...item, ...req.body, id: item.id },
            errors: errors.array()
        });
    }
    if (!await Material.update(item.id, req.body))
        return notFound(res);
    await req.setFlash({ type: 'success', message: 'Material atualizado com sucesso.' });
    res.redirect('/materiais');
};
exports.remove = async (req, res) => {
    if (!await Material.delete(req.params.id))
        return notFound(res);
    await req.setFlash({ type: 'success', message: 'Material excluído com sucesso.' });
    res.redirect('/materiais');
};
