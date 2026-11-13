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
   **Alertas** mostram o problema. Contagem na aba não se repete no título da seção; total só nos Totais.
2. **Alçada só na área Alertas** (regra 3 do R-20261112-031456; RD-0142): uma linha `Desconto acima da sua alçada`, uma por
   pedido, venha o desconto do Desc./Acrésc. geral ou de um item (RN-VEN-10 olha o desconto do pedido inteiro). Ao tocar em
   "Salvar e enviar pedido", a pergunta `Enviar para aprovação?` (sem texto) com **Enviar** (principal) e **Voltar** (texto).
   Orçamento não pergunta.
3. **Nenhum aviso solto.** Todo problema que pede atenção ou correção vai para a área **Alertas** (§0.1). Fora dela não há linha
   de motivo acima dos botões, texto embaixo do botão, faixa colorida, bolinha na aba nem número em vermelho na tabela.
   Única marca fora dos Alertas: a **falta no campo** (borda `danger` e texto curto embaixo, §6.1), só depois da tentativa.
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
  | Informação faltante (RN-CORE-36; T-0166, RD-0170) | **só depois da tentativa** (§6.1): `Falta a transportadora · aba Entrega`, `Falta a forma de pagamento · aba Venda` ("· aba X" em `ink2`), nunca a da aba aberta: o campo já diz (RD-0189). Pedido recém-aberto: 0 alertas | a aba e o campo | o toque em salvar com falta não salva e leva à 1ª aba com falta; Apenas salvar continua |
  | Recusa do servidor (RN-VEN-40) | o motivo devolvido, curto; preço mínimo = `AGU-1500 acima do desconto máximo` | popup do item, se houver item | o que a recusa disser |
  | Recusa do supervisor | o motivo dele numa linha (o nome fica na etapa "Rejeitado" do Histórico) | — | — |
  | Crédito (RN-VEN-12) | `Limite de crédito excedido` | — | conforme o parâmetro (aprovação ou bloqueio) |
  | Alçada (RN-VEN-10; T-0165, RD-0142) | `Desconto acima da sua alçada` (uma por pedido) | a aba Itens | vai para aprovação (pergunta `Enviar para aprovação?`) |
  | Título vencido (RN-VEN-13; RD-0172) | `Título vencido`, **só quando muda o resultado**: atraso acima do limite do tenant com prazo a prazo (a conta da aprovação por vencido). Fora disso não aparece | — | só à vista ou com aprovação |
  | Cliente (RN-VEN-13; RD-0171) | **uma linha só**, a primeira que vale: `Cliente bloqueado` > `Cliente inativo` > `Cadastro do cliente incompleto: falta CEP e telefone` (os campos que faltam, RN-CORE-17; RD-0138) | — | só orçamento |
  | Sem forma para o cliente (RN-VEN-25; RD-0173) | `Sem forma de pagamento para este cliente` (junta "falta forma aceita" e "Cadastre as formas no BKO"); o campo Forma fica desligado com "—" | — | Salvar e enviar desligado |
  | Item fora da cópia (Duplicar; RD-0174) | `AGU-1500 fora da cópia: sem preço` ou `AGU-1500 fora da cópia: inativo` (um por item; sai a faixa) | — | nenhum |
  | Sem sinal na edição de pedido enviado (RD-0175) | `Sem sinal para salvar a alteração` (sai a faixa vermelha); os botões de salvar desligados | — | não salva |

  No popup do item o código sai (o popup já é do item): `Sem estoque`. O máximo do desconto fica **no campo** (§6.2, RD-0177).
- **Ordem:** §6.5 (T-0166).
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
- **Com informação faltante** (RN-CORE-36; T-0166, §6.1): os botões ficam **tocáveis**. O toque em Salvar e enviar pedido ou
  Salvar como orçamento com falta não salva: liga o modo "tentou", leva à 1ª aba com falta e marca os campos. Apenas salvar
  continua salvando com falta.
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
  (§0.1: `Sem estoque` ou `Acima do estoque`; o máximo fica no campo, §6.2);
  **Embalagem** (Segmentado 48 com as do cadastro do produto: "UN", "PCT c/ 6", "CX c/ 48"); **Quantidade** (passo 48) e
  **Desc./Acrésc.** (`DescontoCompacto` 48) lado a lado; Totais do item (Tabela "3 × R$ 14,94" · linha líquida · **Total do
  item**); principal **Adicionar ao pedido**. Reaberto: principal **Salvar alteração** e **Remover item** (texto `danger`; §5.8). O total
  do pedido só muda ao confirmar. Com alerta, o botão continua: o item entra e o pedido só sai como orçamento. Acima do
  máximo: **"Máx. 10,0%"** embaixo do campo, com a borda (§6.2, RD-0177; substitui o "Sai o Máximo" de 10/11).
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

