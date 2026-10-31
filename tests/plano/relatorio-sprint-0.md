# Relatório de testes — Sprint 0 · critério → teste → resultado

> Dono: agente `testes` (T-0006). Plano e detalhes de cada cenário: `tests/plano/sprint-0.md`.
> Legenda do resultado: `pendente` (ainda não rodou) · `✅` passou · `❌` falhou (ver Defeitos) · `bloqueado` (dependência; ver coluna) · `parcial` (provado só em parte; ver nota).
> Atualizar a cada rodada: data, commit, comando e saída resumida.

## Resumo (rodada 3, 2026-10-31) — Sprint 0: pronta para fechar?

**Quase: SIM para T-0001, T-0002, T-0003, T-0005 e T-0006; a T-0004 fecha quando o Alexandre gerar os 2 APKs no EAS (critério 1, roteiro M-02).** Nenhum defeito reprova critério.

| Tarefa | Veredito | O que falta |
|---|---|---|
| T-0001 Monorepo + platform-sdk | ✅ concluída (rodada 1) | — |
| T-0002 Banco, RLS, migrações | ✅ (rodada 2) + S0-029/030/111 pela API ✅ nesta rodada | — |
| T-0003 Auth, perfis e licenças | ✅ C3.1, C3.2, C3.3 com banco real (login, bloqueio, refresh, logs sem PII também) | 2 defeitos 🟡 (D-1, D-2) e 1 conflito de desenho (O-3) por recado; roteiros manuais M-03 e M-05 no aparelho |
| T-0004 Shells e createApp | C4.2 ✅ · C4.3 ✅ · C4.1 **configuração ✅, build pendente Alexandre** | login na Expo e `eas build --profile campo|gestao` (M-02); ícone da Gestão |
| T-0005 CI e donos | ✅ (verificar 48/49 + 1 pulado; CI do main verde) | — |
| T-0006 Plano e relatório | ✅ este relatório (T-0001..T-0005) | — |

Comandos da rodada 3 (árvore de trabalho sobre 44e82c9, depois da entrega do core R-20261031-141737): `pnpm lint` ✅ (18/18 + fronteiras 0 violações) · `pnpm typecheck` ✅ (18/18) · `pnpm test` ✅ (18/18 tarefas, 1.689 casos) · `MACUXI_PG_EXIGIR=1 pnpm test:tests` ✅ **18 arquivos, 230 casos, 0 pulados** · `node --test scripts/coord-verificar.test.mjs` ✅ 48 + 1 pulado.

| Rodada | Data | Commit | Ambiente | Comando |
|---|---|---|---|---|
| 0 | 2026-10-30 | — | plano (sem código) | — |
| 1 (T-0001 Fase D) | 2026-10-31 | 87460de + árvore de trabalho (engenheiro e banco-dados alterando em paralelo) | Windows 11, Node 24.21, pnpm 12.11.2, Docker de pé | ver "T-0001 — evidências da Fase D" abaixo |
| 2 (T-0002 + S0-014) | 2026-10-31 | 303b739 + árvore de trabalho (engenheiro em packages/platform-sdk e apps/ pela T-0004; vendedor em modules/vendedor) | Windows 11, Node 24.21, pnpm 12.11.2, container `macuxi-postgres` (Postgres 16.15 + pgvector) | `MACUXI_PG_EXIGIR=1 pnpm test:tests` e `MACUXI_PG_EXIGIR=1 pnpm --filter @macuxi/db test` — ver "T-0002 — evidências" abaixo |
| 3 (validação final T-0003/T-0004 + S0-029/030/111) | 2026-10-31 | 44e82c9 + árvore de trabalho (core: ErroHttpModulo e definirCapturaFoto entregues; engenheiro revisando T-0011) | Windows 11, Node 24.21, pnpm 12.11.2, container `macuxi-postgres` (migrações 0001–0004) | `MACUXI_PG_EXIGIR=1 pnpm test:tests` + raiz `pnpm lint`/`typecheck`/`test` — ver "Rodada 3 — evidências" abaixo |

## Critério → teste → resultado

