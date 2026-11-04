# Vendedor — pré-venda e envio ao ERP pelo Hub (T-0053)

Referências: RF-VEN-03/05, RN-VEN-13/30/32/33, RN-INT-08/09, ADR 0007 (outbox e consumidores), decisão do Alexandre sobre cancelamento depois do envio (R-20261031-100601, opção b). Fluxo do pedido e da alçada: `pedido-e-aprovacao.md`.

## Fluxo de ponta a ponta

```
App (offline)                     API do Vendedor                         Hub (modulo-integracao)            Conector/ERP
─────────────                     ───────────────                         ───────────────────────            ────────────
Novo pedido ── push ─────────────► receber: alçada (RN-VEN-10)
                                   aprovado ─ vendedor.pedido.aprovado@1 ─► fila pedido_fila_erp (pendente) ─► GET /pedidos/pendentes
                                   em aprovação → Gestão decide ─ aprovado@1 ┘                                    │
                                                                                                                 ▼
                                   consumidor retorno_erp ◄─ integracao.pedido.retorno_erp@1 ◄─ POST /pedidos/{uuid}/retorno
                                   status + histórico "ERP" + status_alterado@1 (+ faturado@1)
App (pull) ◄── linha do pedido com status/numero_erp
Orçamento ── push (tipo=orcamento) ► receber: só totais do dia; `received`, sem alçada, sem evento, sem fila (RN-VEN-32)
Converter ── push (pedido novo, orcamento_origem_id) ► valida a validade e o dono; marca o orçamento; segue como pedido
```

## Retorno do ERP (pronto e ligado)
- Consumidor ÚNICO de `integracao.pedido.retorno_erp@1` em `api/retorno-erp.ts` (T-0053 + T-0054), registrado em `apiVendedor.consumidores`. As regras puras ficam em `domain/retorno-erp.ts`: `planejarRetornoErp` para o status e `itensDoFaturamento` para os itens, com saldo por sequência. Faturamento gravado, devolução e telas: `retorno-erp.md`.
- O pedido só anda para a frente (a ordem dos eventos não é garantida): `aprovado → enviado ao ERP → integrado → faturado parcial → faturado`; `rejeitado_erp` vale até `enviado ao ERP` (motivo vira `motivo_rejeicao` "Recusado pelo ERP: …"); `cancelado` vem só do ERP e vale do aprovado em diante (`motivo_cancelamento` "Cancelado no ERP: …"). Repetido/atrasado/pedido nunca enviado = ignorado com log sem dado pessoal.
- Cada transição grava `pedido_evento` com autor "ERP" (perfil `erp`) e publica `vendedor.pedido.status_alterado@1` (autor nulo). A 2ª nota parcial não muda o status (o banco não aceita `de = para`): só publica o faturado.
- `vendedor.pedido.faturado@1`: com `itens_faturados`, traduz a `sequencia` (1..n do pedido enviado) em `produto_id`; `faturado_total` sem itens e sem parcial antes = o pedido inteiro; Sem a migração do faturamento, `faturado_total` sem itens depois de parcial **não publica**: sem o acumulado por item, contaria em dobro. Com a migração, `FATURAMENTO_LIGADO` liga a tabela `pedido_faturamento` e esse caso fatura o saldo (`retorno-erp.md`).
- O contrato consumido é espelhado em `contracts/pre-venda.ts` (`RetornoErpConsumido`, `passthrough`), sem depender do pacote da integração.

