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

function renderIndex(res, { materialData = null, errors = [], status = 200 } = {}) {
  return res.status(status).render('materials/index', {
    title: 'Materiais',
    materials: Material.all(),
    materialData,
    errors
  });
}

exports.index = (req, res) => renderIndex(res);

exports.editForm = (req, res) => {
  const item = Material.find(req.params.id);
  if (!item) return notFound(res);
  renderIndex(res, { materialData: item });
};

exports.create = (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return renderIndex(res, {
      status: 422,
      materialData: { ...emptyMaterial, ...req.body },
      errors: errors.array()
    });
  }
  Material.create(req.body);
  req.app.locals.flash = { type: 'success', message: 'Material cadastrado com sucesso.' };
  res.redirect('/materiais');
};

exports.update = (req, res) => {
  const item = Material.find(req.params.id);
  if (!item) return notFound(res);
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return renderIndex(res, {
      status: 422,
      materialData: { ...item, ...req.body, id: item.id },
      errors: errors.array()
    });
  }
  Material.update(item.id, req.body);
  req.app.locals.flash = { type: 'success', message: 'Material atualizado com sucesso.' };
  res.redirect('/materiais');
};

exports.remove = (req, res) => {
  if (!Material.delete(req.params.id)) return notFound(res);
  req.app.locals.flash = { type: 'success', message: 'Material excluído com sucesso.' };
  res.redirect('/materiais');
};