| Tarefa | Critério | Cenários | Tipo | Resultado | Bloqueado por / nota |
|---|---|---|---|---|---|
| T-0001 | C1.1 Os 277 testes da Fase M passam nos novos locais | S0-001, S0-002, S0-003, S0-004, S0-005 | estático, integ | ✅ | 277/277 por nome (275 idênticos + 2 com describe renomeado), todos verdes; 4 deles reescritos no SDK com o mesmo título. Rodada 2: 1 caso substituído por decisão posterior (ver Observações da rodada 2) |
| T-0001 | C1.2 Fase M não alterada e demo funcionando | S0-006, S0-007, S0-008, S0-009 | estático, e2e | ✅ (S0-008 parcial) | pasta idêntica à linha de base; demo na cópia: API ok, web dev não subiu (ver S0-008) |
| T-0001 | C1.3 dependency-cruiser falha em import interno entre módulos | S0-010, S0-011, S0-012, S0-013, S0-014 | estático | ✅ | 18 variantes de violação falham e os imports permitidos passam; S0-014 (SQL/Drizzle entre schemas) ✅ na rodada 2 |
| T-0002 | C2.1 Migração sobe e desce sem erro | S0-020, S0-021, S0-022, S0-023 | integ | ✅ | S0-020/021/022 pela suíte do banco-dados (6/6) + ciclo up → down --tudo → up → down --tudo → up pela CLI num banco efêmero; S0-023 também em tests/ (independente) |
| T-0002 | C2.2 Tenant A não lê dados do tenant B em nenhuma tabela | S0-024, S0-025, S0-026, S0-027, S0-028, S0-029, S0-030, S0-111 | integ, carga | ✅ | S0-024..028 ✅ em tests/ como `macuxi_app` (rodada 2). Rodada 3: S0-029 e S0-030 ✅ pela API real (tests/integracao/multitenant/api.test.ts); S0-111 ✅ com HTTP real, 50 conexões alternando tokens de A e B, 0 respostas de outro tenant (tests/carga/fundacao.test.ts) |
| T-0002 | C2.3 Seed carrega os usuários fake da Fase M | S0-031, S0-032, S0-033, S0-034 | integ | ✅ | S0-031..034 em tests/ (lista escrita a partir da Fase M, lida como `macuxi_app`, junto com dois-tenants) e na suíte do banco-dados (4/4) |
| T-0003 | C3.1 Ativar/desativar módulo de teste reflete no app no próximo sync | S0-040 a S0-051 | unit, integ, sync, e2e, comp | ✅ | Com módulos reais (o `teste` da fixture não está instalado): tenant (Promotor), perfil e usuário (Vendedor), dependência (Catálogo) → `/v1/me/modulos` muda na requisição seguinte com o MESMO token, `versao_licencas` muda e volta; o motor de sync REAL do SDK, falando com o createApp real, aplica no próximo sync, apaga o armazenamento do módulo, segura a fila até a confirmação (RN-CORE-02) e mantém o estado sem sinal. S0-050 (Playwright no BKO) não rodou: sem Playwright instalado → roteiro M-06. Defeitos 🟡 D-1 e D-2 não reprovam |
| T-0003 | C3.2 Rota de módulo inativo → 403 `MODULO_INATIVO` | S0-052, S0-053, S0-054, S0-055, S0-056 | integ | ✅ | Varredura de TODAS as rotas montadas de módulos não-core e de TODAS as entidades de sync dos manifestos: 403 `MODULO_INATIVO` com `detalhes.modulo`; os dois motivos (tenant e usuário) dão o mesmo código; precedência 401 → 403 MODULO_INATIVO → 403 PERFIL_SEM_ACESSO → 400 → 404; JWT só com sub/tid/perfil/iat/exp. Push de item de módulo inativo: rejeitado, mas com o código errado (D-1) |
| T-0003 | C3.3 Promotor não vê nenhuma ação de pedido | S0-060 a S0-066 | unit, comp, integ, sync, e2e | ✅ | API: varredura de toda rota de pedido montada → 403, inclusive com Vendedor e Catálogo no PERFIL do promotor (PERFIL_SEM_ACESSO); push de pedido/pedido_item/pedido_evento rejeitado. UI: shell web real (nenhuma ação `pedido.*`; promotor fora do BKO) e shell do app Campo com o que o Vendedor declara no fonte (sem "Novo pedido", sem abas/ações na ficha; botões das telas atrás de `usePode`). Conflito de desenho O-3 (API veta até a LEITURA que a matriz permite) por recado. No aparelho: M-05 |
| T-0003 | (base) Auth, logs sem PII, escopo de carteira | S0-070 a S0-074, S0-110 | integ, carga | ✅ (S0-110 medido) | Login com código da empresa; mesma resposta para código/e-mail/senha errados; bloqueio por 5 falhas (423 só com a senha certa) e remoto (derruba acesso e refresh na hora); aparelho bloqueado e de outro tenant; limite 5/5 min por IP + código (429 + Retry-After); refresh rotativo com queda da família no reuso; JWT expirado/none/adulterado/outro segredo → 401; logs em trace sem e-mail, senha, token ou refresh. S0-074 (carteira) pelo pull: vendedor só a própria carteira. S0-110: p95 acima da meta de 300 ms neste ambiente (O-4) |
| T-0004 | C4.1 Dois builds Android do mesmo código | S0-080, S0-081 (manual M-02), S0-082 | unit, manual, comp | parcial — **build pendente Alexandre** | Configuração ✅: `app.config.ts` nas duas variantes (nome, pacote, scheme, variante distintos; mesmo projeto EAS), `expo config` real conferido, `eas.json` com `campo`/`gestao` (dev client, APK, interna) e `*-preview`; `expo-dev-client` no shell. Os 2 APKs dependem do login do Alexandre na Expo (M-02). Ícone da Gestão = do Campo (pendência de arte) |
| T-0004 | C4.2 Extensão de exemplo só com módulo ativo | S0-083 a S0-087 | comp, e2e, integ | ✅ | "Novo pedido" real do Vendedor no slot `cliente.acoes` (lido do fonte) aparece com o Vendedor efetivo e some sem erro com o Vendedor ou o Catálogo inativos; card de exemplo no `inicio.cards` aparece/some nas duas variantes; menu do BKO real só com módulos efetivos. S0-086 (error boundary por extensão) não verificado (desejável) |
| T-0004 | C4.3 Shells com os 8 módulos e createApp montando só os efetivos | S0-087, S0-052 | integ, comp | ✅ | Web (shell real), mobile (`instalados.ts`) e API (`MODULOS_API`, `/v1/saude`) com os mesmos 8; sem Core/banco tudo falha fechado (401); rotas montadas por manifesto e bloqueadas por requisição (varredura S0-052) |
| T-0005 | C5.1 PR fora do dono é sinalizado | S0-090, S0-091, S0-092, S0-093 | integ | ✅ | `node --test scripts/coord-verificar.test.mjs`: 49 casos (A1–A11, B1–B12), 48 ✅ + 1 pulado; passo "verificar donos" com `--base` no PR (ci.yml) |
| T-0005 | C5.2 Pipeline verde no branch principal | S0-094, S0-095, S0-096 (manual M-04) | estático, integ, manual | ✅ | CI do main verde (runs 41208133979, 41209930842, 41210242610, conferidos pelo gerente com gh; T-0005, Histórico); Postgres no CI com `MACUXI_PG_EXIGIR=1` |
| T-0006 | C6.1 Relatório critério → teste → resultado de T-0001 a T-0005 | todos | — | ✅ | Este arquivo (rodadas 1–3) |
| transversal | Offline básico | S0-100 a S0-105 (manual M-03) | comp, sync, manual | parcial | S0-104 (acesso inválido no meio do push, fila preservada, envia depois do refresh) e S0-105 (pull por tenant e carteira) ✅ com o motor real; S0-047 (sem sinal) ✅. S0-101..103 cobertos pelos testes do dono (motor-sync, sync e banco da API), não refeitos aqui; S0-100 no aparelho (M-03) |

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
| S0-029 | tests/integracao/multitenant/api.test.ts | ✅ | Admin de A alterando licença de usuário de B → 404 `USUARIO_NAO_ENCONTRADO` com status e corpo IDÊNTICOS aos de um id inexistente; retrato jsonb de usuario_modulo/tenant_modulo/perfil_modulo de B igual antes e depois. `tenant_id` em cabeçalho (`x-tenant-id`), query ou corpo: ignorado (200 no próprio tenant ou 400), B intacto; `GET /v1/core/licencas` e pull de cliente com cabeçalho/query de B devolvem só A; admin de B não vê nada de A. |
| S0-030 | idem | ✅ | Evento `core.usuario.modulos_alterados@1` e auditoria `licenca.alterar` gerados pela rota em A: visíveis no contexto de A, nenhum id deles no contexto de B (lido como `macuxi_app`). O despacho entre tenants pelo `macuxi_worker` é da suíte do banco-dados (worker.test.ts). |
| S0-031 | tests/integracao/banco/seed-fase-m.test.ts + db/testes/seed-fase-m.test.ts | ✅ | Banco efêmero próprio com dois-tenants + Fase M (3 tenants), lido como `macuxi_app`: os 12 usuários com nome, e-mail e perfil esperados (lista escrita a partir do generate.ts da Fase M, lido só para consulta): 8 vendedor, Fernando Lima = **gerente** (manager → gerente; R-20261031-093112), Juliana = analista, Ana = assistente, Patrícia = admin; todos os perfis ∈ `PERFIS` do platform-sdk; nenhum supervisor ou promotor. |
| S0-032 | idem | ✅ | As 6 equipes da Fase M; cada vendedor na equipe da Fase M (Bruna Zona Sul, Rafael e Paula Zona Norte, Diego Centro, Carla e Thiago Interior, Marcos Zona Leste, Lívia Zona Oeste); as 6 sob um só nó cujo responsável é Fernando Lima. |
| S0-033 | idem | ✅ | Seed rodado mais 2 vezes: contagens de usuario, equipe, cliente, carteira, produto, tenant_modulo, perfil_modulo e parametro iguais; hashes de senha preservados; 12 usuários. |
| S0-034 | idem | ✅ | Senhas em argon2id (`$argon2id$v=19$m=…,t=…,p=…$`), nenhuma em texto; todos os e-mails em `@exemplo.com.br`. Os três tenants veem só os próprios usuários. |
| S0-040, S0-060 | modules/core/domain (modulo-core) e packages/platform-sdk (modulos-efetivos, permissoes) | ✅ | Testes unitários dos donos, verdes no `pnpm test` (core 245, platform-sdk 95). |
| S0-041 | tests/integracao/api/licencas.test.ts | ✅ | Efetivos de partida pela API para 6 perfis de A e o vendedor de B (core sempre; `teste` da fixture, não instalado, ignorado; versões semânticas). Tenant desliga o Promotor → `/v1/me/modulos` do promotor = `[core]`, supervisor perde o Promotor; religa → volta, com o mesmo `versao_licencas` de antes. |
| S0-042, S0-053 | idem | ✅ | Perfil `vendedor` sem o Vendedor: vendedores perdem, supervisor mantém. Exceção do usuário: só o vendedor2 perde. Os dois motivos dão 403 `MODULO_INATIVO` na rota real. |
| S0-043 | idem | ✅ | Desliga + religa + repete: +2 eventos `core.usuario.modulos_alterados@1` (nada mudou na 3ª → sem evento) e +3 auditorias; evento com `modulo=core`, `usuario_id` do admin, `request_id` e payload `{ nivel, modulo }`. |
| S0-044 | idem | ✅ | RN-CORE-03: Catálogo desligado no tenant → o Vendedor sai junto (efetivos `[core]`), rota do Vendedor 403 `MODULO_INATIVO`; religa → os dois voltam. |
| S0-045 | idem | ✅ | Core não desliga em tenant, perfil nem usuário (422 `RN-CORE-01`); analista, assistente, gerente e vendedor: 403 `PERFIL_SEM_ACESSO` para alterar e 403 para ler licenças. Tela do BKO: roteiro M-06. |
| S0-046 | tests/integracao/api/sync-app.test.ts | ✅ | Motor real do SDK × createApp real: vendedor2 sincroniza, grava rascunho do Vendedor; admin desliga; antes do sync o aparelho continua igual; no sync seguinte `modulosAtivos` = `[core, catalogo]` e `mod:vendedor:*` apagado; clientes do Core continuam; religa → volta. Com o registro de sync que o app Campo declara hoje, a lista de módulos é aplicada mesmo com o pull falhando (D-2). |
| S0-047 | idem | ✅ | Sem sinal: `sincronizar()` = false com "Sem sinal…", estado anterior mantido; na reconexão aplica a desativação. |
| S0-048 | idem + licencas.test.ts | ✅ (com D-1) | Item de pedido na fila de módulo desativado: continua visível na fila com código, `limpezaPendente = [vendedor]`, armazenamento do módulo só sai depois de `confirmarLimpeza`. O código devolvido pelo servidor é `ENTIDADE_DESCONHECIDA`, e não `MODULO_INATIVO` (D-1): no app aparece "não enviado — corrija ou descarte" em vez de "módulo desativado". |
| S0-049 | licencas.test.ts | ✅ | Desligar o Vendedor no tenant não altera contagens de cliente/carteira/produto (dados na nuvem ficam). |
| S0-050 | — (Playwright não instalado) | manual | Roteiro M-06 (tela de licenças do BKO). API da tela coberta por S0-041..045. |
| S0-051 | modules/core/app/lib/meus-modulos.test.ts (modulo-core) | ✅ | Teste do dono, verde. No aparelho: M-03. |
| S0-052, S0-087 | licencas.test.ts | ✅ | Varredura de todas as rotas montadas dos 7 módulos não-core (hoje: o cancelar do Vendedor) e de todas as entidades de `sync` dos manifestos no pull, com o admin (só core): 403 `MODULO_INATIVO` + `detalhes.modulo`. Rota inexistente de módulo instalado → 404. |
| S0-054 | idem | ✅ | Sem token e token lixo → 401 `NAO_AUTENTICADO`; módulo inativo → 403 `MODULO_INATIVO`; ação do Core sem perfil → 403 `PERFIL_SEM_ACESSO`; id inválido → 400 `VALIDACAO`; rota inexistente → 404. |
| S0-055 | idem | ✅ | Mesmo token antes/depois da desativação (tenant, perfil e usuário): a chamada seguinte já é 403. Payload do JWT = `exp, iat, perfil, sub, tid`. Troca de perfil no banco vale na hora (auth.test.ts). |
| S0-056 | idem | ✅ (com D-1) | Pull de entidade de módulo inativo → 403 `MODULO_INATIVO` (ativo e sem provedor → 501 `SYNC_NAO_IMPLEMENTADO`). Push → rejeitado por item, código errado (D-1). |
| S0-061, S0-062 | tests/modulos/promotor-sem-pedido.test.ts | ✅ | Páginas e extensões do Vendedor lidas do fonte (`modules/vendedor/app/index.ts`) e montadas no `criarShell('campo')` com os manifestos reais: promotor COM o Vendedor licenciado → `pagina('novo-pedido')` nula (deep link bloqueado), `cliente.acoes` e `cliente.abas` vazios, `pode('pedido.*')` falso; toda ação de pedido declarada no app exige `pedido.*` sem `promotor`; botões de editar/cancelar/criar atrás de `usePode`/`SePode`. Controle positivo com o vendedor. |
| S0-063 | tests/integracao/api/promotor-pedido.test.ts | ✅ | Toda rota montada com caminho ou ação de pedido → 403 para o promotor (fixture: `MODULO_INATIVO`). |
| S0-064 | idem | ✅ | Admin põe Vendedor e Catálogo no perfil promotor (`/me/modulos` passa a ter o Vendedor) → toda rota de pedido continua 403 `PERFIL_SEM_ACESSO`; contraprova: o vendedor passa da checagem de perfil. |
| S0-065 | idem | ✅ | Push de `pedido`, `pedido_item`, `pedido_evento` pelo promotor: os 3 rejeitados, nenhum evento `vendedor.pedido.*` gravado (código `ENTIDADE_DESCONHECIDA` por falta de provedor; RN-PRO-01 no push está nos testes do dono, apps/api/test/sync.test.ts). |
| S0-066 | tests/modulos/promotor-sem-pedido.test.ts | ✅ | Shell web REAL com os 8 módulos ativos para o promotor: nenhuma ação `pedido.*`, nenhum item de menu com ação de pedido; o login do BKO recusa promotor e vendedor (`mensagemPerfilForaDoApp` + logout da sessão recém-criada). |
| S0-070 | tests/integracao/api/auth.test.ts | ✅ | Login `alfa` + e-mail + senha → `expires_in` 900 (exp − iat = 900), refresh `<tenant>.<segredo>`, usuário e tenant (nome/fuso). Código errado, e-mail inexistente, senha errada e e-mail de outro tenant: status e corpo idênticos (401 `CREDENCIAIS_INVALIDAS`), sem nome nem fuso do tenant. |
| S0-071 | idem | ✅ | Refresh devolve par novo; reuso do antigo → 401 `SESSAO_INVALIDA` e o refresh NOVO também cai (família); refresh lixo, de A com prefixo de B, e após logout → 401; logout responde igual sempre. Bloqueio: 5 falhas → 423 só com a senha certa; bloqueio remoto derruba acesso (401) e refresh na hora; aparelho bloqueado 423; aparelho de outro tenant 403 `DISPOSITIVO_INVALIDO` (entrega do core desta rodada); 6ª tentativa no mesmo IP + código → 429 com `Retry-After`. JWT expirado, `alg: none`, outro segredo, perfil adulterado, `tid` de outro tenant → 401. |
| S0-072 | idem | ✅ | `vendedor@exemplo.com.br` existe em A e B: o código da empresa decide (ids de usuário e tenant certos); o pull de cada token só traz o próprio tenant. |
| S0-073 | idem | ✅ | Logger em `trace` capturado, com os serializadores do servidor.ts e com os padrão do Fastify: login ok/errado, login em B, `/me/modulos`, pull, rota com e-mail no corpo, refresh e reuso → nenhum e-mail, senha, access, refresh ou segredo do refresh no log; nada de `authorization`/`bearer`. |
| S0-074 | tests/integracao/api/sync-app.test.ts (S0-105) | ✅ (parte da Sprint 0) | Pull de cliente: vendedor1 = c1 e c3; vendedor2 = c2; vendedor de B = só o cliente de B. Supervisor/gerente pela equipe: testes do core (carteira). Observação O-5 na carteira. |
| S0-080 | tests/modulos/shells.test.ts + `npx expo config` | ✅ | `app.config.ts` avaliado com APP_VARIANT campo/gestao: Macuxi Campo/br.com.macuxi.campo/macuxicampo × Macuxi Gestão/br.com.macuxi.gestao/macuxigestao, mesmo slug e projectId; variante inválida lança erro. `APP_VARIANT=… npx expo config --type public` confirma os mesmos valores e os plugins (router, splash, location, image-picker, secure-store). `eas.json`: `campo`/`gestao` com `developmentClient`, `distribution: internal`, `buildType: apk`, `APP_VARIANT` certo; `*-preview` idem sem dev client. |
| S0-081 | — | **pendente Alexandre** | Roteiro M-02 (login na Expo com acesso à organização `macuxifdv` ou `eas init`; `eas build --profile campo|gestao --platform android`). |
| S0-082 | shells.test.ts | ✅ | Campo nunca monta Gestor nem Integração; Gestão nunca monta Vendedor nem Integração. |
| S0-083, S0-085 | shells.test.ts | ✅ | "Novo pedido" (Vendedor, `cliente.acoes`, lido do fonte) aparece com o Vendedor efetivo e some sem erro com Vendedor ou Catálogo inativos; card do Treinamento em `inicio.cards` aparece/some no Campo e na Gestão. |
| S0-084 | shells.test.ts | ✅ (shell) | Menu do BKO real: Vendedor some quando sai dos efetivos e `pagina('pedidos')` fica nula. Clique no BKO: M-06. |
| S0-090..S0-093 | scripts/coord-verificar.test.mjs (alexandre/engenheiro) | ✅ | `node --test`: 49 casos, 48 ✅, 1 pulado. |
| S0-094..S0-096 | .github/workflows/ci.yml | ✅ | Passos: lint, typecheck, testes com Postgres (`MACUXI_PG_EXIGIR=1`), testes do coord, verificar `--base` no PR, next build. Runs verdes no main (T-0005, Histórico). |
| S0-104 | sync-app.test.ts | ✅ | Acesso inválido durante o push: o item fica `pendente` com 1 tentativa (401 não rejeita a fila); com o acesso novo do `/v1/auth/refresh` o servidor responde por item. |
| S0-105 | sync-app.test.ts | ✅ | Ver S0-074. |
| S0-110 | tests/carga/fundacao.test.ts | medido (meta não atingida aqui, O-4) | HTTP real, 50 conexões × 5 s, sozinho: `/v1/me/modulos` p50 664 / p95 1.065 ms; pull de cliente p50 1.742 / p95 1.960 ms; `/v1/core/licencas` p95 1.397 ms; 45 req/s; 0 erros. Com a suíte inteira em paralelo: p95 até 4,7 s. Em série: `/v1/saude` 6 ms, `/v1/me/modulos` 45 ms, pull 74 ms; `select 1` no Postgres do Docker = 3,3 ms por ida e volta. Login (argon2id) em série: p50 135–189 ms, máx. 234 ms. O teste reprova só acima de 8 s (teto anti-patologia). |
| S0-111 | idem | ✅ | Mesma carga alternando 4 tokens (vendedor e admin de A e de B) com `x-tenant-id` do OUTRO tenant em toda requisição: 0 respostas com dado do outro tenant, 0 não-200. |


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

