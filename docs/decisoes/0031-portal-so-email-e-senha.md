# ADR 0031 — Portal `config.` só com e-mail e senha: sem convite e sem TOTP, admin do cliente com escolha de empresa, super-admin pelo deploy e senha única da plataforma (RN-CORE-32)

- **Status**: **aceita** em 2026-11-07 por decisão do dono do produto (mensagens de 07/11, 15h e 15h25, registradas na T-0093 e na
  T-0094). Substitui, da [ADR 0029](0029-super-admin-de-plataforma.md), o **§2** (primeiro acesso por convite), o **§3** (TOTP
  obrigatório), o `amr=["pwd","otp"]` e o "2º fator" do §4, e o mínimo de 12 caracteres da senha do super-admin. O resto da 0029
  continua valendo, inclusive o §8 (papel `macuxi_portal`, T-0091).
- **Data**: 2026-11-07
- **Tarefa**: T-0093 (desenho: [docs/desenho/T-0093.md](../desenho/T-0093.md))
- **Autor**: engenheiro-software
- **Regras**: RN-CORE-32 (senha), RN-CORE-33 (quem entra no portal), RN-CORE-34 (admin inicial no passo Empresa), RN-CORE-31, RN-AUD-01

## Contexto
No teste do 1º acesso no `config-demo`, o dono do produto decidiu que o portal entra só com e-mail e senha já cadastrados, sem código
de convite, sem QR code/TOTP e sem a tela "Primeiro acesso"; que a senha de toda a plataforma tem 8+ caracteres com letra, número e
caractere especial; que o cliente (admin da empresa) também entra no portal e escolhe a empresa quando tiver mais de uma; e que o
time da Macuxi vê todas. O portal da 0029 só conhecia o super-admin, com convite e TOTP obrigatórios.

## Decisão
1. **Login de uma etapa** (`POST /v1/plataforma/auth/login`, e-mail e senha) abre a sessão do portal. Saem o desafio de 2ª etapa, o
   TOTP, os códigos de recuperação, o convite e o primeiro acesso (rotas, funções, telas, a dependência `qrcode` e os secrets
   `*_SUPERADMIN_CONVITE`).
2. **Dois tipos de acesso** na mesma sessão curta (token de 2 h, eram 15 min até a Emenda 1; teto de 8 h, revogável, conferida no banco a cada requisição,
   segredo e `aud` próprios, `amr=["pwd"]`):
   - `super_admin` (time da Macuxi, `plataforma.super_admin`): vê todas as empresas; o tenant vem no `x-macuxi-tenant` (como na 0029 §5);
   - `admin_cliente` (`core.usuario` com perfil `admin`, ativo, de empresa ativa): só nas empresas em que **a senha conferiu**; a
     empresa escolhida fica na sessão e no token (`tid`); trocar de empresa exige escolher de novo e invalida o token anterior.
     Nas rotas com `superAdmin: 'aceita'` ele é o **usuário admin real** do tenant (licença do perfil, ação/perfil e carteira como no
     BKO); `'exige'` e a criação de empresa continuam só do super-admin. Vendedor, promotor, supervisor e os demais perfis não entram
     (RN-CORE-33).
   - Se o mesmo e-mail é de um super-admin e a senha confere nele, a sessão é de super-admin.
3. **Busca das empresas do e-mail**: uma função `plataforma.sa_contas_para_login` (EXECUTE só ao `macuxi_portal`) devolve até 20
   contas candidatas com o hash; a senha é conferida no Node (argon2id), em paralelo; a função grava a consulta na auditoria
   append-only. O `macuxi_portal` continua sem grant em tabela.
4. **Bloqueio por chave do e-mail** (HMAC-SHA256 com o segredo da plataforma), 5 falhas → 15 min, aplicado **também** a e-mail que
   não existe: a resposta (401 ou 423) não revela se o e-mail existe. Fica o limite por IP.
5. **Super-admin nasce pelo deploy** (sem autocadastro): função `plataforma.criar_super_admin` sem EXECUTE para app, worker ou portal,
   chamada pela CLI `super-admin` com a conexão de administração, pelos workflows `producao — super-admin` (environment `PRODUCAO`,
   secret `PROD_SUPERADMIN_SENHA`) e `demo — super-admin` (`DEMO_SUPERADMIN_SENHA`). Criar, redefinir a senha (revoga as sessões) e
   desativar (não o último).
