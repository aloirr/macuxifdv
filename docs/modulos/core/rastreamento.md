# Rastreamento de localização no expediente (T-0156)

Desenho: `docs/desenho/tracking.md`; ADR 0061. Regras: RN-CORE-13 (portão do rastreamento), RN-CORE-37 (permissão "o tempo todo") e RN-CORE-46 (km do dia).
**Desligado de fábrica. O rastreamento é interno** (dono do produto, 19/11/2026, 05h46 de Manaus): o vendedor e o promotor não veem nada dele (sem termo,
aceite, pausa nem "Meu trajeto"); só o supervisor e o gerente veem o trajeto da equipe, e o admin só se o perfil dele receber `trajeto.ver_equipe` no BKO.

## Domain (funções puras, teste citando a regra)
- `podeRastrear` (`domain/rastreamento.ts`): parâmetro ligado, cargo de campo, app Campo, feriado, ausência, expediente e permissão do aparelho; a mesma no app, na tarefa e na API.
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
| `core.trajeto_do_dia@1` | `trajeto.ver_equipe` | lote `usuario_ids` + `data`; escopo e permissão conferidos no Core; saída só com pontos e metros (sem `pausas`) |
| `GET\|PUT /parametros/rastreamento` | `rastreamento.configurar` | auditado; salvar o mesmo valor não audita |
| `GET\|POST\|DELETE /ausencias` | `ausencia.cadastrar` | só do escopo; cancelar = `deleted_at` |

Nenhuma rota exporta pontos. Nenhuma coordenada vai para log (`ctx.log` leva só contagens).

## Campo (`modules/core/app`)
Sem tela, seção, alerta nem chave local do rastreamento. O app só envia o ponto (entidade `ponto_trajeto`) e recebe a própria ausência; a captura é da tarefa do shell.

## BKO (`modules/core/web`)
Painéis Rastreamento (liga/desliga, expediente, frequência) e Ausências.