## Rodada 3 — evidências (2026-10-31, validação final de T-0003/T-0004)

| Verificação | Comando | Resultado |
|---|---|---|
| Testes do agente testes com banco obrigatório | `MACUXI_PG_EXIGIR=1 pnpm test:tests` | ✅ **18 arquivos, 230 casos, 0 pulados** (164 da rodada 2 + 6 do produto-dono da T-0007 + 60 novos) |
| Lint / typecheck da raiz | `pnpm lint`, `pnpm typecheck` | ✅ 18/18 cada; fronteiras: 0 violações (508 módulos, 1.276 dependências) |
| Testes da raiz | `pnpm test` | ✅ 18/18 tarefas: core 245, api 51, db 150, platform-sdk 95, vendedor 104, promotor 155, pesquisa 215, treinamento 230, integracao 104, ui 38, comum 16, config 8, web 11, mobile 13, mock-api 18, catalogo 5, gestor 1, tests 230 |
| Verificar de donos | `node --test scripts/coord-verificar.test.mjs` | ✅ 48 + 1 pulado |
| Config do Expo real | `APP_VARIANT=campo|gestao npx expo config --type public --json` (em apps/mobile) | ✅ nomes, pacotes, scheme, variante, owner `macuxifdv` e projectId iguais ao esperado |