## 5. Ajustes do teste da v1.0.4 (T-0165, v1.0.5)
> 2026-11-12 · designer-ux. **Versão final, aprovada pelo dono do produto** em R-20261112-031456 ("aprovo T-0165", com as
> simulações finais da ponte), mais R-20261112-031841 (coluna "Valor tabela") e R-20261112-032141 (% sempre na coluna; Totais
> com Desconto (%) e Desconto (R$)). Origem: os 13 ajustes de R-20261111-225010 e a revisão de R-20261112-023909/024013.
> **Imagens oficiais** (antes e depois; fonte: o `.html` de mesmo nome): `telas/T-0165-busca.png` (aba Itens),
> `telas/T-0165-desconto-geral.png`, `telas/T-0165-folha-do-item.png`, `telas/T-0165-venda.png` (sem mudança),
> `telas/T-0165-entrega.png` e `telas/T-0165-resumo.png`. **Vale a imagem aprovada**; este texto dá as medidas.
> Esta seção substitui: no §1, a ordem, o título "VENDA" e as linhas Pagamento/Prazo, a tabela de itens, as Observações, a
> linha "Desconto do pedido" e os Totais; no §3, o painel "No pedido", o botão Adicionar, a linha do resultado, o cabeçalho do
> popup, a linha de Embalagem e os Totais do popup; no §0, a regra 2 (alçada). As imagens finais `2026-11-12-T0165-final-*` e
> as regras do R-20261112-031456 substituem a v2 no que divergirem. **Ajustes do corretor** (RD-0142 a RD-0149, pré-aprovados
> pelo dono do produto; `docs/qualidade/redundancias/2026-11-12-T-0165-novo-pedido.md`) já aplicados aqui e nas imagens.

### 5.1 Totais: uma regra para a folha do item, o Resumo, o detalhe e o PDF
- **Sem desconto nem acréscimo:** uma linha só, **Valor final** (15/600 `ink` · Archivo 20/800; na folha do item, 18).
- **Com ajuste nos itens** (R-20261112-032141): **Valor de tabela** ··· R$ · **Desconto (%)** ··· "6,1%" · **Desconto (R$)** ···
  "− R$ 13,62" (U+2212) · **Valor final**. Com acréscimo: **Acréscimo (%)** e **Acréscimo (R$)** ("+ R$"). O % sai do rótulo.
  O % e o R$ são a soma dos ajustes dos itens sobre o valor de tabela (`linhasDosTotais`).
- Não há mais desconto nem acréscimo do pedido (§5.7): as duas linhas são só o resultado dos itens.
- `CartaoDeTotais` (Resumo e detalhe do pedido e do orçamento) e os totais da `FolhaDoItem` seguem a mesma regra; rótulos
  "Valor de tabela" e "Valor final". A aba Itens não tem total: o valor fica só no Resumo (RD-0149).
- **Arredondamento** (RN-VEN-02; R-20261112-041447): meia para cima no **preço unitário** da embalagem; total da linha =
  unitário × quantidade. Exemplo das imagens: AGU-1500 3 FD a 19,92 com −5,0% → 18,92 × 3 = **56,76**; LPO-400 6 UN a 17,75 com
  −10,0% → 15,98 × 6 = **95,88**; FIL-103 57,60. Valor de tabela R$ 223,86 · Desconto (%) 6,1% · Desconto (R$) − R$ 13,62 ·
  Valor final R$ 210,24. As simulações da ponte arredondavam a linha (56,77, 95,85, 210,22): vale a RN, não a imagem.
  Folha da ACO-1000 (RN-VEN-15): UN 7,18 × 12 = CX 86,16; 3 CX com 5,0% → 81,85 × 3: Valor de tabela R$ 258,48 · Desconto
  (R$) − R$ 12,93 · Valor final R$ 245,55 (a CX de 86,10 da simulação não existe pela RN-VEN-15).
