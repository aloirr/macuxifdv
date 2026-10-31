# Quadro — Sprint 0 (Fundação modular)

> Dono: gerente-projetos. Status: aberta → em_andamento → em_teste → em_revisao → concluida (ou bloqueada).

| Tarefa | Título | Responsável | Status |
|---|---|---|---|
| [T-0001](tarefas/T-0001.md) | Reestruturar o monorepo em modules/ + platform-sdk | engenheiro-software | em_andamento (A/B/C/A2/B2 ✅ — 277/277 copiados · rodando: ligação nos shells e slots do vendedor · depois: D, revisão) |
| [T-0002](tarefas/T-0002.md) | Banco: schemas plataforma e core, RLS e migrações | banco-dados | em_andamento (infra Docker/compose/migrações; aguarda Docker instalado) |
| [T-0003](tarefas/T-0003.md) | Auth, perfis e licenças de módulos | modulo-core | aberta |
| [T-0004](tarefas/T-0004.md) | Shells mobile (campo/gestao), web e api montando módulos pelo manifesto | engenheiro-software | aberta |
| [T-0005](tarefas/T-0005.md) | CI e verificação de donos | engenheiro-software | aberta |
| [T-0006](tarefas/T-0006.md) | Plano de testes da fundação | testes | em_andamento (plano entregue; execução aguarda T-0001..T-0005) |

## Prioridades da semana 02–06/11 (Alexandre, R-20261031-021714)
1. **Ambiente e git (até seg 02/11)**: Docker com `pgvector/pgvector:pg16`; EAS para Android; `main` com commit inicial do Alexandre; commit ao fim de cada rodada.
2. **Fechar a T-0001 nos 277 (até seg 02/11)**: ligação nos shells → D (com `next build` e lint/typecheck/test da raiz) → revisão.
3. **T-0002 com RLS de verdade (semana)**; em paralelo, testes de domínio da T-0003 no modulo-core.
- T-0004 e o resto da T-0005 ficam para a semana de 09/11.

## Sprint 1 — backlog aberto
| Tarefa | Título | Responsável | Status |
|---|---|---|---|
| [T-0007](tarefas/T-0007.md) | Produto no dono definitivo (ADR-0005) | engenheiro-software | aberta |
| [T-0008](tarefas/T-0008.md) | Adaptador SQLite no aparelho | engenheiro-software | aberta |
| [T-0009](tarefas/T-0009.md) | Integração: domínio e contratos do Hub | modulo-integracao | em_revisao (desenho/contratos/domínio entregues, 97 testes; aguarda revisão do engenheiro, registro de 2 eventos e `ambiente.ts` no platform-sdk) |
| [T-0010](tarefas/T-0010.md) | Promotor: domínio de trade marketing (sem banco, sem telas) | modulo-promotor | em_revisao (domínio/contratos/manifesto entregues; aguarda revisão do engenheiro e `ambiente.ts` no platform-sdk) |

## Próximas sprints
Ver `docs/produto/05-roadmap.md`.
