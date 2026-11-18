# 🟢 ClientCore V2

### Plataforma de Gestão de Serviços de Tecnologia da Informação

O **ClientCore V2** é a segunda versão do projeto ClientCore, desenvolvido como projeto de extensão do **Instituto Federal de Educação, Ciência e Tecnologia de São Paulo (IFSP) — Câmpus Campinas**.

Esta versão representa a evolução do sistema original, trazendo uma arquitetura mais estruturada, novas funcionalidades, gerenciamento de permissões e integração com banco de dados relacional.

---

## 📖 Sobre o Projeto

O **ClientCore** é uma plataforma web desenvolvida para centralizar e otimizar a gestão operacional de empresas prestadoras de serviços de Tecnologia da Informação e profissionais autônomos.

O projeto surgiu da necessidade de substituir processos manuais e descentralizados, frequentemente realizados por meio de planilhas, aplicativos de mensagens e ferramentas independentes.

Na versão 2.0, o sistema foi reformulado utilizando a arquitetura **Model-View-Controller (MVC)**, permitindo melhor organização do código, manutenção e expansão das funcionalidades.

A plataforma contempla:

- 👥 **Gestão de Clientes:** cadastro, consulta e gerenciamento das informações dos clientes.
- 🛠️ **Gestão de Atendimentos:** organização e acompanhamento dos serviços técnicos.
- 📅 **Calendário:** planejamento e visualização dos atendimentos agendados.
- 📦 **Controle de Materiais:** gerenciamento de materiais utilizados durante os serviços.
- 💰 **Gestão Financeira:** acompanhamento de receitas, despesas e valores relacionados aos atendimentos.
- 🔐 **Autenticação:** controle de acesso com diferentes níveis de permissão.
- ☁️ **Persistência de Dados:** armazenamento centralizado utilizando PostgreSQL.

## 🎯 Objetivo

Desenvolver uma solução acessível, intuitiva e escalável para empresas de TI e profissionais autônomos, proporcionando maior controle sobre clientes, atendimentos, materiais e recursos financeiros.

O ClientCore busca reduzir a dependência de controles manuais, melhorar a organização das informações e contribuir para a eficiência dos processos administrativos e operacionais.

## 🚀 Evolução do Projeto

O **ClientCore V2** dá continuidade ao sistema desenvolvido anteriormente, preservando seus objetivos e ampliando sua estrutura tecnológica.

### Principais melhorias da versão 2.0

- Reestruturação do projeto utilizando arquitetura MVC.
- Migração do back-end para Node.js e Express.
- Implementação de PostgreSQL para persistência dos dados.
- Reformulação da interface, mantendo a identidade visual verde e preto.
- Implementação de autenticação e autorização de usuários.
- Separação das permissões entre analistas e administradores.
- Inclusão de funcionalidades financeiras.
- Aprimoramento dos módulos de calendário e materiais.
- Organização do código para facilitar manutenção e futuras implementações.

## 🔐 Controle de Acesso

O sistema utiliza autenticação baseada em sessões e controle de acesso por perfis.

### 👨‍💻 Analista

Responsável pelas atividades operacionais da plataforma.

**Permissões:**
- Acesso ao painel do sistema.
- Visualização e gerenciamento de clientes.
- Consulta e controle de materiais.
- Acesso ao calendário de atendimentos.
- Acompanhamento dos serviços cadastrados.

### 🛡️ Administrador

Responsável pelo gerenciamento administrativo e financeiro.

**Permissões:**
- Acesso às funcionalidades do analista.
- Cadastro e gerenciamento de usuários.
- Edição, desativação e exclusão de contas.
- Acesso ao módulo financeiro.
- Acompanhamento de receitas, despesas e custos operacionais.

A página inicial e a seção Sobre permanecem públicas. As funcionalidades internas exigem autenticação.

O cadastro de usuários é restrito aos administradores, não sendo permitido o registro público de novas contas.