## Orçamento (pronto atrás de repositório; liga com a 0013)
- Push `PedidoPush.tipo = 'orcamento'` (ausente = pedido). Orçamento: preço e totais do dia (RN-VEN-01/02), condição permitida (RN-VEN-14), desconto acima do bloqueio continua recusado (RN-VEN-10); **não** passa pela alçada, fica `received`, não publica evento (metas, Gestor e fila do ERP só veem pedido), expira em `orcamento.validade_dias` (padrão 7, de 1 a 90). Histórico: "Orçamento salvo, válido até dd/mm/aaaa; não reserva estoque nem consome crédito".
- RN-VEN-13: cliente inativo aceita só orçamento (o pedido é recusado com a orientação de salvar como orçamento).
- Converter (RF-VEN-03) é offline: o app cria um pedido novo (UUID do aparelho) com `orcamento_origem_id` e os mesmos itens/desconto/condição; o servidor confere dono, cliente, validade (no momento da conversão no aparelho, limitado a 7 dias antes da chegada) e se já converteu (`ORCAMENTO_JA_CONVERTIDO`; o mesmo pedido reenviado é idempotente). Preço e alçada são os do dia.
- Cancelar orçamento usa a rota de cancelar pedido, sem evento.
- Lista e detalhe (`GET /v1/vendedor/pedidos[/:id]`) trazem `tipo`, `validade_ate`, `situacao_orcamento` (aberto/expirado/convertido/cancelado, calculada no servidor), `orcamento_origem_id`, `convertido_pedido_id`.
- **Até a 0013**: `api/pre-venda.ts` usa `preVendaIndisponivel` em produção (push de orçamento/conversão recusado com `PRE_VENDA_INDISPONIVEL`, sem gravar nada) e o app só mostra a opção com o parâmetro `orcamento.ativo` (padrão desligado). Os testes usam `criarPreVendaEmMemoria()`. Com a 0013: implementar `RepositorioPreVenda` em SQL (mesma interface), apontar `usarPreVenda` para ela no `api/index.ts` e ligar `orcamento.ativo` na base demo.

### O que a 0013 precisa ter (pedido ao banco-dados)
- `vendedor.pedido.tipo text not null default 'pedido' check (tipo in ('pedido','orcamento'))`;
- `vendedor.pedido.validade_ate timestamptz` (check: `tipo = 'orcamento'` ⇔ `validade_ate is not null`);
- `vendedor.pedido.orcamento_origem_id uuid` (FK `(tenant_id, orcamento_origem_id)` → `vendedor.pedido (tenant_id, id)`; só em `tipo = 'pedido'`);
- `vendedor.pedido.convertido_pedido_id uuid` (FK idem; só em `tipo = 'orcamento'`) e índice único parcial `(tenant_id, orcamento_origem_id) where orcamento_origem_id is not null` (um pedido por orçamento);
- `vendedor.pedido_item.quantidade_faturada int not null default 0 check (>= 0)`;
- pull do pedido com as 4 colunas novas (já opcionais em `PedidoSyncSchema`); índice `(tenant_id, tipo, created_at desc)` para a lista; seed da demo com 1 orçamento aberto, 1 expirado e 1 convertido; parâmetros `orcamento.ativo = true` e `orcamento.validade_dias = 7` na demo.

## Telas
- **Campo**: Novo pedido ganha "Tipo: Pedido | Orçamento" (só com `orcamento.ativo`) e o botão "Salvar orçamento"; o detalhe mostra "Orçamento NNN", a situação (calculada offline pela validade) e "Converter em pedido" (vendedor dono, orçamento aberto); a lista mostra a situação do orçamento. Número do ERP no detalhe (já existia).
- **Gestão/BKO**: lista e gaveta mostram a situação do orçamento; título "Orçamento NNN".

## Fora desta parte (backlog)
Evento "enviado" do Hub (hoje o Vendedor vê `integrado` direto do `aprovado`), reenvio ao ERP pelo BKO, aba/filtro "Orçamentos" no BKO, PDF com o selo "Orçamento — válido até", crédito/estoque no orçamento.

## T-0071 — tela do orçamento no app Campo (04/11)
- **Detalhe do orçamento**: selo de validade ("Orçamento · até 10/11", "Vencido", "Virou pedido 000015") pela data civil no fuso do tenant (`validade_data` do pull; linha antiga usa `validade_ate`; na fila, criação + `orcamento.validade_dias`), tudo offline.
- **Transformar em pedido** (RN-VEN-18): cria um pedido NOVO na fila com `orcamento_origem_id`, copiando medida, ajustes do item e do pedido (no modo gravado), frete, endereço, condição, observação e visita; o preço não é copiado. Antes, `reconferirOrcamento` (domain) roda no aparelho: se preço, estoque, medida, alçada ou cliente mudaram, a folha "Mudou desde o orçamento" lista em português e pede confirmação; cliente bloqueado/incompleto só com orçamento.
- **Editar**: orçamento na fila edita offline; orçamento já recebido edita pela API (`PUT /v1/vendedor/orcamentos/:id` com `atualizado_em`), com sinal. **Duplicar** (inclusive vencido) reabre o rascunho com os mesmos ajustes. **PDF** sai com o título "Orçamento" e a validade. **Cancelar orçamento** usa `POST /v1/vendedor/orcamentos/:id/cancelar`.
