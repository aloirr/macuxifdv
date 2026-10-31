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
| `vendedor.pedido.criado@1` | vendedor | gestor, treinamento, core (metas) |
| `vendedor.pedido.status_alterado@1` | vendedor | gestor, integracao, core (metas) |
| `vendedor.pedido.aprovacao_solicitada@1` | vendedor | gestor |
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
| `integracao.produto.atualizado@1` | integracao | catalogo (core após a T-0007, ADR 0005) |
| `integracao.preco.atualizado@1` | integracao | catalogo |
| `integracao.estoque.atualizado@1` | integracao | catalogo |
| `integracao.vendedor.atualizado@1` | integracao | core (usuários/carteira; a declarar no manifesto do core) |
| `integracao.titulo.atualizado@1` | integracao | vendedor (financeiro do cliente; a declarar) |
| `integracao.nota.atualizado@1` | integracao | vendedor (nota do pedido; a declarar) |
| `integracao.rota.atualizado@1` | integracao | core (roteiro de visitas; a declarar) |
| `integracao.pedido.retorno_erp@1` | integracao | vendedor |
| `integracao.lote.concluido@1` | integracao | integracao (monitor do BKO, RF-INT-04) |
| `integracao.reconciliacao.divergente@1` | integracao | integracao (monitor do BKO), gestor (alertas; a declarar) |

> Integração (T-0009): a antiga linha curinga `integracao.<entidade>.atualizado@1` virou uma linha por entidade,
> para que cada consumidor seja explícito. "a declarar" = consumidor sugerido que ainda não está no `consome` do manifesto;
> o dono do módulo declara quando for usar (e o registro passa a valer como contrato).
