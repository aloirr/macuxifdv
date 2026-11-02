# ADR 0016 — Pedido ao ERP ampliado no v1: quantidade na unidade base e entrega condicionada à versão do Conector

- **Status**: aceita (2026-11-02, R-20261102-104149) · **emenda 1** (2026-11-02): frete sem valor (decisão R-20261102-105040,
  RN-VEN-16 nova) e medidas por tenant (R-20261102-111619, RN-CORE-19)
- **Data**: 2026-11-02
- **Tarefa**: T-0061 (spec do Alexandre R-20261102-093007), T-0060 (R-20261102-092329)
- **Autor**: engenheiro-software
- **Base**: RN-INT-08, RN-INT-09 (mudança compatível fica no `v1`), RN-INT-11 (política de versão), ADR 0013 (rotas do
  Conector), RN-VEN-15/16/17; desenho `docs/desenho/T-0061.md`

## Contexto
O pedido passa a ter medida de venda (a da unidade ou a embalagem, ex.: "CX c/ 12"; siglas cadastradas pelo tenant,
RN-CORE-19), desconto **ou** acréscimo por item e por pedido, frete (CIF ou FOB; no FOB, transportadora da lista ou digitada;
**sem valor de frete**, RN-VEN-16) e endereço de entrega. Tudo isso precisa chegar ao ERP pelo
`PedidoParaErp` (`GET /integracao/v1/pedidos/pendentes`). Os Conectores instalados (1.2.x) validam o pedido com o contrato da
versão deles e **descartam campos que não conhecem** (o `z.object` não é estrito). Dois riscos:
1. **Quantidade errada no ERP**: se `quantidade` passasse a ser "na unidade vendida", um Conector 1.2.x gravaria "2" (caixas)
   como 2 unidades.
2. **Pedido incompleto no ERP**: um Conector 1.2.x ignoraria a modalidade FOB e a transportadora, o endereço de entrega e o
   acréscimo — a NF-e sairia com o frete errado e a entrega iria para o endereço principal.

## Decisão
1. **Fica no `v1`** (RN-INT-09): só campos **opcionais** novos; nenhum campo existente muda de formato ou de sentido. Não há
   `/v2` nem nova versão de evento.
2. **Quantidade fora do Vendedor é sempre na unidade base.** `ItemPedidoErp.quantidade` continua sendo a quantidade na
   unidade base (hoje toda venda é UN, então nada muda para quem já integra). Campos novos do item: `unidade` (sigla da medida
   vendida, cadastrada no tenant, ex. `CX`), `fator` (quantidade de unidades da embalagem; 1 na medida da unidade),
   `quantidade_venda` (na medida vendida; `quantidade = quantidade_venda × fator`),
   `preco_tabela_cents` e `preco_unitario_venda_cents` (por unidade vendida), `desconto_pct`, `acrescimo_pct`,
   `acrescimo_cents`. `preco_unitario_cents` segue por unidade base (pode ser arredondado quando o preço da CX não divide pelo
   fator; `total_cents` do item é o valor que manda). Campos novos do pedido: `desconto_pct`, `acrescimo_pct`,
   `acrescimo_total_cents`, `frete` (formato do doc 06, "Bloco `frete`"; **sem valor**, o pedido nunca tem frete em R$ ou %):
   ```ts
   frete: { modalidade: 'CIF' }
        | { modalidade: 'FOB', transportadora:
              { tipo: 'cadastrada', id: uuid, external_id: string | null, nome: string, cnpj: string | null, telefone: string | null }
            | { tipo: 'digitada', nome: string, cnpj: string /* 14 dígitos */, telefone: string | null } }
   ```
   (os campos além de `tipo`/`id` na cadastrada são o retrato do aceite, para o ERP preencher o grupo da transportadora da
   NF-e sem outra consulta) e `endereco_entrega { external_id?, logradouro, numero, complemento, bairro, cidade, uf, cep }`.
   `total_cents` continua sendo o valor do pedido (sem frete; não existe `total_a_pagar_cents`).
   `ItemFaturado.quantidade` (retorno) também é na unidade base.
3. **Entrega condicionada à versão do Conector.** O domain do Hub calcula, na entrada da fila, `exigeConector(pedido)`:
   `'1.3.0'` quando o pedido usa algo que o 1.2.x perderia (fator > 1, acréscimo no item ou no pedido, frete FOB,
   endereço de entrega diferente do principal); senão `null`. CIF não exige: é o comportamento que o ERP já assume. Grava em `pedido_fila_erp.exige_conector`.
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
  e CIF continua indo ao 1.2.1; pedido FOB espera o 1.3.0; a quantidade do item no `PedidoParaErp` é `quantidade_venda × fator`.

## Emenda 1 (2026-11-02) — frete sem valor e medidas do tenant
- **Frete (R-20261102-105040, RN-VEN-16 nova)**: saem do contrato `frete.tipo` (R$/%), `frete.pct`, `frete.valor_cents` e
  `total_a_pagar_cents`. CIF = a empresa paga (sem transportadora); FOB = o cliente paga, transportadora **obrigatória**,
  cadastrada ou digitada (nome e CNPJ obrigatórios, telefone opcional). O Hub não inventa transportadora: FOB sem
  transportadora nunca chega à fila (o Vendedor recusa com `transportadora_obrigatoria`). Mapeamento para a NF-e (`modFrete`)
  é do ERP (doc 06).
- **Medidas (R-20261102-111619, RN-CORE-19)**: `unidade` do item é a sigla de uma medida cadastrada no tenant (`core.medida`);
  o formato no contrato não muda (texto). Na entrada (lotes de `produto` e `produto_unidade`), sigla não cadastrada ou inativa
  é linha com `referencia_ausente` (reprocessável, RN-INT-04), conferida pelo Hub com `core.medidas@1` (ADR 0012, via
  `ctx.consultar` do consumidor A7). O `v1` continua compatível: nenhum campo muda de formato.
