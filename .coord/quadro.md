# Quadro — Sprint 0 (Fundação modular)

> Dono: gerente-projetos. Status: aberta → em_andamento → em_teste → em_revisao → concluida (ou bloqueada).

| Tarefa | Título | Responsável | Onde | Status |
|---|---|---|---|---|
| [T-0001](tarefas/T-0001.md) | Reestruturar o monorepo em modules/ + platform-sdk | engenheiro-software | local | em_revisao (D ✅ 277/277 · Fase M intacta · fronteiras ✅ · rodando: revisão final do engenheiro) |
| [T-0002](tarefas/T-0002.md) | Banco: schemas plataforma e core, RLS e migrações | banco-dados | local | em_teste (critérios 1–3 ✅ no Docker · 74 testes de banco, 0 pulados · vazamento verde · falta: validação do testes e revisão do engenheiro) |
| [T-0003](tarefas/T-0003.md) | Auth, perfis e licenças de módulos | modulo-core | local | em_andamento (Fase 1 ✅ · Fase 2 aguarda T-0002 e T-0004) |
| [T-0004](tarefas/T-0004.md) | Shells mobile (campo/gestao), web e api montando módulos pelo manifesto | engenheiro-software | local | aberta |
| [T-0005](tarefas/T-0005.md) | CI e verificação de donos | engenheiro-software | local (CI `.github/`, engenheiro) | em_teste (verificar/settings/entrega ✅ via nuvem · CI ✅ local · falta: primeiro run real no GitHub) |
| [T-0006](tarefas/T-0006.md) | Plano de testes da fundação | testes | local | em_andamento (plano entregue; execução aguarda T-0001..T-0005) |

## Travado pela nuvem
| Caminho | Tarefa | Branch | Desde |
|---|---|---|---|
| — | — | — | — |

Nenhum agente local altera caminho listado aqui. Destravar quando o merge chegar no pull do `main`.
Destravados em 2026-10-31 (merge 23b4192 da T-0005): `scripts/coord*.mjs` e `.claude/**`. Push liberado pela regra nova do settings (main, nuvem/*, alexandre/*, agente/*; sem force/delete).
Próximas para a nuvem: CI da T-0005 (`.github/`) e desenho da T-0008 depois que a A3 fechar; T-0007 depois que a T-0001 fechar.
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
| [T-0008](tarefas/T-0008.md) | Adaptador SQLite no aparelho | engenheiro-software | local (desenho candidato à nuvem após a A3) | aberta |
| [T-0010](tarefas/T-0010.md) | Promotor: domínio de trade marketing (sem banco, sem telas) | modulo-promotor | local (1ª entrega veio da nuvem, merge 3352d2e) | concluida (147 testes · revisão sem 🔴 · 4 decisões de regra aguardam o Alexandre como premissas) |

## Próximas sprints
Ver `docs/produto/05-roadmap.md`.
