# Desc./Acrésc. (%) do prazo de pagamento: simulação visual

Pedido do Alexandre: R-20261115-111000, alvo **v1.0.14** (era v1.0.13). Modelo refeito pelas decisões de **R-20261115-121000**. **Só simulação**, sem código de produção.

Nas imagens, o **contorno laranja tracejado só marca o que muda**. Ele não sai no app, no PDF nem no BKO.

Modelo e conta: docs/modulos/vendedor/prazo-desconto-acrescimo.md §1–2 (fonte da verdade).

**Referência inacessível:** a simulação que o Alexandre fez na ponte (`recados/anexos/R-20261115-121000-prazos-tabela.png`, no repositório de recados) não abriu nesta sessão (403). O BKO foi desenhado só a partir da descrição do recado; ao comparar com a imagem dele, a diferença ganha da imagem.

## Exemplo usado (os mesmos números em todas as superfícies)
Padaria Trigo Fino, Boleto. Preço de tabela do cliente (sem prazo): filtro FIL-5548 **R$ 100,00**, leite LPO-400 R$ 17,75, café CAF-500 R$ 13,40, detergente DET-500 R$ 4,30. Desconto do vendedor de −5% só no leite.

| Prazo | Filtro (1 un.) | Leite (20) | Café (30) | Detergente (10) | Valor de tabela | Desconto (R$) | Valor final |
|---|---|---|---|---|---|---|---|
| À vista, −1,71% | 98,29 | 349,00 (17,45 un.) | 395,10 (13,17) | 42,30 (4,23) | R$ 884,69 | − R$ 17,40 | **R$ 867,29** |
| 60 dias, +2,50% | 102,50 | 363,80 (18,19 un.) | 412,20 (13,74) | 44,10 (4,41) | R$ 922,60 | − R$ 18,20 | **R$ 904,40** |

## 1. App Campo
Imagens de 360 dp de largura (PNG em 2×), feitas a partir de `campo.html` e `campo.css`:
- `campo-1-venda-lista-de-prazos.png`: aba Venda com a lista do Prazo aberta (360 × 740);
- `campo-2-resumo-a-vista.png`: Resumo do pedido à vista, com a rolagem aberta de cima até os botões;
- `campo-3-resumo-60-dias.png`: o mesmo pedido depois de trocar o prazo para 60 dias;
- `campo-4-catalogo-prazo-padrao.png`: Catálogo aberto pela ficha do cliente (360 × 740).

### 1.1 Lista do Prazo (`ListaSuspensa`, `packages/ui/src/mobile/suspensa.tsx`)
**Não muda.** Cada opção mostra só o prazo; o menu tem a largura do campo; a opção desabilitada segue com o motivo e o cadeado. Sem contorno, porque nada muda em relação ao app de hoje.

### 1.2 Pedido: Itens, Resumo e Totais (`CartaoDeTotais`, `linhasDosTotais`)
- Ao escolher ou trocar o prazo, o **Valor tabela de cada item é refeito** com o % do prazo; o Total do item, os Totais e a folha do item seguem daí, sem nenhuma marca do prazo. É a única coluna com contorno nas telas 2 e 3.
- O desconto do vendedor (−5% no leite) vale sobre o unitário da tabela ajustada: o leite fecha em 331,60 à vista e 345,60 em 60 dias (o Desconto (R$) está na tabela do exemplo).
- **Totais iguais aos de hoje**: Valor de tabela, Desconto (%), Desconto (R$) e Valor final. Sem linha de prazo.
- "Condição de pagamento" continua "Forma: Boleto" e "Prazo: À vista" (ou "60 dias"), sem %.
- Nada novo em Alertas. Trocar o prazo não mostra aviso: os números novos já estão na tela (RN-VEN-42, regras de excesso).
- Vale igual no detalhe do pedido e do orçamento (app e BKO).

### 1.3 Catálogo (`docs/design/catalogo-grade.md`, T-0173)
- **Pela ficha do cliente:** o preço do cartão já sai no prazo padrão do cliente (na simulação, os preços da linha 60 dias da tabela; água R$ 3,27). O contorno marca só o preço.
- **Pelo menu, sem cliente:** a tabela pura, como hoje (`docs/design/telas/T-0173-catalogo-menu.png`); por isso não há imagem nova.

