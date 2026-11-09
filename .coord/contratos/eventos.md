# Registro de eventos

> Dono: engenheiro-software. O schema de cada evento fica em `modules/<publicador>/contracts/eventos.ts`. Mudança incompatível = nova versão + recado aos consumidores.
>
> **Padrão T-0024 ([desenho](../../docs/desenho/T-0024.md))**: o dono exporta do `contracts` a `DefinicaoEvento` (`definirEvento(nome, Schema)`) de cada evento do `publica`; o consumidor importa essa definição do `contracts` do dono e lê com `eventoTolerante(EVENTO_X)` do platform-sdk (chave desconhecida descartada, o resto validado como no contrato), **sem cópia** do payload. A catraca `apps/api/test/eventos-contratos.test.ts` reprova evento publicado sem definição, `contracts` que exporta definição de evento alheio e consumidor com cópia. Coluna "Schema em": **dono** = definição oficial exportada; "cópia" = consumidor que ainda mantém espelho (a trocar na T-0024).
>
> **Entrega (T-0022, ADR 0007 "Implementação")**: o despachante (`pnpm --filter api worker`) entrega cada evento aos módulos que o declaram em `consome` **e** registram `consumidores: [definirConsumidor({ evento, executar })]` no `definirModuloApi`; só a quem tem o módulo ativo no tenant; idempotente por (consumidor, evento_id); falha retenta com espera crescente. A coluna "Consome" abaixo é o planejado: o evento só chega quando o consumidor estiver registrado na API do módulo.

