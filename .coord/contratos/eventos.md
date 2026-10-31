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
| `integracao.<entidade>.atualizado@1` | integracao | core, catalogo, vendedor |
| `integracao.pedido.retorno_erp@1` | integracao | vendedor |
