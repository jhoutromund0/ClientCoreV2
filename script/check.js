const { spawnSync } = require('node:child_process');
const { existsSync, readdirSync, readFileSync } = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');

const project = path.join(__dirname, '..');

function* filesIn(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory())
            yield* filesIn(file);
        else if (entry.isFile())
            yield file;
    }
}

let scripts = 0;
let templates = 0;
let failed = false;

const directories = ['src', 'public', 'script'];
if (existsSync(path.join(project, 'test')))
    directories.push('test');

for (const directory of directories) {
    for (const file of filesIn(path.join(project, directory))) {
        const extension = path.extname(file);
        if (['.js', '.cjs', '.mjs'].includes(extension)) {
            scripts += 1;
            const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
            if (result.error)
                console.error(result.error.message);
            if (result.error || result.status !== 0)
                failed = true;
        }
        if (extension === '.ejs') {
            templates += 1;
            try {
                ejs.compile(readFileSync(file, 'utf8'), { filename: path.relative(project, file) });
            } catch (error) {
                failed = true;
                console.error(error.message);
            }
        }
    }
}

if (failed)
    process.exitCode = 1;
else
    console.log(`${scripts} arquivos JavaScript e ${templates} templates EJS verificados.`);
