# Novo pedido v4: Resumo e detalhe em tabela, Alertas no topo, aba Itens com popup, Início e Pedidos sem repetição (T-0150, T-0148, T-0153)

> 2026-11-10 · designer-ux. Pedidos do dono do produto: R-20261110-062237 (Resumo), R-20261110-062240 (detalhe e revisão das
> telas), R-20261110-062235 (aba Itens), R-20261110-062238 (alçada só ao salvar, máximo bloqueia o envio), R-20261110-062239 e
> R-20261110-062506 (sem repetição e sem excesso de texto). Auditoria: `docs/qualidade/redundancias/2026-11-10-fluxo-de-venda.md`.
> **Versão 2 (10/11, tarde):** R-20261110-093124 (T-0150 e T-0148 não aprovadas na versão 1): área única **Alertas** no topo
> (RN-VEN-42), situação só no **Histórico**, produto sem estoque entra e o pedido só sai como orçamento (RN-VEN-20), o "Falta para
> salvar" vira alerta (RN-CORE-36) e a regra permanente **"uma informação, um lugar"**.
> **Imagens para aprovação** (fonte: o `.html` de mesmo nome): `telas/T-0150-resumo.png`, `telas/T-0150-detalhe.png`,
> `telas/T-0148-itens.png` (versão 2) e `telas/T-0153-inicio-pedidos.png` (aprovada em R-20261110-093125). **Vale a imagem
> aprovada**; este texto só dá as medidas.
> Substitui em `pedido-v3.md` o quadro D (aba Itens) e, em `pedido-v2.md`, o §2.1 (Resumo), o §2.2 (texto embaixo do botão), o
> §4.1 (detalhe) e a regra "a última tag é o estado de agora" do §5.1. No `formulario-pendencias.md`, o bloco "Falta para salvar"
> e a bolinha na aba valem só fora do Novo pedido (visita, pesquisa, cadastro); no pedido, valem os Alertas (§0.1).

## 0. Regras que valem para todas
1. **Uma informação, um lugar** (RN-VEN-42; regra permanente do corretor-redundancias, para todas as telas). Se uma seção mostra
   uma informação, ela não aparece em outro lugar da mesma tela: o **Histórico** mostra a situação, os **Totais** mostram o %, os
   **Alertas** mostram o problema. Contagem na aba não se repete no título da seção; total só nos Totais (ou só no rodapé, na aba
   Itens).
2. **Alçada nunca aparece em tela** e não é alerta. Só na pergunta ao tocar em "Salvar e enviar pedido", quando o desconto passa
   da alçada: título "Desconto acima da sua alçada", texto "Enviar para aprovação?", botões **Enviar para aprovação**
   (principal) e **Voltar** (texto). Orçamento não pergunta.
3. **Nenhum aviso solto.** Todo problema que pede atenção ou correção vai para a área **Alertas** (§0.1). Fora dela não há linha
   de motivo acima dos botões, texto embaixo do botão, faixa colorida, bolinha na aba nem número em vermelho na tabela.
4. Números de tabela em **IBM Plex Sans** tabular (o 6 do Archivo negrito abaixo de 15 px parece 8); Archivo só de 15 px para cima.
5. Mensagem de tela termina com ponto; selo, etapa do Histórico e linha de alerta, sem ponto.

### 0.1 Área Alertas (RN-VEN-42)
- **Onde:** no topo do conteúdo, no lugar do antigo selo de situação.
  - **Novo pedido:** logo abaixo das abas, **em todas as abas** (Venda, Itens, Entrega, Resumo); rola com o conteúdo.
  - **Pedido ou orçamento feito:** logo abaixo do nome do cliente.
  - **Popup do item** (aba Itens): logo abaixo do cabeçalho do popup, só com os problemas daquele item.
