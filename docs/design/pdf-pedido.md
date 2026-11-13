# PDF do pedido e do orçamento: versão final horizontal (T-0159, v1.0.4)

Aprovação: proposta 2 (compacta) com 4 ajustes, R-20261110-215816-alexandre; filial no cabeçalho das 4 versões, R-20261110-215722-gerente-projetos e R-20261110-220007-alexandre (RN-CORE-39: CNPJ e endereço da filial são obrigatórios; o cabeçalho usa sempre a filial de faturamento). **Visual horizontal**, R-20261111-084832-alexandre; Alertas fora de todos os PDFs, R-20261111-085235-alexandre; **v3** (vale esta): coluna Item e itens em ordem do código, R-20261111-085828-alexandre; observações abaixo dos itens, sempre visíveis, R-20261111-090118-alexandre e R-20261111-094836-alexandre; espaço dobrado acima e abaixo da tabela, R-20261111-090759-alexandre. Conteúdo e regras: §2 a §5; medidas, cores e tokens: §6.
Histórico das 3 propostas: `pdf-pedido-propostas.md` (1 e 3 descartadas).
Imagens finais (A4 paisagem, 2246 × 1588 px; as marcas são fictícias):
- `telas/T-0159-pdf-horizontal-cliente.html/png`: pedido, versão do cliente, com as 2 observações;
- `telas/T-0159-pdf-horizontal-escritorio.html/png`: pedido, versão do escritório, com as 2 observações e o Histórico;
- `telas/T-0159-pdf-horizontal-orcamento-cliente.html/png`: orçamento, versão do cliente, só com a Observação do pedido (a da entrega sai com o rótulo e em branco);
- `telas/T-0159-pdf-horizontal-orcamento-escritorio.html/png`: orçamento só salvo, versão do escritório, com as 2 observações em branco e sem Histórico.

As imagens `telas/T-0159-pdf-proposta-2-*` (A4 retrato) ficam só como histórico.

Código: `modules/vendedor/domain/pdf-pedido.ts` (`buildOrderPdfHtml`, `pdfDoPedido`).

## 1. Os ajustes sobre a proposta 2
1. Emb. e Qtd separadas (§3).
2. Marca depois da Descrição (§2 linha 7; §4 Marca).
3. Alertas fora de **todos** os PDFs: pedido e orçamento, cliente e escritório (§2 linha 6). Ficam só nas telas.
4. Filial de faturamento no cabeçalho das 4 versões e sem a célula Filial na ficha (§2 linhas 2 e 5; §3 Filial).
5. Observação do pedido e Observação da entrega abaixo dos itens, à esquerda da caixa do Total, sempre visíveis, nas 4 versões (§2 linha 8; §3 Observações).
6. Coluna Item (1, 2, 3…) e itens em ordem alfabética do código, só no PDF (§2 linha 7; §3 Item).
7. A4 paisagem, fontes maiores, ficha cinza, cabeçalho da tabela verde, espaço dobrado acima e abaixo da tabela, Total em caixa e logo sempre presente (§6).

## 2. Ordem do documento
| # | Bloco | Cliente | Escritório |
|---|---|---|---|
| 1 | Cabeçalho, à esquerda: logo (sempre, §6.5) + nome da distribuidora | sim | sim |
| 2 | Cabeçalho, 2 linhas abaixo do nome: `<nome da filial> · CNPJ <cnpj> · <telefone>` e `<endereço completo com CEP>` | sim | sim (igual) |
| 3 | Cabeçalho, à direita: `PEDIDO 000014` ou `ORÇAMENTO 000015` + data | sim | sim, com "· uso interno" no rótulo |
| 4 | Ficha em grade: Cliente (razão social · fantasia) · CNPJ/CPF | sim | sim, "CNPJ · código" com o código do cliente |
| 5 | Ficha: Entrega (frete + endereço de entrega) · Pagamento · Vendedor | sim | sim, mais Tabela na mesma célula do Vendedor (sem "Filial": está no cabeçalho) |
| 6 | Alertas | nunca | nunca |
| 7 | Tabela de itens, em ordem do código | Item · Código · Descrição · Marca · Emb. · Qtd · Preço unit. R$ · Total R$ | Item · Código · Descrição · Marca · Emb. · Qtd · Tabela · Desc./Acr. · Líquido · Total |
| 8 | Abaixo da tabela, à esquerda: Observação do pedido e, embaixo, Observação da entrega | sim, sempre | sim, sempre |
| 9 | Abaixo das observações, à esquerda: nota | "Valores sem impostos. Preço e estoque confirmados no faturamento." | não sai |
| 10 | Abaixo das observações, à esquerda: **Histórico** (uma linha com setas) | nunca | sim, com 2 etapas ou mais; só "Salvo", não sai |
| 11 | Abaixo da tabela, à direita: caixa do Total | "Total" | Tabela · Desconto (ou Acréscimo) x,x% − R$ y, um traço, Total |

