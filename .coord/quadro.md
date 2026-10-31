# Quadro — Sprint 0 (Fundação modular)

> Dono: gerente-projetos. Status: aberta → em_andamento → em_teste → em_revisao → concluida (ou bloqueada).

| Tarefa | Título | Responsável | Onde | Status |
|---|---|---|---|---|
| [T-0001](tarefas/T-0001.md) | Reestruturar o monorepo em modules/ + platform-sdk | engenheiro-software | local | concluida (277/277 da Fase M · Fase M intacta · fronteiras ✅ · revisão sem 🔴) |
| [T-0002](tarefas/T-0002.md) | Banco: schemas plataforma e core, RLS e migrações | banco-dados | local | concluida (94 testes de banco no Docker · vazamento verde · revisão sem 🔴 · 🟡 corrigidos) |
| [T-0003](tarefas/T-0003.md) | Auth, perfis e licenças de módulos | modulo-core | local | em_andamento (Fase 1 ✅ · Fase 2 aguarda T-0002 e T-0004) |
| [T-0004](tarefas/T-0004.md) | Shells mobile (campo/gestao), web e api montando módulos pelo manifesto | engenheiro-software | local | aberta |
| [T-0005](tarefas/T-0005.md) | CI e verificação de donos | engenheiro-software | local | em_teste (verificar A–B ✅ · CI do main verde · falta: entender o run vermelho 41207939579 com gh) |
| [T-0006](tarefas/T-0006.md) | Plano de testes da fundação | testes | local | em_andamento (plano entregue; execução aguarda T-0001..T-0005) |

## Travado pela nuvem
| Caminho | Tarefa | Branch | Desde |
|---|---|---|---|
| — | — | — | — |

Nenhum agente local altera caminho listado aqui. Destravar quando o merge chegar no pull do `main`.
Destravados em 2026-10-31: `scripts/coord*.mjs` e `.claude/**` (merge 23b4192); T-0011, T-0008 parte 1 e T-0005 casos A–B (merges dcc044d, 0d1c8a1 e 3215b2f). Push liberado (main, nuvem/*, alexandre/*, agente/*; sem force/delete).
Candidata à nuvem depois que a T-0001 fechar: T-0007.
Regras: `docs/produto/07-agentes-e-coordenacao.md`, seção "Frentes de trabalho: local e nuvem".

## Prioridades da semana 02–06/11 (Alexandre, R-20261031-021714)
1. **Ambiente e git (até seg 02/11)**: Docker com `pgvector/pgvector:pg16`; EAS para Android; `main` com commit inicial do Alexandre; commit ao fim de cada rodada.
2. **Fechar a T-0001 nos 277 (até seg 02/11)**: ligação nos shells → D (com `next build` e lint/typecheck/test da raiz) → revisão.
3. **T-0002 com RLS de verdade (semana)**; em paralelo, testes de domínio da T-0003 no modulo-core.
- T-0004 e o resto da T-0005 ficam para a semana de 09/11.

## Sprint 1 — backlog aberto
| Tarefa | Título | Responsável | Onde | Status |
|---|---|---|---|---|
| [T-0007](tarefas/T-0007.md) | Produto no dono definitivo (ADR-0005) | engenheiro-software | local (candidata à nuvem após fechar a T-0001) | aberta |
| [T-0008](tarefas/T-0008.md) | Adaptador SQLite no aparelho | engenheiro-software | local | em_andamento (desenho ✅ da nuvem · falta: revisão do engenheiro e implementação) |
| [T-0011](tarefas/T-0011.md) | Treinamento — domínio (trilhas, XP, níveis, medalhas, ranking) | modulo-treinamento | nuvem → local (merge dcc044d) | em_revisao (186 testes · falta: revisão do modulo-treinamento) |
| [T-0009](tarefas/T-0009.md) | Integração: domínio e contratos do Hub | modulo-integracao | nuvem → local (merge e20f6ac) | em_revisao (revisão do dono 🟢 · eventos registrados ✅ · decisão (b) do cancelamento ✅ · falta: revisão do engenheiro e ajuste 'cancelado' em integração e vendedor) |
| [T-0010](tarefas/T-0010.md) | Promotor: domínio de trade marketing (sem banco, sem telas) | modulo-promotor | local (1ª entrega veio da nuvem, merge 3352d2e) | concluida (147 testes · revisão sem 🔴 · decisões confirmadas; ajuste de sem_gps/parâmetros pendente) |

## Próximas sprints
Ver `docs/produto/05-roadmap.md`.
