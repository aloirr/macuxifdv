# ADR 0016 — Pedido ao ERP ampliado no v1: quantidade na unidade base e entrega condicionada à versão do Conector

- **Status**: proposta (2026-11-02; vira aceita com o OK do gerente no desenho da T-0061)
- **Data**: 2026-11-02
- **Tarefa**: T-0061 (spec do Alexandre R-20261102-093007), T-0060 (R-20261102-092329)
- **Autor**: engenheiro-software
- **Base**: RN-INT-08, RN-INT-09 (mudança compatível fica no `v1`), RN-INT-11 (política de versão), ADR 0013 (rotas do
  Conector), RN-VEN-15/16/17; desenho `docs/desenho/T-0061.md`

## Contexto
O pedido passa a ter unidade de venda (CX com fator), desconto **ou** acréscimo por item e por pedido, frete (CIF/FOB,
transportadora da lista ou digitada, valor em R$ ou %) e endereço de entrega. Tudo isso precisa chegar ao ERP pelo
`PedidoParaErp` (`GET /integracao/v1/pedidos/pendentes`). Os Conectores instalados (1.2.x) validam o pedido com o contrato da
versão deles e **descartam campos que não conhecem** (o `z.object` não é estrito). Dois riscos:
1. **Quantidade errada no ERP**: se `quantidade` passasse a ser "na unidade vendida", um Conector 1.2.x gravaria "2" (caixas)
   como 2 unidades.
2. **Pedido incompleto no ERP**: um Conector 1.2.x ignoraria frete, transportadora, endereço de entrega e acréscimo — o cliente
   não seria cobrado do frete e a entrega iria para o endereço principal.

## Decisão
1. **Fica no `v1`** (RN-INT-09): só campos **opcionais** novos; nenhum campo existente muda de formato ou de sentido. Não há
   `/v2` nem nova versão de evento.
2. **Quantidade fora do Vendedor é sempre na unidade base.** `ItemPedidoErp.quantidade` continua sendo a quantidade na
   unidade base (hoje toda venda é UN, então nada muda para quem já integra). Campos novos do item: `unidade` (código vendido,
   ex. `CX`), `fator`, `quantidade_venda` (na unidade vendida; `quantidade = quantidade_venda × fator`),
   `preco_tabela_cents` e `preco_unitario_venda_cents` (por unidade vendida), `desconto_pct`, `acrescimo_pct`,
   `acrescimo_cents`. `preco_unitario_cents` segue por unidade base (pode ser arredondado quando o preço da CX não divide pelo
   fator; `total_cents` do item é o valor que manda). Campos novos do pedido: `desconto_pct`, `acrescimo_pct`,
   `acrescimo_total_cents`, `frete { modalidade, tipo, pct, valor_cents, transportadora { external_id?, nome, documento?,
   inscricao_estadual?, telefone?, digitada } }`, `endereco_entrega { external_id?, logradouro, numero, complemento, bairro,
   cidade, uf, cep }` e `total_a_pagar_cents` (= `total_cents` + frete; `total_cents` continua **sem** o frete).
   `ItemFaturado.quantidade` (retorno) também é na unidade base.
3. **Entrega condicionada à versão do Conector.** O domain do Hub calcula, na entrada da fila, `exigeConector(pedido)`:
   `'1.3.0'` quando o pedido usa algo que o 1.2.x perderia (unidade com fator > 1, acréscimo no item ou no pedido, frete com
   valor > 0 ou FOB, endereço de entrega diferente do principal); senão `null`. Grava em `pedido_fila_erp.exige_conector`.
   `selecionarPendentes` só entrega a um Conector com versão ≥ `exige_conector`; os outros pedidos seguem saindo normalmente.
   O monitor do BKO ganha o alerta **`pedido_aguardando_conector`** ("N pedidos esperam o Conector 1.3.0 ou mais novo:
   atualize o Conector") e o sinal de vida devolve o mesmo aviso. Nada é recusado e nada se perde: quando o Conector é
   atualizado, os pedidos retidos saem na próxima consulta.
4. O piso geral de quem recebe pedidos (`VERSAO_PISO_PEDIDOS`, hoje 1.2.1, RN-INT-11) **não** sobe para 1.3.0: subir pararia
   também cadastro, preço e estoque (o 426 vale para todas as rotas de dados) por causa de uma parte dos pedidos.

## Alternativas consideradas
- **`/integracao/v2` do pedido**: limpo, mas obriga Hub a servir v1 e v2 ao mesmo tempo e não resolve o Conector antigo
  (continuaria pedindo v1). Rejeitada.
- **Subir o piso de pedidos para 1.3.0**: simples, mas para tudo (426 em todas as rotas de dados) até o cliente atualizar.
  Rejeitada; o filtro por pedido é uma linha no `selecionarPendentes`.
- **Quantidade na unidade vendida + fator**: o 1.2.x gravaria quantidade errada sem aviso. Rejeitada (risco 1).

## Consequências
- O Conector 1.3.0 (frente da nuvem, `apps/conector`) passa a mapear os campos novos para a tabela de entrada de pedidos do
  ERP (`db/conector/views-modelo.sql` ganha as colunas) e as 4 entidades novas de cadastro (árvore, unidades, endereços,
  transportadoras).
- `integracao.pedido_fila_erp` ganha `exige_conector text null` (banco-dados). O Vendedor publica os campos novos no
  `vendedor.pedido.aprovado@1` (aditivo) e guarda `quantidade_faturada` na unidade base.
- Teste obrigatório no domain do Hub: pedido com CX não é entregue a Conector 1.2.1 e é entregue a 1.3.0; pedido só com UN
  continua indo ao 1.2.1; a quantidade do item no `PedidoParaErp` é `quantidade_venda × fator`.
