# BKO → Sistema → Integração ERP: uma linha por entidade (T-0173; desenho da v1.0.19)

Decisão do dono do produto R-20261115-110600, item 3. Tela de referência: 1366×768, sem rolagem lateral.
Regras do corretor: uma informação, um lugar; só o texto que a pessoa usa para agir.

## 1. O que sai da tela
Saem o de-para (mapeamento), os cards "Pedidos no ERP", conectores, alertas, carga por entidade, inativações, os KPIs do topo, o filtro "Conector",
"Só com erro" e "Exportar lotes (CSV)". O de-para vai para Parâmetros → Integração (seção 9).

## 2. Ordem na tela (desenho aprovado na v1.0.19)
1. `PageHeader` com o título **Integração ERP** e, no `subtitle`, só a linha de identificação **‹conector› · v‹versão› · última carga
   recebida 15/11 às 01:02** (do lote mais recente; sem lote, sem linha); à direita, a ação `Button variant="link"` **Atualizar**. Sem filtro.
2. `Panel label="Entidades"` com uma `TabelaDados` (rótulo "Entidades"), sem `TableScroll`: **uma linha por entidade**, agregando os lotes recentes dela.
   A linha não é clicável: as ações ficam nos botões da última coluna (seção 5). Cabeçalho da tabela sem fundo (`--surface`, peso 600).
3. **Histórico — ‹Entidade›**: `Dialog largura="larga"` (720 px a partir de 640 px; abaixo, folha na largura toda), aberto por **Histórico (n)** (seção 5).

## 3. Colunas (rótulos exatos)
**Tabela de entidades** (a 1366 px com o menu lateral aberto; nada corta o selo, o número nem os botões):
| Coluna | Conteúdo | Largura |
|---|---|---|
| Entidade | `ROTULO_ENTIDADE` (ex.: Produtos), peso 400 | sem largura (divide o resto) |
| Última carga | `15/11 às 01:02` do lote mais recente (`formatDateTime`, data uma vez por linha); sem falha e com mais de um lote, `15/11 às 01:01 · 4 lotes`; com falha, `15/11 às 01:02 · falhou 01:03` (hora da falha com `formatTime`; falha em outro dia, `formatDataHoraCurta`: `15/11 às 23:58 · falhou 16/11 00:03`) | 300 px |
| Situação | `Badge` **Com falha** (`danger`) quando a entidade tem lote reprocessável (RN-INT-15), inclusive concluído com avisos; senão **Em dia** (`success`) | 120 px |
| Linhas integradas | número (`numero: true`), `x de y` do lote mais recente: `7.378 de 14.780`; lote em andamento, célula vazia | 150 px |
| (ações) | **Reprocessar** (`primary`, `size="sm"`) só com lote reprocessável, à esquerda de **Histórico (n)** (secundário, `size="sm"`; n = lotes da entidade) | 260 px |

"Com falha" e o botão **Reprocessar** usam o mesmo critério: existe lote reprocessável da entidade (RN-INT-15).
Ordem: entidades com falha primeiro; dentro de cada grupo, a carga mais recente no topo.

**Tabela do Histórico**:
| Coluna | Conteúdo | Largura |
|---|---|---|
| Recebido | `15/11 01:02` (`formatDataHoraCurta`) | 17% |
| Falhou | só no lote com falha: `01:03` (`formatTime`); falha em outro dia, `16/11 00:03` (`formatDataHoraCurta`); nos outros, célula vazia | 17% |
| Situação | `Badge` do lote (seção 4) | 26% |
| Linhas | número, `x de y` do lote; lote com falha conta `0 de 3.695`; lote em andamento, célula vazia | 20% |
| (ações) | links (`Button variant="link"`): **Cancelar** só em andamento; **Ver erros** só em lote com erro (com falha ou com linhas com erro), abre o log (`LoteDrawer`) | resto (20%) |

No Histórico, o lote mais recente fica no topo.
**Data+hora em célula**: `dd/mm hh:mm`, 24 h, no fuso do tenant (`sessao.fuso`), sem "às" e sem ano (`formatDataHoraCurta`); data dentro de frase
(a linha do `PageHeader`) usa `formatDateTime`. Exceção: a Última carga da tela de entidades usa o texto aprovado com "às"
(`formatDateTime`, R-20261120-183112). Célula sem valor fica vazia: a tabela não usa **—**.