- **Sem alerta, a área não aparece** (nem o título).
- **Forma:** título "ALERTAS" 12/600 maiúsculas em `danger` (6,4:1 sobre `ground`); cartão branco, borda `line`, raio 12, igual às
  outras tabelas; uma linha por alerta, alvo ≥ 44 dp: ícone `alerta` 18 em `danger` + texto 14 `ink` (até 2 linhas) + `chevron`
  16 `ink3` quando a linha leva a algum lugar. Sem fundo colorido e sem borda colorida.
- **Texto:** só o problema e o item, sem ponto, na ordem "código + problema":

  | Alerta | Texto | Toque leva a | Efeito no salvar |
  |---|---|---|---|
  | Desconto acima do máximo (RN-VEN-11) | `AGU-1500 acima do desconto máximo` (um por item) | popup do item | só orçamento |
  | Sem estoque (RN-VEN-20) | `BIS-400 sem estoque` (um por item) | popup do item | só orçamento |
  | Informação faltante (RN-CORE-36) | `Falta a transportadora · aba Entrega`, `Falta a forma de pagamento · aba Venda` ("· aba X" em `ink2`) | a aba | Salvar e enviar desligado; Apenas salvar continua |
  | Recusa do servidor (RN-VEN-40) | o motivo devolvido, curto; preço mínimo = `AGU-1500 acima do desconto máximo` | popup do item, se houver item | o que a recusa disser |
  | Recusa do supervisor | o motivo dele numa linha (o nome fica na etapa "Rejeitado" do Histórico) | — | — |
  | Crédito (RN-VEN-12) | `Limite de crédito excedido` | — | conforme o parâmetro (aprovação ou bloqueio) |
  | Título vencido (RN-VEN-13) | `Título vencido` | — | só à vista ou com aprovação |
  | Cliente (RN-VEN-13) | `Cliente bloqueado`, `Cliente inativo`, `Cadastro do cliente incompleto` | — | só orçamento |

  No popup do item o código sai (o popup já é do item): `Sem estoque`, `Acima do desconto máximo de 10,0%`.
- **Ordem:** primeiro os que impedem o envio (cliente, faltante, máximo, estoque), depois crédito e título; dentro de cada tipo,
  na ordem dos itens.
- **TalkBack:** "Alertas, n" no título; cada linha lê o texto e, se tocável, "toque duas vezes para corrigir".
- **RD-0071 (confirmado pelo designer-ux):** a frase do preço mínimo é uma só, `<código> acima do desconto máximo`, uma linha por
  item, no aparelho, na recusa da API e na fila. Substitui "Desconto acima do máximo: AGU-1500" e "Preço de AGU-1500 abaixo do
  mínimo".

## 1. Resumo (aba Resumo do Novo pedido)
Ordem: **Alertas (§0.1, só se houver) · Cliente · Venda · Itens · Entrega · Observações · Desconto do pedido · Totais · botões**.
- Título de seção: 12/600 maiúsculas `ink2` ("CLIENTE", "VENDA", "ITENS" sem contagem, "ENTREGA", "OBSERVAÇÕES", "TOTAIS").
- **Tabela rótulo | valor** (Cliente, Venda, Entrega): cartão branco, borda `line`, raio 12; linhas com traço `lineSoft`, respiro
  10/12; rótulo 13 `ink2` em coluna de 92 dp; valor 14 `ink` à esquerda, quebra em mais linhas.
  - Cliente: **Razão social** e **CNPJ** (o nome fantasia e o código já estão no cabeçalho).
  - Venda: **Pagamento** e **Prazo**. Entrega: **Frete** e **Endereço**. Observações: uma célula só; vazia "—".
