# Registro de eventos

> Dono: engenheiro-software. O schema de cada evento fica em `modules/<publicador>/contracts/eventos.ts`. Mudança incompatível = nova versão + recado aos consumidores.

| Evento | Publica | Consome |
|---|---|---|
| `core.cliente.atualizado@1` | core | gestor, catalogo |
| `core.visita.checkin@1` | core | promotor, pesquisa, gestor |
| `core.visita.checkout@1` | core | gestor, promotor |
| `core.usuario.modulos_alterados@1` | core | todos (shell) |
| `catalogo.produto.visualizado@1` | catalogo | gestor (P2) |
| `catalogo.busca.realizada@1` | catalogo | catalogo (analytics) |
| `vendedor.pedido.criado@1` | vendedor | gestor, core (metas); treinamento troca por `faturado@1` |
| `vendedor.pedido.status_alterado@1` | vendedor | gestor, integracao, core (metas) |
| `vendedor.pedido.aprovacao_solicitada@1` | vendedor | gestor |
| `vendedor.pedido.faturado@1` | vendedor | treinamento (desafio de vendas, RN-TRE), gestor e core (metas; a declarar) |
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
| `integracao.titulo.atualizado@1` | integracao | vendedor (financeiro do cliente; a declarar) |
| `integracao.nota.atualizado@1` | integracao | vendedor (nota do pedido; a declarar) |
| `integracao.rota.atualizado@1` | integracao | core (roteiro de visitas; a declarar) |
| `integracao.pedido.retorno_erp@1` | integracao | vendedor (aplica o status e publica `vendedor.pedido.faturado@1`; desenho T-0011) |
| `integracao.lote.concluido@1` | integracao | integracao (monitor do BKO, RF-INT-04) |
| `integracao.reconciliacao.divergente@1` | integracao | integracao (monitor do BKO), gestor (alertas; a declarar) |

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