## 4. Status (rótulo e tom do `Badge`)
| Estado do lote | Rótulo | Tom |
|---|---|---|
| recebido, processando | Em andamento | `pending` |
| concluido | Concluído | `success` |
| concluido_com_erros | Concluído com avisos | `warning` |
| falhou | Com falha | `danger` |
| cancelado (estado novo, contrato do modulo-integracao) | Cancelado | `neutral` |

A cor vem sempre com o texto. Estes rótulos valem para o Histórico; a tabela de entidades usa só **Com falha** e **Em dia** (seção 3).

## 5. Ações
| Onde | Ação | Quando aparece |
|---|---|---|
| Linha da entidade | **Reprocessar** | só com lote reprocessável (RN-INT-15), o mesmo critério do **Com falha** |
| Linha da entidade | **Histórico (n)** | sempre |
| Histórico, por lote | **Cancelar** | só em andamento |
| Histórico, por lote | **Ver erros** | só em lote com erro |
| Rodapé do Histórico | **Reprocessar os n lotes** (principal; com 1, **Reprocessar o lote**) | só se a entidade tem lote reprocessável |

Ação que não vale para o estado some (não aparece desligada). Um só principal por tela: na tabela, **Reprocessar** é o principal da linha com falha;
no Histórico, o principal é o do rodapé, e o rodapé leva também **Fechar**.

**Diálogo Histórico — ‹Entidade›**: `subtitle` **‹conector› · n lotes**
(com 1, **1 lote**); o corpo é só a tabela, sem nota explicativa.

**Reprocessar** (linha ou rodapé) com a permissão `lote.reprocessar`: dispara direto, sem diálogo; aviso (`useToast`, success) **Reprocessamento iniciado.**
Sem a permissão: popup de autorização (seção 6).

**Cancelar**: `Dialog` com o título **Cancelar este lote?**; corpo **{Entidade} · lote {8 caracteres}**; botões **Cancelar lote** (perigo) e
**Voltar**. Depois: aviso **Lote cancelado.**

## 6. Popup de autorização (Reprocessar sem `lote.reprocessar`)
`Dialog` curto, sem parágrafo: título **Autorizar reprocessamento**; um campo **Senha de [quem ▼]** (o seletor, alvo de 44 px, lista
os usuários do tenant com `lote.reprocessar`, isto é, perfis `admin` e `analista`, `PERFIS_ACAO_INTEGRACAO`; vem com o primeiro
escolhido, então só a senha é digitada; senha com "Mostrar", foco nela); botões **Voltar** e **Autorizar** (principal; desligado
com a senha vazia; "Autorizando…" enquanto espera). Sem e-mail digitado: o seletor diz quem autorizou, que a senha sozinha não diz (a auditoria precisa do autor). O seletor é um campo do kit (15 px, 400).
- Erros (embaixo da senha, `text-danger`; a senha é limpa e recebe o foco): **Senha incorreta.** · **Muitas tentativas. Tente de novo
  em alguns minutos.** · **Não deu para autorizar agora. Tente de novo.** (o "sem perfil" some: a lista só traz quem pode).
- Sucesso: fecha e mostra **Reprocessamento iniciado.**

Premissa: a API recebe o id do usuário escolhido + a senha, confere o perfil (RN-INT-06) e audita quem autorizou; a senha nunca vai
para log nem fica guardada na tela. Contrato a pedir ao modulo-integracao/engenheiro-software (lista dos autorizadores e a rota).

## 7. Estados
- Carregando: `LoadingBlock`. Erro sem dado: `ErrorBlock` com "Tentar de novo". Erro com dado: a tabela fica e o `ErrorBlock` diz **Não deu para atualizar agora.**
- Vazio (`EstadoVazio semBorda`, dentro do `Panel`): só **Nenhum lote recebido ainda.** É o único vazio da tela.