6. **RN-CORE-32 é uma função só**, no domain do Core, usada na criação e na troca de toda senha (portal, BKO, apps, CLIs); login
   não aplica a regra (senhas já gravadas continuam valendo).
7. **Passo Empresa cria o admin inicial do cliente** com a senha master (RN-CORE-34), validada pela RN-CORE-32 na API; empresa
   existente não troca senha (RN-CORE-31).

## Alternativas
- **Manter o TOTP obrigatório para o super-admin** e tirar só para o cliente: era a recomendação técnica; o dono do produto decidiu
  tirar para todos. Fica no backlog o **TOTP opcional** para o time da Macuxi (colunas da 0035 e a chave na VM mantidas).
- **Admin do cliente com o token do BKO** (sessão de tenant comum) em vez da sessão do portal: zero mudança no SDK, mas a sessão
  seria a longa do app, sem auditoria por requisição na `auditoria_plataforma` e sem revogação no ritmo do portal. Recusada.
- **Código da empresa no login do portal** (como no BKO): evitaria a busca entre empresas, mas o dono do produto pediu só e-mail e
  senha e a escolha depois. Recusada.
- **Token sem empresa, tenant só no cabeçalho, também para o cliente**: a troca de empresa não invalidaria nada e um erro no portal
  mandaria o cabeçalho de outra empresa; com `tid` no token a API recusa na hora. Recusada.
- **Conferir a senha dentro do banco**: o Postgres não tem argon2id; trocar o hash de todos os usuários não cabe. Recusada.

## Consequências
- **Risco registrado (decisão do dono do produto):** sem 2º fator, o super-admin, que cria e altera qualquer empresa, fica protegido
  só pela senha (RN-CORE-32), pelo bloqueio por e-mail, pelo limite por IP, pela sessão de 2 h/8 h (Emenda 1) e pela auditoria. Uma senha
  vazada do time da Macuxi dá acesso a todas as empresas até alguém revogar (workflow `redefinir`/`desativar`). Mitigações sem
  código: senha longa e única em gerenciador de senhas; Cloudflare Access no host `config.` com os e-mails do time.
- **O limite do `macuxi_portal` (0029, T-0091) cresce um pouco:** quem tiver a senha desse papel abre sessão sem senha também de
  admin do cliente e lê o hash dos admins de um e-mail que já conheça. Não amplia o dano de dados (o `macuxi_app` já lê tudo pelo RLS)
  e cada consulta e sessão fica gravada pelo banco, append-only.
- Tempo de resposta do login cresce um pouco com muitas empresas no mesmo e-mail (até 20 conferências em paralelo); o bloqueio e o
  limite por IP tornam a medição impraticável.
- Saem `MACUXI_SUPERADMIN_CONVITE` e a exigência de `MACUXI_CHAVE_TOTP` na API; a chave continua gerada na VM, sem uso. Entram os
  secrets `PROD_SUPERADMIN_SENHA` e `DEMO_SUPERADMIN_SENHA` (usados só no workflow manual) e saem os `*_SUPERADMIN_CONVITE`.
- Quem estava logado no portal entra de novo depois do deploy (token antigo sem tipo). Super-admin já criado continua valendo, só com a senha.
- O `tenant:criar` e o cadastro de usuário passam a recusar senha sem caractere especial (o `PROD_TENANT_ADMIN_SENHA` precisa atender).
- Fixtures de teste que criam senha fraca precisam mudar.

## Emenda 1 (2026-11-14) — sessão de 2 h

- **Origem**: dono do produto, 14/11/2026, recado R-20261114-125500-alexandre ("aumente o tempo de sessao para duas horas").
- **Decisão**: no item 2, o token da sessão curta passa de 15 min para **2 h (120 min) renováveis com uso**, igual à Emenda 1 da
  [ADR 0029](0029-super-admin-de-plataforma.md). O teto de 8 h, a conferência no banco a cada requisição e o bloqueio de 15 min
  após 5 falhas não mudam.
