# PDF do pedido e do orçamento: versão final (T-0159, v1.0.4)

Aprovação: proposta 2 (compacta) com 4 ajustes, R-20261110-215816-alexandre; filial no cabeçalho das 4 versões, R-20261110-215722-gerente-projetos e R-20261110-220007-alexandre (RN-CORE-39: CNPJ e endereço da filial são obrigatórios; o cabeçalho usa sempre a filial de faturamento). Versão: v1.0.4 (R-20261110-212147-gerente-projetos).
Histórico das 3 propostas: `pdf-pedido-propostas.md` (1 e 3 descartadas).
Imagens finais (A4, 1588 × 2246 px; as marcas são fictícias):
- `telas/T-0159-pdf-proposta-2-cliente.html/png`: pedido, versão do cliente;
- `telas/T-0159-pdf-proposta-2-escritorio.html/png`: pedido, versão do escritório, **com** Alertas;
- `telas/T-0159-pdf-proposta-2-orcamento-cliente.html/png`: orçamento, versão do cliente;
- `telas/T-0159-pdf-proposta-2-orcamento-escritorio.html/png`: orçamento só salvo, versão do escritório, **sem** Alertas e sem Histórico.

Código: `modules/vendedor/domain/pdf-pedido.ts` (`buildOrderPdfHtml`, `pdfDoPedido`). Depois do push do lote v1.0.3, nunca antes.

## 1. Os 4 ajustes sobre a proposta 2
1. Emb. e Qtd separadas (§3).
2. Marca depois da Descrição (§2 linha 7; §4 Marca).
3. Orçamento sem Alertas (§2 linha 6; §4 Alertas).
4. Filial de faturamento no cabeçalho das 4 versões e sem a célula Filial na ficha (§2 linhas 2 e 5; §3 Filial).

## 2. Ordem do documento
| # | Bloco | Cliente | Escritório |
|---|---|---|---|
| 1 | Cabeçalho, à esquerda: logo + nome da distribuidora | sim | sim |
| 2 | Cabeçalho, 2 linhas abaixo do nome: `<nome da filial> · CNPJ <cnpj> · <telefone>` e `<endereço completo com CEP>` | sim | sim (igual) |
| 3 | Cabeçalho, à direita: `PEDIDO 000014` ou `ORÇAMENTO 000015` + data | sim | sim, com "· uso interno" no rótulo |
| 4 | Ficha em grade: Cliente (razão social · fantasia) · CNPJ/CPF | sim | sim, "CNPJ · código" com o código do cliente |
| 5 | Ficha: Entrega (frete + endereço de entrega) · Pagamento · Vendedor | sim | sim, mais Tabela (sem "Filial": está no cabeçalho) |
| 6 | Faixa **Alertas** | nunca | só no pedido; sem alerta, não sai |
| 7 | Tabela de itens | Código · Descrição · Marca · Emb. · Qtd · Preço unit. R$ · Total R$ | Código · Descrição · Marca · Emb. · Qtd · Tabela · Desc./Acr. · Líquido · Total |
| 8 | Totais no rodapé da tabela | "Total" | Tabela · Desconto (ou Acréscimo) x,x% − R$ y · Total |
| 9 | Nota | "Valores sem impostos. Preço e estoque confirmados no faturamento." | não sai |
| 10 | Faixa **Histórico** (uma linha com setas) | nunca | sim, com 2 etapas ou mais; só "Salvo", não sai |

