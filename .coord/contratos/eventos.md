# Registro de eventos

> Dono: engenheiro-software. O schema de cada evento fica em `modules/<publicador>/contracts/eventos.ts`. Mudança incompatível = nova versão + recado aos consumidores.
>
> **Entrega (T-0022, ADR 0007 "Implementação")**: o despachante (`pnpm --filter api worker`) entrega cada evento aos módulos que o declaram em `consome` **e** registram `consumidores: [definirConsumidor({ evento, executar })]` no `definirModuloApi`; só a quem tem o módulo ativo no tenant; idempotente por (consumidor, evento_id); falha retenta com espera crescente. A coluna "Consome" abaixo é o planejado: o evento só chega quando o consumidor estiver registrado na API do módulo.

| Evento | Publica | Consome |
|---|---|---|
| `core.cliente.atualizado@1` | core | gestor, catalogo |
| `core.visita.checkin@1` | core | promotor, pesquisa, gestor |
| `core.visita.checkout@1` | core | gestor, promotor |
| `core.usuario.modulos_alterados@1` | core | todos (shell) |
| `core.notificacao.criada@1` | core | core (envio do push pela Expo atrás de `MACUXI_PUSH_ATIVO=1`; despachante pronto na T-0022, consumidor pedido ao modulo-core) |
| `core.rota.dia_planejado@1` | core | gestor (cobertura de rota, RN-GES; **planejado** — pedido do modulo-gestor via R-20261031-165536; payload a definir pelo modulo-core na T-0018, quando o BKO publica/gera a rota do dia) |
| `core.meta.definida@1` | core | gestor (meta × realizado; a declarar). **Publicado** desde a T-0020 no `PUT metas/:usuarioId/:periodo`, só quando o valor muda; payload na nota "Sprint 1" abaixo |
| `catalogo.produto.visualizado@1` | catalogo | gestor (P2) |
| `catalogo.busca.realizada@1` | catalogo | catalogo (analytics) |
| `vendedor.pedido.criado@1` | vendedor | gestor, core (metas) |
| `vendedor.pedido.status_alterado@1` | vendedor | gestor, integracao, core (metas) |
| `vendedor.pedido.aprovacao_solicitada@1` | vendedor | gestor |
| `vendedor.pedido.faturado@1` | vendedor | treinamento (desafio de vendas, RN-TRE), gestor e core (metas; a declarar) |
| `vendedor.pedido.aprovado@1` | vendedor | integracao (fila de exportação ao ERP, RN-INT-08; a declarar). **Aprovado** (T-0029, ADR 0011 aceita em 2026-11-01; o manifesto do Vendedor passa a publicar na onda 2) |
| `promotor.visita_loja.concluida@1` | promotor | gestor |
| `promotor.gondola.registrada@1` | promotor | gestor |
| `promotor.share.medido@1` | promotor | gestor |
| `promotor.preco.coletado@1` | promotor | gestor |
| `promotor.ruptura.registrada@1` | promotor | gestor, vendedor (alerta, P1) |
| `promotor.tarefa.concluida@1` | promotor | gestor |
| `pesquisa.resposta.registrada@1` | pesquisa | gestor |
| `treinamento.licao.concluida@1` | treinamento | gestor |
| `treinamento.medalha.conquistada@1` | treinamento | gestor, core (notificação) |
| `integracao.cliente.atualizado@1` | integracao | core |
| `integracao.produto.atualizado@1` | integracao | core (dono de `core.produto`, ADR 0005; a declarar). O catálogo deixa de consumir |
| `integracao.preco.atualizado@1` | integracao | catalogo |
| `integracao.estoque.atualizado@1` | integracao | catalogo |
| `integracao.vendedor.atualizado@1` | integracao | core (usuários/carteira; a declarar no manifesto do core) |
| `integracao.titulo.atualizado@1` | integracao | core (dono de `core.titulo`, doc 04; a declarar — T-0016 corrige a sugestão anterior "vendedor": o Vendedor lê o título do Core por contrato/sync) |
| `integracao.nota.atualizado@1` | integracao | vendedor (nota do pedido; a declarar) |
| `integracao.rota.atualizado@1` | integracao | core (roteiro de visitas; a declarar) |
| `integracao.pedido.retorno_erp@1` | integracao | vendedor (aplica o status e publica `vendedor.pedido.faturado@1`; desenho T-0011) |
| `integracao.lote.concluido@1` | integracao | integracao (monitor do BKO, RF-INT-04) |
| `integracao.reconciliacao.divergente@1` | integracao | integracao (monitor do BKO), gestor (alertas; a declarar) |
| `integracao.lote.recebido@1` | integracao | integracao — **interno** (T-0025; ADR 0013 §7): a outbox como fila; o `POST /integracao/v1/lotes` publica na transação do lote (`LoteRecebidoEvento`: ids e contagens, sem linhas) e o consumidor do próprio módulo aplica o lote. Nenhum outro módulo consome |