Arquivos novos (todos do agente testes):

| Arquivo | Casos | Cobre |
|---|---|---|
| tests/integracao/apoio/api.ts | — | sobe o createApp REAL (8 módulos, Core com JWT, `macuxi_app`) num banco efêmero próprio com dois-tenants; login com IP único por chamada |
| tests/integracao/api/licencas.test.ts | 12 (1 `it.fails` = D-1) | C3.1/C3.2: S0-041..045, S0-049, S0-052..056 |
| tests/integracao/api/sync-app.test.ts | 7 (1 `it.fails` = D-2) | C3.1 no motor real: S0-046..048, S0-104, S0-105 |
| tests/integracao/api/promotor-pedido.test.ts | 4 | C3.3 API: S0-063..065 |
| tests/integracao/api/auth.test.ts | 14 | S0-070..073 + bloqueios, limite, aparelho, JWT |
| tests/integracao/multitenant/api.test.ts | 4 | S0-029, S0-030 |
| tests/carga/fundacao.test.ts | 2 | S0-110 (medido), S0-111 |
| tests/modulos/promotor-sem-pedido.test.ts | 8 | C3.3 UI: S0-061, S0-062, S0-066, O-3 |
| tests/modulos/shells.test.ts | 9 | T-0004: S0-080, S0-082..085, S0-087 |