- **PDF** (`pdf-pedido.md` §4): a caixa do Total do escritório segue a mesma regra (R-20261112-031456 regra 10 e 032141).

### 5.2 Folha do item (R-20261112-031456, regras 1 e 7)
- **Cabeçalho:** "nome - marca" na linha do ✕ (`titulo` da `Folha`: nome Archivo 18/800, " - Marca" IBM Plex Sans 18/400, até 2
  linhas). Sem marca no cadastro: só o nome. Abaixo, **só o código** (IBM Plex Mono 13 `ink2`).
- **Linha Embalagem · Estoque:** à esquerda, **EMBALAGEM** (`Segmentado` 48, as embalagens do cadastro, base primeiro, "FD c/ 6"
  numa linha) com a **mesma largura da Quantidade** (metade da linha menos 6 dp). À direita, **ESTOQUE**: rótulo 12/600 `ink2`
  alinhado à direita, em cima, e embaixo uma caixa de 84 × 48 dp (borda 1,5 `lineStrong`, raio 12, cabe "99.999") com **só o
  número** (15/600 tabular, sem a sigla: a embalagem está ao lado), inteiro para baixo, **na embalagem marcada** (FD c/ 6: 63;
  UN: 383). Com uma embalagem só, ela aparece sozinha e marcada.
- **Risco de ruptura** (exceção aprovada à regra "avisos só em Alertas": é informação do produto na escolha, não um
  impedimento): estoque **de 1 a 9** na embalagem marcada, a caixa fica com borda `accent`, fundo `accentSoft`, número
  `accentInk` e, embaixo, ícone `alerta` 14 + "Risco de ruptura" 12/600 `accentInk`. **Estoque 0:** caixa normal com "0"; o
  problema fica só no alerta `Sem estoque` do item (§0.1; RD-0144).
- **Quantidade** (`Passo` 48) e **Desc./Acrésc.** (`DescontoCompacto` 48) lado a lado, metade cada, 12 dp entre eles. Embalagem,
  Estoque, Quantidade e Desc./Acrésc. com a **mesma altura** (48 dp).
- **Item novo** entra com o último Desc./Acrésc. geral aplicado (§5.7). **Item já no pedido** (lápis na lista e no Resumo,
  §5.8) abre a folha reaberta, com o ajuste dele: principal **Salvar alteração** e **Remover item** (texto `danger`).
- Ordem: cabeçalho · Alertas do item (§0.1, só se houver) · Embalagem e Estoque · Quantidade e Desc./Acrésc. · Totais (§5.1) ·
  botão principal (· Remover item, reaberto). Espaço entre blocos 14.
- **Dado da demo:** a AGU-1500 tem UN e FD c/ 6 no seed (R-20261112-010513).

### 5.3 Aba Itens (R-20261112-031456, regras 4 a 6)
- **Ordem:** Alertas (só se houver) · **Desc./Acrésc. geral** (§5.7) · busca · lista · fim da aba (sugestões, Leve mais) ·
  Avançar. Saem o painel "No pedido" (com "Ver itens" e "Recolher") e o "Total do pedido": o total fica só no Resumo
  (RD-0149).
- **Busca:** `CampoBusca` 48 "Buscar produto", com ✕ para limpar quando tem texto. A consulta começa com **3 letras**, 250 ms
  depois da última tecla (R-20261112-033004).
- **Busca vazia:** a lista mostra os **itens do pedido** (com o lápis, §5.8), na ordem em que entraram. Com texto, os que não batem saem e voltam
  ao limpar.
