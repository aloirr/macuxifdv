# ADR 0029 — Super-admin de plataforma: identidade fora dos tenants, 2º fator TOTP, sessão curta e auditoria total

- **Status**: proposta (vira aceita quando o Alexandre aceitar, pedido no status das 2h de 06/11, com as revisões da T-0087 sem 🔴;
  até lá o portal pode ir à verificação e ao deploy, porque a decisão é reversível pelo down da 0035)
- **Data**: 2026-11-06
- **Tarefa**: T-0087 (desenho: [docs/desenho/T-0087.md](../desenho/T-0087.md))
- **Autor**: engenheiro-software
- **Base**: T-0083 §1 e §8 (a tela do operador pedia ADR própria), ADR 0006 (login do tenant), ADR 0013 (chave do Conector), ADR 0028
  (host `config.` no mesmo serviço do BKO), mensagem do Alexandre de 05/11 21h50

## Contexto
O portal `config.macuxifdv.com.br` deixa a Macuxi (o Alexandre) criar a empresa cliente e carregar a base dela sem linha de comando. Quem
usa o portal não é usuário de nenhum tenant: precisa enxergar todos e criar tenant novo, algo que o `macuxi_app` não faz (a
`provisionar_tenant` da T-0083 não tem grant a ele). É o acesso mais poderoso do produto e fica na internet.

## Decisão
1. **Identidade própria, fora dos tenants**: `plataforma.super_admin` (sem `tenant_id`, como `plataforma.tenant`; exceção à regra 5
   registrada aqui). RLS ligado e forçado **sem política** para `macuxi_app`; todo acesso por funções `SECURITY DEFINER` pequenas, com
   `search_path` fixo, grant só ao `macuxi_app` (nunca ao `macuxi_worker`). `PERFIS` não muda: o super-admin não é perfil de tenant.
2. **Primeiro acesso por convite secreto**: só com **zero** super-admins e com o `MACUXI_SUPERADMIN_CONVITE` (≥ 32 caracteres, secret do
   environment `PRODUCAO`), conferido em tempo constante. Depois do primeiro, a rota responde 410 para sempre. Novos super-admins e a
   redefinição do 2º fator ficam para um comando com a conexão de administração (fora da T-0087).
3. **2º fator TOTP obrigatório** (RFC 6238, SHA-1, 6 dígitos, 30 s, janela ±1, sem reuso do mesmo passo). Segredo de 20 bytes cifrado com
   AES-256-GCM (`MACUXI_CHAVE_TOTP`; AAD = id do super-admin). 10 códigos de recuperação de uso único, só o SHA-256 guardado. Implementado com
   `node:crypto`; a única dependência nova é o gerador de QR no apps/web (`qrcode`, JS puro, MIT), aceita por esta ADR.
4. **Sessão curta e revogável**: JWT com **segredo próprio** (`MACUXI_JWT_SEGREDO_PLATAFORMA`), `aud=macuxi-plataforma`, `sid`,
   `amr=["pwd","otp"]`, 15 min renováveis com uso, teto de 8 h. A sessão é conferida no banco **a cada requisição** (revogar vale na hora).
   5 falhas → bloqueio de 15 min. O token fica no `sessionStorage` da origem `config.` (o BKO, outra origem, nunca o lê).
5. **Rota de módulo opta pelo super-admin** (`RotaModulo.superAdmin: 'aceita' | 'exige'`), com o tenant no cabeçalho `x-macuxi-tenant`.
   A API monta um usuário `admin` do tenant com os módulos **licenciados ao tenant** e `ctx.superAdmin`; licença, Zod e RLS continuam
   valendo; ação/perfil do manifesto e carteira não (a opção da rota é a autorização). Rota sem a opção recusa o token (401).
   Rotas sem tenant (empresas) são da plataforma (`/v1/plataforma/*`, montadas pela API, que conhece todos os manifestos).
6. **Toda requisição do super-admin é auditada pela API** em `plataforma.auditoria_plataforma` (append-only), no fim da resposta e também
   quando recusada; login, TOTP e recuperação são auditados pelo Core na mesma tabela. Sem dado pessoal: ids, modelo da rota, status,
   contagens, `request_id`, prefixo do IP. O fato no tenant vai também à `plataforma.auditoria` dele (`usuario_id` = id do super-admin).
7. **Só no host `config.`**: o apps/web responde 404 para `/config/*` nos outros hosts. Recomendado (sem código, decisão do Alexandre):
   Cloudflare Access no host `config.` com o e-mail dele, como uma 3ª barreira.

## Alternativas
- **Super-admin como perfil `admin` de um tenant "Macuxi"** com poderes extras: mistura o RLS dos tenants com um acesso que atravessa
  todos; um erro de escopo vazaria dados entre clientes. Recusada.
- **Só Cloudflare Access na frente** (sem identidade própria): sem 2º fator controlado por nós, sem auditoria por ação e a API ficaria
  aberta a quem chamasse direto `api.`. Fica como camada extra, não como a proteção.
- **WebAuthn/passkey**: mais forte, mas mais código no navegador e no servidor do que cabe até 12h de 06/11. Pode substituir o TOTP depois.
- **Papel de banco próprio para o portal** (outra conexão): isolaria melhor, mas exige outro pool e outro segredo na VM no dia do deploy.
  As funções `SECURITY DEFINER` que conferem a sessão dão o mesmo efeito prático agora; revisitar quando houver mais de um operador.

## Consequências
- Três segredos novos no `.env`/`PRODUCAO`: `MACUXI_SUPERADMIN_CONVITE`, `MACUXI_CHAVE_TOTP`, `MACUXI_JWT_SEGREDO_PLATAFORMA`. Sem eles as
  rotas do portal respondem 503 (falha fechada).
- Perder o celular **e** os códigos de recuperação exige o comando de administração (procedimento a escrever com o T-0086).
- Quem marca uma rota com `superAdmin` responde por não gravar o id do super-admin em FK para `core.usuario`.
- O `macuxi_app` ganha poder de criar tenant, mas só por função que exige sessão de super-admin viva. **Limite**: a senha e o TOTP são
  conferidos no Node (a chave do TOTP fica fora do banco), então o banco não distingue o Core de quem tenha a **credencial do
  `macuxi_app`**: com ela, dá para abrir desafio e sessão de super-admin pelas funções `sa_*` sem senha nem TOTP. A proteção contra
  isso é a própria credencial (só no `.env` da VM e no secret `PRODUCAO`, nunca em log) e a trilha: toda sessão aberta grava
  `sa.sessao.aberta` (e todo tenant provisionado, `sa.tenant.provisionar`) na `plataforma.auditoria_plataforma` **pelo próprio banco**,
  append-only, que o app não altera nem apaga. Quem vazar a credencial do app já lê e grava os dados de todos os tenants pelo RLS
  (`app.tenant_id` é do app), então o portal não amplia o dano de dados; amplia a criação de tenant, que fica auditada. Fechar o
  limite pede o papel de banco próprio do portal (ver Alternativas). Limite aceito e registrado (docs/banco/plataforma.md).
