# Relatório de testes — Sprint 0 · critério → teste → resultado

> Dono: agente `testes` (T-0006). Plano e detalhes de cada cenário: `tests/plano/sprint-0.md`.
> Legenda do resultado: `pendente` (ainda não rodou) · `✅` passou · `❌` falhou (ver Defeitos) · `bloqueado` (dependência; ver coluna) · `parcial` (provado só em parte; ver nota).
> Atualizar a cada rodada: data, commit, comando e saída resumida.

| Rodada | Data | Commit | Ambiente | Comando |
|---|---|---|---|---|
| 0 | 2026-10-30 | — | plano (sem código) | — |
| 1 (T-0001 Fase D) | 2026-10-31 | 87460de + árvore de trabalho (engenheiro e banco-dados alterando em paralelo) | Windows 11, Node 24.21, pnpm 12.11.2, Docker de pé | ver "T-0001 — evidências da Fase D" abaixo |
| 2 (T-0002 + S0-014) | 2026-10-31 | 303b739 + árvore de trabalho (engenheiro em packages/platform-sdk e apps/ pela T-0004; vendedor em modules/vendedor) | Windows 11, Node 24.21, pnpm 12.11.2, container `macuxi-postgres` (Postgres 16.15 + pgvector) | `MACUXI_PG_EXIGIR=1 pnpm test:tests` e `MACUXI_PG_EXIGIR=1 pnpm --filter @macuxi/db test` — ver "T-0002 — evidências" abaixo |

## Critério → teste → resultado

| Tarefa | Critério | Cenários | Tipo | Resultado | Bloqueado por / nota |
|---|---|---|---|---|---|
| T-0001 | C1.1 Os 277 testes da Fase M passam nos novos locais | S0-001, S0-002, S0-003, S0-004, S0-005 | estático, integ | ✅ | 277/277 por nome (275 idênticos + 2 com describe renomeado), todos verdes; 4 deles reescritos no SDK com o mesmo título. Rodada 2: 1 caso substituído por decisão posterior (ver Observações da rodada 2) |
| T-0001 | C1.2 Fase M não alterada e demo funcionando | S0-006, S0-007, S0-008, S0-009 | estático, e2e | ✅ (S0-008 parcial) | pasta idêntica à linha de base; demo na cópia: API ok, web dev não subiu (ver S0-008) |
| T-0001 | C1.3 dependency-cruiser falha em import interno entre módulos | S0-010, S0-011, S0-012, S0-013, S0-014 | estático | ✅ | 18 variantes de violação falham e os imports permitidos passam; S0-014 (SQL/Drizzle entre schemas) ✅ na rodada 2 |
| T-0002 | C2.1 Migração sobe e desce sem erro | S0-020, S0-021, S0-022, S0-023 | integ | ✅ | S0-020/021/022 pela suíte do banco-dados (6/6) + ciclo up → down --tudo → up → down --tudo → up pela CLI num banco efêmero; S0-023 também em tests/ (independente) |
| T-0002 | C2.2 Tenant A não lê dados do tenant B em nenhuma tabela | S0-024, S0-025, S0-026, S0-027, S0-028, S0-029, S0-030, S0-111 | integ, carga | ✅ (parte de banco) | S0-024..028 ✅ em tests/ como `macuxi_app` (e na suíte do banco-dados); parte de banco do S0-111 ✅ (concorrência no pool). S0-029, S0-030 e S0-111 pela API: pendente (T-0003/T-0004 em andamento) |
| T-0002 | C2.3 Seed carrega os usuários fake da Fase M | S0-031, S0-032, S0-033, S0-034 | integ | ✅ | S0-031..034 em tests/ (lista escrita a partir da Fase M, lida como `macuxi_app`, junto com dois-tenants) e na suíte do banco-dados (4/4) |
| T-0003 | C3.1 Ativar/desativar módulo de teste reflete no app no próximo sync | S0-040 a S0-051 | unit, integ, sync, e2e, comp | pendente | T-0003 + T-0004 em andamento: não validado nesta rodada |
| T-0003 | C3.2 Rota de módulo inativo → 403 `MODULO_INATIVO` | S0-052, S0-053, S0-054, S0-055, S0-056 | integ | pendente | T-0003 em andamento: não validado nesta rodada |
| T-0003 | C3.3 Promotor não vê nenhuma ação de pedido | S0-060 a S0-066 | unit, comp, integ, sync, e2e | pendente | T-0003 + T-0004 em andamento: não validado nesta rodada; API definitiva na Sprint 4 (R7) |
| T-0003 | (base) Auth, logs sem PII, escopo de carteira | S0-070 a S0-074, S0-110 | integ, carga | pendente | T-0003 em andamento: não validado nesta rodada |
| T-0004 | C4.1 Dois builds Android do mesmo código | S0-080, S0-081 (manual M-02), S0-082 | unit, manual, comp | pendente | T-0004 em andamento: não validado nesta rodada; Android SDK/EAS (R2) |
| T-0004 | C4.2 Extensão de exemplo só com módulo ativo | S0-083 a S0-087 | comp, e2e, integ | pendente | T-0004 em andamento: não validado nesta rodada |
| T-0005 | C5.1 PR fora do dono é sinalizado | S0-090, S0-091, S0-092, S0-093 | integ | pendente | T-0005; modo `--base` do verificar (R4) |
| T-0005 | C5.2 Pipeline verde no branch principal | S0-094, S0-095, S0-096 (manual M-04) | estático, integ, manual | pendente | T-0005; nome do branch (R5) |
| transversal | Offline básico | S0-100 a S0-105 (manual M-03) | comp, sync, manual | pendente | T-0001 Fase A + T-0003 + T-0004 |