- **Linha do produto** (cartão branco, linhas de 64 dp, traço `lineSoft`): **duas linhas por produto** (regra 4). A descrição
  2 aparece só no balão do nome (regra 5); sai a terceira linha do resultado (RD-0143).
  - linha 1: **nome** 15/600 + " - Marca" 15/400 (R-20261112-031456 regra 1; sem marca, só o nome). O nome tem sublinhado
    pontilhado (`ink2`, 1,5 px) e é tocável **quando o produto tem descrição 2**; sem descrição 2, sem sublinhado e sem toque;
  - linha 2, 13 `ink2`, 12 dp entre os pares: código (IBM Plex Mono 12,5) · **"Emb. FD c/ 6"** (sempre a embalagem principal do
    cadastro) · **"Est. 63"** (estoque nessa embalagem, inteiro para baixo) no fim. Estoque zero: "Est. 0", sem vermelho;
  - à direita, **"+"** 44 × 44 (borda 1,5 e ícone `mais` 22 em `accent`, raio 12): abre a folha do item; TalkBack "Adicionar
    <nome>". **Produto já no pedido:** no lugar do "+", o **lápis** (`BotaoEditar` `linha`, §5.8), que abre a folha reaberta
    (Salvar alteração, Remover item).
  - Câmera 44 só com foto, entre o texto e o "+" (como no §3).
- **Balão do nome** (regra 5): toque no nome abre o `Balao` logo abaixo dele, com a seta para o nome: **só a descrição 2**
  (13,5/400 branca, até 4 linhas, largura até 300 dp), sem repetir nome e marca. Fecha com outro toque em qualquer lugar ou ao
  rolar; um balão por vez. TalkBack: o nome lê a descrição 2 junto.
- **Mais de 20 resultados** (T-0167, R-20261112-033004; imagem `telas/T-0167-mostrar-mais.png`; `MostrarMais`): no fim da
  lista, "Mostrando 20 de 87" (13 `ink2`, centrado) e o botão **+ Mostrar mais** (secundário 44, largura toda); cada toque põe
  os próximos 20 da lista já ranqueada no fim, sem nova consulta e sem rolar a tela. Com tudo à vista, os dois somem. Com mais
  de 20, o Avançar vem depois do + Mostrar mais.
- **Nada encontrado** (`NadaEncontrado`): no lugar da lista, um cartão com "Nenhum produto com “agau”." (14 `ink`) e, quando o
  índice tem um termo parecido, **Você quis dizer “água”?** (14/600 `accentInk`, alvo 48; o toque busca o termo). Sem termo
  parecido, só a frase. O mesmo fim de lista vale no Catálogo (`rota-catalogo-perfil.md` §3).

### 5.4 Resumo (R-20261112-031456 regra 9, 031841 e 032141)
- **Ordem:** Alertas · Cliente · **Condição de pagamento** · Itens · Entrega · **Observação do pedido** · Totais · botões. Sai a
  linha "Desconto do pedido" (vira o Desc./Acrésc. geral da aba Itens, §5.7).
- **CONDIÇÃO DE PAGAMENTO** no lugar de "VENDA"; linhas **Forma** e **Prazo**.
- **Tabela de itens:** **Código · Emb. · Qtd · Valor tabela · Desc./Acrésc. · Total**, larguras 46/28/52/52/52 dp, 5 dp entre as
  colunas, Código com o resto; linha com 13 dp em cima e embaixo (≥ 44 dp). Sai a descrição.
  - **Código:** IBM Plex Mono 12,5 `accentInk` (7,9:1), sublinhado. O toque na célula do código abre o **balão** com
    **"nome - marca"** (14/400 branca numa linha, quebra se não couber), logo abaixo do código, com a seta para ele. Fecha com
    outro toque. TalkBack: "LPO-400, Leite em pó integral 400 g - Vale Verde".
  - **Emb.:** à esquerda, numa linha ("FD c/ 6", "UN"). **Qtd:** só o número.
  - **Valor tabela** = quantidade × preço de tabela da embalagem, antes do ajuste (AGU-1500, 3 FD c/ 6 a 19,92 → 59,76). A soma
    da coluna é o Valor de tabela dos Totais.
  - **Desc./Acrésc.:** **sempre em %**, também quando o vendedor deu o ajuste em R$ (valor ÷ valor de tabela do item, uma casa):
    "−5,0%", "+10,0%" e, sem ajuste, "0,0%" em `ink2`. O mesmo formato no detalhe e no PDF do escritório.
  - **Total** 13/700. Números sem "R$", alinhados à direita, tabulares.
  - Depois do Total, o **lápis** pequeno (`BotaoEditar` `tabela`, §5.8). O toque nele ou no resto da linha abre a folha do item
    (reaberta).
