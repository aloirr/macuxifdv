# Relatório de testes — Sprint 0 · critério → teste → resultado

> Dono: agente `testes` (T-0006). Plano e detalhes de cada cenário: `tests/plano/sprint-0.md`.
> Legenda do resultado: `pendente` (ainda não rodou) · `✅` passou · `❌` falhou (ver Defeitos) · `bloqueado` (dependência; ver coluna) · `parcial` (provado só em parte; ver nota).
> Atualizar a cada rodada: data, commit, comando e saída resumida.

| Rodada | Data | Commit | Ambiente | Comando |
|---|---|---|---|---|
| 0 | 2026-10-30 | — | plano (sem código) | — |
| 1 (T-0001 Fase D) | 2026-10-31 | 87460de + árvore de trabalho (engenheiro e banco-dados alterando em paralelo) | Windows 11, Node 24.21, pnpm 12.11.2, Docker de pé | ver "T-0001 — evidências da Fase D" abaixo |

## Critério → teste → resultado

| Tarefa | Critério | Cenários | Tipo | Resultado | Bloqueado por / nota |
|---|---|---|---|---|---|
| T-0001 | C1.1 Os 277 testes da Fase M passam nos novos locais | S0-001, S0-002, S0-003, S0-004, S0-005 | estático, integ | ✅ | 277/277 por nome (275 idênticos + 2 com describe renomeado), todos verdes; 4 deles reescritos no SDK com o mesmo título |
| T-0001 | C1.2 Fase M não alterada e demo funcionando | S0-006, S0-007, S0-008, S0-009 | estático, e2e | ✅ (S0-008 parcial) | pasta idêntica à linha de base; demo na cópia: API ok, web dev não subiu (ver S0-008) |
| T-0001 | C1.3 dependency-cruiser falha em import interno entre módulos | S0-010, S0-011, S0-012, S0-013, S0-014 | estático | ✅ (S0-014 pendente) | 18 variantes de violação falham e os imports permitidos passam; S0-014 depende da T-0002 |
| T-0002 | C2.1 Migração sobe e desce sem erro | S0-020, S0-021, S0-022, S0-023 | integ | pendente | T-0002; Postgres de teste (R1) |
| T-0002 | C2.2 Tenant A não lê dados do tenant B em nenhuma tabela | S0-024, S0-025, S0-026, S0-027, S0-028, S0-029, S0-030, S0-111 | integ, carga | pendente | T-0002 (+T-0003 para S0-029/030/111) |
| T-0002 | C2.3 Seed carrega os usuários fake da Fase M | S0-031, S0-032, S0-033, S0-034 | integ | pendente | T-0002 |
| T-0003 | C3.1 Ativar/desativar módulo de teste reflete no app no próximo sync | S0-040 a S0-051 | unit, integ, sync, e2e, comp | pendente | T-0003 + T-0004 + motor de sync |
| T-0003 | C3.2 Rota de módulo inativo → 403 `MODULO_INATIVO` | S0-052, S0-053, S0-054, S0-055, S0-056 | integ | pendente | T-0003 |
| T-0003 | C3.3 Promotor não vê nenhuma ação de pedido | S0-060 a S0-066 | unit, comp, integ, sync, e2e | pendente | T-0003 + T-0004; API definitiva na Sprint 4 (R7) |
| T-0003 | (base) Auth, logs sem PII, escopo de carteira | S0-070 a S0-074, S0-110 | integ, carga | pendente | T-0003 |
| T-0004 | C4.1 Dois builds Android do mesmo código | S0-080, S0-081 (manual M-02), S0-082 | unit, manual, comp | pendente | T-0004; Android SDK/EAS (R2) |
| T-0004 | C4.2 Extensão de exemplo só com módulo ativo | S0-083 a S0-087 | comp, e2e, integ | pendente | T-0004 |
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
| S0-014 | — | pendente | T-0002 (schemas por módulo). |

## T-0001 — evidências da Fase D (2026-10-31)

Pedidos do Alexandre:

| Verificação | Comando | Resultado |
|---|---|---|
| Lint da raiz | `pnpm lint` | ✅ 16/16 tarefas + fronteiras com 0 violações |
| Typecheck da raiz | `pnpm typecheck` | ✅ 16/16 |
| Testes da raiz | `pnpm exec turbo run test --force` (sem cache) | ✅ 16/16 tarefas, 0 em cache, **641 casos verdes** (core 175, promotor 143, platform-sdk 78, vendedor 75, db 74, ui 38, mock-api 18, comum 16, config 8, web 7, mobile 2, catalogo 2, pesquisa 2, gestor 1, integracao 1, treinamento 1) |
| Build do web | `pnpm --filter web build` | ✅ next build 16.4.3: compilou, TypeScript ok, 5 rotas (/, /_not-found, /[...caminho], /auditoria, /login) |
| Testes do agente testes | `node node_modules/vitest/vitest.mjs run --config tests/vitest.config.ts` | ✅ 3 arquivos, 85 casos (fronteiras 21, fase-m-contagem 61, fase-m-intacta 3); `tsc -p tests/tsconfig.json` ok |
| Donos (árvore de trabalho) | `node scripts/coord.mjs verificar <agente>` para engenheiro-software, modulo-core, modulo-vendedor, modulo-catalogo, modulo-promotor, modulo-gestor, modulo-pesquisa, modulo-treinamento, modulo-integracao e testes | ✅ exit 0 nos 10, sem violação nem falso positivo (arquivos de outros agentes aparecem só em "Outros donos", que é informativo) |
| Donos dos commits da T-0001 | `donoDe` (scripts/coord-lib.mjs) sobre os arquivos de 14cccd4 (464) e 0a3d612 (35) | ✅ nenhum arquivo sem dono; todos de agentes da T-0001 ou do gerente (recados/quadro/tarefas) |

Observações (não bloqueiam o aceite):
- **tests/ fora do `pnpm test`**: tests/ não é pacote do workspace; os 85 casos acima só rodam pelo comando direto. Pedi ao engenheiro que entre no turbo/CI.
- **Contador estático e `it.each` com template literal**: `scripts/contar-testes.mjs` dá 15 em modules/core/domain/matriz.test.ts, e o Vitest executa 20 (o script avisa). Não afeta os 277, porque nenhum arquivo da Fase M usa tabela em template; nos outros 47 arquivos dos 8 pacotes, contagem estática = execução.
- **mock-api lento**: "edita pedido aguardando aprovação…" leva 4,6–5,3 s, com timeout padrão de 5 s (instável sob carga, igual na origem). A árvore de trabalho já tem `vitest run --testTimeout=30000` em apps/mock-api/package.json (engenheiro; ainda não commitado no momento desta leitura).

## Defeitos

| # | Cenário | Passos para reproduzir | Esperado × obtido | Arquivo provável | Dono | Recado |
|---|---|---|---|---|---|---|
| — | T-0001 | Nenhum defeito que reprove critério da T-0001 nesta rodada | — | — | — | — |

## Testes manuais

| Roteiro | Executado por | Data | Resultado | Evidência |
|---|---|---|---|---|
| M-01 (opcional) | | | pendente | |
| M-02 | | | pendente | |
| M-03 | | | pendente | |
| M-04 | | | pendente | |
