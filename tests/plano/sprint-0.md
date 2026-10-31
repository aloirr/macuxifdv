# Plano de testes — Sprint 0 (Fundação modular) · T-0006

> Dono: agente `testes`. Versão 1 — 2026-10-30. Escopo agora: **plano** (não há código ainda; T-0001 Fase A em andamento).
> Fontes: `.coord/tarefas/T-0001..T-0005.md`, `docs/produto/03-regras-de-negocio.md`, `docs/produto/04-arquitetura-e-dados.md`, `docs/produto/02-modulos-e-requisitos.md` (RF-CORE-01/03/07), `docs/produto/05-roadmap.md`.
> Relatório de resultado: `tests/plano/relatorio-sprint-0.md` (mesmos IDs de cenário).
> Linha de base da Fase M (gerada hoje, só leitura): `tests/plano/fase-m-baseline.sha256` e `tests/plano/fase-m-git-status.txt`.

## 1. Como ler

- **ID** `S0-nnn` é estável: o arquivo de teste e o relatório citam o mesmo ID (no nome do `describe`/`test`).
- **Tipo**: `unit` (função pura, Vitest — responsabilidade do agente do módulo; eu só confiro que existe e passa), `integ` (API + Postgres de teste, ou entre módulos), `e2e` (Playwright no BKO), `comp` (componente do shell com Testing Library), `sync` (motor de sync com SQLite em memória), `carga` (autocannon/k6), `estático` (análise de código/config), `manual` (roteiro em aparelho real).
- **Destrava**: tarefa/fase cuja entrega permite escrever ou rodar o teste.
- **Arquivo previsto**: caminho sugerido sob `tests/` (meu) ou no módulo (dono do módulo). Nada é criado antes da T-0001 Fase A entregar a estrutura.

## 2. Ambiente de teste previsto (a confirmar quando a T-0001 entregar)

| Item | Proposta | Situação hoje (2026-10-30) |
|---|---|---|
| Runner unit/integ | Vitest em modo *projects* (raiz) — `vitest.workspace.*` ou `projects` no config raiz; arquivo é meu, crio após a Fase A | sem estrutura |
| Postgres de teste | Postgres 16 + pgvector, banco efêmero por execução (`macuxi_teste_<pid>`), migrações aplicadas do zero | **sem Docker e sem Postgres na máquina** — ver Risco R1 |
| Papel de conexão nos testes | papel de aplicação **sem** SUPERUSER, sem BYPASSRLS e que não é dono das tabelas (igual à API) | depende de T-0002 |
| E2E BKO | Playwright (Chromium), `playwright.config.ts` na raiz (meu), API + web locais | sem estrutura |
| Shell mobile | React Native Testing Library (componentes) + roteiro manual em aparelho | sem Android SDK/Java na máquina — R2 |
| Motor de sync | Vitest + SQLite em memória (`better-sqlite3` ou o adaptador escolhido no platform-sdk) + API real via `fastify.inject` ou servidor local | depende de T-0001 Fase A |
| Fronteiras | dependency-cruiser com a mesma config de `packages/config`, rodado também sobre fixture `tests/fixtures/fronteira/` | depende de T-0001 Fase A |
| Carga | autocannon (Node, roda no Windows sem instalação extra) | — |
| CI | GitHub Actions (T-0005) com serviço Postgres | sem `gh` local; branch atual `master`, principal declarada `main` — R5 |

## 3. Dados de teste — fixture "dois-tenants" (pedido ao `banco-dados`)

Separada do seed da Fase M (o seed da Fase M é de um tenant só e não tem promotor nem supervisor).

| Tenant | Fuso | Módulos ativos (tenant_modulo) | Usuários (perfil) |
|---|---|---|---|
| A "Distribuidora Alfa" | America/Manaus | core, vendedor, promotor, `teste`, `teste-dependente` | admin, analista, assistente, gerente, supervisor, vendedor-1 (equipe 1), vendedor-2 (equipe 2), promotor |
| B "Comercial Beta" | America/Sao_Paulo | core, vendedor | admin-B, vendedor-B |

- UUIDs fixos e legíveis (prefixo `aaaaaaaa-` para A, `bbbbbbbb-` para B) para asserts determinísticos.
- **Pelo menos 1 linha em toda tabela com `tenant_id` em cada tenant** (senão o teste de vazamento passa "no vazio").
- `perfil_modulo` em A: vendedor → core, vendedor, teste · promotor → core, promotor, teste · supervisor/gerente → core, vendedor, promotor.
- `usuario_modulo` em A: vendedor-2 com exceção que **remove** `teste`.
- Módulo fixture `teste` (rota `GET /v1/teste/ping`, extensão em `inicio.cards`, 1 entidade de sync `teste_item`) e `teste-dependente` (depende de `teste`) — vivem em `tests/fixtures/modulos/` e são registrados só em ambiente de teste (pedido ao engenheiro).
- Senhas de teste em `.env.test` (exemplo em `.env.test.example`), hash argon2 no banco; e-mails `@exemplo.com.br`.
- Caso de borda pedido: **mesmo e-mail em A e em B** (para S0-072), se o modelo de login permitir — pergunta aberta Q3.

## 4. Matriz de cenários por critério de aceite

