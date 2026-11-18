
const path = require('path');

require('dotenv').config({
    path: path.join(__dirname, '..', '.env')
});

const User = require('../src/models/User');
const { pool } = require('../src/config/database');
const readline = require('node:readline/promises');
const { Writable } = require('node:stream');
const accountValidation = require('../src/services/accountValidation');
const passwordPolicy = require('../src/services/passwordPolicy');

async function main() {
    const terminal = Boolean(process.stdin.isTTY && process.stdout.isTTY);
    let hideInput = false;
    const output = new Writable({
        write(chunk, encoding, done) {
            if (hideInput) return done();
            process.stdout.write(chunk, done);
        }
    });
    const rl = readline.createInterface({
        input: process.stdin,
        output,
        terminal
    });

    try {
        console.log('\n=== CRIAR ADMINISTRADOR ===\n');

        const account = await accountValidation.account({
            name: await rl.question('Nome: '),
            email: await rl.question('E-mail: '),
            role: 'admin'
        });
        if (!account) throw new Error('Confira o nome e o e-mail.');

        let password = process.env.ADMIN_PASSWORD;
        if (password === undefined) {
            if (!terminal) throw new Error('Abra um terminal interativo ou defina ADMIN_PASSWORD.');
            process.stdout.write('Senha (12 a 200 caracteres): ');
            hideInput = true;
            try {
                password = await rl.question('');
            } finally {
                hideInput = false;
                process.stdout.write('\n');
            }
        }
        const issue = await passwordPolicy.validate(password, account);
        if (issue) throw new Error(issue.message);

        const existing = await User.byEmail(account.email);

        if (existing) {
            throw new Error('Já existe um usuário com esse e-mail.');
        }

        const admin = await User.create({ ...account, password });

        console.log('\nAdministrador criado com sucesso!');
        console.log('Nome:', admin.name);
        console.log('E-mail:', admin.email);
        console.log('Perfil:', admin.role);

    } finally {
        rl.close();
        await pool.end();
    }
}

main().catch(error => {
    console.error('\nErro:', error.message);
    process.exitCode = 1;
});
