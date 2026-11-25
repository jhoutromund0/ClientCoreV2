const { createHash } = require('node:crypto');

const minLength = 12;
const maxLength = 200;
const common = /^(?:password|senha|senhaforte|minhasenha|suasenha|admin|administrador|qwerty|qwertyuiop|letmein|iloveyou|bemvindo|welcome|changeme|empresa|clientcore)\d*$/;
const sequential = ['01234567890123456789', '98765432109876543210'];
const normalized = text => text.normalize('NFKD').toLowerCase().replace(/\p{M}|[^\p{L}\p{N}]/gu, '');

function input(password) {
    return typeof password === 'string' && password.length > 0 && password.length <= maxLength;
}

async function breached(password) {
    const digest = createHash('sha1').update(password).digest('hex').toUpperCase();
    const response = await fetch('https://api.pwnedpasswords.com/range/' + digest.slice(0, 5), {
        headers: { 'Add-Padding': 'true' },
        signal: AbortSignal.timeout(4000)
    });
    if (!response.ok) throw new Error('Pwned Passwords indisponível.');
    const suffix = digest.slice(5) + ':';
    return (await response.text()).split('\n').some(line => line.startsWith(suffix) && Number(line.slice(suffix.length)) > 0);
}

async function validate(password, account) {
    if (!input(password) || password.length < minLength)
        return { message: 'Use uma senha de 12 a 200 caracteres.' };

    const candidate = normalized(password);
    const identity = [normalized((account.email || '').split('@')[0]), normalized(account.name)];
    const repeated = /^(.{1,20})\1+$/u;
    if (!candidate || common.test(candidate) || repeated.test(candidate) ||
        sequential.some(sequence => sequence.includes(candidate)) ||
        identity.some(value => value.length >= 4 && candidate.includes(value)))
        return { message: 'Escolha uma senha menos previsível e sem seu nome ou e-mail.' };

    if (process.env.PASSWORD_BREACH_CHECK !== 'true') return null;
    try {
        if (await breached(password)) return { message: 'Essa senha já apareceu em um vazamento. Escolha outra.' };
    } catch {
        return { status: 503, message: 'A verificação de senhas está indisponível. Tente novamente em instantes.' };
    }
    return null;
}

module.exports = { input, validate };
