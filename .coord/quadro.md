# Quadro — Sprint 0 (Fundação modular)

> Dono: gerente-projetos. Status: aberta → em_andamento → em_teste → em_revisao → concluida (ou bloqueada).

| Tarefa | Título | Responsável | Onde | Status |
|---|---|---|---|---|
| [T-0001](tarefas/T-0001.md) | Reestruturar o monorepo em modules/ + platform-sdk | engenheiro-software | local | concluida (277/277 da Fase M · Fase M intacta · fronteiras ✅ · revisão sem 🔴) |
| [T-0002](tarefas/T-0002.md) | Banco: schemas plataforma e core, RLS e migrações | banco-dados | local | concluida (94 testes de banco no Docker · vazamento verde · revisão sem 🔴 · 🟡 corrigidos) |
| [T-0003](tarefas/T-0003.md) | Auth, perfis e licenças de módulos | modulo-core | local | concluida (3 critérios ✅ no Postgres real · 245 testes no core, 51 na API) |
| [T-0004](tarefas/T-0004.md) | Shells mobile (campo/gestao), web e api montando módulos pelo manifesto | engenheiro-software | local | concluida (APKs de desenvolvimento campo e gestao gerados no EAS · previews na sequência) |
| [T-0005](tarefas/T-0005.md) | CI e verificação de donos | engenheiro-software | local | concluida (verificar --base e casos A–B · CI do main verde · run 41207939579 foi cancelamento por concorrência) |
| [T-0006](tarefas/T-0006.md) | Plano de testes da fundação | testes | local | concluida (relatório final da Sprint 0 · 230 casos em tests/ com banco real) |

## Travado pela nuvem
| Caminho | Tarefa | Branch | Desde |
|---|---|---|---|
| `apps/conector/**`, `modules/integracao/contracts/**`, `docs/modulos/integracao/**` | T-0023 | `nuvem/T-0023-conector-oracle` | 2026-10-31 |
| `modules/gestor/domain/**`, `modules/gestor/contracts/**`, `modules/gestor/manifest.ts`, `docs/modulos/gestor/**` | T-0014 (ajustes v2: prazo em dias úteis, "passou do limite", feriados) | `nuvem/T-0014-ajustes-v2` | 2026-10-31 |

