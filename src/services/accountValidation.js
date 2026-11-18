const { body, validationResult } = require('express-validator');

const email = body('email').isString().bail().trim().isLength({ min: 1, max: 254 }).bail()
    .isEmail().bail().customSanitizer(value => value.toLowerCase());
const accountFields = [
    body('name').isString().bail().trim().isLength({ min: 2, max: 120 }),
    email,
    body('role').isString().bail().isIn(['admin', 'analista'])
];

async function account(input) {
    const request = { body: { name: input?.name, email: input?.email, role: input?.role } };
    await Promise.all(accountFields.map(field => field.run(request)));
    return validationResult(request).isEmpty() ? request.body : null;
}

function loginAddress(value) {
    const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return email && email.length <= 254 ? email : null;
}

module.exports = { account, loginAddress };