### T-0001 — Monorepo em `modules/` + platform-sdk

**C1.1 — Os 277 testes da Fase M continuam passando nos novos locais**

| ID | Cenário | Tipo | Dados / pré-condições | Destrava | Arquivo previsto |
|---|---|---|---|---|---|
| S0-001 | Rodar a suíte da Fase M numa **cópia descartável** (fora dos dois repositórios) com `vitest --reporter=json` para obter a lista de referência: nome completo de cada teste (arquivo › describe › it) e total (esperado 277) | estático | cópia em pasta temporária + `pnpm install` lá; nunca rodar dentro da Fase M (R3) | já possível | `tests/fundacao/fase-m/referencia.json` (gerado) |
| S0-002 | Rodar os testes copiados no `macuxifdv` (`pnpm test` + reporter JSON) e comparar **por nome** com a referência: nenhum teste faltando, nenhum falhando, total ≥ 277 | integ | mapa origem → destino de `docs/desenho/T-0001.md` (renomeações de arquivo/describe precisam estar no mapa) | T-0001 Fases A+B | `tests/fundacao/fase-m-contagem.test.ts` + script `tests/scripts/comparar-testes-fase-m.mjs` |
| S0-003 | Nenhum `.skip`, `.only`, `.todo`, `--passWithNoTests` mascarando arquivo vazio, nem asserção removida nos arquivos copiados (diff de corpo de teste origem × destino, ignorando imports) | estático | arquivos origem (Fase M) e destino | T-0001 Fase B | idem S0-002 |
| S0-004 | Lint e typecheck verdes em `modules/core`, `modules/vendedor`, `apps/web`, `apps/mobile` após a cópia | estático | — | T-0001 Fases A+B | CI (T-0005) |
| S0-005 | Os testes de `domain` ficaram no módulo certo (core × vendedor) e rodam isoladamente (`pnpm --filter @macuxi/core test`, `... vendedor test`) | integ | mapa do desenho | T-0001 Fase B | `tests/fundacao/fase-m-contagem.test.ts` |

Referência estática (contagem de chamadas `it(`/`test(` hoje na Fase M, 23 arquivos, **187 chamadas**; a diferença para 277 vem de `it.each`/`test.each` em 9 arquivos — S0-001 confirma em execução):

| Arquivo (Fase M) | Chamadas | Usa `.each` |
|---|---|---|
| apps/mobile/src/lib/helpers.test.ts | 13 | — |
| apps/mobile/src/lib/order-pdf.test.ts | 10 | — |
| apps/mobile/src/lib/order-prefill.test.ts | 2 | — |
| apps/mobile/src/lib/outbox.test.ts | 6 | — |
| apps/mobile/src/lib/time.test.ts | 4 | — |
| apps/mobile/src/lib/visit.test.ts | 13 | — |
| apps/mock-api/test/api.test.ts | 18 | — |
| apps/web/lib/api.test.ts | 4 | — |
| apps/web/lib/audit.test.ts | 7 | — |
| apps/web/lib/csv.test.ts | 4 | — |
| apps/web/lib/format.test.ts | 4 | sim |
| apps/web/lib/plan-form.test.ts | 11 | — |
| apps/web/lib/policy-form.test.ts | 1 | sim |
| apps/web/lib/routes.test.ts | 22 | sim |
| apps/web/lib/rules.test.ts | 4 | sim |
| packages/contracts/src/index.test.ts | 6 | — |
| packages/domain/src/analytics.test.ts | 6 | — |
| packages/domain/src/calendar.test.ts | 5 | — |
| packages/domain/src/incentive.test.ts | 13 | sim |
| packages/domain/src/money.test.ts | 2 | sim |
| packages/domain/src/order.test.ts | 14 | sim |
| packages/domain/src/route.test.ts | 6 | — |
| packages/domain/src/visit.test.ts | 12 | — |

Atenção: vários desses arquivos (`visit`, `route`, `order-pdf`, `order-prefill`, `routes`) **não estão commitados** na Fase M (ver `fase-m-git-status.txt`). A cópia da T-0001 tem de partir da **árvore de trabalho**, não do `HEAD` 41283b7 — senão os 277 não fecham. Os testes de `apps/mock-api` (18) não têm destino óbvio na nova arquitetura: o desenho da T-0001 precisa dizer se entram na conta dos 277 ou se são aposentados com justificativa (Q1).

**C1.2 — A pasta da Fase M não foi alterada e a demo continua funcionando**

| ID | Cenário | Tipo | Dados / pré-condições | Destrava | Arquivo previsto |
|---|---|---|---|---|---|
| S0-006 | `sha256sum -c tests/plano/fase-m-baseline.sha256` na Fase M: 226 arquivos idênticos (exclui `node_modules`, `.git`, `.next`, `.expo`, `.turbo`) e nenhum arquivo novo fora dessas pastas | estático | linha de base de 2026-10-30 (já gerada) | já possível; rodar ao fim de cada fase da T-0001 | `tests/fundacao/fase-m-intacta.test.ts` |
| S0-007 | `git --no-optional-locks status --porcelain --untracked-files=all` na Fase M igual a `fase-m-git-status.txt` e `HEAD` = 41283b7 | estático | idem | já possível | idem |
| S0-008 | Demo da Fase M funciona: em **cópia descartável** (pasta temporária), `pnpm install`, `pnpm seed`, sobe mock-api :8000 e web :3000; smoke Playwright (abre web, lista pedidos, abre um cliente) e `GET` de saúde na API | e2e | cópia; portas livres | já possível | `tests/fundacao/fase-m-demo.spec.ts` (Playwright, baseURL da cópia) |
| S0-009 | Nenhum script, config ou package do `macuxifdv` aponta para `C:\Users\domon\dev\forca-vendas` como destino de escrita (grep de `forca-vendas` fora de `docs/` e `tests/plano/`) | estático | — | T-0001 Fase A | `tests/fundacao/fase-m-intacta.test.ts` |

