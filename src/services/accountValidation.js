const { body, validationResult } = require('express-validator');

const name = body('name').isString().bail().trim().isLength({ min: 2, max: 120 }).bail()
    .custom(value => !/[\x00-\x1f\x7f]/.test(value));
const email = body('email').optional({ values: 'null' }).isString().bail().trim()
    .isLength({ max: 254 }).bail().if(value => value !== '').isEmail().bail()
    .customSanitizer(value => value.toLowerCase());
const mileageRate = body('mileageRate').optional().isString().bail().trim()
    .matches(/^(?:\d{1,6}(?:[.,]\d{1,2})?)?$/).bail().customSanitizer(value => {
        if (value === '')
            return null;
        const [whole, decimals = ''] = value.split(/[.,]/);
        return Number(whole) * 100 + Number(decimals.padEnd(2, '0'));
    });
const accountFields = [
    name,
    email,
    body('role').isString().bail().isIn(['admin', 'analista']),
    mileageRate
];

async function validatedAccount(body, fields) {
    const request = { body };
    await Promise.all(fields.map(field => field.run(request)));
    if (!validationResult(request).isEmpty())
        return null;
    request.body.email ||= null;
    return request.body;
}

async function newAccount(input) {
    return validatedAccount({ name: input?.name, email: input?.email, role: 'analista' }, [name, email]);
}

async function account(input) {
    const form = await validatedAccount({
        name: input?.name, email: input?.email, role: input?.role, mileageRate: input?.mileageRate
    }, accountFields);
    if (!form) return null;
    const { mileageRate: mileageRateCentsPerKm, ...account } = form;
    return mileageRateCentsPerKm === undefined ? account : { ...account, mileageRateCentsPerKm };
}

function loginName(value) {
    const name = typeof value === 'string' ? value.trim() : '';
    return name && [...name].length <= 120 && !/[\x00-\x1f\x7f]/.test(name) ? name : null;
}

module.exports = { account, newAccount, loginName };
