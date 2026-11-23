const TransportSettings = require('../models/TransportSettings');

function renderForm(res, settings, errors = []) {
    return res.status(errors.length ? 422 : 200).render('settings/index', {
        title: 'Configurações', settings, errors
    });
}

exports.index = async (req, res) => {
    const { originAddress, rateCentsPerKm } = await TransportSettings.get();
    const rate = rateCentsPerKm == null ? '' : (rateCentsPerKm / 100).toFixed(2).replace('.', ',');
    return renderForm(res, { originAddress, rate });
};

exports.save = async (req, res) => {
    const originAddress = typeof req.body.originAddress === 'string' ? req.body.originAddress.trim() : '';
    const rate = typeof req.body.rate === 'string' ? req.body.rate.trim() : '';
    const match = /^(\d{1,6})(?:[.,](\d{1,2}))?$/.exec(rate);
    const errors = [];
    if (!originAddress || originAddress.length > 300)
        errors.push('Informe o endereço da empresa com até 300 caracteres.');
    if (!match)
        errors.push('Informe uma tarifa em reais por km com até duas casas decimais.');
    if (errors.length)
        return renderForm(res, { originAddress, rate }, errors);

    const rateCentsPerKm = Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0'));
    await TransportSettings.save({ originAddress, rateCentsPerKm });
    await req.setFlash({ type: 'success', message: 'Configurações de deslocamento salvas.' });
    return res.redirect('/configuracoes');
};