Observação: rodar `iniciar-demo.cmd`/`pnpm demo` **dentro** da Fase M escreve nela (`pnpm install`, `mock-data/saida/*.xlsx`, `.next`). Por isso S0-008 roda numa cópia; se o Alexandre quiser a prova na pasta original, é teste manual dele (roteiro M-01) e a linha de base precisa ser regerada depois.

**C1.3 — dependency-cruiser falha se um módulo importar código interno de outro**

| ID | Cenário | Tipo | Dados / pré-condições | Destrava | Arquivo previsto |
|---|---|---|---|---|---|
| S0-010 | Repositório real passa no dependency-cruiser sem violações (exit 0) | estático | config de `packages/config` | T-0001 Fase A | CI + `tests/fundacao/fronteiras.test.ts` |
| S0-011 | Fixture com violações, cada uma deve falhar (exit ≠ 0, mensagem cita a regra): `modules/a` importando `modules/b/domain`, `b/api`, `b/app`, `b/web`, `b/db`, `b/manifest.ts`; via caminho relativo (`../../b/domain/x`), via alias de pacote (`@macuxi/b/domain`), `import()` dinâmico, `require`, `export * from`, `import type` | estático | `tests/fixtures/fronteira/` com a mesma config (pedido ao engenheiro: config reutilizável apontando para outra raiz) | T-0001 Fase A | `tests/fundacao/fronteiras.test.ts` |
| S0-012 | Fixture com importações permitidas não falha: `modules/b/contracts`, `modules/core/contracts`, `packages/*` | estático | idem | T-0001 Fase A | idem |
| S0-013 | `packages/*` não importa nada de `modules/*` (plataforma não depende de módulo) e `modules/*/contracts` não importa `domain`/`api`/`db` de ninguém (contrato só depende de Zod e de outros contracts) | estático | idem | T-0001 Fase A (confirmar se essas regras existem — Q2) | idem |
| S0-014 | Nenhum módulo referencia tabela de outro schema: busca de `pgSchema('<outro>')`/SQL cru com `<outro>.` em `modules/<m>/db` e `modules/<m>/api` | estático | — | T-0002 + T-0001 | `tests/fundacao/fronteiras-schema.test.ts` |

### T-0002 — Schemas `plataforma` e `core`, RLS e migrações

**C2.1 — Migração sobe e desce sem erro**

| ID | Cenário | Tipo | Dados / pré-condições | Destrava | Arquivo previsto |
|---|---|---|---|---|---|
| S0-020 | Banco vazio → `up` completo sem erro → `down` completo sem erro → banco igual ao inicial (dump de schema sem objetos de `plataforma`/`core`) | integ | Postgres de teste efêmero | T-0002 | `tests/integracao/banco/migracoes.test.ts` |
| S0-021 | Ciclo `up → down → up`: o dump de schema (`pg_dump --schema-only` ou consulta ao catálogo) do 2º `up` é idêntico ao do 1º | integ | idem | T-0002 | idem |
| S0-022 | `down` com seed carregado não falha (ou falha com mensagem documentada, se for decisão do banco) | integ | seed Fase M | T-0002 | idem |
| S0-023 | Conformidade (regra 5 do CLAUDE.md): toda tabela de `plataforma` e `core` tem `id uuid`, `tenant_id`, `created_at`, `updated_at`, `deleted_at`, `external_id`; `relrowsecurity = true` e ≥ 1 política; exceções declaradas pelo banco (ex.: `plataforma.tenant`) | integ | catálogo do Postgres; lista de exceções do banco-dados | T-0002 | `tests/integracao/banco/conformidade.test.ts` |

**C2.2 — Teste de vazamento: tenant A não lê dados do tenant B em nenhuma tabela** (RN-CORE-05)