- **Entrega:** tabela **Frete**, **Endereço** e **Observação** (a da entrega; vazia, a linha não aparece).
- **Observação do pedido:** campo editável aqui (o único lugar dela no Novo pedido), título "OBSERVAÇÃO DO PEDIDO", caixa de
  64 dp que cresce com o texto, até 500 caracteres, sem texto dentro quando vazia (RD-0147). O PDF não muda.
- **Totais:** §5.1. Botões: §1.

### 5.5 Aba Venda (ajuste 7)
- Ordem: Alertas · **CLIENTE** · Forma de pagamento e Prazo · Crédito do cliente · Avançar.
- Tabela Cliente (`TabelaRotuloValor`, só leitura): **Endereço** (o do cadastro, principal: rua e número · bairro · cidade/UF,
  quebra em linhas), **Filial** (a filial de faturamento do cliente, nome do cadastro; tenant com uma filial só, a linha não
  aparece) e **CNPJ** (com máscara; CPF na pessoa física; vazio "—"). O nome fantasia e o código ficam só no cabeçalho.

### 5.6 Aba Entrega (R-20261112-031456, regra 8)
- **Ordem e títulos** (12/600 maiúsculas `ink2`, `RotuloSecao`): **FRETE** (CIF | FOB) · **TRANSPORTADORA** (só no FOB) ·
  **ENDEREÇO** (com "Editar") · **OBSERVAÇÃO** · Avançar. Os títulos não repetem "entrega": a aba já diz (RD-0145). CIF: só o
  seletor; o endereço sobe logo abaixo dele. A folha de editar o endereço mantém o título dela.
- **TRANSPORTADORA** (RD-0146): título no mesmo estilo de FRETE. Saem os chips. Campo de escolha 48 dp (borda `lineStrong`,
  raio 12) com o nome 15 `ink` e a seta 18; vazio, **"Escolher"** em `ink3`. O toque abre a **folha "Transportadora"** (`Folha`,
  título Archivo 18/800):
  - `CampoBusca` "Buscar" (procura no nome, sem acento e sem caixa);
  - as transportadoras **ativas do cadastro do BKO** (`vendedor.transportadora`, baixadas no aparelho; funciona sem sinal), em
    ordem alfabética, linhas de 52 dp 15 `ink`; a escolhida com ✓ `accent` sobre `accentSoft`;
  - **"Outra (digitar)"** sempre por último (15/600 `accentInk`), também quando a busca não acha nada;
  - tocar numa linha escolhe e fecha a folha.
  Com "Outra (digitar)", o campo mostra "Outra" e abrem embaixo **Nome** e **CNPJ**, como hoje (RN-VEN-16;
  `TransportadoraDigitada`). Sem transportadora no cadastro, o campo não aparece e ficam direto Nome e CNPJ.
- **OBSERVAÇÃO** (a da entrega): um campo só (até 500 caracteres), sem texto dentro quando vazio (o mesmo da Observação do
  pedido). A Observação do pedido sai daqui e vai para o Resumo (§5.4), onde a da entrega aparece como "Observação" dentro de
  ENTREGA. A linha automática do
  cadastro incompleto (RN-CORE-17) não aparece no pedido: os campos que faltam estão no alerta do cliente (§0.1; RD-0138).
  **Falta a transportadora** (T-0166, RD-0170): **no campo** (borda `danger` e "Obrigatório" embaixo, `CampoEscolha` com
  `falta`); **em Alertas só na tentativa** (§6.1). Antes disso, o campo vazio mostra "Escolher" e nada mais. CNPJ digitado
  inválido: "CNPJ inválido" embaixo do campo CNPJ ao sair dele.

### 5.7 Desc./Acrésc. geral na aba Itens (R-20261112-031456, regras 2 e 3)
- **Regra nova:** não existe mais desconto nem acréscimo sobre o total do pedido; o ajuste fica **sempre no item**. Sai o
  "Desconto do pedido" do Resumo. A RN entra no doc 03 (gerente-projetos): muda a RN-VEN-02 na parte do desconto do pedido e o
  rateio pelo maior resto deixa de existir.
