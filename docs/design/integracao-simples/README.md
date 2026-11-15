# BKO → Sistema → Integração ERP: só a tabela de lotes (T-0173)

Decisão do dono do produto R-20261115-110600, item 3. Tela de referência: 1366×768, sem rolagem lateral.
Regras do corretor: uma informação, um lugar; só o texto que a pessoa usa para agir.

## 1. O que sai da tela
Saem o de-para (mapeamento), os cards "Pedidos no ERP", conectores, alertas, carga por entidade, inativações, os KPIs do topo, o filtro "Conector",
"Só com erro" e "Exportar lotes (CSV)". O de-para vai para Parâmetros → Integração (confirmado; seção 9).

## 2. Ordem na tela
1. `PageHeader` com o título **Integração ERP**, sem subtítulo; à direita, a ação `Button variant="link"` **Atualizar**.
2. `FilterBar` com dois `SelectField`: **Entidade** (Todas) e **Status** (Todos). "Limpar filtros" só aparece com filtro ativo.
3. `TabelaDados` (rótulo "Lotes"), sem `TableScroll`. Clicar na linha abre o log (o `LoteDrawer` que já existe); a linha indica que é clicável só com o cursor de mão e o fundo `--ground` (#F8F6F1) sob o mouse, sem chevron. O mais recente fica no topo.
   Cabeçalho da tabela sem fundo (`--surface`, peso 600).

## 3. Colunas (rótulos exatos)
| Coluna | Conteúdo | Largura | Prioridade |
|---|---|---|---|
| Entidade | `ROTULO_ENTIDADE` (ex.: Clientes) | 19% | 1 |
| Lote | 8 primeiros caracteres do id, fonte mono; id inteiro no `title` | 11% | 2 |
| Início | `15/11 14:31` | 12% | 1 |
| Duração | `2 min 10 s` | 11% | 2 |
| Conclusão | `15/11 14:33`; **célula vazia** em andamento | 12% | 3 |
| Status | um `Badge` (seção 4) | 15% | 1 |
| Linhas integradas | número (`numero: true`): `1.240`; se houve erro, `1.180 de 1.240` | 14% | 1 |
| (ações) | `MenuAcoes` "⋯", só nas linhas com ação (seção 5); nas outras a célula fica vazia | 52 px | 1 |

As colunas cabem no quadro de 1366 px com o menu lateral aberto; nada corta o selo nem o número.
**Data+hora**: `dd/mm hh:mm`, 24 h, no fuso do tenant (`sessao.fuso`), sem "às" e sem ano.
**Duração** (do início até a conclusão; em andamento, até agora, e atualiza com a tabela): `< 1 min` → `45 s`; `< 1 h` → `2 min 10 s`
(segundos zerados somem: `3 min`); `≥ 1 h` → `1 h 05 min`. Sem início: célula vazia. A tabela não usa **—**.
Os dois formatadores entram em `packages/ui/src/web/format.ts` (`formatDataHoraCurta`, `formatDuracao`), feitos pelo designer-ux; o módulo não cria cópia.

## 4. Status (rótulo e tom do `Badge`)
| Estado do lote | Rótulo | Tom |
|---|---|---|
| recebido, processando | Em andamento | `pending` |
| concluido | Concluído | `success` |
| concluido_com_erros | Concluído com avisos | `warning` |
| falhou | Com falha | `danger` |
| cancelado (estado novo, contrato do modulo-integracao) | Cancelado | `neutral` |

A cor vem sempre com o texto. O filtro Status usa estes 5 rótulos.

## 5. Menu "⋯" por status (`MenuAcoes`)
| Status | Ações |
|---|---|
| Em andamento | **Cancelar** (perigo) |
| Concluído com avisos | Reprocessar |
| Com falha | Reprocessar |
| Concluído, Cancelado | sem "⋯" |

O log não entra no menu: abre com o clique na linha (seção 2). Ação que não vale para o status some (não aparece desligada).

**Reprocessar** com a permissão `lote.reprocessar`: dispara direto, sem diálogo; aviso (`useToast`, success) **Reprocessamento iniciado.**
O status da mesma linha volta a Em andamento.

**Cancelar**: `Dialog` com o título **Cancelar este lote?**; corpo **{Entidade} · lote {8 caracteres}**; botões **Cancelar lote** (perigo) e
**Voltar**. Depois: aviso **Lote cancelado.**

## 6. Popup de autorização (Reprocessar sem `lote.reprocessar`)
`Dialog` curto, sem parágrafo: título **Autorizar reprocessamento**; um campo **Senha de [quem ▼]** (o seletor, alvo de 44 px, lista
os usuários do tenant com `lote.reprocessar`, isto é, perfis `admin` e `analista`, `PERFIS_ACAO_INTEGRACAO`; vem com o primeiro
escolhido, então só a senha é digitada; senha com "Mostrar", foco nela); botões **Voltar** e **Autorizar** (principal; desligado
com a senha vazia; "Autorizando…" enquanto espera). Sem e-mail digitado.
- Erros (embaixo da senha, `text-danger`; a senha é limpa e recebe o foco): **Senha incorreta.** · **Muitas tentativas. Tente de novo
  em alguns minutos.** · **Não deu para autorizar agora. Tente de novo.** (o "sem perfil" some: a lista só traz quem pode).
- Sucesso: fecha e mostra **Reprocessamento iniciado.**

Premissa: a API recebe o id do usuário escolhido + a senha, confere o perfil (RN-INT-06) e audita quem autorizou; a senha nunca vai
para log nem fica guardada na tela. Contrato a pedir ao modulo-integracao/engenheiro-software (lista dos autorizadores e a rota).

## 7. Estados
- Carregando: `LoadingBlock`. Erro sem dado: `ErrorBlock` com "Tentar de novo". Erro com dado: a tabela fica e o `ErrorBlock` diz **Não deu para atualizar agora.**
- Vazio (`EstadoVazio`): **Nenhum lote recebido ainda.** Com filtro: **Nenhum lote com esses filtros.** + `Button` **Limpar filtros**.

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
2. Área **Alertas** (`Panel` label "Alertas", como no monitor), só quando há pedido retido (`condicoes_sem_correspondente`), uma linha por
   condição: **{n} pedidos retidos: condição {código} sem código do ERP** + botão secundário **Cadastrar**, que abre a folha já com a entidade
   e o código do Macuxi (RN-VEN-42: nenhum aviso fora de Alertas).
3. `FilterBar`: **Entidade** (Todas + os 4 rótulos de `ROTULO_TIPO_MAPEAMENTO`) e **Buscar** (código ou nome, Macuxi ou ERP).
4. Tabela: **Entidade** · **No Macuxi** (`código · nome`) · **No ERP** (mono) · **Situação** (`Badge` Ativo `success` / Inativo `neutral`) · ⋯.
   Menu ⋯: **Editar** · **Ativar** ou **Inativar** (só a que vale) · **Apagar** (perigo, por último, com `Dialog` de confirmação).
   Sem `mapeamento.editar`: sem botão Novo, sem ⋯ e sem "Cadastrar" (nada de texto "só administrador…").
5. Folha (`Drawer`, 480 px) **Novo de-para** / **Editar de-para**: **Entidade** (select) · **No Macuxi** (combobox com busca na lista
   da entidade; mostra `código · nome`; marca **{n} retidos** e deixa desligado o que já tem de-para, com "já tem: ERP {código}") ·
   **No ERP** (texto, até 60) · **Descrição (opcional)**. Na lista, o único aviso é o selo **{n} retidos**. Rodapé: **Cancelar** e **Salvar de-para**. Novo nasce ativo (o "Ativo" sai do formulário).
   Aviso ao salvar: **De-para salvo.** ou **De-para salvo. {n} pedidos seguiram para o ERP.**
6. Vazio (`EstadoVazio`): só **Nenhum de-para ainda.**, sem botão; o **Novo de-para** fica só no `PageHeader` (item 1: um só principal).
   Sem itens, o `FilterBar` (Entidade e Buscar) some.
Premissa: a lista de códigos do Macuxi por entidade vem de uma consulta do modulo-integracao (a pedir).
Decisões da marca (valem para a tabela de lotes e para o de-para):
- MC-0061: tabelas e o vazio ficam dentro de um cartão branco (`--surface`) com borda contínua (`--line`), raio 12 px.
- MC-0062: códigos (Macuxi, ERP e lote) em IBM Plex Mono; **{n} retidos** é um selo `Badge` de aviso (`warning`).
- MC-0063: o nome da entidade na tabela vai em peso 400 (texto comum, sem negrito).

## 10. Simulações (1366×768, PNG 2x)
`simulacoes/`: `lotes.png` (menu ⋯ aberto num lote em andamento: só Cancelar), `lotes-popup.png`, `de-para.png` (menu ⋯ de um inativo),
`de-para-folha.png` (busca do código do Macuxi aberta), `de-para-vazio.png`. HTML e `base.css` ao lado, com os tokens do BKO, o logo A negativo para o grafite (28 px, MC-0057) e as fontes de `apps/web/app/fonts`
ligadas por `@font-face` (MC-0058; captura só depois de `document.fonts.ready`); dados fictícios.
Decisões (R-20261115-111800): ação que não vale some do menu; ⋯ só em linha com ação e log no clique da linha (RD-0324); Conclusão
vazia em andamento (o selo já diz "Em andamento" e a Duração conta ao vivo, então qualquer texto ali repetiria); popup com 1 campo;
seletor de quem autoriza em vez de e-mail (a senha sozinha não diz quem autorizou, e a auditoria precisa do autor).
