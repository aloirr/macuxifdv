# v1.0.17 — % do prazo gravado no orçamento: matriz de cenários

> 2026-11-20 · testes · RN-VEN-43, RN-VEN-44 (retrato da RN-VEN-45) · depende do PR do modulo-vendedor (% do prazo no detalhe do orçamento).

Ensaio: `tests/integracao/api/orcamento-pct-gravado-v1017.test.ts` (API + Postgres). Orçamento de 3 unidades do ALFA-001 no
BOL-28-56 com +2,50%; depois o ERP muda o prazo para +4,00%. O esperado sai da fórmula da RN-VEN-43 em `tests/modulos/apoio/oraculo-prazo.ts`; a tabela
pura vem de um orçamento de controle no PIX (0%).

| # | Cenário | Esperado | origin/main 54e6e4e |
|---|---|---|---|
| PG-01 | Orçamento gravado | `prazo_percentual_ajuste` = 2,50; unitário = regra(pura, +2,50%); total = unitário × 3 | verde |
| PG-02 | Pull `pedido` depois da mudança no ERP | a linha do orçamento traz `prazo_percentual_ajuste` = 2,50 (não 4,00) e passa no `PedidoSyncSchema` | **vermelho**: o pull não traz o campo |
| PG-03 | Aparelho: `detalheDoPedido` e o cálculo da edição (`calcularPedido` com os congelados do detalhe) | detalhe com 2,50; unitário e total iguais aos gravados | **vermelho**: o detalhe não traz o campo |
| PG-04 | API: `PUT /v1/vendedor/orcamentos/:id` (a edição do aparelho, sem `created_offline_at`) com o % gravado | 200; o orçamento mantém 2,50, o unitário e o total | **vermelho**: 422 `RN-VEN-45` ("Este prazo de pagamento mudou…"), porque o PUT compara a mudança do cadastro com o agora |

Hoje, no `main`, o aparelho edita com o % do pull (4,00, `use-vendedor.ts`), mostra o preço congelado e manda 4,00 no PUT; a API
descarta o congelado (gravado em 2,50) e reprecifica com a tabela × 4,00%: o total salvo diverge do que a tela mostrou.

## Teste manual

1. Salvar um orçamento num prazo com % diferente de 0; mudar o % do prazo no ERP e sincronizar.
2. Editar o orçamento no Campo sem mudar nada e salvar: o total da tela e o do orçamento no BKO continuam iguais aos de antes.