| Evento | Publica | Consome | Schema em (T-0024, 05/11) |
|---|---|---|---|
| `core.cliente.atualizado@1` | core | gestor, catalogo | **dono** `core: EVENTO_CLIENTE_ATUALIZADO` · gestor tolerante (`EVENTOS_CONSUMIDOS`) |
| `core.visita.checkin@1` | core | promotor, pesquisa, gestor | **dono** `core: EVENTO_VISITA_CHECKIN` · gestor tolerante (`EVENTOS_CONSUMIDOS`) |
| `core.visita.checkout@1` | core | gestor, promotor | **dono** `core: EVENTO_VISITA_CHECKOUT` · gestor tolerante (`EVENTOS_CONSUMIDOS`) |
| `core.usuario.modulos_alterados@1` | core | todos (shell) | **dono** `core: EVENTO_MODULOS_ALTERADOS` |
| `core.notificacao.criada@1` | core | core (envio do push pela Expo atrás de `MACUXI_PUSH_ATIVO=1`, `data.link` + `data.entidades`, T-0065; consumidor em `modules/core/api/consumidores.ts`) | **dono** `core: EVENTO_NOTIFICACAO_CRIADA` (consumo próprio) |
| `core.rota.dia_planejado@1` | core | gestor (cobertura de rota, RN-GES; **planejado** — pedido do modulo-gestor via R-20261031-165536; schema definido na T-0024; entra no `publica` quando o BKO publicar/gerar a rota do dia (T-0018)) | **dono** `core: EVENTO_ROTA_DIA_PLANEJADO` (`.strict()`, fora do `publica` até o Core publicar) · gestor tolerante, em `EVENTOS_PROPOSTOS` (fora do `consome`) |
| `core.meta.definida@1` | core | core (push da meta, T-0065), gestor (meta × realizado; declarado na T-0024). **Publicado** desde a T-0020 no `PUT metas/:usuarioId/:periodo`, só quando o valor muda; payload na nota "Sprint 1" abaixo | **dono** `core: EVENTO_META_DEFINIDA` · gestor tolerante (`EVENTOS_CONSUMIDOS`); o Gestor usa só `indicador = venda_cents` |
| `catalogo.produto.visualizado@1` | catalogo | gestor (P2) | **dono** `catalogo: EVENTO_PRODUTO_VISUALIZADO` (`contracts/eventos.ts`) |
| `catalogo.busca.realizada@1` | catalogo | catalogo (analytics) | **dono** `catalogo: EVENTO_BUSCA_REALIZADA` (`contracts/eventos.ts`; sem o texto da busca) |
| `catalogo.referencia.marca_desconhecida@1` | catalogo (consumidor de `integracao.produto.atualizado@1`, um por lote e produto) | integracao (monitor: aviso `marca_concorrente_desconhecida`; desenho `docs/modulos/integracao/desenho.md` §14) | **dono** `catalogo: EVENTO_REFERENCIA_MARCA_DESCONHECIDA` (`contracts/eventos.ts`, T-0103, aditivo, no `publica`). Payload strict: `produto_external_id`, `produto_codigo` (nulo), `marcas[1..3]` (como vieram do ERP), `marca_external_id?`, `lote_id`, `entidade: 'produto'`, `ocorrido_em`; sem dado pessoal. Desde a T-0113 (ADR 0034) a marca é procurada no cadastro do Catálogo (`catalogo.marca_concorrente`), mesma forma |
| `catalogo.marca_concorrente.alterada@1` | catalogo | nenhum obrigatório (o Promotor lê por `catalogo.marcas@1` e não guarda cópia); possível: integracao (reprocessar avisos de marca desconhecida) | **implementado T-0113 (ADR 0034 §2; lote de 08/11)**: `EVENTO_MARCA_CONCORRENTE_ALTERADA` (`modules/catalogo/contracts/marcas.ts`, no `publica`; publicado por `POST/PUT /v1/catalogo/marcas`; escrita sem mudança não publica), um por escrita, pela outbox na mesma transação. Payload strict com o estado completo: `id`, `nome`, `ativo`, `external_id` (nulo), `fato` ∈ `criada \| alterada \| inativada \| reativada`, `alterada_em`; consumidor guarda o de `alterada_em` maior. Substitui o `promotor.concorrente.alterado@1` previsto na 0027, que nunca foi publicado |
| `vendedor.pedido.criado@1` | vendedor | gestor, core (metas) | **dono** `vendedor: EVENTO_PEDIDO_CRIADO` · gestor tolerante (`EVENTOS_CONSUMIDOS`) · **T-0138 (aditivo, mesma versão, 08/11):** `emitido_em?: IsoDateTime` = `emitidoEm(created_offline_at, recebidoEm)` (`domain/aprovacao.ts`: hora do aparelho limitada, nunca no futuro, no máximo 7 dias antes do recebimento; sem hora, o recebimento), o mesmo valor de `vendedor.pedidos_da_meta@1` (`EMITIDO_EM_SQL`). Consumidores apuram por `emitido_em ?? criado_em` (Gestor `apuracao.ts`); emissor antigo sem o campo continua válido |
| `vendedor.pedido.status_alterado@1` | vendedor | gestor, integracao, core (metas) | **dono** `vendedor: EVENTO_PEDIDO_STATUS_ALTERADO` · tolerante: gestor, core (`consumidores-pedido.ts`), integracao (`consumidores-pedido.ts`) |
| `vendedor.pedido.aprovacao_solicitada@1` | vendedor | gestor | **dono** `vendedor: EVENTO_PEDIDO_APROVACAO_SOLICITADA` (`credito`/`historico` objeto ou null, aditivo no @1) · tolerante: gestor, core |
| `vendedor.pedido.faturado@1` | vendedor | treinamento (desafio de vendas, RN-TRE), gestor e core (metas; a declarar) | **dono** `vendedor: EVENTO_PEDIDO_FATURADO` · tolerante: gestor, treinamento (`PedidoFaturadoLido = tolerante(PedidoFaturadoEvento)`) |
| `vendedor.pedido.aprovado@1` | vendedor | integracao (fila de exportação ao ERP, RN-INT-08; A8 declarado e consumido desde 2026-11-02, T-0032). **Aprovado** (T-0029, ADR 0011 aceita em 2026-11-01; o manifesto do Vendedor passa a publicar na onda 2) | **dono** `vendedor: EVENTO_PEDIDO_APROVADO` · tolerante: integracao · **T-0084 (aditivo, desenho 05/11)**: `itens[].aplicacao?: string ≤ 1000 \| null` (retrato RN-VEN-19), repassado ao `ItemPedidoErp.aplicacao` · **T-0089 (aditivo, desenho 06/11)**: `pagamento?: { forma_codigo, forma_external_id?, prazo_codigo, prazo_external_id?, parcelas_dias, prazo_medio_dias } | null`, repassado ao `PedidoParaErp.pagamento`; no pedido novo `condicao_pagamento_codigo` = código do prazo (o Hub usa primeiro o `prazo_external_id`, depois o de-para; §4.3) |
| `vendedor.pedido.cancelado@1` | vendedor (T-0114, R-20261107-173950 d) | integracao (devolve o cancelamento ao ERP quando o conector `aceita_cancelamento`; contrato do Conector aditivo na v1: `PedidosPendentes.cancelamentos?`) | **dono** `vendedor: EVENTO_PEDIDO_CANCELADO` · tolerante: integracao |
| `promotor.visita_loja.concluida@1` | promotor | gestor | **dono** `promotor: EVENTO_VISITA_LOJA_CONCLUIDA` · gestor tolerante (`EVENTOS_CONSUMIDOS`); campos: docs/modulos/promotor/eventos.md |
| `promotor.gondola.registrada@1` | promotor | gestor | **dono** `promotor: EVENTO_GONDOLA_REGISTRADA` · gestor tolerante |
| `promotor.share.medido@1` | promotor | gestor | **dono** `promotor: EVENTO_SHARE_MEDIDO` · gestor tolerante |
| `promotor.preco.coletado@1` | promotor | gestor | **dono** `promotor: EVENTO_PRECO_COLETADO` · gestor tolerante |
| `promotor.ruptura.registrada@1` | promotor | gestor, vendedor (alerta, P1) | **dono** `promotor: EVENTO_RUPTURA_REGISTRADA` · gestor tolerante (vendedor ainda sem consumidor) |
| `promotor.tarefa.concluida@1` | promotor | gestor | **dono** `promotor: EVENTO_TAREFA_CONCLUIDA` · gestor tolerante |
| `pesquisa.resposta.registrada@1` | pesquisa | gestor; core (baixa da pendência de etapa do checkout, desenho T-0039 §2: `consumidorBaixaPorResposta` em `modules/core/api/etapas-pendencia.ts`, tolerante, ligado 2026-11-05) | **dono** `pesquisa: DEF_RESPOSTA_REGISTRADA` · gestor tolerante (`EVENTOS_CONSUMIDOS`) |
| `treinamento.licao.concluida@1` | treinamento | gestor | **dono** `treinamento: DEFINICAO_LICAO_CONCLUIDA` · gestor tolerante (`EVENTOS_CONSUMIDOS`) |
| `treinamento.medalha.conquistada@1` | treinamento | gestor, core (notificação) | **dono** `treinamento: DEFINICAO_MEDALHA_CONQUISTADA` · gestor tolerante (`EVENTOS_CONSUMIDOS`); core ainda sem consumidor |
| `integracao.cliente.atualizado@1` | integracao | core | **dono** `integracao: EVENTO_ERP_CLIENTE_ATUALIZADO` · tolerante: core |
| `integracao.produto.atualizado@1` | integracao | core (dono de `core.produto`, ADR 0005; consumido desde a T-0066). O catálogo deixa de consumir | **dono** `integracao: EVENTO_ERP_PRODUTO_ATUALIZADO` · tolerante: core, catalogo (`consumidores-erp.ts`, sem cópia desde 05/11) · **T-0084/T-0085 (aditivo, desenho 05/11)**: registro ganha `aplicacao?` (cortada em 2.000 pelo Hub, aviso `aplicacao_cortada`), `referencias?` `[{marca_external_id?, marca_nome?, codigo ≤ 30}]` ≤ 3, `oferece_junto?` `[external_id]` ≤ 5 e `etiquetas?` ≤ 4; o catalogo volta a ler esses campos (o nó já lia) · **implementado 06/11** (`ProdutoBase` + `limitarCatalogoDoProduto`, corte antes do hash; tetos de proteção que recusam a linha: aplicação 20.000, referências 10, oferece junto 20, etiquetas 10). O Hub não resolve a marca (ADR 0027): o Catálogo resolve por `promotor.concorrentes@1`; **T-0113 (ADR 0034)**: passa a resolver no próprio cadastro `catalogo.marca_concorrente`, na transação |
| `integracao.preco.atualizado@1` | integracao | catalogo (consumido desde a T-0066; produto achado por `core.cadastro_resumo@1` `produto_external_ids`) | **dono** `integracao: EVENTO_ERP_PRECO_ATUALIZADO` · tolerante: catalogo (`consumidores-erp.ts`, sem cópia desde 05/11) |
| `integracao.estoque.atualizado@1` | integracao | catalogo (consumido desde a T-0066) | **dono** `integracao: EVENTO_ERP_ESTOQUE_ATUALIZADO` · tolerante: catalogo (`consumidores-erp.ts`, sem cópia desde 05/11) |
| `integracao.vendedor.atualizado@1` | integracao | core (usuários; consumido desde a T-0066) | **dono** `integracao: EVENTO_ERP_VENDEDOR_ATUALIZADO` · tolerante: core |
| `integracao.titulo.atualizado@1` | integracao | core (dono de `core.titulo`, doc 04; consumido desde a T-0066 — T-0016 corrige a sugestão anterior "vendedor": o Vendedor lê o título do Core por contrato/sync) | **dono** `integracao: EVENTO_ERP_TITULO_ATUALIZADO` · tolerante: core |
| `integracao.nota.atualizado@1` | integracao | vendedor (nota do pedido; a declarar) | **dono** `integracao: EVENTO_ERP_NOTA_ATUALIZADO` · tolerante: core, vendedor |
| `integracao.rota.atualizado@1` | integracao | core (rota datada das próximas 4 ocorrências; consumido desde a T-0066) | **dono** `integracao: EVENTO_ERP_ROTA_ATUALIZADO` · tolerante: core |
| `integracao.catalogo_no.atualizado@1` | integracao | catalogo (consumido desde a T-0066) | **dono** `integracao: EVENTO_ERP_CATALOGO_NO_ATUALIZADO` · tolerante: catalogo (`consumidores-erp.ts`, sem cópia desde 05/11) |
| `integracao.produto_unidade.atualizado@1` | integracao | core (unidades do produto, T-0061) | **dono** `integracao: EVENTO_ERP_PRODUTO_UNIDADE_ATUALIZADO` · tolerante: core |
| `integracao.cliente_endereco.atualizado@1` | integracao | core (endereços de entrega, T-0061) | **dono** `integracao: EVENTO_ERP_CLIENTE_ENDERECO_ATUALIZADO` · tolerante: core |
| `integracao.transportadora.atualizado@1` | integracao | — (sem consumidor; a declarar) | **dono** `integracao: EVENTO_ERP_TRANSPORTADORA_ATUALIZADO` |
| `integracao.forma_pagamento.atualizado@1` | integracao | vendedor (formas de pagamento, RN-VEN-24) | **T-0089 (desenho 06/11, aditivo no v1, precedente ADR 0016)**: `FormaPagamentoPayload` (`codigo`, `nome`, `ordem`); docs/desenho/T-0089.md §4.2 |
| `integracao.prazo_pagamento.atualizado@1` | integracao | vendedor (prazos da forma e prazo médio, RN-VEN-24) | **T-0089 (desenho 06/11, aditivo no v1)**: `PrazoPagamentoPayload` (`forma_external_id` → `referencia_ausente` reprocessável, `codigo`, `parcelas_dias`, `prazo_medio_dias` informativo: o Macuxi calcula); §4.2 |
| `integracao.tabela_escalonada.atualizado@1` | integracao | catalogo (faixas de preço por quantidade, RN-VEN-23) | **T-0089 (desenho 06/11, aditivo no v1)**: `TabelaEscalonadaPayload` (`produto_external_id`, `medida`, `quantidade_minima`, `preco_unidade_cents` da unidade base, vigência, `tabela_external_id?`); §4.2 |
| `integracao.pedido.retorno_erp@1` | integracao | vendedor (aplica o status e publica `vendedor.pedido.faturado@1`; desenho T-0011) | **dono** `integracao: EVENTO_PEDIDO_RETORNO_ERP` · tolerante: vendedor (`api/eventos-consumidos.ts`) |
| `integracao.pedido.cancelamento_recusado@1` | integracao (T-0114, R-20261108-103541; aditivo) | vendedor (opcional; avisa quem cancelou) | **dono** `integracao: EVENTO_PEDIDO_CANCELAMENTO_RECUSADO` (`contracts/eventos.ts`, no `publica`). Payload `{ pedido_uuid, numero_erp (ou null), motivo (1..300), recusado_em }`; publicado quando o ERP recusa o cancelamento devolvido (retorno aditivo `cancelamento_recusado` em `POST /pedidos/{uuid}/retorno`). Só estado do Conector: não vira `StatusRetornoErp` nem entra em `retorno_erp@1` |
| `integracao.lote.concluido@1` | integracao | integracao (monitor do BKO, RF-INT-04) | **dono** `integracao: EVENTO_LOTE_CONCLUIDO` |
| `integracao.reconciliacao.divergente@1` | integracao | integracao (monitor do BKO), gestor (alertas; a declarar) | **dono** `integracao: EVENTO_RECONCILIACAO_DIVERGENTE` |
| `integracao.lote.recebido@1` | integracao | integracao — **interno** (T-0025; ADR 0013 §7): a outbox como fila; o `POST /integracao/v1/lotes` publica na transação do lote (`LoteRecebidoEvento`: ids e contagens, sem linhas) e o consumidor do próprio módulo aplica o lote. Nenhum outro módulo consome | **dono** `integracao: EVENTO_LOTE_RECEBIDO` (consumo próprio, oficial) |

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