| ID | Cenário | Tipo | Dados / pré-condições | Destrava | Arquivo previsto |
|---|---|---|---|---|---|
| S0-024 | Para **cada tabela com `tenant_id` descoberta dinamicamente** no `information_schema` (tabela nova fica coberta sem editar o teste): conectado como papel da aplicação com contexto do tenant A, `SELECT` retorna só linhas de A e `count(*) where tenant_id = B` = 0 | integ | fixture dois-tenants (≥ 1 linha por tabela por tenant) | T-0002 | `tests/integracao/multitenant/vazamento-leitura.test.ts` |
| S0-025 | Escrita cruzada: no contexto de A, `INSERT` com `tenant_id = B` é rejeitado (WITH CHECK); `UPDATE`/`DELETE` em linhas de B afetam 0 linhas; `UPDATE` que troca `tenant_id` de A para B é rejeitado | integ | idem | T-0002 | `tests/integracao/multitenant/vazamento-escrita.test.ts` |
| S0-026 | **Falha fechada**: sem contexto de tenant definido (ou contexto vazio/inválido), toda tabela retorna 0 linhas ou erro — nunca todas | integ | idem | T-0002 | idem S0-024 |
| S0-027 | Pool de conexões: com pool de tamanho 1, alternar transações A/B/A; o contexto é `SET LOCAL`/por transação e não "vaza" para a próxima requisição | integ | idem | T-0002 + T-0003 (camada de acesso da API) | `tests/integracao/multitenant/pool.test.ts` |
| S0-028 | O papel usado pela API não é SUPERUSER, não tem BYPASSRLS e não é dono das tabelas (ou as tabelas têm `FORCE ROW LEVEL SECURITY`) | integ | `pg_roles`, `pg_class` | T-0002 | `tests/integracao/banco/conformidade.test.ts` |
| S0-029 | API: token do tenant A pedindo recurso por ID do tenant B → 404 (não revela existência); `tenant_id` enviado em header/corpo/query é ignorado — só vale o do token | integ | fixture; rotas de core da T-0003 (`/v1/me`, `/v1/me/modulos`, usuários) | T-0003 | `tests/integracao/multitenant/api.test.ts` |
| S0-030 | Outbox e auditoria por tenant: evento `core.usuario.modulos_alterados@1` gerado em A não é entregue a consumidor no contexto de B; `plataforma.auditoria` de A invisível para admin de B | integ | idem | T-0003 | idem |

**C2.3 — Seed carrega os usuários fake da Fase M**

| ID | Cenário | Tipo | Dados / pré-condições | Destrava | Arquivo previsto |
|---|---|---|---|---|---|
| S0-031 | Seed carrega os 12 usuários da Fase M (`apps/mock-api/src/seed/generate.ts`): 8 vendedores (Bruna T., Rafael S., Diego M., Carla N., Marcos P., Lívia R., Thiago A., Paula V.), gerente Fernando Lima, analista Juliana Melo, assistente Ana Costa, admin Patrícia Gomes — comparar por e-mail e perfil (`seller→vendedor`, `manager→gerente`, `analyst→analista`, `bko_assistant→assistente`, `admin→admin`) | integ | seed T-0002 | T-0002 | `tests/integracao/banco/seed-fase-m.test.ts` |
| S0-032 | Equipes da Fase M (Zona Sul, Zona Norte, Centro, Interior, Zona Leste, Zona Oeste) existem e cada vendedor está na equipe certa; hierarquia gerente → equipes | integ | idem | T-0002 | idem |
| S0-033 | Seed idempotente: rodar 2× não duplica (contagens iguais) | integ | idem | T-0002 | idem |
| S0-034 | Senhas armazenadas com argon2 (prefixo `$argon2id$`), nenhuma em texto; nenhum dado pessoal real (domínio `@exemplo.com.br`) | integ | idem | T-0002 + T-0003 | idem |

### T-0003 — Auth, perfis e licenças de módulos

**C3.1 — Ativar/desativar um módulo de teste reflete no app no próximo sync** (RN-CORE-01, 02, 03; RF-CORE-03)

| ID | Cenário | Tipo | Dados / pré-condições | Destrava | Arquivo previsto |
|---|---|---|---|---|---|
| S0-040 | `modulosEfetivos` = ativos do tenant ∩ perfil ∩ exceções do usuário; core sempre presente; módulo com dependência inativa sai (tabela de casos) | unit (modulo-core) | — | T-0003 | `modules/core/domain/*.test.ts` (dono: modulo-core) |
| S0-041 | API: admin de A desativa `teste` no tenant → `GET /v1/me/modulos` do vendedor-1 não traz `teste`; reativa → volta (com versão e parâmetros) | integ | fixture dois-tenants + módulo `teste` | T-0003 + T-0004 (registro de módulo fixture) | `tests/integracao/licencas/ativacao.test.ts` |
| S0-042 | Três níveis: tenant desligado vence perfil ligado; perfil sem o módulo → usuário não tem; exceção do vendedor-2 remove `teste` só dele (vendedor-1 continua com) | integ | idem | T-0003 | idem |
| S0-043 | Ativar/desativar grava `core.usuario.modulos_alterados@1` no outbox na mesma transação e registra auditoria quem/quando/antes/depois (RN-AUD-01) | integ | idem | T-0003 | idem |
| S0-044 | `teste-dependente` só aparece com `teste` ativo; desligar `teste` remove os dois sem erro (RN-CORE-03) | integ | idem | T-0003 | idem |
| S0-045 | Core não pode ser desativado (API recusa; tela com controle desabilitado) | integ + e2e | idem | T-0003 | idem + `tests/e2e/bko/licencas.spec.ts` |
| S0-046 | **Sync**: app com `teste` ativo e tabela local `teste_item` populada → admin desativa → próximo sync: shell desmonta aba/menu/extensão, motor apaga `teste_item` do SQLite e deixa de pedir a entidade no pull; reativar → reaparece e repuxa | sync | SQLite em memória + API real | T-0001 Fase A (motor) + T-0003 + T-0004 | `tests/sync/licenca-modulo.test.ts` |
| S0-047 | Offline: módulo desativado com aparelho sem rede → app continua com o estado anterior, sem travar; na reconexão o sync aplica a desativação | sync | idem, rede simulada | idem | idem |
| S0-048 | Itens pendentes na outbox de um módulo que foi desativado: push devolve rejeitado `MODULO_INATIVO` por item e o app mostra na tela de sincronização (não some em silêncio) — comportamento a confirmar (Q4) | sync | idem | idem | idem |
| S0-049 | Dados na nuvem do módulo desativado permanecem (retenção [90] dias) e voltam ao reativar (RN-CORE-02) | integ | idem | T-0003 | `tests/integracao/licencas/ativacao.test.ts` |
| S0-050 | BKO: admin percorre tenant → perfil → usuário, liga/desliga `teste`; a lista "Meus módulos" do usuário reflete; analista/assistente não acessam a tela (menu ausente + API 403) — matriz §2 "Ativar/desativar módulos: só admin" | e2e | idem; web + API locais | T-0003 + T-0004 | `tests/e2e/bko/licencas.spec.ts` |
| S0-051 | App: tela "Meus módulos" lista exatamente os efetivos | comp | idem | T-0003 + T-0004 | `tests/comp/mobile/meus-modulos.test.tsx` |