> Integração (T-0009): a antiga linha curinga `integracao.<entidade>.atualizado@1` virou uma linha por entidade,
> para que cada consumidor seja explícito. "a declarar" = consumidor sugerido que ainda não está no `consome` do manifesto;
> o dono do módulo declara quando for usar (e o registro passa a valer como contrato).

> **`vendedor.pedido.faturado@1`** (T-0004, decisão do engenheiro sobre o pedido do Alexandre R-20261031-103502 item 10).
> Publicado pelo Vendedor a cada retorno do ERP aceito (`integracao.pedido.retorno_erp@1`) com status `faturado_parcial` ou
> `faturado_total` (ESTADOS_PEDIDO_ERP da integração). Payload:
> `{ pedido_id: uuid, vendedor_id: uuid, faturado_em: ISO UTC, parcial: boolean, itens: [{ produto_id: uuid, quantidade: inteiro > 0 }] }`
> — `itens` = o que foi faturado NESTE retorno (o consumidor soma; quantidade na unidade de venda; sem valores). Um evento por
> retorno aceito (o retorno já é idempotente no Hub); o consumidor é idempotente por `evento_id`. Sem estorno nesta fase.
> Não se usa `retorno_erp@1` para isso: ele não tem `vendedor_id` nem itens, fala a língua do ERP e só existe com o Hub.
> Schema em `modules/vendedor/contracts/eventos.ts` (`PedidoFaturadoEvento`); o manifesto do Vendedor já declara o `publica`.
> Desenho: `docs/desenho/T-0004.md` §8 (o evento) e `docs/desenho/T-0011.md` (a publicação na outbox).
> Origem dos itens (T-0011 §2): `integracao.pedido.retorno_erp@1` e o `RetornoErp` do Conector ganham `itens_faturados`
> opcional (`[{ sequencia, quantidade }]`, a sequência do `PedidoParaErp`). É um campo novo opcional, então continua `@1`
> (RN-INT-09). Um `faturado_parcial` sem `itens_faturados` **não publica** o evento; o `faturado_total` cobre o saldo.

