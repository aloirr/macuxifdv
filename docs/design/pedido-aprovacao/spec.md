# Pedido em aprovação por crédito e inadimplência (T-0184, P-6) e tabela simples de Pedidos do BKO

Simulação para o dono do produto aprovar em 19/11, **antes do código**. Origem: T-0184 (R-20261117-234127 e R-20261117-234437),
R-20261116-143000 e R-20261118-212716 (tabela simples de Pedidos). Gerador: `node docs/design/pedido-aprovacao/gerar.mjs`.

| Prancha | O que mostra |
|---|---|
| `01-bko-parametros-pedidos.png` | Parâmetros › Pedidos: Alçadas (#412, como está) e o quadro novo **Crédito e inadimplência** com o campo **Quem aprova** |
| `02-campo-enviar-e-detalhe.png` | Campo: Novo pedido com os motivos em Alertas e a pergunta `Enviar para aprovação?`; o pedido em aprovação com o motivo no Histórico |
| `03-gestao-aprovacoes.png` | Gestão: a fila de Aprovações com os motivos na linha de apoio |
| `04-bko-pedidos-tabela.png` | BKO › Operação › Pedidos: tabela simples com Situação e Ações, sem o quadro "Aguardando aprovação" |

## 1. O que muda nas telas
- **BKO, Parâmetros › Pedidos:** abaixo das Alçadas, o quadro `Crédito e inadimplência` com uma linha: `Quem aprova` + lista
  suspensa (Supervisor, Gerente, Analista comercial — os mesmos níveis das Alçadas) e Descartar/Salvar. Sem subtítulo nem texto de
  explicação (§P1, §P9 do menu Parâmetros). O limite não aparece: é o que vem do ERP (RN-VEN-12, resposta 2).
- **Campo, Novo pedido:** os textos da área Alertas já existem (`pedido-v4.md` §0.1): `Limite de crédito excedido` e
  `Título vencido`. Muda só o efeito: os dois passam a mandar para aprovação, como a alçada, com a mesma pergunta
  `Enviar para aprovação?` (Enviar / Voltar). Nenhum texto novo no Campo.
- **Campo, pedido em aprovação:** sem Alertas (não há o que corrigir). O motivo aparece **uma vez**, na etapa atual do Histórico:
  `Em aprovação · Crédito · Inadimplente` (rótulos curtos: Desconto, Crédito, Inadimplente). Gestão e BKO usam o mesmo detalhe.
- **Gestão, Aprovações:** a linha de motivos (`linhaDeMotivos`) ganha `Inadimplente há N dias`; o crédito continua
  `Crédito disponível R$ X`. Exige o motivo novo `inadimplencia` em `MotivoAprovacao` (contratos do vendedor e do gestor;
  engenheiro-software decide versão e ADR).
- **Offline:** o app calcula com os dados da última sincronização e mostra os mesmos alertas; o servidor revalida ao receber
  (critério 4). Nenhuma tela nova.
- **BKO › Pedidos (tabela simples):** colunas Cliente · Nº · Vendedor · Recebido · Valor · Situação · Ações. Situação só com os
  status de `ORDER_STATUS_LABEL` (sem status novo). Ações só no pedido `Aguardando aprovação`: **Aprovar** (principal),
  **Rejeitar**, **Devolver ao vendedor**. O motivo fica numa linha 13 `ink2` sob o nome do cliente, só no pendente. Sai o quadro
  "Aguardando aprovação".

## 2. Pontos para o dono do produto (opções A/B e recomendação)
| Ponto | A | B | Recomendação |
|---|---|---|---|
| **P1** Inadimplente com pedido à vista | vai para aprovação (muda a RN-VEN-13) | passa direto, como hoje | **A**: é o que diz a resposta 3 |
| **P2** Quem aprova o inadimplente | o mesmo campo do crédito (um campo só: "Crédito e inadimplência") | a tabela de Alçadas | **A**: os dois são risco financeiro; um campo, uma regra |
| **P3** Pedido com mais de um motivo | uma aprovação só, com o aprovador mais alto entre os motivos, e todos os motivos na tela | uma aprovação por motivo, em sequência | **A**: o aprovador decide uma vez vendo tudo |
| **P4** Cliente sem limite informado pelo ERP | sem crédito: o pedido a prazo vai para aprovação com o motivo Crédito | sem trava: passa | **A**: mais seguro. Atenção: se o ERP de uma empresa não manda limite, todo pedido a prazo dela vai para aprovação |
| **P5** Campo "Quem aprova" vazio (critério 2) | Supervisor | Gerente | **B**: o campo já vem preenchido com Gerente, e o admin troca |
| **P6** Rejeitar × Devolver ao vendedor (BKO › Pedidos), sem status novo | Rejeitar encerra (`Cancelado`); Devolver volta para corrigir (`Rejeitado`, "Corrigir pedido" no Campo) | só Aprovar e Rejeitar (o Rejeitado já volta ao vendedor) | **A**: as três ações pedidas, com os status que existem. O modulo-vendedor confirma a transição `pending_approval → cancelled` |

## 3. Depois da aprovação
- gerente-projetos: RN-VEN-12 e RN-VEN-13 no doc 03 com a decisão.
- engenheiro-software: motivo `inadimplencia` e o parâmetro do aprovador nos contratos; desenho do servidor.
- modulo-vendedor: o envio para aprovação pelo caminho da alçada; a tabela de Pedidos do BKO.
- modulo-gestor: `linhaDeMotivos` com Inadimplente.
- design-de-marca e corretor-redundancias: parecer das pranchas e das telas.