**C3.2 — Rota de módulo inativo responde 403 `MODULO_INATIVO`**

| ID | Cenário | Tipo | Dados / pré-condições | Destrava | Arquivo previsto |
|---|---|---|---|---|---|
| S0-052 | **Varredura de rotas**: enumerar todas as rotas registradas no Fastify (hook `onRoute`) de cada módulo não-core; chamar cada uma com token de usuário sem o módulo → 403 com corpo `{ codigo: 'MODULO_INATIVO' }` (rota nova fica coberta sem editar o teste) | integ | fixture + `teste` | T-0003 + T-0004 | `tests/integracao/licencas/modulo-inativo.test.ts` |
| S0-053 | Os dois motivos dão o mesmo código: módulo inativo no tenant (vendedor-B em `/v1/teste/ping`) e inativo só para o usuário (vendedor-2) | integ | idem | T-0003 | idem |
| S0-054 | Precedência: sem token → 401; token válido + módulo inativo → 403 `MODULO_INATIVO`; módulo ativo + perfil sem permissão → 403 com outro código; recurso inexistente → 404 | integ | idem | T-0003 | idem |
| S0-055 | **Licença checada por requisição**: desativar o módulo com o JWT ainda válido (15 min) → a próxima chamada já é 403 (licença não pode estar "congelada" no token) | integ | idem | T-0003 | idem |
| S0-056 | `GET /v1/sync/pull?entidades=teste_item` com módulo inativo → 403 `MODULO_INATIVO` (ou entidade ignorada — Q5); `POST /v1/sync/push` com item de módulo inativo → item rejeitado `MODULO_INATIVO` | integ | idem | T-0001 Fase A (sync) + T-0003 | idem |

**C3.3 — Promotor não vê nenhuma ação de pedido** (RN-PRO-01, matriz §2)

| ID | Cenário | Tipo | Dados / pré-condições | Destrava | Arquivo previsto |
|---|---|---|---|---|---|
| S0-060 | Matriz de permissões perfil × ação como função pura; para promotor: criar, editar, cancelar, duplicar, excluir pedido = negado; ver pedidos = leitura da carteira | unit (modulo-core) | — | T-0003 | `modules/core/domain/*.test.ts` |
| S0-061 | App Campo logado como promotor **em tenant com Vendedor ativo**: nenhuma aba "Novo pedido", nenhuma ação de pedido em `produto.acoes`, `cliente.abas`, `inicio.cards`, detalhe de pedido sem botões de editar/cancelar/duplicar/excluir | comp | fixture A (promotor) | T-0003 + T-0004 | `tests/comp/mobile/promotor-sem-pedido.test.tsx` |
| S0-062 | Navegação direta (deep link / rota) para a tela de novo pedido como promotor → tela de bloqueio, nada é gravado na outbox | comp | idem | T-0004 | idem |
| S0-063 | API: promotor em `POST/PUT/PATCH/DELETE` de pedido → 403. Na Sprint 0 ainda não há rotas de pedido (Sprints 4–5): validar com rota fixture protegida pela ação `pedido.criar` no guard do platform-sdk; **teste definitivo reaberto na Sprint 4** | integ | fixture A | T-0003 | `tests/integracao/perfis/promotor-pedido.test.ts` |
| S0-064 | Exceção de usuário não "fura" a regra: promotor com exceção que adicionasse Vendedor continua sem ação de pedido (RN-PRO-01 é "nunca") | integ + comp | fixture A | T-0003 | idem |
| S0-065 | Sync push com pedido vindo de token de promotor → item rejeitado (RN-PRO-01) | sync | idem | T-0001 Fase A + T-0003 (Sprint 4 para o definitivo) | `tests/sync/promotor-pedido.test.ts` |
| S0-066 | BKO: promotor não tem ações de pedido no web (ou não tem acesso ao BKO — Q6) | e2e | idem | T-0003 + T-0004 | `tests/e2e/bko/perfis.spec.ts` |

