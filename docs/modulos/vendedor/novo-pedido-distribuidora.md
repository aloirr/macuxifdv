# Vendedor — novo pedido de distribuidora (T-0061)

> Regras: RN-VEN-02, 03, 10, 11, 15, 16 e 17 (doc 03). Desenho dos contratos: `docs/desenho/T-0061.md`. Schema: migração 0013.
> Implementado na frente nuvem (`nuvem/T-0061-pedido-3-abas`).

## O que o vendedor faz (app Campo, offline-first)
Novo pedido em **3 abas**, com o **total fixo no rodapé** (botão Enviar sempre visível):
1. **Itens** — busca local; cada produto mostra uma linha por medida (UN e, se houver, CX c/ N) com `−`/`+` de 48 dp; toque em
   "Desconto ou acréscimo" abre o ajuste do item (desconto OU acréscimo). Adicionar um item = 2 toques (buscar, `+`); CX = o mesmo.
2. **Condições** — desconto OU acréscimo do pedido, prazo (RN-VEN-14), tipo (pedido/orçamento, se ligado), **frete CIF/FOB**
   (FOB: transportadora da lista ou "Outra (digitar)" com nome e CNPJ) e observação.
3. **Entrega e resumo** — endereço de entrega (principal por padrão, ou um de entrega do cliente) e o resumo com desconto efetivo,
   frete e prazo.

Tudo vem das linhas locais do sync: `produto_unidade` e `cliente_endereco` (Core), `transportadora` (Vendedor), `tabela_preco`
(Catálogo). Sem essas linhas o pedido segue só em UN, com o endereço do cadastro. O rascunho guarda `ajustes` por linha, `acrescimo_pct`,
`frete` e `endereco_entrega_id`; a chave da linha é `produto` (unidade base) ou `produto@CX` (embalagem), então rascunhos antigos continuam
válidos.

## Regras no domain (`modules/vendedor/domain/preco-pedido.ts`, testes em `preco-pedido.test.ts`)
- `precoDoItem`: preço da CX = UN × fator (preço próprio da CX é opcional e está na fila de corte); desconto **ou** acréscimo; meia para cima por
  linha, em centavos; devolve `quantidade_base` e o mínimo (RN-VEN-11) na medida vendida.
- `totaisDoPedido`: ajuste do pedido (desconto **ou** acréscimo) distribuído por linha (a soma das linhas = total) e **desconto efetivo**
  = 1 − total após descontos e acréscimos ÷ total pela tabela, **sem frete** (RN-VEN-03); negativo = acréscimo.
- `nivelDeAprovacao`: a alçada olha **só o efetivo** (RN-VEN-10): item com 30% e pedido com 5% efetivo → sem aprovação; efetivo ≤ 0 nunca
  vai para aprovação. Há uma folga de arredondamento de 1 centavo por linha só na alçada, para um pedido pequeno com exatamente 5% não virar 5,1%.
- `validarFrete` (RN-VEN-16): CIF sem transportadora; FOB com cadastrada **xor** digitada (nome ≥ 2, CNPJ com dígito verificador).
  `modalidadePadraoDosParametros`: parâmetro `frete.modalidade_padrao` (padrão CIF).
- `resolverEnderecoEntrega` (RN-VEN-17), `resolverUnidadeDoItem` (o fator vem do Core, nunca do aparelho), `rotuloMedida` ("UN", "CX c/ 12"),
  `precoMinimoBaseCents`/`descontoMaximoDoItemPct`/`itemRespeitaPrecoMinimo` (RN-VEN-11).

## API (`/v1/vendedor`)
- **Push do pedido** (`receber.ts`): `PedidoPush` ganha `items[].unidade/desconto_pct/acrescimo_pct`, `acrescimo_pct`, `frete`,
  `endereco_entrega_id`. A API revalida tudo pelo domain (`revalidarPedido`): fator do Core (`core.cadastro_resumo@1`), unidade ativa,
  excludência desconto × acréscimo, alçada pelo efetivo, frete (padrão do tenant quando ausente), transportadora ativa do tenant,
  endereço do cliente. Recusas novas (422, item `rejeitado`): `unidade_invalida`, `endereco_invalido`, `transportadora_obrigatoria`,
  `transportadora_invalida`, `desconto_e_acrescimo`, `preco_abaixo_minimo`. Idempotente como antes (hash do envio inclui os campos novos).