- **Onde:** no topo da aba Itens, abaixo dos Alertas e acima da busca. Título de seção "DESC./ACRÉSC. GERAL" e, numa linha,
  `DescontoCompacto` (48 dp, só os tipos **Desc %** e **Acrésc %**, valor com uma casa, alinhado à direita) com o resto da
  largura e o botão **Aplicar** (secundário 48, padding 16). Sem botão principal na aba.
- **Aplicar** desligado com o campo vazio ou quando todos os itens já têm esse ajuste. Ligado: aplica o % em **todos os itens**
  do pedido e **sobrescreve** o ajuste que cada um tinha (em % ou em R$).
- **Pergunta** (`Dialogo`, só o título; RD-0148), só quando algum item tem outro ajuste: `Trocar o desconto de todos os itens
  por 5,0%?` (o % e o sinal vêm do campo; acréscimo: `Trocar o desconto ou acréscimo de todos os itens por +3,0%?`), botões
  **Trocar** (principal) e **Voltar** (texto). Sem diferença ou sem itens: aplica direto, sem pergunta.
- **Depois de aplicar:** o Aplicar desliga; nenhum aviso a mais. Cada item continua editável na folha (o vendedor muda só
  aquele item).
- **Item novo** entra com o último geral aplicado. Sem itens, o Aplicar guarda o % para os que entrarem. O campo fica com o
  último geral enquanto o pedido está aberto; ao reabrir um rascunho, volta vazio (o geral não é gravado no pedido: vale o
  ajuste de cada item).
- **Acima da alçada** (regra 3 aprovada, com o RD-0142): quando o desconto do pedido inteiro passa da alçada do vendedor
  (RN-VEN-10), venha do geral ou dos itens, entra **uma** linha nos Alertas, `Desconto acima da sua alçada` (toque leva à aba
  Itens); some quando o desconto volta para dentro da alçada. Ao salvar, a pergunta `Enviar para aprovação?` (§0, regra 2).
- **Acima do desconto máximo** de um produto (RN-VEN-11): o % entra no item, o item vai para os Alertas
  (`AGU-1500 acima do desconto máximo`, toque abre a folha) e o pedido só sai como orçamento, igual ao item digitado na folha.
- **Componentes:** `DescontoCompacto` (2 tipos), `Botao` secundário, `Dialogo`. Novos em `@macuxi/ui/mobile` (designer-ux):
  `Balao` (§5.3 e §5.4) e `CampoEscolha` (campo + folha com busca e opção final, §5.6; com `falta`, §6.1).

### 5.8 Lápis Editar no item do pedido (R-20261112-082212, aprovado com imagens)
> 2026-11-12 · designer-ux. **Imagens aprovadas** (fonte: `telas/T-0165-editar.html`): `telas/T-0165-editar-itens.png` (aba
> Itens, busca vazia), `telas/T-0165-editar-busca.png` (com busca), `telas/T-0165-editar-resumo.png` (Resumo) e
> `telas/T-0165-editar-folha.png` (folha reaberta). Substitui o ✓ do §5.3 e os botões "Salvar item" e "Remover do pedido" do §3
> e do §5.2. Vale a imagem para o lápis e a folha reaberta; o resto segue o §5.1 a §5.4: os números (§5.1; as simulações
> arredondavam a linha: 56,77, 95,85, − R$ 13,64, R$ 210,22), a Observação do pedido vazia sem texto dentro (§5.4, RD-0147) e o
> Avançar no fim da aba Itens (§5.3).
- **Componente:** `BotaoEditar` (`@macuxi/ui/mobile`): borda `accent` 1,5, fundo `accentSoft`, ícone `edit` em `accentInk`
  (6,3:1), toque do kit (escala 0,97). Dois tamanhos, os dois com alvo de 48 dp:
  - `linha`: 44 × 44, raio 12, ícone 20;
  - `tabela`: 32 × 32, raio 9, ícone 16, folga de toque de 8 dp em volta.
- **Aba Itens:** o item que já está no pedido mostra o lápis (`linha`) **no lugar do "+"**, na mesma posição e tamanho. Busca
  vazia: todos os itens da lista têm o lápis. Com busca: o item já no pedido tem o lápis; os outros continuam com o "+".
  TalkBack: "Água mineral 1,5 L, no pedido. Editar".