- **Tabela de itens**: colunas **Produto · Qtd · Preço unit. · Desc./Acrésc. · Total**, larguras fixas 40/48/58/56 dp e o Produto com
  o resto. Cabeçalho 11/600 `ink2` (pode quebrar em 2 linhas). Produto: descrição 12,5/600 (até 2 linhas) e o código em mono 10,5
  `ink2`. Qtd "4 UN" (a embalagem vendida, nunca UN no lugar de FD). Preço unit. = preço de tabela da embalagem. Desc./Acrésc.
  "−5,0%" / "+10,0%" / "—". Total do item 13/700. Números sem "R$" (o R$ está nos Totais), alinhados à direita.
  O % do item fica sempre em `ink`, também acima do máximo: o problema está nos Alertas.
- **Desconto do pedido**: rótulo 14 `ink2` à esquerda, `DescontoCompacto` (156 dp) à direita.
- **Totais** (cartão): **Tabela** ··· R$ · **linha líquida** ··· ± R$ · **Total** (15/600 · Archivo 20/800, traço `line` acima).
  Linha líquida = resultado de itens e pedido sobre a tabela: "Acréscimo 5,8%" ··· "+ R$ 6,94" ou "Desconto 8,8%" ··· "− R$ 10,53"
  (U+2212). Sem ajuste, a linha não aparece. **Sem caixa verde.**
- Botões sem alerta: **Salvar e enviar pedido** (principal 52) · **Apenas salvar** e **Salvar como orçamento** (secundários 52,
  metade cada, quebram em 2 linhas) · **Cancelar** (texto). **Nada embaixo do botão.**
- **Com alerta que só permite orçamento** (acima do máximo, sem estoque, cliente bloqueado; RN-VEN-11, RN-VEN-20, RN-VEN-13):
  **Salvar como orçamento** (principal 52) · **Apenas salvar** (secundário 52, largura toda) · **Cancelar** (texto). Nenhuma
  linha acima dos botões.
- **Com informação faltante** (RN-CORE-36): Salvar e enviar pedido desligado (o TalkBack lê o primeiro alerta como motivo);
  Apenas salvar continua.
- **Aba Venda:** sai a faixa verde "Cliente liberado · sem título vencido" e a faixa do crédito; crédito e título viram alertas.
  A tabela Limite · Disponível · Prazo médio continua, sem vermelho (é dado, não alerta).
- **Saem**: a linha "AGU-1500 acima do desconto máximo" acima dos botões, o bloco "Falta para salvar" e a bolinha na aba (a linha
  do alerta já diz a aba).

## 2. Detalhe do pedido e do orçamento (Campo; Gestão e BKO com o mesmo desenho)
Ordem: **‹ Pedidos e ⋮ · título · cliente · Alertas (só se houver) · tabela Pagamento/Entrega · ITENS (n) · Totais · Histórico ·
rodapé de ações**.
- Título Archivo 24/800 "Pedido 000013" / "Orçamento 000012". Cliente 15 `ink` "Nome · cód. C5007".
- **Sem selo no topo.** A situação aparece só no Histórico (RN-VEN-42). Sai também o selo roxo "Preço de 09/11" do orçamento: a
  etapa "Salvo · 09/11" do Histórico já é a data do preço congelado (RN-VEN-18).
- **Alertas** (§0.1): a recusa (motivo numa linha) e, no orçamento, os problemas que impedem o Transformar (acima do máximo, sem
  estoque, cliente). Pedido enviado, aprovado ou faturado normalmente não tem alerta.
- Tabela Pagamento ("Boleto · 28/56 dias") e Entrega ("CIF · endereço"). Gestão e BKO: + linha **Vendedor**.
- ITENS (n) e Totais: iguais ao Resumo (§1). Aqui o título leva a contagem (não há aba).
- **Histórico** (sempre aparece): as tags da RN-VEN-30 em ordem, da primeira à atual; altura 28, texto 12,5, data "dd/mm hh:mm";
  autor só quando não é o vendedor do pedido. **A última tag é a situação atual**, em 700 e na cor da situação, sempre com texto:
  - Aprovado, Recebido no ERP, Faturado: `successBg`/`success`;
  - Em aprovação: `warningBg`/`warningInk`;
  - Rejeitado, Cancelado: `dangerBg`/`danger`;
  - as demais (Salvo, Na fila, Enviado, Faturado parcial, Transformado em pedido nº): fundo `ink`, texto branco.
  As anteriores ficam neutras (`neutralBg`/`neutralInk`, 500).
