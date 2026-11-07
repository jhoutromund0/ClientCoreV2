
const path = require('path');

require('dotenv').config({
    path: path.join(__dirname, '..', '.env')
});

const User = require('../src/models/User');
const { pool } = require('../src/config/database');
const readline = require('readline/promises');

async function main() {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    try {
        console.log('\n=== CRIAR ADMINISTRADOR ===\n');

        const name = (await rl.question('Nome: ')).trim();
        const email = (await rl.question('E-mail: ')).trim().toLowerCase();
        const password = await rl.question('Senha (mínimo 12 caracteres): ');

        if (name.length < 2 || !/^\S+@\S+\.\S+$/.test(email) || password.length < 12) {
            throw new Error('Dados inválidos. Confira nome, e-mail e senha.');
        }

        const existing = await User.byEmail(email);

        if (existing) {
            throw new Error('Já existe um usuário com esse e-mail.');
        }

        const admin = await User.create({
            name,
            email,
            password,
            role: 'admin'
        });

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