Nenhum agente local altera caminho listado aqui. Destravar quando o merge chegar no pull do `main`.
Destravados em 2026-10-31 (merges no main): `scripts/coord*.mjs` e `.claude/**` (T-0005, 23b4192); T-0011, T-0008 parte 1 e T-0005 casos A–B (dcc044d, 0d1c8a1, 3215b2f); T-0007, T-0012 e `.claude/hooks/**` (6fba044, f4fdbe5, d277a55); T-0011 v2 (9f06e77); guardião v2 (c2f0005) e v3 (5d7e317); T-0013 (`apps/conector/**`, 588da33 — travado de novo pela T-0023); `.claude/settings.json` (PostToolUse religado). T-0021 ajustes (`modules/catalogo/...`, 7b3bb50). Push liberado (main, nuvem/*, alexandre/*, agente/*; sem force/delete).
Regras: `docs/produto/07-agentes-e-coordenacao.md`, seção "Frentes de trabalho: local e nuvem".

## Meta: fechar a Sprint 0 até sexta, 06/11 (Alexandre, R-20261031-103502)
1. **T-0004** (shells com os 8 módulos, `createApp`, EAS, pendências da T-0002 §6) → **T-0003 Fase 2** (T-0007 já mergeada) → **execução da T-0006** e relatório da Sprint 0.
2. Ajustes pendentes: só os do backlog.
3. Concluídas: T-0001, T-0002, T-0003, T-0005, T-0006, T-0007, T-0009, T-0010, T-0011, T-0012. **Sprint 0 fechada em 2026-11-01** (APKs de desenvolvimento gerados). T-0004 em teste.

## Sprint 1 — Core (planejada em 2026-10-31; meta do roadmap: modo avião — abrir cliente, rota e fazer check-in; sincroniza depois)
Ordem (ondas do desenho, docs/desenho/T-0016.md §9): onda 1 banco lote A + core contratos/domínio + engenheiro E1–E3 (após T-0015) → onda 2 T-0017 + vendedor pull + E4 → onda 3 T-0018 + T-0008 P3/P5 → onda 4 T-0019 + T-0022 (+ T-0020 fase 1) → onda 5 testes e revisão.

| Tarefa | Título | Responsável | Onde | Status |
|---|---|---|---|---|
| [T-0015](tarefas/T-0015.md) | Ajustes pós-Sprint 0: O-3 (promotor lê pedidos da carteira) e D-1 | engenheiro-software | local | concluida (O-3 e D-1 provados com Postgres) |
| [T-0016](tarefas/T-0016.md) | Desenho técnico e contratos da Sprint 1 | engenheiro-software | local | concluida (aprovado; ADRs 0009/0010) |
| [T-0017](tarefas/T-0017.md) | Carteira e Cliente 360 | modulo-core | local | concluida (critérios ✅ · revisão final sem 🔴) |
| [T-0018](tarefas/T-0018.md) | Rotas e visitas reais, sync de visita e pedido (D-2) | modulo-core | local | concluida (🔴 da revisão corrigido · D-2..D-5 fechados · meta da sprint demonstrada) |
| [T-0019](tarefas/T-0019.md) | Central de notificações | modulo-core | local | concluida (revisão sem 🔴 · push real depende do EAS) |
| [T-0020](tarefas/T-0020.md) | Metas e indicadores básicos — só fase 1 | modulo-core | local | concluida (fase 1 · revisão sem 🔴 · realizado de venda nas Sprints 4–5) |
| [T-0022](tarefas/T-0022.md) | Despachante da outbox (onda 4) | engenheiro-software | local | concluida (revisão sem 🔴) |
| [T-0008](tarefas/T-0008.md) | Adaptador SQLite no aparelho — parte 2 | engenheiro-software | local | bloqueada (parte 2 aprovada · P4/P7 dependem do build EAS) |

## Adiantadas (domínio sem banco/telas) e backlog de outras sprints
| Tarefa | Título | Responsável | Onde | Status |
|---|---|---|---|---|
| [T-0007](tarefas/T-0007.md) | Produto no dono definitivo (ADR-0005) | engenheiro-software | nuvem → local (merge 6fba044) | concluida (🔴 da fixture corrigido · 🟡 aplicados · API 37/37 com banco) |
| [T-0011](tarefas/T-0011.md) | Treinamento — domínio (trilhas, XP, níveis, medalhas, ranking) | modulo-treinamento | nuvem → local (merge 9f06e77) | concluida (230 testes · revisão sem 🔴 · RN-TRE-01..08 aplicadas) |
| [T-0012](tarefas/T-0012.md) | Pesquisa — domínio | modulo-pesquisa | nuvem → local (merge f4fdbe5) | concluida (215 testes · revisão sem 🔴 · decisões do Alexandre aplicadas · cliente fechado via RN-CORE-14) |
| [T-0013](tarefas/T-0013.md) | Conector v1 (lado do cliente) — Sprint 2 | modulo-integracao | nuvem → local (merges a7cd2fe, 588da33) | concluida (revisões do dono e do engenheiro sem 🔴 · correções na T-0023) |
| [T-0014](tarefas/T-0014.md) | Gestor — domínio — Sprint 6 | modulo-gestor | nuvem (ajustes v2) | em_andamento (ajustes v1 mergeados · v2 na nuvem: prazo em dias úteis, limite, feriados) |
| [T-0021](tarefas/T-0021.md) | Catálogo — domínio — Sprint 3 | modulo-catalogo | nuvem → local (merges 706a31e, 7b3bb50) | concluida (236 testes · revisões do dono e do engenheiro sem 🔴) |
| [T-0023](tarefas/T-0023.md) | Conector: ajustes v1.1 e adaptador Oracle — Sprint 2 | modulo-integracao | nuvem | em_andamento (sessão da nuvem) |
| [T-0024](tarefas/T-0024.md) | Payload dos eventos no contracts de cada módulo — Sprint 2 | engenheiro-software | local | aberta |
| [T-0009](tarefas/T-0009.md) | Integração: domínio e contratos do Hub | modulo-integracao | nuvem → local (merge e20f6ac) | concluida (cancelado do ERP ✅ · revisão sem 🔴 · OrderStatus depois do merge da T-0007) |
| [T-0010](tarefas/T-0010.md) | Promotor: domínio de trade marketing (sem banco, sem telas) | modulo-promotor | local (1ª entrega veio da nuvem, merge 3352d2e) | concluida (155 testes · revisão sem 🔴 · decisões do Alexandre aplicadas) |

## Próximas sprints
Ver `docs/produto/05-roadmap.md`.