- Rodapé: as ações da tabela do `pedido-v2.md` §4.3 (ex.: rejeitado = **Corrigir pedido** + PDF · Duplicar). Orçamento com
  alerta que impede o pedido: principal **Editar** (sem Transformar) + PDF · Duplicar.
- Sai: o selo de situação, o motivo solto embaixo do selo, "Desconto efetivo (sem frete)", o cartão de aprovação, a linha de
  alçada no Campo e "Corrija e salve de novo".

## 3. Aba Itens (T-0148)
Ordem: **Alertas (§0.1, só se houver) · No pedido (compacto) · busca · resultados · rodapé Total do pedido + Avançar**. Sai a linha
"Total do pedido · n itens" do topo.
- Premissas aprovadas (R-20261110-093124): popup de baixo para cima; item acima do máximo ou sem estoque entra e o pedido só sai
  como orçamento; embalagens só as do cadastro do produto; "Ver itens" sem número.
- **No pedido**: painel `#E7EAE3` (sem borda, raio 12), título 11/600 maiúsculas; linhas de 44 dp com descrição 13 (uma linha,
  reticências), "4 UN" 13 `ink2` (44 dp) e o valor 13/700 (58 dp). Mais de 3 itens: só o título e o link **"Ver itens"**, sem a
  contagem, que já está na aba "Itens (n)" (RD-0070; TalkBack: "Ver os n itens do pedido") (`accentInk` 13/600, alvo 44); aberto,
  o link vira **"Recolher"**. Tocar na linha reabre o popup. Nenhuma marca de problema nas linhas: o problema está nos Alertas.
- **Resultado** (cartão branco): descrição 15/600 (até 2 linhas); abaixo, numa linha 12,5 `ink2`: **"Estoque 32 PCT"** (600 `ink`) ·
  descrição 2 resumida (reticências). Estoque zero no mesmo formato, **"Estoque 0 PCT"**, sem vermelho (é dado, não alerta). À
  direita: ícone `camera` 22 (alvo 44) só se o produto tiver foto e o botão **Adicionar** (secundário 44). Sem campo de
  quantidade na linha.
- **Popup** (`Folha`): descrição (Archivo 18/800), "código · Estoque n EMB" (estoque zero: só o código); **Alertas do item**
  (§0.1: `Sem estoque`, `Acima do desconto máximo de 10,0%`; acima do máximo, o campo Desc./Acrésc. ganha borda `danger` 2);
  **Embalagem** (Segmentado 48 com as do cadastro do produto: "UN", "PCT c/ 6", "CX c/ 48"); **Quantidade** (passo 48) e
  **Desc./Acrésc.** (`DescontoCompacto` 48) lado a lado; Totais do item (Tabela "3 × R$ 14,94" · linha líquida · **Total do
  item**); principal **Adicionar ao pedido**. Reaberto: principal **Salvar item** e **Remover do pedido** (texto `danger`). O total
  do pedido só muda ao confirmar. Com alerta, o botão continua: o item entra e o pedido só sai como orçamento. Sai o "Máximo
  10,0%" embaixo do campo.
- **Foto**: tocar na câmera baixa a foto (indicador no lugar da imagem), guarda no aparelho e abre em tela escura com ✕ e a
  descrição. Sem sinal e sem cópia: "Foto indisponível sem sinal."

