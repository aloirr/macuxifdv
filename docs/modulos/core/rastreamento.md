# Rastreamento de localização no expediente (T-0156)

Desenho: `docs/desenho/tracking.md`; ADR 0061. Regras: RN-CORE-13 (portão do rastreamento), RN-CORE-37 (permissão "o tempo todo") e RN-CORE-46 (km do dia).
**Desligado de fábrica. O rastreamento é interno** (dono do produto, 19/11/2026, 05h46 de Manaus): o vendedor e o promotor não veem nada dele; só o supervisor e o gerente veem o trajeto da equipe, e o admin só se o perfil dele receber `trajeto.ver_equipe` no BKO.

## Domain (funções puras, teste citando a regra)
- `podeRastrear` (`domain/rastreamento.ts`): as 7 condições estão no desenho (`docs/desenho/tracking.md#2-quando-o-tracking-grava-todas-as-condições`, §2); a mesma no app, na tarefa e na API.
- `triarPontoRecebido` (`domain/trajeto-ponto.ts`): o portão por ponto no push, mais futuro > 5 min, > 90 dias e coordenada inválida.
- `validarParametrosRastreamento`: sem expediente em nenhum dia, não liga.
- `metrosDoTrajeto` (`domain/performance/trajeto.ts`): km do dia; o mesmo número do `core.deslocamento_dia`.

## API (`/v1/core`)
| Rota ou entidade | Ação | Nota |
|---|---|---|
| push `ponto_trajeto` | — | ponto fora do portão é descartado e responde `aceito` (não trava a fila); recalcula o dia em `core.deslocamento_dia` |
| pull `ausencia_usuario` | — | só a do próprio usuário |
| pull `parametro` | — | leva a chave `rastreamento` |
| `GET /trajeto?usuario_id&data` | `trajeto.ver_equipe` | `usuario_id` obrigatório; só no escopo (fora = 404); até 90 dias |
| `core.trajeto_do_dia@1` | `trajeto.ver_equipe` | lote `usuario_ids` + `data`; escopo e permissão conferidos no Core; saída só com pontos e metros |
| `GET\|PUT /parametros/rastreamento` | `rastreamento.configurar` | auditado; salvar o mesmo valor não audita |
| `GET\|POST\|DELETE /ausencias` | `ausencia.cadastrar` | só do escopo; cancelar = `deleted_at` |

Nenhuma rota exporta pontos. Nenhuma coordenada vai para log (`ctx.log` leva só contagens).

## Campo (`modules/core/app`)
O app só envia o ponto (entidade `ponto_trajeto`) e recebe a própria ausência; a captura é da tarefa do shell.

### Envio dos pontos
O shell grava os pontos em `core__ponto_trajeto` com `enviado_em` nulo; a rotina `enviarPontosDoTrajeto` (export de `modules/core/app`, RN-CORE-13) os envia direto pelo transporte do sync, sem passar pela fila do motor: o rastreamento é interno e não aparece na fila nem na contagem que o vendedor vê. Não é etapa de sync: a etapa só roda na carga completa e o contexto dela não tem o SQLite.
- Assinatura: `enviarPontosDoTrajeto({ db, push, agora, registrar? })`. `db` = SQLite do usuário (o mesmo do `gravarPontosDoTrajeto`); `push` = `TransporteSync.push` do shell; `agora: () => new Date()`; `registrar` recebe só contagens, nunca coordenada.
- O shell chama `await enviarPontosDoTrajeto(...)` com o aparelho online, antes de cada envio da fila (início do sync e no ciclo de envio), e registra o retorno (só contagens).
- Laço de até `MAX_ITENS_PUSH` (500) por `capturado_em`: valida com `PontoTrajetoSchema`, monta `ItemPush` (`ponto_trajeto`, `upsert`, id = id do ponto) e chama `push`. `aceito`, `conflito` (o servidor já tinha o id) e `rejeitado` marcam `enviado_em`; rejeitado também entra em `rejeitados`, para não ficar em laço. Ponto inválido é marcado sem envio. Se `push` lançar, para, deixa o resto pendente e devolve `erro: true`.
- Poda: no fim de cada passada, mesmo com `erro`, apaga os pontos com `enviado_em` há mais de 90 dias (`docs/banco/aparelho-sqlite.md` §11). Pendente nunca é apagado.
- Idempotente: queda entre enviar e marcar repete o ponto; o servidor (`somente_insercao` pelo id) não duplica. Sem a tabela, não faz nada. Nunca lança.
- Retorno: `{ enviados, rejeitados, invalidos, podados, erro }`.

## BKO (`modules/core/web`)
Painéis Rastreamento (liga/desliga, expediente, frequência) e Ausências.
