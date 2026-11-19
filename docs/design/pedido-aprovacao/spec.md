# Pedido em aprovação por crédito e inadimplência (T-0184, P-6) e tabela simples de Pedidos do BKO

Simulação para o dono do produto aprovar em 19/11, **antes do código**. Origem: T-0184 (R-20261117-234127 e R-20261117-234437),
R-20261116-143000 e R-20261118-212716 (tabela simples de Pedidos). Gerador: `node docs/design/pedido-aprovacao/gerar.mjs`.

| Prancha | O que mostra |
|---|---|
| `01-bko-parametros-pedidos.png` | Parâmetros › Pedidos: Alçadas (#412, como está) e o quadro novo **Crédito e inadimplência** com **Quem aprova crédito** e **Quem aprova inadimplência** (P2 B) |
| `02-campo-enviar-e-detalhe.png` | Campo: Novo pedido com os motivos em Alertas e a pergunta `Enviar para aprovação?`; o pedido em aprovação com uma etapa por motivo no Histórico (P3 B, P7 A); o crédito devolvido encerrando a aprovação pendente (P8 A) |
| `03-gestao-aprovacoes.png` | Gestão: a fila de Aprovações do Gerente, um item por motivo, só os motivos dele (P3 B) |
| `04-bko-pedidos-tabela.png` | BKO › Operação › Pedidos em 1366×768: as 13 colunas de R-20261118-214740, rolagem horizontal com as pontas fixas |
| `04b-bko-pedidos-tabela-larga.png` | A mesma tabela em 1920×1080: todas as colunas à vista, sem rolagem |

## 1. O que muda nas telas
- **BKO, Parâmetros › Pedidos:** abaixo das Alçadas, o quadro `Crédito e inadimplência` com duas linhas (P2 B):
  `Quem aprova crédito` e `Quem aprova inadimplência`, cada uma com lista suspensa (Supervisor, Gerente, Analista comercial — os
  mesmos níveis das Alçadas), as duas preenchidas com Gerente (P5 B), e Descartar/Salvar. Sem subtítulo nem texto de
  explicação (§P1, §P9 do menu Parâmetros). O limite não aparece: é o que vem do ERP (RN-VEN-12, resposta 2).
- **Campo, Novo pedido:** os textos da área Alertas já existem (`pedido-v4.md` §0.1): `Limite de crédito excedido` e
  `Título vencido`. Muda só o efeito: os dois passam a mandar para aprovação, como a alçada, com a mesma pergunta
  `Enviar para aprovação?` (Enviar / Voltar). Nenhum texto novo no Campo.
- **Campo, pedido em aprovação (P3 B):** sem Alertas (não há o que corrigir). Uma etapa por motivo no Histórico, cada motivo
  **uma vez**: a pendente `Em aprovação · Crédito` no tom `destaque` (Azul noite #1E3350 sobre Azul suave #DFE2E6, 12/600,
  MC-1744; sem amarelo); a aprovada vira `Aprovado · Inadimplente · Rui Matos · 18/11 10:05` no tom `sucesso` (o autor aparece
  porque não é o vendedor, `historico.ts`). Rótulos curtos: Desconto, Crédito, Inadimplente. Com P8 A, a devolução de um motivo
  mostra `Rejeitado · Crédito · Rui Matos · 18/11 10:20` (tom `erro`) com o motivo em 1 linha, a etapa pendente sai e o rodapé
  traz `Corrigir pedido`. Totais só com `Valor final` (pedido-v4 §5.1; RD-2230). Gestão e BKO usam o mesmo detalhe.
- **Gestão, Aprovações (P3 B):** um item por motivo; cada aprovador vê só os motivos dele. O item leva o nº do pedido e o
  motivo: `Nº 000021 · Crédito disponível R$ 1.880,00`, `Nº 000021 · Inadimplente há 12 dias`, `Nº 000020 · Desconto 12%`
  (o desconto de 12% cai no Gerente pela alçada até 15%). Com crédito e inadimplência no mesmo aprovador (P5 B), o pedido
  aparece uma vez por motivo, cada um com o seu `Decidir` (12/600, MC-1747). Exige o motivo novo `inadimplencia` em `MotivoAprovacao` (contratos do vendedor e do gestor;
  engenheiro-software decide versão e ADR).
- **Offline:** o app calcula com os dados da última sincronização e mostra os mesmos alertas; o servidor revalida ao receber
  (critério 4). Nenhuma tela nova.
- **BKO › Pedidos (tabela, R-20261118-214740):** colunas nesta ordem: Código do cliente · Cliente · UF · Cidade · Nº · Vendedor ·
  Supervisor · Recebido · Valor · Motivo · Observação do pedido · Situação · Ações. Sai o quadro "Aguardando aprovação".
  - **Substitui** (RD-2231), em `docs/design/telas/bko-revisao.md`, as linhas 246 a 250 (regras 5 e 6 e o "Texto final
    (Pedidos)": quadro "Aguardando aprovação" em cima; pendente fora da lista, da contagem e do total; select Situação sem
    "Aguardando aprovação") e as linhas 358 e 359 (decisão h, opções a e b). Vale agora: sem quadro de pendências; o pendente
    fica na lista, na contagem e no total, com o selo `Aguardando aprovação` e as Ações na linha; o filtro Situação oferece
    `Aguardando aprovação`. O pendente continua num lugar só (RD-0363): a linha da tabela.
  - **Motivo** vira coluna (`Crédito`, `Inadimplente`, `Desconto 12%`); vazio = `—`, como nas outras tabelas do BKO. A
    **Observação** também usa `—` quando vazia e quebra em até 2 linhas; o Cliente também quebra. Nada com reticências (RD-2233).
  - **Ações** só no pedido `Aguardando aprovação`: lista suspensa (Aprovar, Rejeitar, Devolver ao vendedor; vazia mostra
    `Escolher ação`) e um botão ao lado. Rótulo do botão: A **Aplicar**, B Confirmar, C Executar. **Decidido: Aplicar** (18/11, R-20261118-220604). Por quê:
    "Aplicar" é o padrão de ação escolhida numa lista em BKO, verbo curto que não se confunde com "Aprovar".
  - **Situação** antes de Ações (as duas por último), só com `ORDER_STATUS_LABEL`, no selo do sistema (`SeloSituacao`, MC-1743): Aguardando aprovação
    `pending` (#1E3350 sobre #DFE2E6), Aprovado e Faturado `success`, Enviado ao ERP `neutral`, Rejeitado `danger`; peso 500.
  - **Marca:** lista e botão de Ações em 15 px; rótulos dos filtros 12/600; cabeçalho 12; Código, Nº, Recebido e Valor com
    `tabular-nums`.

## Prancha 04: largura
13 colunas não cabem nos ~1030 px de conteúdo de uma tela 1366×768.

| Opção | Como fica | Recomendação |
|---|---|---|
| **A** | Rolagem horizontal: Código + Cliente fixos à esquerda, Situação + Ações fixas à direita (`position: sticky`), as do meio rolam; barra visível e sombra sutil na borda interna das fixas | **A**: funciona em 1366, o notebook comum do escritório, e deixa cliente e ação sempre à vista |
| **B** | Abaixo de 1600 px somem, nesta ordem, UF, Cidade, Supervisor e Observação | — |
| **C** | Exigir tela larga (1920) | — |

Em 1920×1080 (`04b`) as 13 colunas cabem sem rolagem nas três opções.

## 2. Pontos para o dono do produto (opções A/B e recomendação)
| Ponto | A | B | Recomendação | Decisão (18/11) |
|---|---|---|---|---|
| **P1** Inadimplente com pedido à vista | vai para aprovação (muda a RN-VEN-13) | passa direto, como hoje | **A**: é o que diz a resposta 3 | **A** |
| **P2** Quem aprova o inadimplente | o mesmo campo do crédito (um campo só: "Crédito e inadimplência") | a tabela de Alçadas | **A**: os dois são risco financeiro; um campo, uma regra | **B**, com dois campos no quadro: "Quem aprova crédito" e "Quem aprova inadimplência" (prancha 01) |
| **P3** Pedido com mais de um motivo | uma aprovação só, com o aprovador mais alto entre os motivos, e todos os motivos na tela | uma aprovação por motivo, em sequência | **A**: o aprovador decide uma vez vendo tudo | **B** (abre P7 e P8, abaixo) |
| **P4** Cliente sem limite informado pelo ERP | sem crédito: o pedido a prazo vai para aprovação com o motivo Crédito | sem trava: passa | **A**: mais seguro. Atenção: se o ERP de uma empresa não manda limite, todo pedido a prazo dela vai para aprovação | **A** |
| **P5** Campo "Quem aprova" vazio (critério 2) | Supervisor | Gerente | **B**: o campo já vem preenchido com Gerente, e o admin troca | **B**: os dois campos vêm com Gerente |
| **P6** Rejeitar × Devolver ao vendedor (BKO › Pedidos), sem status novo | Rejeitar encerra (`Cancelado`); Devolver volta para corrigir (`Rejeitado`, "Corrigir pedido" no Campo) | só Aprovar e Rejeitar (o Rejeitado já volta ao vendedor) | **A**: as três ações pedidas, com os status que existem. O modulo-vendedor confirma a transição `pending_approval → cancelled` | **A** |

Decisões do dono do produto em 18/11 (R-20261118-214740).

## Pontos da P3 B
| Ponto | A | B | Recomendação | Decisão (18/11) |
|---|---|---|---|---|
| **P7** As aprovações acontecem ao mesmo tempo ou em ordem? | ao mesmo tempo: cada aprovador decide quando quiser; o pedido sai quando todas aprovarem | em ordem: crédito → inadimplência → desconto | **A**: mais rápido; nenhum motivo depende do outro. A prancha 02 mostra a inadimplência aprovada antes do crédito | **A** |
| **P8** A rejeição de um motivo devolve o pedido inteiro? | sim: uma rejeição encerra as outras aprovações pendentes e o pedido segue o P6 (Rejeitar = `Cancelado`; Devolver = `Rejeitado` com "Corrigir pedido") | não: as outras continuam e o vendedor só vê o resultado no fim | **A**: o vendedor corrige uma vez; ninguém aprova o que já caiu. A 3ª tela da prancha 02 mostra o crédito devolvido e a etapa pendente encerrada | **A** |

Decisões do dono do produto em 18/11 (R-20261118-220604), sobre as simulações: P7 A, P8 A e o rótulo "Aplicar".

## 3. Depois da aprovação
- gerente-projetos: RN-VEN-12 e RN-VEN-13 no doc 03 com a decisão.
- engenheiro-software: motivo `inadimplencia` e o parâmetro do aprovador nos contratos; desenho do servidor.
- modulo-vendedor: o envio para aprovação pelo caminho da alçada; a tabela de Pedidos do BKO.
- modulo-gestor: `linhaDeMotivos` com Inadimplente.
- design-de-marca e corretor-redundancias: parecer das pranchas e das telas.