## 4. Início e Pedidos (T-0153)
- Início: o `inicio.md` continua valendo, com 2 cortes: Orçamentos e A faturar só "3 · R$ 1.150" e "6 · R$ 3.989" (sem parênteses).
- Pedidos: Rascunhos (n) sem frase; a linha de contagem vira **"Total R$ 8.420"**; cada pedido em 2 linhas: cliente ··· total
  (Archivo 15/700) e **"Nº 000013 · hoje 05:55"** ··· selo (Rejeitado, Aprovado, Em aprovação, Orçamento, Faturado, Na fila).
  Recusa: + uma linha 13 `ink` com o motivo. Gestão: o vendedor no lugar da hora. Na lista o selo por linha **continua**
  (RN-VEN-42: é a única forma de ver a situação de vários pedidos).

### 4.1 Sinal, servidor e fila na tela Pedidos (RD-0076, R-20261110-104300; 10/11)
Regra: "uma informação, um lugar" e "nenhum aviso solto" (RN-VEN-42). A lista não tem área Alertas (os Alertas são do pedido);
o estado da lista fica num **único selo no cabeçalho**, à direita do título, no lugar do "↻ 06:30" da imagem T-0153.
Componente: **`SeloAtualizacao`** (`@macuxi/ui/mobile`, `sincronizacao.tsx`; textos em `desenhoSeloAtualizacao`, `atualizacao.ts`).

| Situação | Selo (texto visível) | Tom | Toque | Leitor de tela |
|---|---|---|---|---|
| Normal | ↻ **06:30** (nunca sincronizou: ↻ **Sincronizar**) | neutro (borda `line`, fundo branco) | Sincronizar (= puxar) | "Atualizado às 06:30" |
| Puxando / consultando o período no servidor | ↻ **Atualizando…** | neutro | nada | "Atualizando a lista" |
| Modo sem sinal ligado ou sem rede | ⚠ **Sem sinal** | atenção (`warningBg`/`warningInk`) | modo ligado: abre o Perfil; sem rede: tenta sincronizar | "Sem sinal. A lista mostra o que está no aparelho, atualizado às 06:30." |
| Sincronização ou consulta do período falhou | ⚠ **Sem resposta** | atenção | tenta de novo (puxar + nova consulta) | "Sem resposta do servidor. A lista mostra o que está no aparelho, atualizado às 06:30." |

Prioridade: Sem sinal > Atualizando… > Sem resposta > hora. Pílula de 32 dp, alvo de 44 dp (`hitSlop`), ícone 14 + texto 13
tabular; em atenção o texto é semibold.

**Saem da tela** (cada um já está no selo do cabeçalho ou na linha do pedido):
- faixa "1 pedido na fila do aparelho. Enviando automaticamente…" (a fila é o selo **Na fila** da linha; o Início tem "n na fila");
- faixa "Sem sinal: mostrando só o que o aparelho tem deste período." → selo **Sem sinal**;
- faixa "Sem resposta do servidor. Mostrando o que está no aparelho." → selo **Sem resposta**;
- texto "Buscando o restante no servidor…" → selo **Atualizando…**;
- o rodapé inteiro: "Atualizado às hh:mm · puxe para sincronizar" (a hora está no selo), "Modo sem sinal ligado · desligue no
  Perfil" (o toque no selo abre o Perfil) e o erro do motor em vermelho (selo **Sem resposta**).

**Ficam:**
- o cartão vazio (`textoDoVazio`), quando o período está todo fora dos 90 dias e não há resposta: é o conteúdo da lista, não um
  aviso a mais;
- o limite de 1.000 resultados entra na linha do total, sem frase solta: **"Total R$ 8.420 · 1.000 mais recentes"** (só quando a
  consulta foi cortada; para ver os demais, o vendedor escolhe um período menor no filtro).
- Busca: placeholder **"Cliente ou nº"** no Campo e no Gestão (a busca procura nome fantasia, razão social e nº; não procura
  código). A imagem T-0153 foi corrigida (10/11 ~11h40), junto com os chips sem número (RD-0077) e a frase da recusa (RD-0071).