- **Gravação**: `pedido` (`acrescimo_pct`, `desconto_efetivo_pct`, `frete_modalidade`, `transportadora_*` como retrato, `endereco_entrega_id`
  + `endereco_entrega` jsonb) e `pedido_item` (`unidade` vendida, `fator`, `acrescimo_pct`; `desconto_pct` do item é o do item). O
  `total_cents` de cada item já inclui o ajuste do pedido (a soma fecha com o total).
- **Evento `vendedor.pedido.aprovado@1`** (aditivo, `api/aprovado-erp.ts`, usado no aceite automático e na aprovação por decisão):
  `quantidade` = unidade **base**; `unidade`, `fator`, `quantidade_venda`, `preco_tabela_cents`, `desconto_pct`, `acrescimo_pct`,
  `acrescimo_cents` por item; `desconto_pct`, `acrescimo_pct`, `acrescimo_total_cents`, `frete` (CIF ou FOB com transportadora cadastrada/
  digitada, sem valor) e `endereco_entrega` (com `principal`) no pedido. Orçamento nunca publica.
- **Detalhe** (`OrderDetail`): item `unit`, `factor`, `base_quantity`, `unit_label`, `surcharge_pct`; pedido `surcharge_pct`,
  `effective_discount_pct`, `freight`, `delivery_address`, `price_table_name` (ver pendências). A alçada e o texto de pendência usam o efetivo.
- **Sync**: colunas novas no pull de `pedido` e `pedido_item`; entidade nova `transportadora` (tenant, só pull).
- **Transportadoras no BKO**: `GET/POST /transportadoras`, `PUT|PATCH /transportadoras/:id` (editar, inativar/reativar; sem exclusão), `GET
  /transportadoras/digitadas` (digitadas pelos vendedores ainda fora do cadastro), `GET /frete/parametros` (padrão CIF/FOB do tenant, **só leitura**: a escrita de `plataforma.parametro` é do Core, S0-014; recado ao modulo-core).
  Ações novas no manifesto: `transportadora.ver` (admin, analista, gerente, supervisor, assistente) e `transportadora.gerenciar` (admin,
  analista, gerente). Multi-tenant por RLS; escrita auditada; CNPJ com dígito verificador e único por
  tenant; transportadora vinda do ERP (`external_id`) não muda nome/CNPJ no BKO. Promotor sem nenhuma dessas ações.

## Telas
- **Campo e Gestão** (mesmo detalhe): itens com medida ("2 CX c/ 12 × R$ …") e desconto/acréscimo, acréscimo ou desconto do pedido,
  desconto efetivo, frete (CIF/FOB + transportadora + CNPJ) e endereço de entrega; PDF com coluna **Medida**, frete e endereço.
- **BKO**: gaveta do pedido com os mesmos campos; página **Transportadoras** (menu Cadastros) com busca na URL, CSV, cadastro/edição/
  inativação, digitadas para cadastrar e o padrão do frete (leitura).
- **PDFs** (`domain/pdf-pedido.ts`): coluna Medida nas duas versões; "Frete: CIF – por conta da empresa" ou "Frete: FOB – por conta do cliente ·
  <transportadora> (CNPJ …)"; endereço de entrega; interno com desconto/acréscimo por item, desconto efetivo (sem frete) e nome da tabela. A versão
  cliente continua sem `%` nem a palavra desconto.

## Testes
`domain/preco-pedido.test.ts`, `domain/revalidar-novo-pedido.test.ts`, `domain/pdf-pedido.test.ts`, `app/lib/novo-pedido.test.ts`,
`app/lib/pedidos.test.ts`, `api/novo-pedido.db.test.ts` (Postgres real: UN/CX, efetivo × alçada, frete, transportadora, endereço, evento ao ERP,
detalhe, pull, CRUD multi-tenant, promotor recusado), `api/leitura.test.ts` (perfis e licença das rotas novas), `web/lib/*.test.ts`.

