# Rastreamento de localização no expediente (T-0156)

Desenho: `docs/desenho/tracking.md`; ADR 0061; spec das telas: `docs/design/tracking/spec.md`. Regras: RN-CORE-13 (finalidade, aviso e termo), RN-CORE-37
(permissão "o tempo todo") e RN-CORE-46 (km do dia). **Desligado de fábrica.**

## Domain (funções puras, teste citando a regra)
- `podeRastrear` (`domain/rastreamento.ts`): as seis condições do §2, a mesma no app, na tarefa e na API.
- `triarPontoRecebido` (`domain/trajeto-ponto.ts`): o portão por ponto no push, mais futuro > 5 min, > 90 dias e coordenada inválida. A pausa é decisão do aparelho.
- `validarParametrosRastreamento`: sem expediente em nenhum dia, não liga.
- `metrosDoTrajeto` (`domain/performance/trajeto.ts`): km do dia; o mesmo número do app e do `core.deslocamento_dia`.

## API (`/v1/core`)
| Rota ou entidade | Ação | Nota |
|---|---|---|
| push `aceite_termo_rastreamento` (ambos) | — | idempotente; só versão que existe no tenant; volta no pull só o do próprio usuário |
| push `ponto_trajeto` | — | ponto fora do portão é descartado e responde `aceito` (não trava a fila); recalcula o dia em `core.deslocamento_dia` |
| push `pausa_trajeto` | — | início e fim, sem motivo; o fim chega depois, no mesmo id |
| pull `termo_rastreamento`, `ausencia_usuario` | — | termo do tenant; ausência só a do próprio usuário |
| pull `parametro` | — | leva a chave `rastreamento` |
| `GET /trajeto?usuario_id&data` | `trajeto.ver_proprio` / `trajeto.ver_equipe` | equipe só no escopo (fora = 404); até 90 dias |
| `core.trajeto_do_dia@1` | `trajeto.ver_equipe` | lote `usuario_ids` + `data`; escopo e permissão conferidos no Core |
| `GET\|PUT /parametros/rastreamento` | `rastreamento.configurar` | auditado; salvar o mesmo valor não audita |
| `GET\|POST /rastreamento/termos` | `rastreamento.configurar` | cada publicação é uma versão nova |
| `GET\|POST\|DELETE /ausencias` | `ausencia.cadastrar` | só do escopo; cancelar = `deleted_at` |

Nenhuma rota exporta pontos. Nenhuma coordenada vai para log (`ctx.log` leva só contagens).

## Campo (`modules/core/app`)
- Telas `/m/termo-rastreamento` e `/m/meu-trajeto`; seção `SecaoLocalizacaoPerfil` e linha `AlertaTermoRastreamento` para o Perfil; hook `useAbrirTermoPendente` para a raiz do shell.
- Armazenamento do módulo (`motor.armazenamentoDoModulo('core')`): `rastreamento.aceite` e `rastreamento.pausa`, que a tarefa `macuxi-trajeto` também lê.
- `definirPontosLocaisDoDia(leitor)`: o shell entrega os pontos de hoje do SQLite; sem ele, "Meu trajeto" busca o dia no servidor.
- Fora: botão "Contestar este dia" (P1 do spec, depende do dono do produto).
