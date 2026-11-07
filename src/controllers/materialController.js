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
async function renderIndex(res, { materialData = null, errors = [], status = 200 } = {}) {
    return res.status(status).render('materials/index', {
        title: 'Materiais',
        materials: await Material.all(),
        materialData,
        errors
    });
}
exports.index = async (req, res) => renderIndex(res);
exports.editForm = async (req, res) => {
    const item = await Material.find(req.params.id);
    if (!item)
        return notFound(res);
    renderIndex(res, { materialData: item });
};
exports.create = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return renderIndex(res, {
            status: 422,
            materialData: { ...emptyMaterial, ...req.body },
            errors: errors.array()
        });
    }
    await Material.create(req.body);
    req.app.locals.flash = { type: 'success', message: 'Material cadastrado com sucesso.' };
    res.redirect('/materiais');
};
exports.update = async (req, res) => {
    const item = await Material.find(req.params.id);
    if (!item)
        return notFound(res);
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return renderIndex(res, {
            status: 422,
            materialData: { ...item, ...req.body, id: item.id },
            errors: errors.array()
        });
    }
    await Material.update(item.id, req.body);
    req.app.locals.flash = { type: 'success', message: 'Material atualizado com sucesso.' };
    res.redirect('/materiais');
};
exports.remove = async (req, res) => {
    if (!await Material.delete(req.params.id))
        return notFound(res);
    req.app.locals.flash = { type: 'success', message: 'Material excluído com sucesso.' };
    res.redirect('/materiais');
};