**Auth (objetivo da T-0003, sem critério explícito — base para todos os outros)**

| ID | Cenário | Tipo | Dados / pré-condições | Destrava | Arquivo previsto |
|---|---|---|---|---|---|
| S0-070 | Login OK devolve access (15 min) + refresh; senha errada e usuário inexistente dão a **mesma** resposta (sem enumeração de usuário) | integ | fixture | T-0003 | `tests/integracao/auth/login.test.ts` |
| S0-071 | Refresh rotativo: refresh usado 2× → 2º recusado e família revogada; access expirado → 401; usuário bloqueado → refresh recusado (RF-CORE-01 "bloqueio remoto") | integ | relógio simulado | T-0003 | idem |
| S0-072 | Mesmo e-mail em A e B: login escolhe/pede o tenant de forma determinística e o token nunca mistura tenants (Q3) | integ | fixture com e-mail repetido | T-0003 | idem |
| S0-073 | Nenhum e-mail, senha, token ou refresh nos logs pino durante login/refresh/erro (captura do stream de log) | integ | idem | T-0003 | `tests/integracao/auth/logs-sem-pii.test.ts` |
| S0-074 | Escopo de carteira (RN-CORE-04): vendedor vê só a própria carteira, supervisor a equipe, gerente as equipes abaixo, admin o tenant — em `/v1/core/clientes` se existir na Sprint 0; senão reaberto na Sprint 1 | integ | fixture | T-0003 / Sprint 1 | `tests/integracao/perfis/escopo-carteira.test.ts` |

### T-0004 — Shells montando módulos pelo manifesto

**C4.1 — Dois builds Android de desenvolvimento a partir do mesmo código**

| ID | Cenário | Tipo | Dados / pré-condições | Destrava | Arquivo previsto |
|---|---|---|---|---|---|
| S0-080 | `app.config.ts` avaliado com `APP_VARIANT=campo` e `=gestao` gera `name`, `android.package`, ícone e lista de módulos possíveis diferentes; package distintos permitem instalar os dois lado a lado | unit/estático | — | T-0004 | `tests/fundacao/variantes-mobile.test.ts` |
| S0-081 | Dois APKs de desenvolvimento gerados (perfis EAS ou `expo prebuild` + Gradle); `aapt dump badging` mostra os dois packages; ambos instalam e abrem no mesmo aparelho | manual | Android SDK/Java ou EAS (conta Expo) — R2 | T-0004 | roteiro M-02 |
| S0-082 | Variante limita módulos mesmo se licenciados: Campo nunca monta `gestor`; Gestão mostra a aba "Trade" de leitura e não as telas de coleta do promotor (manifesto `apps.campo`/`apps.gestao`) | comp | fixture A (gerente com promotor licenciado) | T-0004 | `tests/comp/mobile/variantes.test.tsx` |

**C4.2 — Extensão de exemplo aparece só com o módulo ativo** (RN-CORE-03)

| ID | Cenário | Tipo | Dados / pré-condições | Destrava | Arquivo previsto |
|---|---|---|---|---|---|
| S0-083 | Mobile: card de `teste` em `inicio.cards` renderiza com módulo ativo; inativo → não renderiza, sem erro e sem "buraco" de layout | comp | registro de módulos injetável no shell | T-0004 | `tests/comp/mobile/extensoes.test.tsx` |
| S0-084 | Web: mesmo cenário no slot equivalente do BKO e item de menu do módulo aparece/some após ligar/desligar no BKO | comp + e2e | idem | T-0004 + T-0003 | `tests/comp/web/extensoes.test.tsx`, `tests/e2e/bko/licencas.spec.ts` |
| S0-085 | Extensão opcional com provedor inativo some sem erro (consumidor ativo, provedor inativo) | comp | `teste-dependente` declarando opcional | T-0004 | `tests/comp/mobile/extensoes.test.tsx` |
| S0-086 | Extensão que lança exceção não derruba o shell (error boundary por extensão) — desejável | comp | fixture que lança | T-0004 | idem |
| S0-087 | API monta os plugins dos módulos e o bloqueio é por requisição/tenant (S0-052); módulo não instalado na build não registra rota (404) — confirmar desenho (Q7) | integ | — | T-0004 | `tests/integracao/licencas/modulo-inativo.test.ts` |

### T-0005 — CI e verificação de donos

**C5.1 — PR que altera arquivo fora do dono é sinalizado**

| ID | Cenário | Tipo | Dados / pré-condições | Destrava | Arquivo previsto |
|---|---|---|---|---|---|
| S0-090 | Em **clone descartável** (pasta temporária, sem push): branch de um agente alterando arquivo de outro dono → passo de verificação do CI sai com código ≠ 0 e lista arquivo + dono | integ | clone local; modo do `verificar` que compara com a base do PR (R4) | T-0005 | `tests/ci/verificar-donos.test.ts` |
| S0-091 | Branch que altera só caminhos do próprio dono → passo verde | integ | idem | T-0005 | idem |
| S0-092 | Exceções universais aceitas (recado novo em `.coord/recados/<destino>/`, próprio diário, próprio `lidos`); **edição** de recado existente é sinalizada (recados são imutáveis) | integ | idem | T-0005 | idem |
| S0-093 | Alteração em `.coord/donos.json`, `.claude/**` ou `scripts/coord*.mjs` por qualquer agente → sinalizada (dono: alexandre) | integ | idem | T-0005 | idem |