Administradores confirmam a própria senha para gerenciar contas. A tela de usuários gera links de convite e recuperação de uso único, válidos por uma hora. O administrador encaminha o link ao destinatário, que define sua própria senha.

A sessão vence após 30 minutos de inatividade ou 12 horas desde o login, com até cinco sessões por conta. Clique no nome da conta no cabeçalho para consultar e encerrar sessões. A alteração do perfil ou da senha revoga os acessos anteriores conforme a operação.

## Fluxo de atendimento

1. Em **Configurações → Serviços**, cadastre os serviços oferecidos e seus preços padrão. Desative os serviços que deixaram de ser oferecidos. Os atendimentos já agendados conservam os preços registrados.
2. No **Calendário**, selecione um cliente, um serviço, os responsáveis, a data, o horário e os materiais previstos. O endereço do cliente é sugerido e pode ser alterado para esse atendimento.
3. Abra **Visitas** para acompanhar os dados operacionais e o deslocamento. Ao encerrar a execução, confirme as quantidades efetivamente utilizadas. O estoque muda pelo consumo confirmado e uma correção posterior movimenta somente a diferença.
4. No **Financeiro**, o administrador revisa o valor do serviço, os materiais, o custo de deslocamento, as despesas extras e o valor recebido. O deslocamento cobrado do cliente tem um campo próprio. As previsões ficam disponíveis antes da conclusão. O lançamento concluído conserva os valores e custos registrados.

O financeiro mantém um lançamento por visita. Para corrigir os dados de origem de um atendimento com lançamento concluído, exclua esse lançamento, edite o atendimento e registre os valores atualizados. Visitas concluídas permanecem no histórico de consumo. Visitas agendadas podem ser canceladas.

## Atualização do PostgreSQL e do Render

