# Vendedor — retorno do ERP, faturado e devolução (T-0054)

Referências: desenho `docs/desenho/T-0011.md` (publicação do `vendedor.pedido.faturado@1`), ADR 0007 (outbox e consumidores), doc 03 RN-INT-08, RN-VEN-30 e RN-TRE-08, contrato do Hub `modules/integracao/contracts/pedido.ts`.

## Fluxo
O consumidor do retorno é um só no módulo (T-0053 + T-0054). O status segue `planejarRetornoErp`, regra da T-0053 descrita em `pre-venda-e-erp.md`; esta página trata do faturamento gravado, da devolução e das telas.

1. O Conector manda o retorno ao Hub (`POST /integracao/v1/pedidos/{uuid}/retorno`). O Hub publica `integracao.pedido.retorno_erp@1` na outbox.
2. O despachante entrega ao Vendedor (só se o módulo estiver ativo no tenant), numa transação `comTenant` (RLS) com a marca de consumo (idempotência por `evento_id`).
3. O consumidor (`api/retorno-erp.ts`) lê o pedido (`for update`), decide no domínio (`domain/retorno-erp.ts`) e grava:
   - **status** (RN-INT-08/RN-VEN-30, `planejarRetornoErp`): o pedido só avança `aprovado < enviado < integrado < faturado parcial < faturado total`. Retorno repetido ou atrasado é ignorado (log `repetido_ou_atrasado`). `cancelado` vale de aprovado em diante e é final, sem estorno depois de faturado. `rejeitado_erp` só vale antes de integrado e vira `rejected` com o motivo `Recusado pelo ERP: …`. A linha do tempo leva autor "ERP" (perfil `erp`);
   - **número do ERP**, **linha do tempo** (`pedido_evento`, autor "ERP") e `vendedor.pedido.status_alterado@1`;
   - **faturamento** (retorno `faturado_*`): a nota e os itens, na unidade base, vão para `pedido_faturamento`, uma linha por `evento_id`. O retorno informa a sequência e o consumidor encontra o produto no próprio pedido, limitando ao saldo. Sequência inexistente ou quantidade acima do saldo vira divergência no log. `faturado_total` sem itens fatura o saldo; parcial sem itens grava a nota e não publica nada. Depois o consumidor publica `vendedor.pedido.faturado@1` com os itens deste retorno, somados por produto, e `faturado_em` igual à emissão da nota (regra da T-0053) ou, sem nota, ao `ocorrido_em` do retorno;
   - **resumo** no pedido (`total_faturado_cents`, `faturado_em`) e no item (`quantidade_faturada`, na unidade base). O pull leva ao aparelho esses campos, mais o número de notas e a última NF.
4. **Devolução** (RN-VEN-37, *proposta*): o consumidor de `integracao.nota.atualizado@1` só usa nota `tipo = devolucao` com `pedido_uuid`. Ela é gravada em `pedido_devolucao` (upsert pelo `external_id` da nota). Nota cancelada, inativada, sem pedido ou que deixou de ser devolução sai da soma (soft delete). A devolução não muda o status do pedido. A situação é `parcial` ou `total` comparando o devolvido com o faturado. Não há estorno no Treinamento.

## Telas
- **Campo e Gestão** (offline, pelo pull): chip **Faturados** (parcial e total) na lista; a observação da linha mostra "Faturado R$ … (NF …) · Devolvido R$ … (parcial)"; o detalhe tem o cartão **Faturamento** e "Faturado X de Y" em cada item. As notas detalhadas aparecem quando o detalhe vem da API.
- **BKO**: filtro de status (já tinha faturado parcial e total); o resumo do faturamento aparece embaixo do status na lista; a gaveta tem a seção **Faturamento e devolução** com as notas e a coluna **Faturado** nos itens; o CSV ganha `Nº ERP`, `Faturado (R$)`, `Devolvido (R$)` e `Última NF` no fim.
- Permissões: as rotas e o pull continuam com `pedido.ver` e o escopo de sempre (RN-CORE-04; promotor só lê a carteira). Os consumidores não têm perfil: rodam no tenant do evento e só com a licença do Vendedor ativa.

## Estado da ligação (migração 0013 no `main`)
- **Faturamento ligado** (`FATURAMENTO_LIGADO = true`), com o esquema real da 0013:
  - `vendedor.pedido_faturamento`: uma linha por retorno faturado, idempotente por `evento_id`, itens `[{sequencia, produto_id, quantidade, total_cents}]`;
  - `pedido.total_faturado_cents` e `pedido.faturado_em`;
  - `pedido_item.quantidade_faturada` na **unidade base**: quantidade × fator (desenho T-0061 §2.1). O retorno do ERP e o `faturado@1` também vêm na unidade base.
- A lista e o pull leem o número de notas e a última NF de `pedido_faturamento` (junção lateral). O detalhe lista as notas.
- **Devolução desligada** (`DEVOLUCAO_LIGADA = false`): a 0013 não criou `pedido_devolucao`. O consumidor da nota não é registrado e o devolvido fica 0. Para ligar, o banco-dados precisa criar `vendedor.pedido_devolucao`: `pedido_id` com FK composta, `external_id` com único parcial onde `deleted_at is null`, `nota_numero`, `nota_serie`, `emitida_em`, `total_cents >= 0`, colunas comuns, RLS e `grant select, insert, update`. Depois disso, a chave vira `true`.
- `retorno-erp.db.test.ts` valida contra a 0013 real: RLS de dois tenants, idempotência por `evento_id`, saldo e item em caixa (fator 12) na unidade base.

## Contratos
- Consome: `integracao.pedido.retorno_erp@1` e `integracao.nota.atualizado@1`. Os schemas são ESPELHO dos oficiais de `modules/integracao/contracts` (`api/eventos-consumidos.ts`) e trazem só os campos lidos. O motivo é que o import relativo exige os inputs do turbo (regra R2 do CI). Quando o engenheiro-software os incluir, o espelho dá lugar ao import oficial.
- Publica: `vendedor.pedido.status_alterado@1` (autor `null`, `alterado_em` = instante do ERP) e `vendedor.pedido.faturado@1`.
- Campos novos, todos opcionais e compatíveis: `Order.faturado_cents|devolvido_cents|devolucao|ultima_nota|situacao_faturamento`, `OrderItem.quantity_invoiced`, `OrderDetail.faturamento` (notas e devoluções), `PedidoSync.faturado_cents|devolvido_cents|notas_faturamento|ultima_nota_numero|faturado_em` e `PedidoItemSync.quantidade_faturada`.

## Fora (backlog)
Reenvio ao ERP pelo BKO depois de `rejeitado_erp` (RF-VEN-09); estorno do desafio na devolução ou no cancelamento depois de faturado; devolução por item (a nota do ERP só traz o total); evento `vendedor.pedido.devolvido@1`; liberar a reserva de estoque no faturamento (RN-VEN-20, estoque fora da fatia).