## Fila de corte e pendências
Cortado/não feito nesta entrega: (1) transportadora vinda do ERP (o `external_id` já é respeitado no BKO e no evento, falta a ingestão do
Hub); (2) preço próprio da CX na tabela (hoje CX = UN × fator; o domain já aceita `preco_proprio_unidade_cents`); (4) chip "campanha" na
nova tela (o selo "Campanha" do produto continua). A lista das digitadas (3) **foi feita**. Pendentes de outros donos: edição do padrão do frete pelo BKO (rota do Core para `plataforma.parametro`); árvore/trilha do Catálogo
(T-0052), RN-VEN-11 na API depende de `preco_venda_cents`/`desconto_maximo_pct` no `core.cadastro_resumo@1` e no `ProdutoSync`, nome da tabela
de preço em `catalogo.precos_cliente@1`, número do pedido nos eventos (T-0065).

## T-0071 — fatia 6 (app Campo, 04/11)
- **Ajuste em % ou R$** no item (R$ por unidade da medida vendida) e no pedido (R$ sobre o total dos itens): `app/lib/novo-pedido.ts` usa o preço v2 do domain (arredondamento no unitário, rateio pelo maior resto, RN-VEN-02). O rascunho guarda `ajustes[chave].em` e `ajuste_em`/`desconto_valor_cents`/`acrescimo_valor_cents` no pedido; o push leva `desconto_unitario_cents`/`acrescimo_unitario_cents` (+ `ajuste_em: 'valor'`) e nunca % e R$ juntos. Referência: 398,30 → 379,79 (39830/1467/384/37979, 4,6%) com teste no app.
- **Aba Itens**: chip da medida ("FD c/ 12"), "R$ 17,90 → 17,01", equivalente ("−R$ 0,89" / "= 5,3%"), seletor Desc.|Acrésc. e %|R$ (a troca de modo leva o equivalente) e trilha do catálogo ("Mercearia › Bebidas") que abre a árvore do Catálogo só com os produtos da tabela do cliente.
- **Aba Detalhes (hoje: fim da aba Itens, T-0136)**: "Combina com o pedido" e "Leve mais" pela consulta `catalogo.sugestoes_pedido@1` (roda no aparelho) mais clientes parecidos e embalagem maior; "+" soma 1 UN, "⇄" troca pela embalagem maior (ajuste zerado).
- **Aba Resumo**: Descontos = tabela − total, faixa com o % de 1 casa calculado dos inteiros (4,6%), seletor %|R$ do pedido.
- Código: `app/lib/documento.ts` (cópia completa), `app/lib/sugestoes-pedido.ts`, `app/components/novo-pedido*.tsx`.

## T-0089 — aba Itens revisada, forma de pagamento e prazo, crédito do cliente (06/11)

Referência: `docs/produto/referencias/R-20261106-0703-alexandre-novo-pedido-itens-v2.png`; spec de UX: `docs/design/novo-pedido-itens.md`; desenho: `docs/desenho/T-0089.md`.

**Regras no `domain`** (funções puras, com teste que cita a RN):
- `domain/preco-item.ts` — RN-VEN-15 nova (`precoDaMedida`: embalagem = unidade × quantidade, sem preço de caixa) e RN-VEN-23 (`faixaAplicavel`, `precoBaseDoItem`, `proximaFaixa`, `faixasDaConsulta`). A base do item é o menor entre a tabela e a faixa (P4); a faixa vale só na medida dela (P3); o desconto incide sobre a base com a faixa e a faixa não entra na alçada (o "total pela tabela" já é o da faixa); o preço mínimo continua só travando o desconto (P5).
- `domain/pagamento.ts` — RN-VEN-24/25 (`prazoMedioDias` arredondado para cima: 28/56 = 42; `descricaoPrazo` sem "médio"; `formasDoCliente`, `prazosDaForma`, `pagamentoPadrao`, `validarPagamento`), RN-VEN-13 (`exigeAprovacaoPorVencido`, `tituloVencidoDias`, padrão 5) e RN-VEN-12 (`creditoDoCartao`). Cliente sem prazo médio = sem teto; lista de formas vazia = todas as ativas (P1).
- `revalidarPedido` recebe `faixas` (por produto) e `titulo_vencido`; título vencido com prazo a prazo manda o pedido para aprovação (nível supervisor, motivo `credito`: a coluna `motivos_aprovacao` só aceita os motivos da 0009).