Também: `tests/tsconfig.json` ganhou `jsx: react-jsx` e as libs `DOM` (o shell web real é importado nos testes).

`it.fails` = teste do comportamento CERTO que hoje falha por defeito conhecido: a suíte fica verde e, quando o dono corrigir, o teste fica vermelho de propósito (trocar por `it`).

Observações da rodada 3 (não reprovam critério):
- **O-4 (desempenho, linha de base da Sprint 9)**: cada requisição autenticada abre várias transações (autenticar, licenças, carteira, horizonte, pull), cerca de 14–22 idas e voltas ao banco; com o Postgres do Docker no Windows (3,3 ms por ida e volta) o p95 sob 50 conexões fica entre 1 e 2 s (meta do plano: 300 ms). Em nuvem com o banco na mesma rede deve cair muito; mesmo assim, uma transação por requisição é a melhoria natural (engenheiro-software, Sprint 9).
- **O-5 (carteira no pull)**: o vendedor recebe TODOS os vínculos de carteira dos clientes dele, inclusive o do promotor que atende o mesmo cliente (só o UUID do usuário, sem dado pessoal). Coerente com "quem mais atende meu cliente"; registrar se for intencional (modulo-core).
- **O-6**: o cancelar do Vendedor com id válido ainda dá 500 no banco real (falta a tabela `vendedor.pedido`, R-20261031-110346 ao banco-dados) e `PEDIDO_NAO_ENCONTRADO` sai 422 (R-20261031-132736 ao vendedor). Os testes evitam esse caminho (id inválido → 400).
- **O-7 (já conhecido do engenheiro)**: sem `trustProxy`, atrás de um balanceador o limite de 5 logins/5 min por IP + código da empresa passa a valer para a EMPRESA inteira (todos com o IP do proxy). Resolver antes de publicar a API.
- **Guardião de Bash, falso positivo**: no meu `npx expo config` (14:16) ele acusou `.coord/diario/engenheiro-software.md`, `.coord/lidos/engenheiro-software.txt` e dois recados novos do engenheiro, que estava gravando em paralelo. Não desfiz nada (aviso R-20261031-131537 do gerente).

