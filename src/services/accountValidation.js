const { body, validationResult } = require('express-validator');

const email = body('email').isString().bail().trim().isLength({ min: 1, max: 254 }).bail()
    .isEmail().bail().customSanitizer(value => value.toLowerCase());
const mileageRate = body('mileageRate').optional().isString().bail().trim()
    .matches(/^(?:\d{1,6}(?:[.,]\d{1,2})?)?$/).bail().customSanitizer(value => {
        if (value === '')
            return null;
        const [whole, decimals = ''] = value.split(/[.,]/);
        return Number(whole) * 100 + Number(decimals.padEnd(2, '0'));
    });
const accountFields = [
    body('name').isString().bail().trim().isLength({ min: 2, max: 120 }),
    email,
    body('role').isString().bail().isIn(['admin', 'analista']),
    mileageRate
];

async function account(input) {
    const request = { body: { name: input?.name, email: input?.email, role: input?.role, mileageRate: input?.mileageRate } };
    await Promise.all(accountFields.map(field => field.run(request)));
    if (!validationResult(request).isEmpty())
        return null;
    const { mileageRate: mileageRateCentsPerKm, ...account } = request.body;
    return mileageRateCentsPerKm === undefined ? account : { ...account, mileageRateCentsPerKm };
}

function loginAddress(value) {
    const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return email && email.length <= 254 ? email : null;
}

module.exports = { account, loginAddress };