> **Sprint 1 — contratos planejados (desenho [T-0016](../../docs/desenho/T-0016.md), aguardando OK do gerente)**. Schemas em
> `modules/core/contracts/eventos.ts` (modulo-core). Sem consumidor rodando até existir o despachante da outbox (ADR 0007).
> - `core.visita.checkin@1` (payload definido agora):
>   `{ visita_id, usuario_id, cliente_id, rota_parada_id, checkin_em, data_local, fora_do_raio, distancia_m, sem_gps, extra }`.
> - `core.visita.checkout@1` (payload definido agora):
>   `{ visita_id, usuario_id, cliente_id, checkin_em, checkout_em, data_local, resultado, motivo_codigo, pedido_id, fechada_por, permanencia_s }`
>   — `resultado`: `atendido | pedido | sem_pedido | cliente_fechado | nao_finalizado`; `fechada_por`: `usuario | auto`.
>   O Promotor usa `permanencia_s` (RN-PRO-07).
>   **A mesma visita pode ter dois `checkout@1`** (revisão final da Sprint 1): o servidor fecha sozinho a aberta esquecida ou
>   duplicada (`fechada_por: 'auto'`, `resultado: 'nao_finalizado'`, RN-CORE-11) e depois chega o checkout real do aparelho, que
>   **vence** (`fechada_por: 'usuario'`, desenho T-0016 §4.3). O consumidor guarda por `visita_id` e deixa o `usuario` substituir o
>   `auto` (nunca o contrário); a idempotência por `evento_id` não cobre esse caso, porque são dois eventos diferentes.
> - `core.meta.definida@1` (publicado na T-0020, `modules/core/contracts/eventos.ts`, `MetaDefinidaSchema`):
>   `{ usuario_id, periodo: 'AAAA-MM', indicador: 'venda_cents' | 'positivacao' | 'cobertura_pct' | 'visitas', valor: inteiro ≥ 0,
>   valor_anterior: inteiro | null, definido_por: uuid }` — `valor` em centavos (`venda_cents`), contagem ou pontos-base
>   (`cobertura_pct`). Um evento por indicador alterado; a última versão do (usuário, período, indicador) vence. Substitui o
>   formato pedido pelo Gestor (`{ usuario_id, mes, meta_cents }`): `mes` = `periodo` e `meta_cents` = `valor` com
>   `indicador = 'venda_cents'`.
> - `core.rota.dia_planejado@1` continua **planejado** (não é publicado ainda): entra quando o Gestor for usar (Sprint 6) ou na
>   T-0024; até lá a cobertura de rota sai do pull de `rota`/`rota_parada` ou da API do Core.
> - `core.cliente.atualizado@1` (payload definido agora): `{ cliente_id, campos: string[], origem: 'erp' | 'bko' | 'campo' }`.
> - `core.notificacao.criada@1` (novo): `{ notificacao_id, usuario_id, tipo, prioridade }` — sem título/corpo (dado pessoal fica no banco).
> - O Core passa a consumir, quando houver despachante: `vendedor.pedido.faturado@1` e `vendedor.pedido.status_alterado@1`
>   (metas, RN-CORE-21), `vendedor.pedido.criado@1` (notificação do pedido em nome, RN-VEN-35) e
>   `treinamento.medalha.conquistada@1` (notificação).

> **Pedido no servidor — contratos aprovados (desenho [T-0029](../../docs/desenho/T-0029.md) §3.4, ADR 0011 aceita em 2026-11-01)**.
> Schemas em `modules/vendedor/contracts/eventos.ts` (modulo-vendedor). Status sempre no vocabulário do doc 03 (RN-VEN-30), mapeado de
> `ORDER_STATUSES` por `statusDoContrato`; nenhum nome, documento ou endereço no payload.
> - `vendedor.pedido.criado@1`: formato do espelho do Gestor (`PedidoCriadoV1`) + `status`.
> - `vendedor.pedido.status_alterado@1`: `{ pedido_id, vendedor_id, de, para, alterado_em, autor_id, motivo }`, um por transição
>   (no recebimento: `null → recebido` e `recebido → aprovado | em_aprovacao`).
> - `vendedor.pedido.aprovacao_solicitada@1`: formato do espelho do Gestor (`AprovacaoSolicitadaV1`); `credito` e `historico` nulos na fatia.
> - `vendedor.pedido.aprovado@1` (novo): o `PedidoAprovadoParaFila` pedido pelo Hub (R-20261101-044224-3), publicado quando o pedido vira
>   aprovado (automático dentro da alçada ou por decisão); chaves do ERP anuláveis.