## Defeitos

| # | Cenário | Passos para reproduzir | Esperado × obtido | Arquivo provável | Dono | Recado |
|---|---|---|---|---|---|---|
| — | T-0001 | Nenhum defeito que reprove critério da T-0001 nesta rodada | — | — | — | — |
| — | T-0002 | Nenhum defeito que reprove critério da T-0002 na rodada 2 (as melhorias 🟢 estão nas Observações da rodada 2) | — | — | — | — |
| D-1 🟡 | S0-048, S0-056, S0-065 | Admin desliga o Promotor no tenant; com o token do promotor, `POST /v1/sync/push` com item `checklist_loja` | Esperado `rejeitado/MODULO_INATIVO` (desenho T-0004 §5); obtido `rejeitado/ENTIDADE_DESCONHECIDA`. No app o item vira "falhou" e não volta sozinho quando o módulo é religado. Teste: licencas.test.ts "DEFEITO D-1" (`it.fails`) | apps/api/src/sync.ts (`registrarSync`), packages/platform-sdk/src/sync.ts (`rejeitarItensInvalidos`) | engenheiro-software | R-20261031-144832-testes |
| D-2 🟡 | S0-046 | Motor real com o registro que o app Campo declara (`visita` do core, `pedido` do vendedor) contra a API real | Esperado: sync termina; obtido: pull de `pedido`/`visita` → 501 `SYNC_NAO_IMPLEMENTADO` e o motor para no primeiro erro (todo "Sincronizar" mostra erro). A lista de módulos é aplicada antes, então C3.1 vale. Teste: sync-app.test.ts "DEFEITO D-2" (`it.fails`) | packages/platform-sdk/src/motor-sync.ts e/ou apps/api/src/sync.ts; provedores: modulo-core/modulo-vendedor (Sprint 1) | engenheiro-software | R-20261031-144846-testes |
| O-3 🟡 (desenho) | S0-063, S0-064 | Admin licencia o Vendedor para o perfil promotor | Matriz do doc 03 dá ao promotor "Ver pedidos: carteira (leitura)"; o app mostra a aba Pedidos só de leitura, mas o createApp veta ao promotor até o GET de pedido. Sem rota de leitura hoje: decidir antes da Sprint 4 | apps/api/src/app.ts (`vetadaAoPromotor`), desenho T-0004 §3 | engenheiro-software | R-20261031-144858-testes (pergunta) |

