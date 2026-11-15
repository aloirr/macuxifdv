# BKO → Sistema → Integração ERP: só a tabela de lotes (T-0173)

Decisão do dono do produto R-20261115-110600, item 3. Tela de referência: 1366×768, sem rolagem lateral.
Regras do corretor: uma informação, um lugar; só o texto que a pessoa usa para agir.

## 1. O que sai da tela
Saem o de-para (mapeamento), os cards "Pedidos no ERP", conectores, alertas, carga por entidade, inativações, os KPIs do topo, o filtro "Conector",
"Só com erro" e "Exportar lotes (CSV)". O de-para continua numa rota direta, sem item de menu (proposta: Parâmetros → Integração, a confirmar).

## 2. Ordem na tela
1. `PageHeader` com o título **Integração ERP**, sem subtítulo; à direita, a ação `Button variant="link"` **Atualizar**.
2. `FilterBar` com dois `SelectField`: **Entidade** (Todas) e **Status** (Todos). "Limpar filtros" só aparece com filtro ativo.
3. `TabelaDados` (rótulo "Lotes"), sem `TableScroll`. Clicar na linha = **Ver o log** (abre o `LoteDrawer` que já existe). O mais recente fica no topo.

## 3. Colunas (rótulos exatos)
| Coluna | Conteúdo | Largura | Prioridade |
|---|---|---|---|
| Entidade | `ROTULO_ENTIDADE` (ex.: Clientes) | 16% | 1 |
| Lote | 8 primeiros caracteres do id, fonte mono; id inteiro no `title` | 11% | 2 |
| Início | `15/11 14:31` | 12% | 1 |
| Duração | `2 min 10 s` | 11% | 2 |
| Conclusão | `15/11 14:33`; **—** em andamento | 12% | 3 |
| Status | um `Badge` (seção 4) | 18% | 1 |
| Linhas integradas | número (`numero: true`): `1.240`; se houve erro, `1.180 de 1.240` | 14% | 1 |
| (ações) | `MenuAcoes` "⋯" | 52 px | 1 |

As colunas cabem no quadro de 1366 px com o menu lateral aberto; nada corta o selo nem o número.
**Data+hora**: `dd/mm hh:mm`, 24 h, no fuso do tenant (`sessao.fuso`), sem "às" e sem ano.
**Duração** (do início até a conclusão; em andamento, até agora, e atualiza com a tabela): `< 1 min` → `45 s`; `< 1 h` → `2 min 10 s`
(segundos zerados somem: `3 min`); `≥ 1 h` → `1 h 05 min`. Sem início: **—**.
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

## 5. Menu "⋯" por status (`MenuAcoes`, nesta ordem)
| Status | Ações |
|---|---|
| Em andamento | Ver o log · **Cancelar** (perigo, por último) |
| Concluído | Ver o log |
| Concluído com avisos | Ver o log · Reprocessar |
| Com falha | Ver o log · Reprocessar |
| Cancelado | Ver o log |

Ação que não vale para o status some do menu (não aparece desligada).

**Reprocessar** com a permissão `lote.reprocessar`: dispara direto, sem diálogo; aviso (`useToast`, success) **Reprocessamento iniciado.**
O status da mesma linha volta a Em andamento.

**Cancelar**: `Dialog` com o título **Cancelar este lote?**; corpo **{Entidade} · lote {8 caracteres}**; botões **Cancelar lote** (perigo) e
**Voltar**. Depois: aviso **Lote cancelado.**

## 6. Popup de senha do administrador (Reprocessar sem `lote.reprocessar`)
`Dialog`, com um só botão principal.
- Título: **Reprocessar lote**
- Linha: **Peça a um administrador para autorizar.**
- Campos: **E-mail do administrador** (`type="email"`) e **Senha do administrador** (`type="password"`, com "Mostrar"). O foco começa no e-mail.
- Botões: **Autorizar e reprocessar** (principal; desligado até os dois campos estarem preenchidos; "Autorizando…" enquanto espera) e **Voltar**.
- Erros (embaixo do campo da senha, `text-danger`; a senha é limpa e recebe o foco):
  - e-mail ou senha errados: **E-mail ou senha incorretos.**
  - usuário sem o perfil: **Esse usuário não pode autorizar o reprocessamento.**
  - muitas tentativas: **Muitas tentativas. Tente de novo em alguns minutos.**
  - sem rede ou servidor fora: **Não deu para autorizar agora. Tente de novo.**
- Sucesso: fecha e mostra **Reprocessamento iniciado.**

Premissa: a API identifica o admin por e-mail + senha; a senha nunca vai para log nem fica guardada na tela.

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
