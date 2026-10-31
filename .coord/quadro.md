# Quadro — Sprint 0 (Fundação modular)

> Dono: gerente-projetos. Status: aberta → em_andamento → em_teste → em_revisao → concluida (ou bloqueada).

| Tarefa | Título | Responsável | Onde | Status |
|---|---|---|---|---|
| [T-0001](tarefas/T-0001.md) | Reestruturar o monorepo em modules/ + platform-sdk | engenheiro-software | local | concluida (277/277 da Fase M · Fase M intacta · fronteiras ✅ · revisão sem 🔴) |
| [T-0002](tarefas/T-0002.md) | Banco: schemas plataforma e core, RLS e migrações | banco-dados | local | concluida (94 testes de banco no Docker · vazamento verde · revisão sem 🔴 · 🟡 corrigidos) |
| [T-0003](tarefas/T-0003.md) | Auth, perfis e licenças de módulos | modulo-core | local | em_andamento (Fase 1 ✅ · Fase 2 aguarda T-0002 e T-0004) |
| [T-0004](tarefas/T-0004.md) | Shells mobile (campo/gestao), web e api montando módulos pelo manifesto | engenheiro-software | local | em_teste (createApp, 8 módulos nos shells, EAS configurado · 37 testes de API · falta: validação do testes e builds EAS com o Alexandre) |
| [T-0005](tarefas/T-0005.md) | CI e verificação de donos | engenheiro-software | local | concluida (verificar --base e casos A–B · CI do main verde · run 41207939579 foi cancelamento por concorrência) |
| [T-0006](tarefas/T-0006.md) | Plano de testes da fundação | testes | local | em_andamento (T-0001, T-0002 e T-0005 validadas · vazamento via tests/ 164/164 · falta: T-0003, T-0004 e S0-029/030/111) |

## Travado pela nuvem
| Caminho | Tarefa | Branch | Desde |
|---|---|---|---|
| `modules/core/contracts/**`, `modules/catalogo/contracts/**`, `modules/vendedor/contracts/**`, `modules/catalogo/manifest.ts`, `modules/vendedor/manifest.ts` | T-0007 | nuvem | 2026-10-31 |
| `modules/pesquisa/domain/**`, `modules/pesquisa/contracts/**`, `modules/pesquisa/manifest.ts`, `docs/modulos/pesquisa/**` | T-0012 | nuvem | 2026-10-31 |
| `.claude/hooks/**` | guardião (Alexandre) | nuvem | 2026-10-31 |
| `modules/treinamento/domain/**`, `modules/treinamento/contracts/**`, `modules/treinamento/manifest.ts`, `docs/modulos/treinamento/**` | T-0011 (ajustes das decisões) | `nuvem/T-0011-ajustes-decisoes` | 2026-10-31 |

Nenhum agente local altera caminho listado aqui. Destravar quando o merge chegar no pull do `main`.
Destravados em 2026-10-31: `scripts/coord*.mjs` e `.claude/**` (merge 23b4192); T-0011, T-0008 parte 1 e T-0005 casos A–B (merges dcc044d, 0d1c8a1 e 3215b2f). Push liberado (main, nuvem/*, alexandre/*, agente/*; sem force/delete).
Regras: `docs/produto/07-agentes-e-coordenacao.md`, seção "Frentes de trabalho: local e nuvem".

## Meta: fechar a Sprint 0 até sexta, 06/11 (Alexandre, R-20261031-103502)
1. **T-0004** (shells com os 8 módulos, `createApp`, EAS, pendências da T-0002 §6) → **T-0003 Fase 2** (espera também o merge da T-0007, que trava `modules/core/contracts`) → **execução da T-0006** e relatório da Sprint 0.
2. Ajustes pendentes: T-0011 (RN-TRE-01..08, na nuvem), 🟡 da T-0001.
3. Concluídas: T-0001, T-0002, T-0005, T-0009, T-0010. T-0004 em teste.

## Sprint 1 — backlog aberto
| Tarefa | Título | Responsável | Onde | Status |
|---|---|---|---|---|
| [T-0007](tarefas/T-0007.md) | Produto no dono definitivo (ADR-0005) | engenheiro-software | nuvem | em_andamento (sessão da nuvem; revisão: engenheiro) |
| [T-0008](tarefas/T-0008.md) | Adaptador SQLite no aparelho | engenheiro-software | local | em_andamento (desenho ✅ e revisado · falta: implementação, parte 2) |
| [T-0011](tarefas/T-0011.md) | Treinamento — domínio (trilhas, XP, níveis, medalhas, ranking) | modulo-treinamento | nuvem (ajustes, branch nuvem/T-0011-ajustes-decisoes) | em_andamento (revisão do dono 🟡 sem 🔴 · ajustes RN-TRE na nuvem · depois: revisão do engenheiro) |
| [T-0012](tarefas/T-0012.md) | Pesquisa — domínio | modulo-pesquisa | nuvem | em_andamento (sessão da nuvem; revisão: modulo-pesquisa) |
| [T-0009](tarefas/T-0009.md) | Integração: domínio e contratos do Hub | modulo-integracao | nuvem → local (merge e20f6ac) | concluida (cancelado do ERP ✅ · revisão sem 🔴 · OrderStatus depois do merge da T-0007) |
| [T-0010](tarefas/T-0010.md) | Promotor: domínio de trade marketing (sem banco, sem telas) | modulo-promotor | local (1ª entrega veio da nuvem, merge 3352d2e) | concluida (155 testes · revisão sem 🔴 · decisões do Alexandre aplicadas) |

## Próximas sprints
Ver `docs/produto/05-roadmap.md`.