## Testes manuais

Roteiro **M-01** para o Alexandre confirmar a demo web da Fase M (premissa do gerente: pasta inalterada ⇒ demo inalterada; S0-006 e S0-007 continuam ✅):
1. Na pasta original `C:\Users\domon\dev\forca-vendas`, rodar `iniciar-demo.cmd` (ou `pnpm demo`). **Atenção: isso escreve na pasta** (`node_modules`, `.next`, `mock-data/saida`).
2. Abrir http://localhost:3000, entrar como gerente (fernando@exemplo.com.br), abrir a lista de pedidos e um pedido; abrir um cliente.
3. Conferir que a API responde em http://localhost:8000/health.
4. Se o Next pedir atualização de segurança (foi o que travou o `next dev` na cópia), anotar a mensagem e não atualizar.
5. Mandar os prints ao agente testes e pedir que ele regere `tests/plano/fase-m-baseline.sha256` e `fase-m-git-status.txt` (senão S0-006 e S0-007 acusam a escrita da demo).

| Roteiro | Executado por | Data | Resultado | Evidência |
|---|---|---|---|---|
Roteiro **M-02** (T-0004 C4.1 — os 2 APKs de desenvolvimento; **pendente Alexandre**):
1. PowerShell em `C:\macuxifdv\apps\mobile`: `npm i -g eas-cli` e `eas login` com uma conta que tenha acesso à organização `macuxifdv` (ou `eas init` para trocar `owner`/`projectId` pelo seu projeto).
2. `eas build --profile campo --platform android` e `eas build --profile gestao --platform android` (APK de desenvolvimento). Anotar os 2 links de build.
3. Instalar os dois APKs no mesmo aparelho Android 10+: devem aparecer como **Macuxi Campo** e **Macuxi Gestão**, lado a lado (pacotes `br.com.macuxi.campo` e `br.com.macuxi.gestao`). Ícone igual nos dois é esperado até a arte da Gestão chegar.
4. No PC, na mesma rede: `npx expo start --dev-client`; abrir cada app e conectar ao Metro.
5. Campo: entrar com `alfa` + `vendedor@exemplo.com.br` (senha da fixture/seed) → abas do Campo, sem aba de Gestor. Gestão: entrar com `alfa` + `gerente@exemplo.com.br` → sem aba Pedidos do Vendedor. Promotor no Gestão e gerente no Campo: mensagem "use o app …".
6. Mandar prints e os links dos builds ao agente testes.