**C5.2 — Pipeline verde no branch principal**

| ID | Cenário | Tipo | Dados / pré-condições | Destrava | Arquivo previsto |
|---|---|---|---|---|---|
| S0-094 | Workflow contém: install com lockfile congelado, lint, typecheck, testes unit, testes `tests/` com serviço Postgres, dependency-cruiser, verificação de donos | estático | arquivo do workflow | T-0005 | `tests/ci/pipeline.test.ts` (lê o YAML) |
| S0-095 | Cada passo realmente reprova: em clone descartável, injetar 1 falha por vez (erro de lint, erro de tipo, teste vermelho, import proibido) e rodar o comando do passo localmente → exit ≠ 0 | integ | clone local | T-0005 | idem |
| S0-096 | Última execução no branch principal verde (consulta somente leitura ao GitHub; sem `gh` na máquina — o engenheiro/Alexandre anexa o link) | manual | acesso ao GitHub | T-0005 | roteiro M-04 |

## 5. Cenários transversais obrigatórios (resumo de cobertura)

| Tema | Cenários |
|---|---|
| Isolamento multi-tenant (RLS, vazamento) | S0-023, S0-024, S0-025, S0-026, S0-027, S0-028, S0-029, S0-030, S0-072, S0-111 |
| Licença de módulo (aparece/some; API recusa) | S0-040 a S0-056, S0-083 a S0-087 |
| Perfis (inclusive promotor × pedido, UI e API) | S0-050, S0-054, S0-060 a S0-066, S0-074 |
| Offline básico | S0-046, S0-047, S0-048, S0-100 a S0-105 |
| Fronteiras de módulo (dependency-cruiser) | S0-010 a S0-014, S0-094, S0-095 |
| Preservação da Fase M | S0-001 a S0-009 |

### Offline básico (RF-CORE-01, RF-CORE-07; motor de sync do platform-sdk)

| ID | Cenário | Tipo | Dados / pré-condições | Destrava | Arquivo previsto |
|---|---|---|---|---|---|
| S0-100 | Após o 1º login online, o app abre sem rede, com sessão e a última lista de módulos efetivos (sem tela de erro) | comp + manual | armazenamento local simulado; roteiro M-03 em modo avião | T-0003 + T-0004 | `tests/comp/mobile/offline-abertura.test.tsx` |
| S0-101 | Pull paginado por cursor `(updated_at, id)` com 2.500 linhas e páginas de 1.000: nada repetido, nada perdido, inclusive linhas com o mesmo `updated_at` na fronteira da página e removidas (`deleted_at`) | sync | SQLite em memória; `teste_item` | T-0001 Fase A | `tests/sync/pull-cursor.test.ts` |
| S0-102 | Push idempotente por UUID gerado no aparelho: reenviar o mesmo lote → resposta `aceito` igual, 1 linha só no Postgres (RN-VEN-33, regra 4) | sync | idem | T-0001 Fase A + T-0002 | `tests/sync/push-idempotente.test.ts` |
| S0-103 | Queda de rede no meio do push (servidor gravou, resposta perdida) → reenvio não duplica e a outbox limpa o item | sync | rede simulada | idem | idem |
| S0-104 | Access expirado enquanto offline → na reconexão o refresh acontece antes do push e a outbox não perde itens | sync | relógio simulado | T-0003 | `tests/sync/reconexao.test.ts` |
| S0-105 | Pull respeita o tenant e o escopo: vendedor-1 nunca recebe `teste_item` de B nem fora da carteira | sync | fixture | T-0002 + T-0003 | `tests/sync/pull-cursor.test.ts` |

### Carga leve (linha de base para a Sprint 9)

| ID | Cenário | Tipo | Dados / pré-condições | Destrava | Arquivo previsto |
|---|---|---|---|---|---|
| S0-110 | autocannon 50 conexões × 30 s em `POST /v1/auth/login` e `GET /v1/me/modulos`: p95 < 300 ms, 0 respostas 5xx | carga | API local + Postgres de teste | T-0003 | `tests/carga/fundacao.mjs` |
| S0-111 | Sob a mesma carga, requisições alternando tokens de A e B: **toda** resposta pertence ao tenant do token (pega vazamento de contexto no pool sob concorrência) | carga | fixture | T-0002 + T-0003 | idem |

## 6. Testes manuais (roteiros)

| ID | Roteiro | Quem | Evidência |
|---|---|---|---|
| M-01 | (Opcional) Demo na pasta original da Fase M: rodar `iniciar-demo.cmd`, abrir http://localhost:3000, abrir um pedido, gerar PDF no app. **Escreve na pasta** — depois regerar `fase-m-baseline.sha256` | Alexandre | prints |
| M-02 | Instalar os APKs Campo e Gestão no mesmo aparelho Android 10+: nomes e ícones diferentes; login em cada um; Campo sem aba de gestor; Gestão com aba Trade só leitura | Alexandre ou engenheiro | prints + `aapt dump badging` |
| M-03 | Aparelho real: login online → modo avião → fechar e reabrir o app (abre em < 2 s, sessão mantida, módulos visíveis) → admin desliga `teste` no BKO → tirar do modo avião → sincronizar → aba/card de `teste` some | Alexandre | vídeo curto |
| M-04 | Link da execução verde do CI no branch principal | engenheiro | URL |