**API (`/v1/vendedor`)**: pull de `forma_pagamento` e `prazo_pagamento` (tenant); `PedidoPush` com `forma_pagamento_id` e `prazo_pagamento_id` (os dois ou nenhum; sem eles vale a condição legada do APK anterior); `receber` e a edição do orçamento validam com `validarPagamento` (422 `RN-VEN-24`/`RN-VEN-25`), consultam `core.financeiro_cliente@1` (indisponível não bloqueia) e gravam o retrato (8 colunas juntas, 0037); `vendedor.pedido.aprovado@1` leva `pagamento?` e `condicao_pagamento_codigo` = código do prazo. Rotas do BKO `GET /formas-pagamento`, `PUT /formas-pagamento/:id`, `PUT /prazos-pagamento/:id` (ações `forma_pagamento.ver|gerenciar`: admin, analista, gerente; promotor nunca) e a consulta `vendedor.formas_pagamento@1`. `api/formas-erp.ts` aplica forma e prazo vindos do Hub (adota pelo código a `AVISTA` semeada; a apagada não volta); o registro dos consumidores espera os contratos `integracao.forma_pagamento|prazo_pagamento.atualizado@1`.

**App (aba Itens)**: sem rodapé fixo; card de pagamento (Forma e Prazo em lista suspensa, só o texto do prazo, desabilitado o que passa do prazo médio do cliente) com "Total do pedido · n itens" logo abaixo; item em 3 linhas (código · nome · embalagem / aplicação / UN|CX, − n +, desconto sempre aberto com o tipo) e "Valor total:" à direita. Aba **Detalhes**: Crédito do cliente (`core.financeiro_cliente@1`, offline, alerta de inadimplência, data da última sincronização) · Frete · Entrega · Observações · Leve mais e pague menos (some enquanto o Catálogo não publica `faixas`) · Combina com o pedido. O "Leve mais" antigo (troca por embalagem maior) saiu de Detalhes: sem preço de caixa não há vantagem a mostrar.

**BKO**: Formas de pagamento e prazos (lista por forma com os prazos e o prazo médio, busca e situação na URL, CSV, criar/editar/inativar).

## T-0136 — Novo pedido em 4 abas: Venda · Itens (n) · Entrega · Resumo (RF-VEN-11, 08/11)
Substitui as 3 abas (Itens · Detalhes · Resumo) acima. A tela abre na **Venda**; vale no Campo e no Gestão (pedido em nome), em Novo pedido, Editar orçamento e Editar pedido, tudo do aparelho (offline).
- **Venda** (`AbaVenda`): caixa **Alertas** (domain `alertasDaVenda`, `domain/alertas-venda.ts`: bloqueado, inativo, cadastro incompleto, título vencido com quantidade/valor/dias, crédito excedido; erro antes de aviso; textos em `app/lib/textos-venda.ts`). Sem alerta, uma linha: "Cliente liberado · sem título vencido". Depois Forma de pagamento e Prazo (RN-VEN-24/25), Limite (total e disponível), Prazo médio do cliente e "Atualizado ..." (data da última sincronização). O prazo médio saiu do cabeçalho.
- **Itens (n)** (`Itens (0)` no início): total do pedido, busca, árvore do Catálogo e itens, como antes, sem o card de forma e prazo; no fim, **Leve mais e pague menos** e **Combina com o pedido** (`FimDaAbaItens`).
- **Entrega** (`AbaEntrega`): endereço de entrega (RN-VEN-17), frete CIF/FOB só com a frase da modalidade ("CIF: frete incluso no preço" / "FOB: transportadora ...") e transportadora no FOB, sem valor de frete (RN-VEN-16), e Observações.
- **Resumo**: inalterado nesta frente (refeito na T-0137).
- **Pendências** (RN-CORE-36): forma e prazo apontam a "aba Venda"; itens, a "aba Itens"; FOB sem transportadora e CNPJ, a "aba Entrega". A bolinha fica na aba da correção; o Resumo nunca a recebe. O voltar do Android percorre Resumo → Entrega → Itens → Venda e só então sai (RN-VEN-38).
- **Toques do pedido mais simples** (cliente sem alerta, CIF, 1 item): ver o recado de entrega da T-0136.