## 3. Textos e formatos
- **Nome do arquivo e `<title>`:** `PED-XXXX-DDMMAAAA` / `ORC-XXXX-DDMMAAAA` (RN-VEN-41, `orderPdfFileName`); sem número, `PROV`. O mesmo nas duas versões.
- **Rótulo do documento:** "Pedido" / "Orçamento"; no escritório, "Pedido · uso interno" / "Orçamento · uso interno". Número como na tela (`000014`). Sem número (ainda na fila do aparelho): só o rótulo e a data; o aparelho nunca inventa número.
- **Data do cabeçalho:** a de emissão, no fuso do tenant (`DD/MM/AAAA`). Orçamento com preço renovado (editado depois do prazo, RN-VEN-18): `10/11/2026 · preço de 14/11/2026`; com o preço do mesmo dia, só a data.
- **Filial no cabeçalho (as 4 versões):** 2 linhas em 7,5 pt, cinza #4A5562, abaixo do nome da distribuidora:
  - linha 1: `Filial Boa Vista · CNPJ 12.345.678/0002-71 · (95) 3224-1000` (nome como está no cadastro, sem rótulo à frente; CNPJ com máscara, `formatCnpj`; telefone com máscara `(DD) NNNN-NNNN` ou `(DD) NNNNN-NNNN`);
  - linha 2: `Rua Cecília Brasil, 450, Sala 2 · Centro · Boa Vista/RR · CEP 69301-380` (endereço completo: logradouro, número e complemento separados por vírgula; bairro; cidade/UF; CEP com máscara `NNNNN-NNN`).
  - Cada parte só sai se existir, sem separador solto; linha sem nenhuma parte não sai. Telefone é opcional. CNPJ e endereço são obrigatórios no cadastro (RN-CORE-39), mas o pedido antigo, sem retrato, sai só com o nome da distribuidora.
  - Sem rótulo "Emitente", "Faturado por" ou parecido: o nome da filial já identifica.
- **Emb.:** coluna própria, alinhada à esquerda, com a sigla e o fator de `unit_label` (`UN`, `FD c/ 10`); vazio = `UN`. **Qtd:** inteiro, sem sigla, alinhada à direita. Some a coluna "Medida" do PDF de hoje.
- **Desc./Acr. (escritório):** `−15,0%`, `+10,0%` ou `—`.
- **Alertas (pedido, escritório):** uma linha curta por alerta, com os mesmos textos da tela (RN-VEN-42, `alertasDoPedido`); o PDF não calcula alerta.
- **Histórico (escritório):** `10/11 05:55 Salvo → 10/11 05:56 Enviado → 10/11 05:58 Rejeitado`; a última etapa em negrito; nome só na etapa feita por outra pessoa que não o vendedor (RN-VEN-30). Orçamento: `Salvo`, `Transformado em pedido nº`, `Cancelado`. Só com 2 etapas ou mais: só `Salvo` (o caso comum do orçamento e do pedido ainda não enviado), a faixa não sai.
- **Continua fora:** "Gerado pelo/em", selo de situação, alçada, "Desconto efetivo", "Motivo da pendência" fora dos Alertas, endereço do cadastro do cliente, "por conta da empresa/do cliente" no frete, % ou a palavra desconto na versão do cliente.

## 4. Mapeamento campo a campo (para o modulo-vendedor)
"Hoje" = já existe em `OrderPdfOrder`/`DetalheParaPdf`. "Novo" = campo a criar (aditivo e opcional; ausente = o pedido antigo sai sem a informação).

