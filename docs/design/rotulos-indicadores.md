# Rótulos dos indicadores de meta (RD-0250)

Um indicador, um nome, em todas as superfícies (Campo, Gestão, BKO, PDF). Quem exibe usa o rótulo desta tabela; não cria sinônimo.

| Indicador (`IndicadorMeta`) | Rótulo |
|---|---|
| `venda_cents` | **Vendas** |
| `positivacao` | **Positivação** |
| `cobertura_pct` | **Cobertura de rota** |
| `visitas` | **Visitas** |
| `itens_por_pedido` | **Itens por pedido** |

## Única exceção: meta de faturamento (D6, regra congelada)
`venda_cents` aparece como **Faturamento** só quando a meta do tenant é medida pelo faturamento do ERP (`tipoMetaVenda === 'faturamento'`), porque aí o número é outro. Sem base definida (`tipoMetaVenda === null`) o rótulo é **Vendas**, como no Início.

## Onde trocar
| Arquivo | Hoje | Passa a |
|---|---|---|
| `apps/mobile/src/lib/inicio.ts:53` | `cobertura_pct: 'Cobertura'` | `'Cobertura de rota'` |
| `modules/core/app/lib/metas-formato.ts:10` | `venda_cents: 'Venda'` | `'Vendas'` |
| `modules/core/app/telas/performance/cards-performance.ts:74,94` | `'Faturamento'` como padrão; `'Vendas'` só com meta de pedido | `'Vendas'` como padrão; `'Faturamento'` só com `tipoMetaVenda === 'faturamento'` |
| `modules/gestor/app/lib/apresentacao.ts:57` | `cobertura_pct: 'Cobertura'` | `'Cobertura de rota'` |
| `modules/core/web/lib/plano-rv.ts:15` | `venda_cents: 'Venda'` | `'Vendas'` |

Já seguem a tabela: `modules/gestor/domain/ranking.ts`, `modules/core/web/lib/plano-rv.ts` (exceto a linha 15, acima), `modules/core/web/components/metas-produtividade/formato.ts`, `modules/core/app/telas/performance/cards-performance.ts:139`.
Cabeçalho de coluna (`modules/core/web/lib/indicadores.ts:29`, "Cobertura") só abrevia se não couber; preferir o rótulo completo.
Os testes que conferem o rótulo (ex.: `apps/mobile/src/lib/inicio.test.ts:150`) mudam junto, pelo dono do arquivo.
