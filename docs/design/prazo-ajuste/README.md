# Desc./Acrésc. (%) do prazo de pagamento: simulação visual

Pedido do Alexandre: R-20261115-111000, alvo **v1.0.13**. **Etapa 2: só simulação**, sem código de produção. Base: a proposta do `modulo-vendedor` em `docs/modulos/vendedor/prazo-desconto-acrescimo.md` (branch `nuvem/prazo-ajuste-modulo-vendedor`, commit 8fd2827), seções 1, 3, 4 e as RN-VEN-43, 44 e 46 propostas. Nada aqui está aprovado.

Nas imagens, o **contorno laranja tracejado só marca o que é novo**. Ele não sai no app, no PDF nem no BKO.

## Exemplos usados (os mesmos números em todas as superfícies)
| Caso | Prazo | Itens | Linhas dos Totais |
|---|---|---|---|
| A | Boleto · À vista, **−1,71%** | 4 itens sem desconto, R$ 1.000,00 | Desconto do prazo (1,71%) **− R$ 17,10** → Valor final **R$ 982,90** |
| B | Boleto · 60 dias, **+2,50%** | os mesmos 4, com −5% e −10% em 2 itens: R$ 954,54 | Acréscimo do prazo (2,50%) **+ R$ 23,86** (954,54 × 2,50% = 23,8635) → Valor final **R$ 978,40** |

## 1. App Campo: Novo pedido
Imagens de 360 × 740 dp (PNG em 2×), feitas a partir de `campo.html`:
- `campo-1-venda-lista-de-prazos.png`: aba Venda com a lista do Prazo aberta;
- `campo-2-resumo-desconto-a-vista.png`: Resumo do caso A, rolado até os Totais;
- `campo-3-resumo-acrescimo-60-dias.png`: Resumo do caso B, rolado até os Totais.

### 1.1 Aba Venda, lista do Prazo (`ListaSuspensa` de `packages/ui/src/mobile/suspensa.tsx`)
**Hoje:** o menu do Prazo tem a largura do campo (metade da linha, 160 dp) e cada opção mostra só o texto do prazo; a opção desabilitada mostra o motivo embaixo e o cadeado.
**Muda:**
- Cada opção ganha um **texto curto à direita**, antes do ✓ ou do cadeado: o percentual com sinal e 2 casas (`−1,71%`, `+2,50%`). **Só quando o percentual é diferente de zero**; com zero, nada aparece (sem "0,00%").
- Estilo: IBM Plex Sans 500, 14, `ink2`, números tabulares; na opção desabilitada, `inkDisabled` como o rótulo. O sinal diz se é desconto ou acréscimo; sem cor verde ou laranja (cor nunca sozinha, e o desconto do prazo não é promoção do vendedor).
- O menu do Prazo passa a abrir com **largura mínima de 224 dp**, alinhado à direita do campo (o `posicaoDoMenu` já aceita `larguraMinima`). Assim "30/60/90 dias" e "+3,90%" cabem numa linha.
- O **campo fechado continua só com o prazo** ("À vista"). O percentual escolhido aparece uma vez, nos Totais do Resumo.
- Kit: `OpcaoLista` ganha o campo opcional `detalhe` (texto à direita). O leitor de tela lê "À vista, desconto de 1,71%" (ou "acréscimo de 2,50%"). O texto vem do domain do Vendedor; o kit não formata nem decide.

### 1.2 Resumo, Totais (`CartaoDeTotais` em `modules/vendedor/app/components/tabelas-pedido.tsx`, linhas de `linhasDosTotais`)
**Hoje:** Valor de tabela · Desconto (%) · Desconto (R$) (fixas no Resumo, com zeros sem ajuste) e o Valor final.
**Muda:**
- Uma **linha nova logo acima do Valor final**, abaixo de "Desconto (R$)", **só quando o percentual do prazo é diferente de zero**:
  - desconto: rótulo `Desconto do prazo (1,71%)`, valor `− R$ 17,10`;
  - acréscimo: rótulo `Acréscimo do prazo (2,50%)`, valor `+ R$ 23,86`.
- Mesmo desenho das outras linhas (rótulo 14 `ink2`, valor Archivo 700 15, cor do texto). O percentual vai no rótulo, com 2 casas e sem sinal (o nome já diz); o valor em R$ leva o sinal com espaço, igual a "Desconto (R$)".
- As três linhas de cima **ignoram o prazo**: Valor de tabela, Desconto (%) e Desconto (R$) continuam sendo só o ajuste dos itens (no caso B, 4,5% e − R$ 45,46).
- A tabela de Itens **não muda**: o Total de cada item é antes do prazo, e a soma da coluna Total bate com Valor de tabela − Desconto (R$). O rateio do ajuste pelas linhas (proposta, seção 1) fica só no envio ao ERP.
- "Condição de pagamento" continua "Forma: Boleto" e "Prazo: À vista", sem o percentual (ele já está nos Totais).
- Nada novo em Alertas: o prazo não bloqueia nem muda o resultado (RN-VEN-42).
- Vale igual no **detalhe do pedido e do orçamento** (app e BKO), que usam o mesmo `CartaoDeTotais`/`linhasDosTotais`. A folha do item não muda.