## 3. Textos e formatos
- **Nome do arquivo e `<title>`:** `PED-XXXX-DDMMAAAA` / `ORC-XXXX-DDMMAAAA` (RN-VEN-41, `orderPdfFileName`); sem número, `PROV`. O mesmo nas duas versões.
- **Rótulo do documento:** "Pedido" / "Orçamento"; no escritório, "Pedido · uso interno" / "Orçamento · uso interno". Número como na tela (`000014`). Sem número (ainda na fila do aparelho): só o rótulo e a data; o aparelho nunca inventa número.
- **Data do cabeçalho:** a de emissão, no fuso do tenant (`DD/MM/AAAA`). Orçamento com preço renovado (editado depois do prazo, RN-VEN-18): `10/11/2026 · preço de 14/11/2026`; com o preço do mesmo dia, só a data.
- **Filial no cabeçalho (as 4 versões):** 2 linhas em 13 px, `--pdf-tinta-2`, abaixo do nome da distribuidora:
  - linha 1: `Filial Boa Vista · CNPJ 12.345.678/0002-71 · (95) 3224-1000` (nome como está no cadastro, sem rótulo à frente, **sem o código da filial e sem `/UF`**: o código não serve ao cliente e a cidade/UF já está na linha 2; nunca `0002 · Filial Boa Vista/RR`, D-T0159-5; CNPJ com máscara, `formatarDocumento` de `@macuxi/comum`; telefone com máscara `(DD) NNNN-NNNN` ou `(DD) NNNNN-NNNN`). Sem nome no retrato, a linha começa no CNPJ;
  - linha 2: `Rua Cecília Brasil, 450, Sala 2 · Centro · Boa Vista/RR · CEP 69301-380` (endereço completo: logradouro, número e complemento separados por vírgula; bairro; cidade/UF; CEP com máscara `NNNNN-NNN`).
  - Cada parte só sai se existir, sem separador solto; linha sem nenhuma parte não sai. Telefone é opcional. CNPJ e endereço são obrigatórios no cadastro (RN-CORE-39), mas o pedido antigo, sem retrato, sai só com o nome da distribuidora.
  - Sem rótulo "Emitente", "Faturado por" ou parecido: o nome da filial já identifica.