## Detalhe por cenário (preencher na execução)

| ID | Arquivo de teste | Resultado | Evidência (saída/print/link) |
|---|---|---|---|
| S0-001 | tests/fundacao/fase-m/referencia.json (gerado por tests/scripts/comparar-testes-fase-m.mjs) | ✅ | Fase M executada numa CÓPIA da árvore de trabalho (pasta temporária, `pnpm install` feito lá): 277 casos em 23 arquivos (domain 92, contracts 6, web 113, mobile 48, mock-api 18). 1ª execução: 276/277. O caso do mock-api "edita pedido aguardando aprovação…" estourou o timeout padrão de 5 s (5,2 s; já é lento na origem). Com `--testTimeout=20000`: 277/277 (5,3 s). Contagem estática `node scripts/contar-testes.mjs <FaseM>/apps <FaseM>/packages` = 277. |
| S0-002 | tests/scripts/comparar-testes-fase-m.mjs (execução, por nome) + tests/fundacao/fase-m-contagem.test.ts (estático) | ✅ | `vitest run --reporter=json` em comum, ui, platform-sdk, core, vendedor, mobile, mock-api e web: 409 casos, 0 falha. Comparação: **275 exatos (describe + título) + 2 casados por título = 277; 0 faltantes; 0 não passaram**. Renomeados: `outbox › junta fila e servidor…` e `outbox › upsertOrder…` → `outbox (pedidos) › …` em modules/vendedor/app/lib/pedidos.test.ts. O teste traz o mapa origem→destino (28 destinos) em forma executável. |
| S0-003 | tests/fundacao/fase-m-contagem.test.ts | ✅ | Sem `.skip/.only/.todo/xit` nos 28 destinos. Diff do corpo (ignorando imports) nos 19 arquivos copiados inteiros = 0 linhas. Partidos (helpers 2+5+6, rules 11+8, contracts 1+5): títulos e describes conferidos. outbox: os 2 de pedidos.test.ts têm as MESMAS asserções (só o preparo da fila mudou para o motor genérico); os 4 de packages/platform-sdk/src/motor-sync.fase-m.test.ts foram **reescritos** com o mesmo título e o mesmo comportamento sobre a API nova (exceção registrada no desenho, §8/A3). O `--passWithNoTests` de vendedor/mobile/web não mascara nada: os três executaram casos (75/2/7). |
| S0-004 | `pnpm lint`, `pnpm typecheck` | ✅ | lint: 16/16 tarefas + `pnpm fronteiras` com 0 violações; typecheck: 16/16. |
| S0-005 | tests/fundacao/fase-m-contagem.test.ts | ✅ | core 175 (Fase M: domain 44, contracts 1, web 59, app 18) e vendedor 75 (Fase M: domain 32, contracts 5, web 11, app 18 + 2 da outbox) rodam isolados (`vitest run` no pacote). |
| S0-006 | tests/fundacao/fase-m-intacta.test.ts | ✅ | 226 arquivos, mesma lista e mesmos sha256 da linha de base de 2026-10-30 (conferido também com `sha256sum -c`: exit 0). Conferido no início e no fim da rodada (depois da cópia e da demo). |
| S0-007 | tests/fundacao/fase-m-intacta.test.ts | ✅ | HEAD 41283b77e3fc…; `git --no-optional-locks status --porcelain --untracked-files=all` = 75 linhas, idêntico a fase-m-git-status.txt. |
| S0-008 | (manual nesta rodada; Playwright fica para quando houver playwright.config) | parcial | Na cópia: `pnpm seed` ok. mock-api em :18000 → `/health` `{ok:true}`, login de gerente, `/v1/orders` 178 itens, `/v1/customers` 1040 itens. O `next dev` da cópia parou numa mensagem de recomendação de atualização de segurança do Next.js e não abriu a porta. Não executei a atualização: fora do escopo, e a cópia é descartável. Para provar a web da demo: roteiro manual M-01 ou nova tentativa com `next build && next start` na cópia. |
| S0-009 | tests/fundacao/fase-m-intacta.test.ts | ✅ | `git grep forca-vendas` fora de docs/, tests/, .coord/ e *.md acha só 4 arquivos, todos revisados e listados no teste: contar-testes (só lê), comentário do seed, `additionalDirectories` em .claude/settings.json e em _instalar/. Qualquer referência nova faz o teste falhar. |
| S0-010 | tests/fundacao/fronteiras.test.ts | ✅ | `pnpm fronteiras`: "no dependency violations found (331 modules, 759 dependencies cruised)", exit 0. |
| S0-011 | tests/fundacao/fronteiras.test.ts + tests/fixtures/fronteira/violacao | ✅ | exit 18 = 18 violações, uma por arquivo: caminho relativo para domain, api, app, web, db, manifest.ts, `import()`, `require`, `export *`, `import type`, alias exportado `@macuxi/b/web`, alias da raiz `@macuxi/b` (manifest), alias fora do exports `@macuxi/b/domain` (regra modulo-importa-caminho-nao-exportado), contracts→domain de outro módulo. O alias é resolvido por junção node_modules/@macuxi/b → modules/b, como o pnpm faz no repo. A fixture do engenheiro (packages/config/__fixtures__/violacao) dá exit 8. |
| S0-012 | tests/fixtures/fronteira/ok | ✅ | packages/*, core/contracts, contracts de outro módulo (relativo e alias), interno do próprio módulo, contracts→domain próprio, shell→web/manifest, mock-api legado→domain: 0 violações, exit 0. |
| S0-013 | tests/fundacao/fronteiras.test.ts | ✅ | contracts→própria api, packages→modules, shell→db de módulo e módulo→shell: todos bloqueados. |
| S0-014 | tests/fundacao/fronteiras-schema.test.ts | ✅ | Varre modules/<m>/{db,api,domain,app,web} (.ts/.tsx/.js/.mjs/.sql) atrás de SQL com `from/join/into/update/table/references/truncate <schema>.<tabela>` e de `pgSchema('<schema>')`, com os schemas do doc 04 + os `create schema` das migrações. Permitido: o próprio schema; `plataforma` só para o core (premissa: o Core administra tenant/licenças/parâmetros/auditoria, RF-CORE-03). 0 violações hoje; `modules/core/db/nuvem.ts` declara só `pgSchema('core')`. O detector tem 16 casos sintéticos (10 que devem ser pegos e 6 que não: nome de evento, ação, extensão, import, tabela sem schema). |
| S0-020 | db/testes/migracoes.test.ts (banco-dados) + CLI | ✅ | Suíte: vazio → up → down volta ao catálogo inicial. CLI num banco efêmero com a fixture: `migrar down --tudo` (0002_core, 0001_plataforma) → `migrar up` → `down --tudo` → `up`, sem erro; banco apagado no fim. |
| S0-021 | db/testes/migracoes.test.ts | ✅ | up → down → up gera o mesmo catálogo. |
| S0-022 | db/testes/migracoes.test.ts | ✅ | down com o seed da Fase M carregado não falha (apaga os dados; documentado em docs/banco/README.md). |
| S0-023 | tests/integracao/banco/conformidade.test.ts + db/testes/conformidade.test.ts | ✅ | Independente (pg_catalog): tabela sem tenant_id só se declarada em `TABELAS_SEM_TENANT_ID` (plataforma.tenant); campos comuns com o tipo certo (id e tenant_id uuid NOT NULL, timestamptz, external_id text); RLS ligado E forçado em todas; política para `macuxi_app` com `tenant_id` (ou `id`, no tenant) = `tenant_atual()` no USING e no WITH CHECK, sem `true`/`or`; todo índice único de tabela de tenant inclui tenant_id (exceto a PK id). |
| S0-024 | tests/integracao/multitenant/vazamento-leitura.test.ts | ✅ | Como `macuxi_app`, nos contextos A e B: em cada tabela com tenant_id (descoberta pelo pg_catalog; fixture com linha de A e de B em todas) o conjunto de ids visível é IGUAL ao que o admin vê com `tenant_id = X` (nem esconde linha própria nem mostra alheia). Nenhuma linha do outro tenant por id, por tenant_id, por join com lista de ids ou por subconsulta. plataforma.tenant: só o próprio. `tenant_por_codigo` (login sem contexto) não lista tenants com `%`, `_%`, vazio, espaço ou injeção. `pg_stats` depois de ANALYZE não expõe valores das tabelas com RLS. |
| S0-025 | tests/integracao/multitenant/vazamento-escrita.test.ts | ✅ | No contexto de A: upsert `on conflict (id) do update` com id de linha de B → 42501 em toda tabela (caminho da escrita idempotente do sync); UPDATE/DELETE por id de B → 0 linhas (ou 42501 na auditoria); INSERT com tenant_id de B → 42501 (controle positivo no próprio tenant passa). Toda FK entre tabelas de tenant é composta com tenant_id e, em cada uma, apontar linha de A para a linha-mãe de B → 23503. Retrato jsonb de todas as linhas de B idêntico antes e depois. |
| S0-026 | tests/integracao/multitenant/vazamento-leitura.test.ts | ✅ | Sem set_config, contexto vazio ou UUID que não é tenant → 0 linhas em toda tabela (inclusive plataforma.tenant). Contexto inválido (texto, espaço, dois UUIDs, injeção) → erro, nunca linhas. Contexto de transação desfeita não vale na seguinte. |
| S0-027 | tests/integracao/multitenant/pool.test.ts | ✅ | `comTenant` (caminho da API): pool de 1 conexão A → B → A → solta (solta vê 0 e contexto nulo); depois de exceção do código (escrita desfeita) e de erro SQL (22012) a conexão volta limpa; tenant inválido recusado antes de ir ao banco. Concorrência: 60 requisições A/B em 4 conexões com pausas aleatórias, cada uma vê só o próprio tenant antes e depois da pausa (parte de banco do S0-111). |
| S0-028 | tests/integracao/banco/conformidade.test.ts + db/testes/conformidade.test.ts | ✅ | `macuxi_app`: sem SUPERUSER/BYPASSRLS/CREATEROLE/CREATEDB/REPLICATION; não herda papel privilegiado (pertença recursiva); não é dono de schema, tabela ou função; sem TRUNCATE (que ignora RLS), REFERENCES ou TRIGGER; sem CREATE em nenhum schema (nem public). Atalhos negados com 42501: SET ROLE, SET SESSION AUTHORIZATION, DISABLE/NO FORCE RLS, ALTER/CREATE POLICY, redefinir `tenant_atual()`, criar view; `row_security = off` dá erro em vez de devolver tudo. SECURITY DEFINER executável: só `plataforma.tenant_por_codigo(p_codigo text)`, com search_path fixo e sem EXECUTE para PUBLIC. Nenhuma view sem `security_invoker` nem matview legível (hoje não há views; o teste já cobre as do Conector quando vierem). |
| S0-029, S0-030 | — | pendente | API da T-0003 (em andamento). |
| S0-031 | tests/integracao/banco/seed-fase-m.test.ts + db/testes/seed-fase-m.test.ts | ✅ | Banco efêmero próprio com dois-tenants + Fase M (3 tenants), lido como `macuxi_app`: os 12 usuários com nome, e-mail e perfil esperados (lista escrita a partir do generate.ts da Fase M, lido só para consulta): 8 vendedor, Fernando Lima = **gerente** (manager → gerente; R-20261031-093112), Juliana = analista, Ana = assistente, Patrícia = admin; todos os perfis ∈ `PERFIS` do platform-sdk; nenhum supervisor ou promotor. |
| S0-032 | idem | ✅ | As 6 equipes da Fase M; cada vendedor na equipe da Fase M (Bruna Zona Sul, Rafael e Paula Zona Norte, Diego Centro, Carla e Thiago Interior, Marcos Zona Leste, Lívia Zona Oeste); as 6 sob um só nó cujo responsável é Fernando Lima. |
| S0-033 | idem | ✅ | Seed rodado mais 2 vezes: contagens de usuario, equipe, cliente, carteira, produto, tenant_modulo, perfil_modulo e parametro iguais; hashes de senha preservados; 12 usuários. |
| S0-034 | idem | ✅ | Senhas em argon2id (`$argon2id$v=19$m=…,t=…,p=…$`), nenhuma em texto; todos os e-mails em `@exemplo.com.br`. Os três tenants veem só os próprios usuários. |


## T-0001 — evidências da Fase D (2026-10-31)

Pedidos do Alexandre:

| Verificação | Comando | Resultado |
|---|---|---|
| Lint da raiz | `pnpm lint` | ✅ 16/16 tarefas + fronteiras com 0 violações |
| Typecheck da raiz | `pnpm typecheck` | ✅ 16/16 |
| Testes da raiz | `pnpm exec turbo run test --force` (sem cache) | ✅ 16/16 tarefas, 0 em cache, **641 casos verdes** (core 175, promotor 143, platform-sdk 78, vendedor 75, db 74, ui 38, mock-api 18, comum 16, config 8, web 7, mobile 2, catalogo 2, pesquisa 2, gestor 1, integracao 1, treinamento 1) |
| Build do web | `pnpm --filter web build` | ✅ next build 16.4.3: compilou, TypeScript ok, 5 rotas (/, /_not-found, /[...caminho], /auditoria, /login) |
| Testes do agente testes | `pnpm test:tests` (também dentro do `pnpm test` da raiz, tarefa `//#test:tests` do turbo, e no CI) | ✅ 3 arquivos, 85 casos (fronteiras 21, fase-m-contagem 61, fase-m-intacta 3); `pnpm typecheck:tests` ok. Na Fase D rodou pelo comando direto; desde 2026-10-31 (R-20261031-100929) roda no `pnpm test` da raiz e no CI: 85/85 |
| Donos (árvore de trabalho) | `node scripts/coord.mjs verificar <agente>` para engenheiro-software, modulo-core, modulo-vendedor, modulo-catalogo, modulo-promotor, modulo-gestor, modulo-pesquisa, modulo-treinamento, modulo-integracao e testes | ✅ exit 0 nos 10, sem violação nem falso positivo (arquivos de outros agentes aparecem só em "Outros donos", que é informativo) |
| Donos dos commits da T-0001 | `donoDe` (scripts/coord-lib.mjs) sobre os arquivos de 14cccd4 (464) e 0a3d612 (35) | ✅ nenhum arquivo sem dono; todos de agentes da T-0001 ou do gerente (recados/quadro/tarefas) |

Observações (não bloqueiam o aceite):
- **tests/ no `pnpm test` da raiz e no CI** (resolvido): na Fase D os 85 casos só rodavam pelo comando direto. O engenheiro criou as tarefas raiz `lint:tests`, `typecheck:tests` e `test:tests` (turbo `//#test:tests`), chamadas por `pnpm lint`/`typecheck`/`test` e pelo CI (R-20261031-100929); 85/85 verdes em 2026-10-31.
- **Contador estático e `it.each` com template literal**: `scripts/contar-testes.mjs` dá 15 em modules/core/domain/matriz.test.ts, e o Vitest executa 20 (o script avisa). Não afeta os 277, porque nenhum arquivo da Fase M usa tabela em template; nos outros 47 arquivos dos 8 pacotes, contagem estática = execução.
- **mock-api lento**: "edita pedido aguardando aprovação…" leva 4,6–5,3 s, com timeout padrão de 5 s (instável sob carga, igual na origem). A árvore de trabalho já tem `vitest run --testTimeout=30000` em apps/mock-api/package.json (engenheiro; ainda não commitado no momento desta leitura).

## T-0002 — evidências (rodada 2, 2026-10-31)

| Verificação | Comando | Resultado |
|---|---|---|
| Testes do agente testes com banco obrigatório | `MACUXI_PG_EXIGIR=1 pnpm test:tests` | ✅ 9 arquivos, **164 casos, 0 pulados**: fronteiras 21, fronteiras-schema 20, fase-m-contagem 62, fase-m-intacta 3, vazamento-leitura 17, vazamento-escrita 7, pool 5, conformidade 24, seed-fase-m 5 (58 de banco) |
| Sem banco (simulado: porta 5499, `MACUXI_PG_AUTO_SUBIR=0`) | `vitest run --config tests/vitest.config.ts integracao` | ✅ 58 pulados com o aviso `[db] Postgres indisponível ...: 58 testes de banco pulados.`; com `MACUXI_PG_EXIGIR=1` o globalSetup FALHA ("testes de banco não podem pular") |
| Suíte do banco-dados | `MACUXI_PG_EXIGIR=1 pnpm --filter @macuxi/db test` | ✅ 8 arquivos, 94 casos (migrações 6, seed 4, conformidade 4, vazamento, estático 41, ambiente-local 17, drizzle 2, aviso 2) |
| Migrações pela CLI | `banco criar-teste --fixture dois-tenants` → `migrar down --tudo` → `migrar up` → `down --tudo` → `up` → `apagar-teste` | ✅ sem erro |
| Typecheck e lint de tests/ | `pnpm typecheck:tests`, `pnpm lint:tests` | ✅ |

Configuração: `tests/vitest.config.ts` usa o globalSetup do `@macuxi/db` (`../db/testes/global-setup.ts`: banco efêmero `macuxi_teste_*` migrado com a fixture dois-tenants, apagado no fim) e o relator `AvisoPulos`. Conexão de prova = `banco().urlApp` (`macuxi_app`); o admin só prepara dados e lê o catálogo (docs/banco/README.md, "Para o agente testes"; R-20261031-093058).

Observações da rodada 2 (não reprovam critério):
- **Caso da Fase M substituído por decisão**: em `modules/vendedor/domain/order.test.ts` (trabalho do vendedor ainda não commitado), "integrado explica que é preciso duplicar" virou "RN-VEN-31 / matriz §2: integrado mostra a mensagem de cancelar no ERP e continua duplicável", pela decisão do Alexandre (doc 03 §4, R-20261031-102322: depois do envio ao ERP, "Pedido já enviado ao ERP — cancele no ERP"). O teste novo continua provando que o integrado é duplicável. Registrado em `SUBSTITUIDOS_POR_DECISAO` (tests/fundacao/fase-m-contagem.test.ts), que exige a decisão e o título do teste substituto. A contagem por destino passou de "= n" para ">= n" porque, depois do aceite da T-0001, os arquivos podem ganhar casos (order.test.ts: 32 → 44). C1.1 fica: 276 casos da Fase M idênticos + 1 substituído por decisão registrada.
- **Bancos de teste esquecidos** no container: `banco status` mostra `macuxi_teste_mvwfojxp_*`, `mvwforit_*` e `mvwfoyvk_*`, de execuções interrompidas mais cedo. Não apaguei, porque `apagar-teste --todos` derrubaria execuções de outros agentes em andamento. Sugestão ao banco-dados: limpeza por idade.
- **comTenant** (db/src/contexto.ts): se o ROLLBACK falhar (conexão quebrada), a conexão volta ao pool com `release()` em vez de `release(erro)`. Não vaza contexto (o servidor descarta a transação), mas pode devolver ao pool uma conexão morta. Melhoria 🟢 para o banco-dados; não é defeito de isolamento.

## Defeitos

| # | Cenário | Passos para reproduzir | Esperado × obtido | Arquivo provável | Dono | Recado |
|---|---|---|---|---|---|---|
| — | T-0001 | Nenhum defeito que reprove critério da T-0001 nesta rodada | — | — | — | — |
| — | T-0002 | Nenhum defeito que reprove critério da T-0002 na rodada 2 (as melhorias 🟢 estão nas Observações da rodada 2) | — | — | — | — |

## Testes manuais

Roteiro **M-01** para o Alexandre confirmar a demo web da Fase M (premissa do gerente: pasta inalterada ⇒ demo inalterada; S0-006 e S0-007 continuam ✅):
1. Na pasta original `C:\Users\domon\dev\forca-vendas`, rodar `iniciar-demo.cmd` (ou `pnpm demo`). **Atenção: isso escreve na pasta** (`node_modules`, `.next`, `mock-data/saida`).
2. Abrir http://localhost:3000, entrar como gerente (fernando@exemplo.com.br), abrir a lista de pedidos e um pedido; abrir um cliente.
3. Conferir que a API responde em http://localhost:8000/health.
4. Se o Next pedir atualização de segurança (foi o que travou o `next dev` na cópia), anotar a mensagem e não atualizar.
5. Mandar os prints ao agente testes e pedir que ele regere `tests/plano/fase-m-baseline.sha256` e `fase-m-git-status.txt` (senão S0-006 e S0-007 acusam a escrita da demo).

| Roteiro | Executado por | Data | Resultado | Evidência |
|---|---|---|---|---|
| M-01 (S0-008: web da demo da Fase M) | Alexandre | | pendente | prints |
| M-02 | | | pendente | |
| M-03 | | | pendente | |
| M-04 | | | pendente | |