## 2. PDF do pedido
`pdf-escritorio-60-dias.html` / `.png` (A4 paisagem, 2246 × 1588 px), versão do escritório do pedido em 60 dias, feita a partir do `buildOrderPdfHtml` atual (`modules/vendedor/domain/pdf-pedido.ts`):
- A coluna **Tabela** sai com o preço já ajustado; Líquido, Total e a caixa do Total seguem dela, com a mesma conta e os mesmos Totais do Resumo (seção 1.2).
- Ficha: "Pagamento: Boleto · 60 dias", sem %.
- Vale igual para o PDF do cliente (só o Valor final, como hoje) e para o orçamento: nada a desenhar além do preço ajustado.

## 3. BKO: Cadastros › Formas de pagamento e prazos (`modules/vendedor/web/pages/formas-pagamento-page.tsx`)
Imagens de 1366 × 768 (PNG em 2×), com Cadastros aberto no menu lateral e o item ativo:
- `bko-1-lista.png`: aba Prazos com a tabela única;
- `bko-2-edicao.png`: gaveta "Editar prazo" de um prazo do ERP, com o campo só leitura.

### 3.0 Menu e trilha (R-20261115-122000)
- O item sai de Comercial e entra em **Cadastros**, com o mesmo rótulo e na ordem do menu (`docs/design/menu-parametros/spec.md` §2, D11).
- O item ativo tem o fundo e a barra laranja de sempre. Se o nome não couber nos 240 px do menu, quebra em duas linhas, sem reticências.
- No título, "Cadastros ›" fica acima (o `eyebrow` do `PageHeader`) e "Formas de pagamento e prazos" no título. A trilha se lê **Cadastros › Formas de pagamento e prazos**.

### 3.1 Abas e tabela única (aprovada, R-20261115-121500)
- **Abas** `Abas` de `packages/ui/src/web/abas.tsx`, logo abaixo do título: **"Prazos (n)"** e **"Formas (n)"**. A contagem fica só nas abas; o título perde o "· n".
- **Aba Prazos** (padrão): tabela plana, uma linha por prazo, sem as linhas de forma nem o recuo. Colunas, nesta ordem (simulação aprovada, R-20261115-121000): **Código** (mono) · **Descrição** (600) · **Forma** · **Parcelas (dias)** ("28, 56") · Prazo médio · **Desc./Acrésc. (%)** · Situação · Origem · ⋯.
- Tipografia da tabela: fonte do sistema (manual da marca §5), célula 15 px, cabeçalho 12/600, título da página 24/700.
- **Desc./Acrésc. (%)**: o `%` fica no título, e o valor só com sinal e 2 casas, alinhado à direita (`−1,71`, `+2,50`); zero como `0,00` em `ink-2`. Sem cor de desconto ou acréscimo. Prioridade 2 (some com o Prazo médio em tela estreita).
- Filtros: busca "Buscar prazo ou código", **Forma** (novo, Todas por padrão) e Situação.
- Botão principal da aba: **"Novo prazo"**; na aba Formas, **"Nova forma"** (um só principal por tela). O menu ⋮ mantém "Exportar CSV" da aba aberta.
- **Aba Formas**: a lista das formas (Forma + código · Situação · Origem · ações), sem os prazos. Sem imagem: é a tabela de hoje sem as linhas de prazo.

### 3.2 Editar prazo
- Campo **"Desc./Acrésc. (%) · Vem do ERP"** depois da prévia, na metade esquerda da grade, **só leitura** (`readOnly` + `aria-readonly`), no mesmo padrão do "Código · Vem do ERP" e "Dias das parcelas · Vem do ERP" de hoje. Sem ajuda e sem validação: não há o que digitar.
- Novo prazo: o campo não aparece; entra com 0,00 (RN-VEN-46).

## 4. Decisões para o Alexandre aprovar
1. **Coluna "Valor tabela" refeita** ao escolher ou trocar o prazo, sem aviso e sem selo.
2. **Resumo e PDF** com os Totais e o desconto do vendedor da seção 1.2.
3. **Catálogo** com o preço no prazo padrão do cliente; pelo menu, a tabela pura.

## 5. Arquivos
`campo.html` + `campo.css` (app), `pdf-escritorio-60-dias.html` (PDF; HTML do `buildOrderPdfHtml` com os números do exemplo e a marcação da prancha), `bko-1-lista.html` e `bko-2-edicao.html` (BKO). Fonte do sistema (manual da marca §5), sem fonte baixada; tokens de `packages/ui` (via `docs/design/telas/telas.css`) e marca v1. PNG com Playwright (Chromium, `deviceScaleFactor` 2).