- **Resumo:** na tabela de itens, uma 7ª coluna **sem título**, depois do Total, com o lápis (`tabela`) centrado na linha.
  Nenhuma coluna é cortada nem perde o título:
  - janela de **400 dp ou mais**: cartão com 10 dp à esquerda e 6 à direita, vão 5, colunas Emb. 46 · Qtd 28 · Valor tabela
    52 · Desc./Acrésc. 52 · Total 52 · lápis 32;
  - janela **menor que 400 dp** (até 360): cartão com 6 e 2, vão 3, colunas 44 · 24 · 46 · 44 · 50 · 32;
  - nos dois casos a margem da tela fica em 16 e o Código fica com o resto (no mínimo 58 dp, cabe "AGU-1500"). Fonte e
    alinhamento como no §5.4.
  TalkBack: "Editar AGU-1500".
- **Ao tocar no lápis** (Itens ou Resumo) ou no resto da linha do Resumo: abre a mesma `Folha` do item (§5.2), já com a
  embalagem, a quantidade e o Desc./Acrésc. do item. Totais da folha: §5.1. Embaixo:
  - **Salvar alteração** (principal 52, largura toda; no lugar de "Adicionar ao pedido"): grava e fecha a folha;
  - **Remover item** (texto 15/600 `danger`, alvo 48, centrado, 12 dp abaixo do principal): tira o item, fecha a folha e mostra
    o `AvisoRodape` "Item removido" com **Desfazer** (5 s), que devolve o item com a embalagem, a quantidade e o ajuste. Sem
    pergunta antes (aprovado pelo dono do produto, R-20261112-155448).
  - Fechar no ✕, no Voltar ou tocando fora: não muda nada.
- **Item novo** (o "+"): a folha continua com **Adicionar ao pedido** e sem "Remover item".

## 6. Menos alertas (T-0166, v1.0.5)
> 2026-11-12 · designer-ux. Pedido do dono do produto R-20261112-031457 ("qualquer falta de informação vira alerta"), com as
> sugestões do corretor **pré-aprovadas** (R-20261112-033620; relatório `docs/qualidade/redundancias/2026-11-12-T-0166-alertas.md`,
> RD-0170 a RD-0188). Critério: alerta só para o que **bloqueia ou muda o resultado** do pedido (envio, preço, alçada, crédito,
> estoque, cadastro obrigatório). Dado opcional faltando não vira alerta. Vale para o Novo pedido, o checkout e a pesquisa
> (`formulario-pendencias.md` §0.0). Substitui, no §0.1, a linha "Informação faltante" e, no §1, o botão desligado por falta.

### 6.1 Falta no campo: só na tentativa (RN-CORE-36; RD-0170)
1. **Antes de tentar**, o campo vazio fica no estado normal ("Escolher", "Itens (0)", campo em branco). Sem vermelho e sem
   linha em Alertas. **Pedido recém-aberto: 0 alertas.**
2. **Avançar** (troca de aba) não bloqueia, porque Apenas salvar aceita pendência (RN-VEN-38). As faltas da aba que o vendedor
   **deixou** ficam marcadas nos campos dela e entram em Alertas enquanto ele estiver em outra aba (RD-0189).
3. **Salvar e enviar pedido**, **Salvar como orçamento** e **Transformar** ficam **tocáveis**. Com falta, o toque não salva:
   liga o modo "tentou" (os campos com falta ficam marcados, e as faltas das outras abas entram em Alertas) e a tela leva à
   **1ª aba com falta**, rolando até o 1º campo marcado. O TalkBack lê a 1ª falta do campo. No Resumo, que não tem campo
   obrigatório, aparecem todas as faltas.
4. **Valor inválido digitado** (CNPJ, desconto acima do preço, quantidade): aparece no campo **ao sair dele** (perder o foco),
   com borda e texto curto. Em Alertas, só na tentativa.
5. **Some sozinho:** corrigido o campo, a borda, o texto e a linha do Alerta somem na hora, sem animação. O modo "tentou" fica
   ligado até o pedido ser salvo ou descartado.