## 2. PDF do pedido (`docs/design/pdf-pedido.md` §2 linha 11 e §6.4)
Imagens A4 paisagem (2246 × 1588 px), geradas com o `buildOrderPdfHtml` atual (`modules/vendedor/domain/pdf-pedido.ts`) e só a linha nova acrescentada à caixa do Total:
- `pdf-cliente-desconto-a-vista.png` e `pdf-escritorio-desconto-a-vista.png` (caso A);
- `pdf-cliente-acrescimo-60-dias.png` e `pdf-escritorio-acrescimo-60-dias.png` (caso B).

**Hoje:** cliente só com o Valor final; escritório com Valor de tabela, Desconto (%) e Desconto (R$) quando há ajuste nos itens, o traço e o Valor final.
**Muda:**
- Na caixa do Total, **nas 4 versões** (pedido e orçamento, cliente e escritório), a linha do prazo entra **acima do traço do Valor final**, só quando o percentual é diferente de zero, com o mesmo rótulo e valor da tela. Estilo das outras linhas da caixa (15 px, rótulo 400, valor 600, `--pdf-tinta`, sem laranja).
- **No PDF do cliente a linha também sai.** Sem ela, a soma da coluna Total R$ (R$ 1.000,00) não bateria com o Valor final (R$ 982,90) e o cliente não veria de onde vem a diferença.
- A ficha continua "Pagamento: Boleto · À vista", sem o percentual. A tabela de itens não muda (totais antes do prazo, como no app).

## 3. BKO: Parâmetros → Formas de pagamento e prazos (`modules/vendedor/web/pages/formas-pagamento-page.tsx`)
Imagens de 1366 × 768 (PNG em 2×):
- `bko-1-lista.png`: lista com a coluna nova;
- `bko-2-edicao.png`: gaveta "Editar prazo" com o campo preenchido e a ajuda;
- `bko-3-edicao-erro.png`: o mesmo campo fora do limite.

### 3.1 Lista
**Hoje:** Forma e prazo · Prazo médio · Situação · Origem · ações.
**Muda:** coluna nova **"Desc./Acrésc."** entre Prazo médio e Situação, número alinhado à direita, 150 px: `−1,71%`, `+2,50%`; zero como `0,00%` em `ink-2`; vazia na linha da forma. O `%` fica no valor, e não no título, para a célula ser lida sozinha (inclusive no CSV e no leitor de tela). É coluna, não selo: é um número, como o Prazo médio. Prioridade 2 (some antes de Forma e prazo e de Situação em telas estreitas, como o Prazo médio).

### 3.2 Edição do prazo (Novo prazo e Editar prazo)
**Hoje:** Forma · Código e Ordem · Dias das parcelas · prévia "60 dias · prazo médio 60 dias".
**Muda:**
- Campo novo **"Desc./Acrésc. (%)"** depois da prévia, na metade esquerda da grade (mesma largura do Código). `inputMode="decimal"`, aceita `-`, vírgula ou ponto, com o `%` fixo dentro do campo à direita (`ink-2`). Vazio = 0. Ao sair do campo, formata com 2 casas ("2,5" vira "2,50").
- **Ajuda** embaixo, 12 px `ink-2`: "Negativo = desconto. Positivo = acréscimo." É o que a pessoa precisa para digitar o sinal certo; nada sobre como o sistema calcula.
- **Validação** depois da tentativa de salvar, no padrão do `CampoFormulario` (borda `danger`, ícone e texto 12 px `danger`), e o erro **ocupa o lugar da ajuda**: "Use de −99,99 a +99,99, com até 2 casas." Vale para fora da faixa, mais de 2 casas e texto que não é número. A API revalida.
- Kit: o `CampoFormulario` de `packages/ui/src/web/ui.tsx` ganha a prop opcional `ajuda` (texto abaixo do campo, trocado pelo erro quando houver), ligada por `aria-describedby`. Fica com o `designer-ux` na implementação.
- Prazo vindo do ERP: se o Alexandre decidir que o ERP é a fonte (pergunta 3 da proposta), o campo fica só de leitura com o rótulo "Desc./Acrésc. (%) · Vem do ERP", igual ao Código e aos Dias das parcelas hoje.

## 4. Decisões para o Alexandre aprovar
1. **Percentual na lista do Prazo do app**, à direita, só quando ≠ 0, em cinza e sem cor; o campo fechado fica só com o prazo.
2. **Linha única nos Totais**, acima do Valor final, com o % no rótulo e o R$ no valor; as três linhas de cima ignoram o prazo.
3. **Itens com o total antes do prazo** no Resumo, no detalhe e nos PDFs (a soma da coluna bate com os Totais); o rateio pelas linhas só no envio ao ERP.
4. **PDF do cliente também mostra a linha do prazo** (hoje ele só tem o Valor final).
5. **BKO:** coluna "Desc./Acrésc." com o `%` no valor e `0,00%` em cinza; campo com ajuda de uma linha e a mensagem de limite acima.

## 5. Arquivos
`campo.html` + `campo.css` (app), `pdf-*.html` (PDF; HTML do `buildOrderPdfHtml` com a linha acrescentada e a marcação da prancha), `bko-*.html` (BKO). Fontes locais de `apps/web/app/fonts`; tokens de `packages/ui` (via `docs/design/telas/telas.css`) e marca v1. PNG com Playwright (Chromium, `deviceScaleFactor` 2).
