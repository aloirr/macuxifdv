# Vendedor — retorno do ERP, faturado e devolução (T-0054)

Referências: desenho `docs/desenho/T-0011.md` (publicação do `vendedor.pedido.faturado@1`), ADR 0007 (outbox e consumidores), doc 03 RN-INT-08, RN-VEN-30 e RN-TRE-08, contrato do Hub `modules/integracao/contracts/pedido.ts`.

## Fluxo
1. O Conector manda o retorno ao Hub (`POST /integracao/v1/pedidos/{uuid}/retorno`). O Hub publica `integracao.pedido.retorno_erp@1` na outbox.
2. O despachante entrega ao Vendedor (só se o módulo estiver ativo no tenant), numa transação `comTenant` (RLS) com a marca de consumo (idempotência por `evento_id`).
3. O consumidor (`api/retorno-erp.ts`) lê o pedido (`for update`), decide no domínio (`domain/retorno-erp.ts`) e grava:
   - **status** (RN-INT-08/RN-VEN-30): o retorno só avança `aprovado < enviado < integrado < faturado parcial < faturado total`. Retorno atrasado é ignorado (log `fora_de_ordem`). `cancelado` vale de aprovado em diante e é final, porque o Hub não publica o `enviado`. Depois de faturado não há estorno. `rejeitado_erp` só vale antes de integrado e vira `rejected` com o motivo `Rejeitado pelo ERP: …`;
   - **número do ERP**, **linha do tempo** (`pedido_evento`, autor "ERP") e `vendedor.pedido.status_alterado@1`;
   - **faturamento** (retorno `faturado_*`): a nota e os itens vão para `pedido_faturamento`, uma linha por `evento_id`. O retorno informa a sequência e o consumidor encontra o produto no próprio pedido, limitando ao saldo. Sequência inexistente ou quantidade acima do saldo vira divergência no log. `faturado_total` sem itens fatura o saldo; parcial sem itens grava a nota e não publica nada. Depois o consumidor publica `vendedor.pedido.faturado@1` com os itens deste retorno, somados por produto, e `faturado_em` igual ao `ocorrido_em` do ERP;
   - **resumo** no pedido (`faturado_cents`, `devolvido_cents`, `notas_faturamento`, `ultima_nota_numero`, `faturado_em`) e no item (`quantidade_faturada`). É o que o pull leva ao aparelho.
4. **Devolução** (RN-VEN-37, *proposta*): o consumidor de `integracao.nota.atualizado@1` só usa nota `tipo = devolucao` com `pedido_uuid`. Ela é gravada em `pedido_devolucao` (upsert pelo `external_id` da nota). Nota cancelada, inativada, sem pedido ou que deixou de ser devolução sai da soma (soft delete). A devolução não muda o status do pedido. A situação é `parcial` ou `total` comparando o devolvido com o faturado. Não há estorno no Treinamento.

## Telas
- **Campo e Gestão** (offline, pelo pull): chip **Faturados** (parcial e total) na lista; a observação da linha mostra "Faturado R$ … (NF …) · Devolvido R$ … (parcial)"; o detalhe tem o cartão **Faturamento** e "Faturado X de Y" em cada item. As notas detalhadas aparecem quando o detalhe vem da API.
- **BKO**: filtro de status (já tinha faturado parcial e total); o resumo do faturamento aparece embaixo do status na lista; a gaveta tem a seção **Faturamento e devolução** com as notas e a coluna **Faturado** nos itens; o CSV ganha `Nº ERP`, `Faturado (R$)`, `Devolvido (R$)` e `Última NF` no fim.
- Permissões: as rotas e o pull continuam com `pedido.ver` e o escopo de sempre (RN-CORE-04; promotor só lê a carteira). Os consumidores não têm perfil: rodam no tenant do evento e só com a licença do Vendedor ativa.

## Ligar (depende da migração do banco-dados)
`FATURAMENTO_LIGADO` (`api/retorno-erp.ts`) começa `false`. Assim os consumidores não são registrados, e o pull, a lista e o detalhe não leem as colunas novas: nada quebra antes da migração. Quando a migração chegar ao `main`:
1. trocar para `true` (o `apiVendedor` já registra `consumidores: consumidoresVendedor`, vazio enquanto a chave estiver desligada);
2. rodar `retorno-erp.db.test.ts`, que deixa de aplicar a DDL proposta e passa a validar a migração real.

### Migração pedida ao banco-dados (a mesma DDL do teste, `DDL_PROPOSTA`)
- `vendedor.pedido`: `faturado_cents bigint not null default 0 (>= 0)`, `devolvido_cents bigint not null default 0 (>= 0)`, `notas_faturamento int not null default 0 (>= 0)`, `ultima_nota_numero text`, `faturado_em timestamptz`.
- `vendedor.pedido_item`: `quantidade_faturada int not null default 0 (>= 0)`.
- `vendedor.pedido_faturamento` (desenho T-0011 §3, acrescido de `status_retorno`, `nota_emitida_em`, `nota_total_cents`, `sequencia` e `valor_cents` nos itens): `pedido_id` (FK composta), `evento_origem_id uuid` com `unique (tenant_id, evento_origem_id)`, `status_retorno` (`faturado_parcial`|`faturado_total`), `parcial`, `nota_numero`, `nota_serie`, `nota_emitida_em`, `nota_total_cents (>= 0)`, `faturado_em not null`, `itens jsonb` (array `[{sequencia, produto_id, quantidade, valor_cents}]`), colunas comuns, índice `(tenant_id, pedido_id, faturado_em)`, RLS e `grant select, insert` ao `macuxi_app`. Só o servidor usa a tabela; ela fica fora do sync.
- `vendedor.pedido_devolucao`: `pedido_id` (FK composta), `external_id text not null` (a nota do ERP) com único parcial `(tenant_id, external_id) where deleted_at is null`, `nota_numero not null`, `nota_serie`, `emitida_em not null`, `total_cents bigint not null (>= 0)`, colunas comuns, índice `(tenant_id, pedido_id)`, RLS e `grant select, insert, update` (o soft delete é feito por `update`). Também só no servidor e fora do sync.
- Volume: uma linha de faturamento por nota do pedido (em geral 1 ou 2) e uma por nota de devolução (rara).

## Contratos
- Consome: `integracao.pedido.retorno_erp@1` e `integracao.nota.atualizado@1`, com os schemas oficiais de `modules/integracao/contracts` (`api/eventos-consumidos.ts`).
- Publica: `vendedor.pedido.status_alterado@1` (autor `null`, `alterado_em` = instante do ERP) e `vendedor.pedido.faturado@1`.
- Campos novos, todos opcionais e compatíveis: `Order.faturado_cents|devolvido_cents|devolucao|ultima_nota|situacao_faturamento`, `OrderItem.quantity_invoiced`, `OrderDetail.faturamento` (notas e devoluções), `PedidoSync.faturado_cents|devolvido_cents|notas_faturamento|ultima_nota_numero|faturado_em` e `PedidoItemSync.quantidade_faturada`.

## Fora (backlog)
Reenvio ao ERP pelo BKO depois de `rejeitado_erp` (RF-VEN-09); estorno do desafio na devolução ou no cancelamento depois de faturado; devolução por item (a nota do ERP só traz o total); evento `vendedor.pedido.devolvido@1`; liberar a reserva de estoque no faturamento (RN-VEN-20, estoque fora da fatia).