## 8. Cards no início de Pedidos (BKO → Pedidos)
Logo abaixo do `PageHeader` da lista de Pedidos e antes dos filtros, um `KpiGrid` (5 por linha a 1366 px) com `KpiCard` só com o valor, sem `sub`:
**Na fila** · **Entregue ao Conector** · **Rejeitado pelo ERP** · **Presos sem retorno** · **Retidos sem mapeamento**.
Com valor maior que zero, Rejeitado e Presos usam `valueClass="text-danger"`, e Retidos usa `text-warning`.
Clicar no card filtra a lista por aquele estado (o card é botão, alvo ≥ 44 px).
Integrado, Faturado parcial, Faturado e Cancelado não viram card: já aparecem na coluna de status da lista (uma informação, um lugar).
A lista "Erros de retorno" não vai para os cards: os avisos ficam só na área "Alertas" (RN-VEN-42).

## 9. De-para em Parâmetros → Integração (confirmado)
Página **De-para de códigos** (rota em Parâmetros → Integração), campos reais do `Mapeamento` (`tipo`, `codigo_macuxi`, `codigo_erp`, `descricao`, `ativo`).
1. `PageHeader` com **Novo de-para** (o único botão principal) à direita.
2. Área **Alertas** (`Panel title="Alertas"`, sem `label`: o título já nomeia a área), só quando há pedido retido (`condicoes_sem_correspondente`), uma linha por
   condição: **{n} pedidos retidos: condição {código} sem código do ERP** + botão secundário **Cadastrar**, que abre a folha já com a entidade
   e o código do Macuxi (RN-VEN-42: nenhum aviso fora de Alertas).
3. `FilterBar`: **Entidade** (Todas + os 4 rótulos de `ROTULO_TIPO_MAPEAMENTO`) e **Buscar** (código ou nome, Macuxi ou ERP).
4. Tabela: **Entidade** · **No Macuxi** (`código · nome`) · **No ERP** (mono) · **Situação** (`Badge` Ativo `success` / Inativo `neutral`) · ⋯.
   Menu ⋯: **Editar** · **Ativar** ou **Inativar** (só a que vale) · **Apagar** (perigo, por último, com `Dialog` de confirmação).
   Sem `mapeamento.editar`: sem botão Novo, sem ⋯ e sem "Cadastrar" (nada de texto "só administrador…").
5. Folha (`Drawer`, 480 px) **Novo de-para** / **Editar de-para**: **Entidade** (select) · **No Macuxi** (combobox com busca na lista
   da entidade; mostra `código · nome`; marca com o selo **{n} retidos** (o único aviso da lista) e deixa desligado o que já tem de-para, com "já tem: ERP {código}") ·
   **No ERP** (texto, até 60) · **Descrição (opcional)**. Rodapé: **Cancelar** e **Salvar de-para**. Novo nasce ativo (o "Ativo" sai do formulário).
   Aviso ao salvar: **De-para salvo.** ou **De-para salvo. {n} pedidos seguiram para o ERP.**
6. Vazio (`EstadoVazio`): só **Nenhum de-para ainda.**, sem botão; o **Novo de-para** fica só no `PageHeader` (item 1: um só principal).
   Sem itens, o `FilterBar` (Entidade e Buscar) some.
Premissa: a lista de códigos do Macuxi por entidade vem de uma consulta do modulo-integracao (a pedir).
Marca (valem para a tabela de entidades, o Histórico e o de-para; manual da marca §4 e §5):
- tabelas e o vazio ficam dentro de um cartão branco (`--surface`) com borda contínua (`--line`), raio 12 px;
- códigos (Macuxi, ERP e lote) na pilha mono do manual §5.1, 15/400, com `tabular-nums`; **{n} retidos** é um selo `Badge` de aviso (`warning`);
- o nome da entidade na tabela vai em peso 400 (texto comum, sem negrito).

## 10. Simulações (1366×768, PNG 2x)
`simulacoes/`: `de-para.png` (menu ⋯ de um inativo), `de-para-folha.png` (busca do código do Macuxi aberta), `de-para-vazio.png`. HTML e `base.css`
ao lado, com os tokens do BKO, o logo negativo para o grafite (28 px, manual da marca §2) e a fonte do sistema, sem `@font-face` (manual §5); dados fictícios.
A tabela de entidades e o Histórico (seções 2, 3 e 5) não têm simulação: a referência é o texto desta spec. As pranchas da tela antiga de lotes saíram.
Decisões: R-20261115-111800.