1. Faça um backup do PostgreSQL. Valide a nova versão primeiro em homologação, com um banco separado.
2. Instale as dependências com `npm ci` e configure `DATABASE_URL` para o banco a atualizar.
3. Execute `npm run db:migrate` antes de iniciar a nova versão. O comando aplica os arquivos SQL pendentes em ordem, cada um em sua própria transação. A quilometragem usa `008_user_mileage_rate.sql` e `009_visit_mileage.sql`. A inicialização verifica as migrações e lista no log os arquivos pendentes. Os registros existentes podem ser vinculados aos novos cadastros ao editar uma visita antiga.
4. No Render, use `npm start` para iniciar a aplicação. Em um plano com comando de pré-deploy, ele pode executar `npm run db:migrate`. Quando o plano não oferece esse comando, execute a migração em uma etapa autorizada antes de iniciar o serviço atualizado. [Etapas de deploy no Render](https://render.com/docs/deploys#pre-deploy-command)

| Variável existente | Configuração |
| --- | --- |
| `DATABASE_URL` | Conexão com o PostgreSQL do ambiente. |
| `SESSION_SECRET` | Chave de pelo menos 32 caracteres, compartilhada pelas instâncias. |
| `NODE_ENV`, `APP_URL`, `PORT` | Use `production` e a origem HTTPS pública no Render. A aplicação usa a porta fornecida pelo ambiente. |
| `TRUST_PROXY_HOPS` | Quantidade de proxies confiáveis entre o cliente e o servidor. |
| `DB_SSL`, `DB_SSL_REJECT_UNAUTHORIZED` | Opções TLS da conexão PostgreSQL de acordo com o ambiente. |
| `NOMINATIM_BASE_URL`, `OSRM_BASE_URL`, `OSM_USER_AGENT` | Endereços dos serviços contratados ou próprios e identificação da aplicação. |
| `CNPJA_BASE_URL`, `CNPJA_TIMEOUT_MS`, `PASSWORD_BREACH_CHECK` | Configurações opcionais mantidas das versões anteriores. |

Para criar o primeiro administrador em um banco novo, execute `node script/create-admin.js`. Para verificar o código sem conexão com o banco, use `npm run check`.

Para rodar localmente por HTTP, use `NODE_ENV=development`, `APP_URL=http://localhost:3000` e `PORT=3000` no ambiente local.

## Deslocamento de clientes e visitas

Em **Configurações**, o administrador define o endereço de partida e a tarifa em reais por quilômetro. O sistema calcula a rota de carro para o endereço efetivo da visita, registra as distâncias de ida e de ida e volta e multiplica a distância total pela tarifa. Alterações no local ou nas configurações atualizam as estimativas em segundo plano. Lançamentos já concluídos mantêm o custo registrado.

Em **Configurações → Usuários**, o administrador pode definir uma tarifa individual por quilômetro. A tarifa padrão da empresa é usada quando a conta não tem tarifa própria. Na edição da visita, é possível informar a quilometragem manualmente e selecionar quem recebe o deslocamento entre os responsáveis. Com um único responsável, a atribuição é automática. O valor a pagar aparece em **Visitas** e entra nas despesas do financeiro. A cobrança ao cliente fica no campo próprio do lançamento.

1. Execute `npm run db:migrate` com `DATABASE_URL` configurada para aplicar as migrações, incluindo a tabela de configuração de deslocamentos.
2. Use as URLs-base reais de serviços próprios ou contratados em `NOMINATIM_BASE_URL` e `OSRM_BASE_URL`. Cada valor é a URL antes do caminho da operação. O ClientCore acrescenta `/search` para geocodificação e `/table/v1/driving` ou `/route/v1/driving` para distâncias. `OSM_USER_AGENT` é opcional e permite identificar a instalação nos pedidos aos serviços.
3. Inicie a aplicação e preencha a tarifa em **Configurações**. O endereço inicial já aparece no formulário.

O processamento de carteiras de clientes usa instâncias adequadas a consultas recorrentes. Consulte a [política do Nominatim público](https://operations.osmfoundation.org/policies/nominatim/) e a [documentação da API de rotas do OSRM](https://project-osrm.org/docs/v5.24.0/api/).

No Render, abra **ClientCore → Environment** e salve as duas variáveis no serviço. Use o `.env` para a execução local. Se ainda precisar contratar ou hospedar os serviços, deixe os dois valores vazios e informe a quilometragem na edição da visita. A tela de configurações indica quais valores precisam de atenção. [Variáveis de ambiente no Render](https://render.com/docs/configure-environment-variables#in-the-render-dashboard)

## 🛠️ Tecnologias Utilizadas

### Front-end

- **HTML5:** estruturação das páginas.
- **CSS3:** estilização e identidade visual.
- **JavaScript:** interatividade e funcionalidades.
- **EJS:** renderização dinâmica das páginas.

### Back-end

- **Node.js:** ambiente de execução JavaScript.
- **Express.js:** gerenciamento do servidor, rotas e requisições.
- **Arquitetura MVC:** separação entre modelos, visualizações e controladores.

### Banco de Dados

- **PostgreSQL:** armazenamento persistente das informações.
- **node-postgres (pg):** comunicação entre a aplicação e o banco de dados.

### Segurança

- Autenticação baseada em sessões.
- Controle de acesso por perfis.
- Armazenamento seguro de senhas utilizando `scrypt`.
- Cookies HTTP-only.
- Proteção contra requisições CSRF.
- Utilização de Helmet para configuração de cabeçalhos HTTP de segurança.

### Infraestrutura e Desenvolvimento

- **Render:** hospedagem da aplicação e do banco de dados.
- **Git:** versionamento do código.
- **GitHub:** armazenamento e colaboração.
- **npm:** gerenciamento de dependências.

## 🏗️ Arquitetura do Sistema

O ClientCore V2 utiliza o padrão arquitetural **MVC (Model-View-Controller)**, promovendo a separação de responsabilidades.

**Model (Modelo):** responsável pela representação dos dados e comunicação com o PostgreSQL.

**View (Visualização):** responsável pela apresentação das interfaces utilizando EJS, HTML, CSS e JavaScript.

**Controller (Controlador):** responsável pelo processamento das requisições, execução das regras de negócio e integração entre modelos e visualizações.

Essa arquitetura facilita a manutenção, os testes e a evolução do sistema.

## 📂 Estrutura do Projeto

```text
ClientCoreV2/
├── public/                 # Arquivos estáticos
├── src/
│   ├── config/             # Configurações e banco de dados
│   ├── controllers/        # Regras de negócio
│   ├── middleware/         # Autenticação e segurança
│   ├── models/             # Modelos de dados
│   ├── routes/             # Rotas da aplicação
│   ├── views/              # Templates EJS
│   ├── app.js              # Configuração do Express
│   └── server.js           # Inicialização do servidor
├── sql/                    # Scripts do PostgreSQL
├── script/                 # Scripts auxiliares
├── .gitignore
├── package.json
├── package-lock.json
└── README.MD
```

## 🎯 Público-Alvo

O ClientCore é direcionado a:

- Empresas prestadoras de serviços de Tecnologia da Informação.
- Empresas de infraestrutura e suporte técnico.
- Profissionais autônomos de TI.
- Pequenas e médias empresas que necessitam organizar seus atendimentos e processos operacionais.

## 💡 Diferenciais

- **Especialização em TI:** funcionalidades voltadas às necessidades de prestadores de serviços tecnológicos.
- **Gestão Centralizada:** clientes, atendimentos, agenda, materiais e finanças em uma única plataforma.
- **Controle de Permissões:** diferentes níveis de acesso conforme a responsabilidade do usuário.
- **Interface Intuitiva:** navegação simplificada e identidade visual consistente.
- **Arquitetura Modular:** estrutura preparada para manutenção e evolução.
- **Persistência Relacional:** utilização de PostgreSQL para armazenamento das informações.
- **Acesso Web:** utilização por meio do navegador, sem necessidade de instalação local pelo usuário final.

## 🔮 Melhorias Futuras

O desenvolvimento do ClientCore é contínuo, permitindo a implementação de novas funcionalidades.

Entre as melhorias planejadas estão:

- 📊 Dashboard com indicadores operacionais e financeiros.
- 📈 Relatórios gerenciais e estatísticos.
- 🔔 Sistema de notificações de atendimentos.
- 📱 Aprimoramento da responsividade para dispositivos móveis.
- ⚙️ Expansão das funcionalidades administrativas.
- 🔗 Integração com serviços e ferramentas externas.

## 📈 Visão do Projeto

Consolidar o ClientCore como uma plataforma de gestão de serviços de TI, oferecendo uma solução capaz de acompanhar o crescimento de empresas e profissionais autônomos.

O projeto busca contribuir para a transformação digital de processos operacionais, incentivando a adoção de ferramentas que promovam organização, produtividade e eficiência.

## 👨‍💻 Equipe de Desenvolvimento

- **Davi Maia Reis**
- **Jhonata Adriano**
- **Matheus Martins Souza**

## 🎓 Contexto Acadêmico

Projeto desenvolvido no âmbito das atividades acadêmicas e extensionistas do **Instituto Federal de São Paulo — Câmpus Campinas**, como continuidade do trabalho iniciado no 3º semestre do curso de **Tecnologia em Análise e Desenvolvimento de Sistemas**.

A segunda versão aplica e amplia conhecimentos de desenvolvimento web, arquitetura de software, banco de dados, segurança da informação e engenharia de software.

## 🔗 Repositórios

**Versão 1.0 — Projeto Original**

https://github.com/jhoutromund0/Client-Core

**Versão 2.0 — Continuação do Projeto**

https://github.com/jhoutromund0/ClientCoreV2

---

**ClientCore V2 — Tecnologia aplicada à organização e à gestão de serviços de TI.**
