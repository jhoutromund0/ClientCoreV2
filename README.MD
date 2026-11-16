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

## 🛠️ Tecnologias Utilizadas

### Front-end

- **HTML5:** estruturação das páginas.
- **CSS3:** estilização e identidade visual.
- **JavaScript:** interatividade e funcionalidades.
- **EJS:** renderização dinâmica das páginas.
- **Tailwind CSS:** estilização e componentes visuais.

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

- **Render:** plataforma prevista para hospedagem da aplicação e do banco de dados.
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
├── .env.example            # Exemplo de variáveis de ambiente
├── .gitignore
├── package.json
├── package-lock.json
└── README.md
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