## 7. Ordem de execução e o que cada tarefa destrava

1. **Já possível**: S0-001, S0-006, S0-007, S0-008 (linha de base e demo da Fase M em cópia).
2. **T-0001 Fase A** (estrutura, platform-sdk, dependency-cruiser): crio `vitest.workspace`/`playwright.config`, fixtures de fronteira e de módulos; S0-009 a S0-013, S0-101 a S0-103 (motor de sync com adaptador em memória).
3. **T-0001 Fase B**: S0-002 a S0-005 (contagem dos 277).
4. **T-0002**: S0-014, S0-020 a S0-028, S0-031 a S0-034.
5. **T-0003 + T-0004**: S0-029, S0-030, S0-040 a S0-087, S0-100, S0-104, S0-105, S0-110, S0-111.
6. **T-0005**: S0-090 a S0-096.

## 8. Riscos e achados do planejamento

- **R1 — Sem Postgres local** (nem Docker, nem `psql`). Bloqueia S0-020 a S0-034 e toda integ. Alternativas: instalar Postgres 16 + pgvector, Docker Desktop, ou `embedded-postgres` (binários via npm). PGlite não serve para RLS (roda como superusuário). Decisão do banco-dados/engenheiro.
- **R2 — Sem Android SDK/Java** na máquina: S0-081 depende de EAS (conta Expo do Alexandre) ou instalação do SDK.
- **R3 — Rodar qualquer coisa dentro da Fase M escreve nela** (`pnpm install`, `vitest` grava cache, `pnpm seed`/demo gravam `mock-data/saida`, `.next`). Toda execução da Fase M é feita numa cópia. Até `git status` atualiza `.git/index`; usar `git --no-optional-locks`.
- **R4 — `node scripts/coord.mjs verificar <agente>` compara a árvore de trabalho com `HEAD`**: (a) num checkout limpo de CI não vê nada (o diff do PR já está commitado) — C5.1 não é atendido sem um modo `--base <ref>`; (b) com vários agentes na mesma árvore, acusa arquivos de outros (hoje `verificar testes` acusa `.coord/quadro.md`, `.coord/tarefas/T-0001.md` e `.coord/diario/gerente-projetos.md`, que são do gerente); (c) o CI precisa saber qual agente é o autor do PR (convenção de branch `agente/T-nnnn` ou trailer no commit). O script é do Alexandre; o CI é do engenheiro.
- **R5 — Nome do branch principal**: o repositório está em `master`, o principal declarado é `main`. O gatilho do CI e o critério C5.2 precisam do nome certo.
- **R6 — Testes não commitados na Fase M**: a cópia deve partir da árvore de trabalho (ver C1.1).
- **R7 — Pedido não existe na Sprint 0**: C3.3 só pode ser provado na UI (ausência de ações) e no guard com rota fixture; o 403 nas rotas reais de pedido é reaberto na Sprint 4.

## 9. Perguntas abertas

- **Q1** (engenheiro): os 18 testes de `apps/mock-api` entram nos 277 em algum destino ou são aposentados com justificativa no desenho?
- **Q2** (engenheiro): a config do dependency-cruiser inclui `packages/* ↛ modules/*` e `contracts ↛ domain/api/db`?
- **Q3** (modulo-core): e-mail é único global ou por tenant? Como o login resolve e-mail repetido?
- **Q4** (modulo-core/engenheiro): o que acontece com itens da outbox de um módulo desativado?
- **Q5** (engenheiro): pull de entidade de módulo inativo → 403 ou entidade ignorada?
- **Q6** (modulo-core): promotor tem acesso ao BKO?
- **Q7** (engenheiro): "api carregando apenas módulos efetivos" — registro por build/instalação + bloqueio por requisição, ou outra coisa?
- **Q8** (modulo-core/gerente): RN-CORE-01 diz "∩ exceções do usuário" — a exceção só remove módulo ou também pode acrescentar um que o perfil não tem? Muda S0-042 e S0-064.

## 10. Pedidos enviados (recados T-0006)

- `banco-dados` (R-20261030-235502-testes): fixture dois-tenants, papel de aplicação sem BYPASSRLS, mecanismo de contexto de tenant, banco de teste efêmero, lista de exceções da regra 5 (R1).
- `engenheiro-software` (R-20261030-235521-testes): ganchos de teste no platform-sdk e nos shells (registro de módulos injetável, `createApp` para `inject`, adaptador SQLite em memória), config do dependency-cruiser reutilizável, formato de erro `MODULO_INATIVO`, CI com `--base` (R4/R5), Q1/Q2/Q5/Q7.
- `modulo-core` (R-20261030-235542-testes): contrato `/v1/me/modulos` e de erro, matriz de permissões como função pura, `testID`/`data-testid` estáveis, Q3/Q4/Q6/Q8.
- `modulo-vendedor` (R-20261030-235545-testes): manifesto do Vendedor sem `promotor` em `perfis` e ações de pedido declaradas com permissão (S0-061).
