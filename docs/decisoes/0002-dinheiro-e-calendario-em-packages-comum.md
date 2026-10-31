# ADR 0002 — Dinheiro e calendário em `packages/comum`

- **Status**: aceita
- **Data**: 2026-10-31
- **Tarefa**: T-0001 (Fase A)
- **Autor**: engenheiro-software

## Contexto
Na Fase M, `packages/domain/src/money.ts` (centavos, `applyPct`, `formatBRL`…) e `calendar.ts`
(dias úteis, `localDate`, `diffDays`) são importados por regras que agora pertencem a módulos
diferentes: `order.ts` (Vendedor) usa `money`; `incentive.ts`, `analytics.ts` e `visit.ts` (Core) usam
`money` e `calendar`; telas web/mobile usam `formatBRL`/`formatPct`. Pela regra de fronteira, o Vendedor
não pode importar `modules/core/domain`.

## Decisão
`money.ts` e `calendar.ts` (e seus 16 testes) vão **sem alteração** para `packages/comum`
(`@macuxi/comum`), que qualquer módulo, shell ou domain pode importar. Os arquivos de domain que os
importavam trocam `./money`/`./calendar` por `@macuxi/comum` (única adaptação permitida na cópia).

## Alternativas consideradas
- **Deixar em `modules/core/domain` e reexportar por `core/contracts`**: mistura utilitário técnico
  com o contrato público do Core e faz todo módulo depender do Core para formatar dinheiro.
- **Duplicar em cada módulo**: diverge com o tempo (arredondamento de centavos precisa ser um só).
- **Pôr no `platform-sdk`**: o SDK é o contrato plataforma ↔ módulo; utilitários de valor não são
  responsabilidade dele.

## Consequências
- `comum` é só utilitário puro e estável (sem regra de negócio com `RN-…`); regra de módulo continua
  no `domain` do módulo. Novos itens em `comum` passam por revisão do engenheiro.
- O fuso padrão `America/Manaus` de `calendar.localDate` é parâmetro com padrão; telas devem passar o
  fuso do tenant.