| Campo no PDF | Versão | Origem | Situação |
|---|---|---|---|
| Logo | as duas | parâmetro do tenant (imagem), modulo-core | novo; sem logo, só o nome |
| Nome da distribuidora | as duas | `ctx.tenant_name` (`nomeDaDistribuidora`) | hoje |
| Nome da filial (cabeçalho) | as 4 | `order.branch_name`, preenchido com o `nome` do retrato da filial (sync `pedido.filial`, T-0149). Um campo só: não criar `filial.nome` em paralelo | hoje |
| CNPJ da filial (cabeçalho) | as 4 | `order.filial.cnpj` (retrato do pedido, `modules/vendedor/contracts/index.ts`) ← `FilialSync`/`core.filiais@1` `cnpj` (`FilialDadosFiscaisSchema`, `modules/core/contracts/filial.ts`) ← ERP (`integracao.filial.atualizado@1`) | novo (contratos já aditivos) |
| Endereço da filial (cabeçalho) | as 4 | `order.filial` { `logradouro`, `numero`, `complemento`, `bairro`, `cidade`, `uf`, `cep` }, mesma cadeia | novo (`cidade`/`uf` já existiam) |
| Telefone da filial (cabeçalho) | as 4 | `order.filial.telefone`, mesma cadeia; opcional | novo |
| Pedido/Orçamento | as duas | `order.tipo` | hoje |
| Número | as duas | `order.number` (null na fila) | hoje |
| Data | as duas | `order.created_at` no fuso `ctx.tz`; `order.preco_data` no orçamento (RN-VEN-18) | hoje |
| Cliente (razão · fantasia) | as duas | `order.customer.legal_name` / `trade_name` | hoje |
| CNPJ/CPF do cliente | as duas | `order.customer.cnpj` (`documentoCliente`) | hoje |
| Código do cliente | escritório | `order.customer.erp_code` | hoje |
| Entrega | as duas | `order.freight.modality` (+ transportadora e CNPJ no FOB) + `order.delivery_address` | hoje (o texto muda: sem "por conta de") |
| Pagamento | as duas | `order.payment_terms` | hoje |
| Vendedor | as duas | `order.seller_name` | hoje |
| Tabela | escritório | `priceTableLabel(order.price_table, order.price_table_name)` | hoje |
| Alertas | escritório, só pedido | a mesma lista da tela, `alertasDoPedido` (RN-VEN-42), passada pronta ao PDF; `order.tipo === 'orcamento'` não imprime | novo campo de entrada (lista de textos) |
| Código | as duas | `item.erp_code` | hoje |
| Descrição | as duas | `item.description` (+ "Aplicação:" e "Equivale a:" como hoje, abaixo da descrição) | hoje |
| Marca | as duas | `item.brand`: retrato gravado no recebimento a partir do cadastro do produto (`produto.marca`, Core/ERP), como `application` (RN-VEN-19). Nulo/ausente ou pedido antigo: célula vazia | novo no item do pedido (`brand` já no contrato) |
| Emb. | as duas | `item.unit_label` (`UN`, `FD c/ 10`) | hoje (vira coluna própria) |
| Qtd | as duas | `item.quantity` | hoje |
| Preço unit. R$ | cliente | `netUnitCents(item)` | hoje |
| Total R$ do item | as duas | `item.total_cents` | hoje |
| Tabela (preço) | escritório | `item.unit_price_cents` | hoje |
| Desc./Acr. | escritório | `item.discount_pct` / `item.surcharge_pct` | hoje |
| Líquido | escritório | `netUnitCents(item)` | hoje |
| Tabela (total) | escritório | `order.subtotal_cents` | hoje |
| Desconto/Acréscimo do pedido | escritório | `descontoDoPedidoPct` + `order.discount_cents` (uma linha, % e R$) | hoje (corrige o D-T0150-1) |
| Total | as duas | `order.total_cents` | hoje |
| Histórico | escritório | `order.history` (`statusText`) | hoje |

O retrato da filial é do pedido: se o cadastro da filial mudar depois, o PDF de um pedido antigo continua com o CNPJ e o endereço da data do pedido.

## 5. Casos de teste (para o testes e o corretor)
1. Pedido e orçamento da filial **Boa Vista**, nas 4 versões: cabeçalho com o nome, o CNPJ, o endereço completo (com CEP) e o telefone de Boa Vista; nenhum dado da matriz nem do tenant no HTML.
2. Filial sem telefone: a linha 1 termina no CNPJ, sem `·` sobrando. Pedido antigo sem retrato da filial: só o nome da distribuidora, sem linha vazia.
2a. Escritório: a ficha não tem a célula "Filial"; o nome da filial aparece uma vez só no HTML (no cabeçalho).
3. **Orçamento** com alerta (desconto acima do máximo): nenhuma das duas versões tem "Alertas".
4. Pedido com alerta: só o escritório tem a faixa; o cliente não.
5. Item `FD c/ 10` com 1: "Emb." = `FD c/ 10`, "Qtd" = `1`; nenhuma célula de Qtd com letra.
6. Produto sem marca: célula vazia, coluna mantida.
7. Versão do cliente sem `%` e sem a palavra "desconto" (regra atual).
8. Nome do arquivo: `PED-0014-10112026` e `ORC-0015-10112026`.
9. Orçamento só salvo: escritório sem faixa Histórico. Pedido salvo, enviado e rejeitado: escritório com as 3 etapas.
10. Rodapé dos totais: "Total" nas 4 versões; nenhuma tem "Total do pedido" nem "Total do orçamento".
