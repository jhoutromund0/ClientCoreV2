# ClientCore V2

Sistema web de gestão de serviços de TI, desenvolvido como evolução do **ClientCore V1**, projeto de extensão do IFSP — Câmpus Campinas. A proposta original centraliza clientes, atendimentos, agenda e materiais, substituindo controles dispersos em planilhas e mensagens. A V2 reorganiza o projeto em MVC, adiciona gestão financeira e autenticação por perfis.

## Funcionalidades

- **Público:** página inicial, Sobre e login.
- **Analista:** painel, clientes, materiais e calendário de atendimentos.
- **Administrador:** todas as funções do analista, além de financeiro e gestão de usuários (criar, editar, desativar, excluir).
- Cadastro público desativado: apenas administradores criam contas.
- Sessões no PostgreSQL, senhas com `scrypt` e cookie HTTP-only; proteção CSRF para ações autenticadas.
- Persistência PostgreSQL para clientes, materiais, visitas, lançamentos financeiros, usuários e sessões.

## Tecnologias

Node.js 18+, Express 4, EJS, CSS, JavaScript, PostgreSQL (`pg`), Helmet, arquitetura MVC.

## Instalação local

1. Instale Node.js e PostgreSQL; crie um banco chamado `clientcore`.
2. Execute `npm install` na raiz do projeto.
3. Crie o arquivo **`.var`** (não versionado) conforme as instruções abaixo.
4. Execute o SQL de `sql/schema.sql` no banco: `psql "$DATABASE_URL" -f sql/schema.sql` (ou use o editor SQL do provedor).
5. Crie o primeiro administrador:
   `npm run create-admin -- "Administrador" admin@exemplo.com "uma-senha-forte-de-12-ou-mais"`
6. Execute `npm start` e abra `http://localhost:3000/login`.

**Variáveis exigidas no `.var`:**

```dotenv
NODE_ENV=development
PORT=3000
DATABASE_URL=postgresql://usuario:senha@localhost:5432/clientcore
DB_SSL=false
SESSION_SECRET=gere-uma-chave-aleatoria-com-mais-de-32-caracteres
```

Para gerar uma chave: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.

O arquivo `.var` e arquivos `.env` estão no `.gitignore`. **No Render, configure essas mesmas chaves em Environment; não faça commit de segredos.** Use `NODE_ENV=production`, a URL interna do PostgreSQL e `DB_SSL` conforme o tipo de conexão. Não use `DB_SSL_REJECT_UNAUTHORIZED=false` em produção sem justificativa e validação do certificado.

## Deploy

- Serviço Web Node.js no Render, diretório raiz com `package.json`.
- Build: `npm install`; Start: `npm start`.
- PostgreSQL na mesma região, `DATABASE_URL` interna.
- Execute `sql/schema.sql` **antes** do primeiro acesso.
- Crie o primeiro admin por execução segura do script em ambiente com acesso ao banco; não coloque a senha em repositórios ou logs.
- Se o proxy causar problemas com cookies, confirme `NODE_ENV=production` e HTTPS público.
- O sistema requer PostgreSQL disponível para iniciar e autenticar. Não há fallback em memória.

## Estrutura

```text
src/app.js                  # middlewares e rotas
src/server.js               # inicialização
src/config/database.js      # pool PostgreSQL
src/config/store.js         # persistência JSONB parametrizada
src/models/                 # modelos, incluindo User
src/controllers/            # regras de negócio
src/routes/                 # rotas e permissões
src/middleware/auth.js      # sessão, autorização e CSRF
src/views/                  # templates EJS
public/                     # CSS e JavaScript
sql/schema.sql              # estrutura de tabelas
scripts/create-admin.js     # criação do primeiro admin
```

## Observações técnicas

- As tabelas operacionais usam UUID e JSONB para preservar os campos atuais da V2. Para relatórios complexos, índices e relações de negócio futuras, recomenda-se normalizar essas tabelas em colunas específicas e adicionar migrações.
- O financeiro é restrito ao administrador inclusive no servidor, não apenas na navegação.
- Não compartilhe credenciais. Contas de usuários devem ser criadas por administradores.
- Sessões expiram após sete dias; ao desativar ou excluir um usuário, ele perde o acesso na próxima requisição.
- O script SQL usa `pgcrypto` para gerar UUID. O banco precisa permitir a extensão.
- Para desenvolvimento/produção real, é recomendado adicionar testes automatizados com PostgreSQL real, auditoria e controle de tentativas de login.

## Histórico

**ClientCore V1:** conceito original de gestão centralizada para prestadores de serviços de TI.

**ClientCore V2:** organização MVC, interfaces renovadas, calendário, materiais, financeiro, PostgreSQL e perfis de acesso.

Repositório de referência da V1: https://github.com/jhoutromund0/Client-Core