Roteiro **M-03** (offline e licença no aparelho; S0-046, S0-047, S0-100): API real no ar (`pnpm --filter api dev`, com `MACUXI_JWT_SEGREDO` no `.env`) e o APK Campo apontando para ela.
1. Entrar como `vendedor2@exemplo.com.br` (`alfa`) com sinal; abrir "Meus módulos" (core, catálogo, vendedor).
2. Modo avião; fechar e reabrir o app: abre em menos de 2 s, com a sessão e os mesmos módulos (sem tela de erro).
3. No BKO (admin `alfa`), em Usuários e módulos, desligar o Vendedor só para o vendedor2.
4. Tirar do modo avião e sincronizar: a aba Pedidos e o "Novo pedido" da ficha do cliente somem; "Meus módulos" sem o Vendedor. Hoje o "Sincronizar" vai mostrar erro por causa do D-2 — anotar a mensagem.
5. Religar no BKO, sincronizar: tudo volta. Vídeo curto.

Roteiro **M-05** (promotor no aparelho; C3.3): APK Campo, entrar como `promotor@exemplo.com.br` (`alfa`, aparelho NÃO bloqueado).
1. Início, Clientes e ficha do cliente: nenhum botão/aba "Novo pedido", "Sugestão de mix", "Últimos pedidos".
2. No BKO, admin liga o Vendedor e o Catálogo no perfil promotor; sincronizar no app: pode aparecer a aba Pedidos (leitura, O-3), mas sem nenhum botão de criar, editar, cancelar, duplicar ou excluir. Desligar de novo no fim.
3. Tentar abrir o deep link `macuxicampo://m/novo-pedido`: tela de bloqueio, nada na fila de sincronização.

Roteiro **M-06** (BKO, tela de licenças; S0-045, S0-050, S0-084 — Playwright ainda não instalado): `pnpm dev` com a API real.
1. Entrar no BKO como admin `alfa`: em Usuários e módulos, o Core aparece ligado e sem controle de desligar.
2. Desligar o Promotor no tenant: some do perfil e dos usuários; religar.
3. Entrar como analista e como assistente: o item de menu de licenças não aparece; abrir a URL direta mostra bloqueio (a API responde 403).
4. Tentar entrar como promotor e como vendedor: mensagem para usar o app Macuxi Campo.

Roteiro **M-07** (câmera da fachada, RN-CORE-14; só com APK novo, a lib nativa entrou depois do último build): no Campo, visita → check-out → "Loja fechada" → a câmera abre, a foto sai ≤ 1600 px; sem foto o check-out não fecha.

| Roteiro | Executado por | Data | Resultado | Evidência |
|---|---|---|---|---|
| M-01 (S0-008: web da demo da Fase M) | Alexandre | | pendente | prints |
| M-02 (S0-081: 2 APKs EAS) | Alexandre | | **pendente Alexandre** (login na Expo) | links dos builds + prints |
| M-03 (offline e licença no aparelho) | Alexandre | | pendente (depende de M-02) | vídeo |
| M-04 (CI verde no main) | gerente-projetos | 2026-10-31 | ✅ | runs 41208133979, 41209930842, 41210242610 (T-0005, Histórico) |
| M-05 (promotor no aparelho) | Alexandre | | pendente (depende de M-02) | prints |
| M-06 (BKO licenças) | Alexandre ou engenheiro | | pendente | prints |
| M-07 (câmera da fachada) | Alexandre | | pendente (depende de M-02) | prints |