- **Observações (as 4 versões):** rótulos "Observação do pedido" e "Observação da entrega", uma embaixo da outra, **sempre**: vazia (ou só com espaços) sai o rótulo com uma linha em branco, para escrever à mão. O texto em negrito, como foi digitado, sem corte (quebra a linha; mantém as quebras digitadas). A linha automática do cadastro incompleto (RN-CORE-17) não entra.
- **Item:** 1, 2, 3… na ordem do PDF. A ordem do PDF é a alfabética do **código** (`erp_code`), comparada com `localeCompare(…, 'pt-BR', { numeric: true })` (`AGU-2` antes de `AGU-10`); código vazio vai para o fim; empate mantém a ordem do pedido. No app e no BKO a ordem não muda.
- **Emb.:** coluna própria, alinhada à esquerda, com a sigla e o fator de `unit_label` (`UN`, `FD c/ 10`); vazio = `UN`. **Qtd:** inteiro, sem sigla, alinhada à direita. Some a coluna "Medida" do PDF de hoje.
- **Desc./Acr. (escritório):** `−15,0%`, `+10,0%` ou `—`.
- **Histórico (escritório):** `10/11 05:55 Salvo → 10/11 05:56 Enviado → 10/11 05:58 Rejeitado`; a última etapa em negrito; nome só na etapa feita por outra pessoa que não o vendedor (RN-VEN-30). Orçamento: `Salvo`, `Transformado em pedido nº`, `Cancelado`. Só com 2 etapas ou mais: só `Salvo` (o caso comum do orçamento e do pedido ainda não enviado), o Histórico não sai.
- **Continua fora:** "Gerado pelo/em", selo de situação, alçada, "Desconto efetivo", Alertas (inclusive "Motivo da pendência"), endereço do cadastro do cliente, "por conta da empresa/do cliente" no frete, % ou a palavra desconto na versão do cliente.

## 4. Mapeamento campo a campo (para o modulo-vendedor)
"Hoje" = já existe em `OrderPdfOrder`/`DetalheParaPdf`. "Novo" = campo a criar (aditivo e opcional; ausente = o pedido antigo sai sem a informação).

| Campo no PDF | Versão | Origem | Situação |
|---|---|---|---|
| Logo | as 4 | logo cadastrada do tenant (parâmetro, modulo-core; `ctx.logo_src`); sem ela (e enquanto o campo não existir no BKO), a do app, `apps/mobile/assets/images/icon.png`, embutida como data URI (`LOGO_PADRAO_DATA_URI`) | novo; **nunca sem imagem** |
| Nome da distribuidora | as 4 | `ctx.tenant_name` (`nomeDaDistribuidora`) | hoje |
| Nome da filial (cabeçalho) | as 4 | o `nome` do retrato da filial (sync `pedido.filial.nome`, T-0149), puro: **não** o `order.branch_name`, que é o rótulo `0002 · Boa Vista/RR` (`nomeDaFilialDoPedido`) da linha Filial do detalhe e do filtro do BKO e continua igual. Sugestão: `order.filial.nome` (aditivo e opcional, na mesma cadeia de `cidade`/`uf`), sem campo novo fora do retrato (D-T0159-5) | hoje (o PDF passa a ler o nome, não o rótulo) |
| CNPJ da filial (cabeçalho) | as 4 | `order.filial.cnpj` (retrato do pedido, `modules/vendedor/contracts/index.ts`) ← `FilialSync`/`core.filiais@1` `cnpj` (`FilialDadosFiscaisSchema`, `modules/core/contracts/filial.ts`) ← ERP (`integracao.filial.atualizado@1`) | novo (contratos já aditivos) |
| Endereço da filial (cabeçalho) | as 4 | `order.filial` { `logradouro`, `numero`, `complemento`, `bairro`, `cidade`, `uf`, `cep` }, mesma cadeia | novo (`cidade`/`uf` já existiam) |
| Telefone da filial (cabeçalho) | as 4 | `order.filial.telefone`, mesma cadeia; opcional | novo |
| Pedido/Orçamento | as 4 | `order.tipo` | hoje |
| Número | as 4 | `order.number` (null na fila) | hoje |
| Data | as 4 | `order.created_at` no fuso `ctx.tz`; `order.preco_data` no orçamento (RN-VEN-18) | hoje |
| Cliente (razão · fantasia) | as 4 | `order.customer.legal_name` / `trade_name` | hoje |
| CNPJ/CPF do cliente | as 4 | `order.customer.cnpj` (`documentoCliente`) | hoje |
| Código do cliente | escritório | `order.customer.erp_code` | hoje |
| Entrega | as 4 | `order.freight.modality` (+ transportadora e CNPJ no FOB) + `order.delivery_address` | hoje (o texto muda: sem "por conta de") |
| Pagamento | as 4 | `order.payment_terms` | hoje |
| Vendedor | as 4 | `order.seller_name` | hoje |
| Tabela | escritório | `priceTableLabel(order.price_table, order.price_table_name)` | hoje |
| Observação do pedido | as 4 | `observacao` do pedido (`PedidoPush.observacao`, já gravada) | hoje no pedido; novo no PDF |
| Observação da entrega | as 4 | campo próprio da entrega, separado da observação do pedido, na aba Entrega (app, sync, banco e BKO), pedido em R-20261111-094836-alexandre ao modulo-vendedor e ao banco-dados. O campo entra na v1.0.5 (R-20261111-092649-gerente-projetos); até lá, nas 4 versões, sai o rótulo com a linha em branco | novo (v1.0.5) |
| Item | as 4 | posição do item depois de ordenar por `item.erp_code` (§3 Item); calculado no PDF | novo (só apresentação) |
| Código | as 4 | `item.erp_code` | hoje |
| Descrição | as 4 | `item.description` (+ "Aplicação:" e "Equivale a:" como hoje, abaixo da descrição) | hoje |
| Marca | as 4 | `item.brand`: retrato gravado no recebimento a partir do cadastro do produto (`produto.marca`, Core/ERP), como `application` (RN-VEN-19). Nulo/ausente ou pedido antigo: célula vazia | novo no item do pedido (`brand` já no contrato) |
| Emb. | as 4 | `item.unit_label` (`UN`, `FD c/ 10`) | hoje (vira coluna própria) |
| Qtd | as 4 | `item.quantity` | hoje |
| Preço unit. R$ | cliente | `netUnitCents(item)` | hoje |
| Total R$ do item | as 4 | `item.total_cents` | hoje |
| Tabela (preço) | escritório | `item.unit_price_cents` | hoje |
| Desc./Acr. | escritório | `item.discount_pct` / `item.surcharge_pct` | hoje |
| Líquido | escritório | `netUnitCents(item)` | hoje |
| Tabela (total) | escritório | `order.subtotal_cents` | hoje |
| Desconto/Acréscimo do pedido | escritório | `descontoDoPedidoPct` + `order.discount_cents` (uma linha, % e R$) | hoje (corrige o D-T0150-1) |
| Total | as 4 | `order.total_cents` | hoje |
| Histórico | escritório | `order.history` (`statusText`) | hoje |

