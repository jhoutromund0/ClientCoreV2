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