6. **Marca do campo** (`@macuxi/ui/mobile`: `TextoDaFalta`, `bordaDaFalta`, `faltaVisivel`; `CampoEscolha` com a prop `falta`):
   borda `danger` de 2 dp no próprio campo e, logo embaixo (4 dp), ícone `alerta` 14 + texto 12,5/600 `danger` (6,4:1 no
   fundo), uma linha, sem ponto. Nada de fundo vermelho, faixa ou bolinha na aba. TalkBack: o campo lê "<rótulo>, <texto>".
7. **Textos curtos** (o domain do módulo escolhe; o kit só desenha):

   | Situação | Texto embaixo do campo | Linha em Alertas (na tentativa, vista de outra aba) |
   |---|---|---|
   | obrigatório vazio (forma, prazo, transportadora, nome/CNPJ da transportadora digitada) | `Obrigatório` | `Falta a forma de pagamento · aba Venda` |
   | forma ou prazo que saiu da lista | `Saiu da lista` | `Falta a forma de pagamento · aba Venda` |
   | prazo que não vale para a forma | `Não vale para esta forma` | `Falta o prazo de pagamento · aba Venda` |
   | forma não aceita pelo cliente (RN-VEN-25) | `Não aceita pelo cliente` | `Falta a forma de pagamento · aba Venda` |
   | prazo acima do prazo médio (RN-VEN-25) | `Acima do prazo médio` | `Falta o prazo de pagamento · aba Venda` |
   | CNPJ da transportadora digitada (RN-VEN-16) | `CNPJ inválido` | `CNPJ da transportadora inválido · aba Entrega` |
   | desconto do item acima do preço (RN-VEN-02) | `Acima do preço` | `AGU-1500 com desconto acima do preço` |
   | quantidade fora do múltiplo ou zero (RN-VEN-21) | `Quantidade inválida` | `AGU-1500 com quantidade inválida` |
   | nenhum item | (sem campo: a aba mostra "Itens (0)" e a lista vazia) | `Falta pelo menos 1 item · aba Itens` |

### 6.2 Folha do item: o máximo no campo (RD-0177)
- Acima do desconto máximo do produto (RN-VEN-11): borda `danger` 2 no `DescontoCompacto` e **"Máx. 10,0%"** embaixo dele
  (`TextoDaFalta`), na hora (não espera tentativa: o item entra, e o pedido só sai como orçamento). Sai a linha
  "Acima do desconto máximo de 10,0%" dos Alertas do item. Nos Alertas do pedido, `AGU-1500 acima do desconto máximo` fica.
- Os Alertas do item ficam só com `Sem estoque` / `Acima do estoque`. A exceção do **Risco de ruptura** (§5.2) não muda.

### 6.3 Folha "Sair do pedido?" sem a linha de motivo (RD-0176)
A folha mostra só as opções possíveis (sem a linha `aviso` "Cliente bloqueado: só dá para salvar como orçamento" ou
"AGU-1500 acima do desconto máximo"): o motivo já está em Alertas. Vale também para a variante da RN-VEN-13
(`formulario-pendencias.md` §2.3).

### 6.4 Faixas e frases que saem do Novo pedido (RD-0174, RD-0175, RD-0178)
- Saem: a faixa "Cópia do pedido 123 com os preços de hoje…", a faixa "Quantidade acima do estoque atual…" (o alerta de estoque
  já diz), a faixa "Sem sinal. Preço e estoque de 14:32.", a nota "Envia quando o sinal voltar." (a confirmação "Pedido salvo
  no aparelho." fica), "Só neste pedido. O cadastro do cliente não muda." (folha do endereço), "Sem dados de crédito deste
  cliente." e "Crédito indisponível agora. Sincronize o aparelho." (a tabela Limite · Disponível · Prazo médio fica com "—").
- Viram linhas de Alertas (§0.1): os itens fora da cópia e o "Sem sinal para salvar a alteração".

### 6.5 Ordem dos Alertas (substitui a do §0.1)
Cliente (uma linha) · sem forma para o cliente · faltas (só na tentativa, na ordem das abas) · máximo · estoque · fora da cópia
· sem sinal · crédito · título vencido · alçada. Dentro de cada tipo, na ordem dos itens.