O retrato da filial é do pedido: se o cadastro da filial mudar depois, o PDF de um pedido antigo continua com o CNPJ e o endereço da data do pedido. A lista de alertas (`order.alertas`) deixa de ser lida pelo PDF.

## 5. Casos de teste (para o testes e o corretor)
1. Pedido e orçamento da filial **Boa Vista**, nas 4 versões: cabeçalho com o nome, o CNPJ, o endereço completo (com CEP) e o telefone de Boa Vista; nenhum dado da matriz nem do tenant no HTML.
1a. Linha 1 do cabeçalho exatamente `Filial Boa Vista · CNPJ 12.345.678/0002-71 · (95) 3224-1000`: sem o código `0002` e sem `/RR` (D-T0159-5); `Boa Vista/RR` só na linha 2.
2. Filial sem telefone: a linha 1 termina no CNPJ, sem `·` sobrando. Pedido antigo sem retrato da filial: só o nome da distribuidora, sem linha vazia.
2a. Escritório: a ficha não tem a célula "Filial"; o nome da filial aparece uma vez só no HTML (no cabeçalho).
3. **Orçamento** com alerta (desconto acima do máximo): nenhuma das duas versões tem "Alertas".
4. **Pedido** com alerta: nenhuma das duas versões tem "Alertas" nem o texto do alerta no HTML.
5. Item `FD c/ 10` com 1: "Emb." = `FD c/ 10`, "Qtd" = `1`; nenhuma célula de Qtd com letra.
6. Produto sem marca: célula vazia, coluna mantida.
7. Versão do cliente sem `%` e sem a palavra "desconto" (regra atual).
8. Nome do arquivo: `PED-0014-10112026` e `ORC-0015-10112026`.
9. Orçamento só salvo: escritório sem Histórico. Pedido salvo, enviado e rejeitado: escritório com as 3 etapas.
10. Caixa do Total: "Total" nas 4 versões; nenhuma tem "Total do pedido" nem "Total do orçamento".
11. Observação vazia (ou só com espaços): o rótulo aparece, com a linha em branco, nas 4 versões; com as duas vazias, os 2 rótulos aparecem. Preenchida: o texto sai em negrito, com as quebras digitadas.
11a. Ordem e Item: pedido com `CAF-500`, `ACU-1K`, `AGU-1500` (nessa ordem no app) sai `1 ACU-1K`, `2 AGU-1500`, `3 CAF-500`; `AGU-2` antes de `AGU-10`. O app e o BKO continuam na ordem do pedido.
12. Logo: sem `logo_src`, o `<img>` do cabeçalho sai com a imagem do app; com `logo_src`, com a do tenant. Nunca cabeçalho sem imagem.
13. Página `@page { size: A4 landscape }`; cabeçalho da tabela com `COR_CABECALHO_TABELA` (#00843D); caixa do Total com borda de 2 px.

## 6. Visual horizontal: medidas, cores e tokens
Unidades em px CSS (96 dpi) e mm; as imagens estão em 2x. Fontes: Archivo (títulos, rótulos e números grandes), IBM Plex Sans (texto), IBM Plex Mono (código do item); no aparelho valem os fallbacks do sistema.

### 6.1 Tokens (cores)
| Token | Valor | Uso |
|---|---|---|
| `--pdf-tinta` | #16202A | texto principal, borda da ficha, borda da caixa do Total, traço sob a tabela |
| `--pdf-tinta-2` | #4A5562 | linhas da filial, data, fantasia, código do item, nota, horários do Histórico |
| `--pdf-rotulo` | #5B6673 | rótulos da ficha e do Histórico, setas |
| `--pdf-destaque` | #C2540A | rótulo "Pedido"/"Orçamento" do cabeçalho |
| `--pdf-ficha` | #F1F2F0 | fundo da ficha **e** da caixa do Total (o mesmo cinza) |
| `--pdf-zebra` | #F3F4F1 | linhas pares da tabela |
| `--pdf-linha` | #C9CEC6 | divisórias internas da ficha, traço da caixa do Total, borda do Histórico |
| `--pdf-cab-tabela` | **#00843D (provisório)** | fundo do cabeçalho da tabela; no código, a constante `COR_CABECALHO_TABELA`. O código oficial da cor vem do dono do produto: troca só aqui |
| `--pdf-cab-tabela-texto` | #FFFFFF | texto do cabeçalho da tabela (contraste ≈ 5:1 sobre #00843D) |

### 6.2 Página
A4 **paisagem** (297 × 210 mm), margens de 10 mm em cima, 11 mm dos lados e 12 mm embaixo. Tabela longa continua na página seguinte com o cabeçalho verde repetido (`thead` como grupo de cabeçalho); a linha de item e o rodapé (caixa do Total + Histórico ou nota) não se partem.

### 6.3 Tipografia (≈ +25% sobre a proposta 2)
| Elemento | Tamanho | Peso / estilo |
|---|---|---|
| Itens da tabela e valores da ficha | **15 px** | 400; razão social 600; Total do item 700 |
| Código do item | 14 px | Plex Mono 500, `--pdf-tinta-2` |
| Número do Item | 15 px | 400, alinhado à direita |
| Texto das observações | 15 px | **600**, `--pdf-tinta` |
| Rótulos da ficha, do Histórico e do cabeçalho da tabela | **10,5 px** | Archivo 700, maiúsculas, espaçamento .09 a .1em |
| Nome da distribuidora | 22 px | Archivo 800 |
| Linhas da filial | 13 px | 400, `--pdf-tinta-2` |
| Rótulo "Pedido"/"Orçamento" (+ "· uso interno") | 13 px | Archivo 700, maiúsculas, .12em, `--pdf-destaque` |
| Número do documento | 28 px | Archivo 800 |
| Data | 13 px | 400, `--pdf-tinta-2` |
| Linhas Tabela e Desconto da caixa | 15 px | 400 |
| Rótulo "Total" da caixa | 15 px | 700 |
| Valor do Total | **26 px** | Archivo 800 |
| Nota do cliente | 12 px | 400, `--pdf-tinta-2` |

### 6.4 Blocos
- **Cabeçalho:** logo de 15 × 15 mm (raio 2 mm, `object-fit: contain`), 4 mm, nome e linhas da filial; à direita, rótulo e número na mesma linha e a data abaixo, alinhados à direita. 4,5 mm até a ficha.
- **Ficha:** borda 1 px `--pdf-tinta`, raio 1,6 mm, fundo `--pdf-ficha`; células com 2,6 mm em cima, 3,2 mm dos lados e 2,8 mm embaixo; divisórias de 1 px `--pdf-linha`; rótulo 1 mm acima do valor. Grade de 3 colunas e **2 linhas** (as observações não ficam na ficha):
  - larguras: cliente 49% · 29% · 22%; escritório 42% · 29% · 29%;
  - linha 1: Cliente (colunas 1 e 2) · CNPJ (ou "CNPJ · código");
  - linha 2: Entrega · Pagamento · Vendedor (no escritório, Vendedor e Tabela lado a lado na mesma célula, 8 mm entre eles).
- **Tabela:** **28 px** abaixo da ficha (o dobro da v1), largura total. Cabeçalho com fundo `--pdf-cab-tabela` e texto branco; 2,6 mm em cima e embaixo e 2,2 mm dos lados. Células com 2,4 mm × 2,2 mm; linhas pares `--pdf-zebra`; traço de 1,5 px `--pdf-tinta` sob a última linha. Item: número alinhado à direita (cabeçalho também), 3,2 mm de folga à direita. Larguras:
  - cliente: Item 15 · Código 26 · Marca 31 · Emb. 28 · Qtd 16 · Preço unit. 38 · Total 26 mm; Descrição, o resto;
  - escritório: Item 15 · Código 24 · Marca 30 · Emb. 24 · Qtd 15 · Tabela 22 · Desc./Acr. 27 · Líquido 22 · Total 22 mm; Descrição, o resto.
- **Rodapé** (**24 px** abaixo da tabela, o dobro da v1; as duas colunas alinhadas **pelo topo**, 20 mm ou mais entre elas):
  - à esquerda, de cima para baixo: **Observação do pedido**, 3,5 mm, **Observação da entrega** (rótulo 10,5 px `--pdf-rotulo` em maiúsculas, 1 mm, texto 15 px peso 600 `--pdf-tinta`; sem fundo e sem borda; vazia guarda a altura de uma linha); 4,5 mm; no cliente, a nota; no escritório, o **Histórico** em caixa de borda 1 px `--pdf-linha`, raio 1,6 mm, fundo branco, rótulo e etapas na mesma linha (6 mm entre eles), largura do conteúdo;
  - à direita, a **caixa do Total**: 87 mm de largura, borda de **2 px** `--pdf-tinta`, raio 1,6 mm, fundo `--pdf-ficha`, 3 mm × 4,5 mm por dentro. No escritório: Tabela e Desconto (rótulo à esquerda, valor à direita), um traço de 1 px `--pdf-linha` e o Total. No cliente: só o Total.
- O Desconto da caixa sai na cor do texto (`--pdf-tinta`), sem laranja: o sinal "−" já diz o que é.

### 6.5 Logo
Sempre há imagem no cabeçalho, nas 4 versões: a logo cadastrada do tenant; sem ela, a do app (`apps/mobile/assets/images/icon.png`, a mesma do EAS), embutida no HTML como data URI, porque o PDF é gerado no aparelho sem rede. Quando o BKO ganhar o campo de logo do tenant, o PDF passa a usá-la sem mudar o layout.
