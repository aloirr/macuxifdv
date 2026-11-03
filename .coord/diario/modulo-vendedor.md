# Diário — modulo-vendedor

2026-10-31 — T-0001 — Fase B: esqueleto modules/vendedor, domain order (32) e contracts de pedido (5) = 37 testes verdes; manifesto sem promotor + acoesPedido (T-0006).
2026-10-31 — T-0001 — Fase B2: manifesto com acoes (RN-PRO-01 testado), moduloWeb (Pedidos, Alçadas) e moduloApp (Pedidos, Pedido, Novo pedido) sobre o motor de sync; 68 testes (29 da Fase M + 2 do manifesto); depende do engenheiro ligar definirAmbienteVendedor no shell.
2026-10-31 — T-0001 — slots cliente.abas/cliente.acoes (mix, últimos pedidos, novo pedido) e total_cents na fila; 73 testes
2026-10-31 — T-0001 — A3 item 4: vendedor usa o ambiente do SDK; ponte @deprecated mantida até o shell sair
2026-10-31 — T-0009/T-0001 — cancelar após envio ao ERP (domain+telas), ponte ambiente.ts removida
2026-10-31 — T-0009 — rota de cancelamento na API ligada a verificarCancelamento (422 após envio), com testes
2026-10-31 — T-0009/T-0011 — OrderStatus com status do ERP (invoiced_partial/invoiced), PedidoFaturadoEvento + montarEventoFaturado, manifesto publica vendedor.pedido.faturado@1; 104 testes
2026-10-31 — T-0015 — rotas GET de pedido com carteira e 404, pedido.ver no manifesto, tela somente leitura; falta SDK liberar promotor
2026-10-31 — T-0015 — pedido.ver com promotor (O-3); lista filtra carteira antes do limit
2026-10-31 — T-0018 — Vendedor: contracts/sync.ts (PedidoSync/PedidoItemSync), provedores de pull pedido/pedido_item (escopo usuarios+carteira, janela 90d), registro no app, teste com Postgres (api/sync.db.test.ts); 123 testes verdes
2026-10-31 — T-0018 — D-4: etapas da Fase M do Vendedor toleram 4xx (pulam sem erro na API real); teste etapas.test.ts
2026-10-31 — T-0018 — D-4: toleraSemRota só pula 404/501/SYNC_NAO_IMPLEMENTADO; 401/403/423 propagam
2026-11-01 — T-0029 — onda 1: contracts (PedidoPush, aprovar/rejeitar, eventos *@1 incl. aprovado, pull pedido_evento/condições), domain/aprovacao (revalidação, status inicial, quem decide, aprovado@1) e domain/pdf-pedido; testes antes citando RN
2026-11-01 — T-0029 — onda 2: receber do pedido (idempotente, preço/cadastro por consulta, alçada, carteira, promotor 403), aprovar/rejeitar/cancelar/lista/detalhe/alçadas, pull de evento e condições, telas Campo/Gestão/BKO sobre o pull, PDF e P-2; 236 testes (28 com Postgres)
2026-11-01 — T-0035 — /alcadas sem promotor (perfis + teste 403), fuso via ctx.fuso(), pedido.db.test sem core.*, janela do pull com relógio real
2026-11-01 — T-0042/T-0034 — relógio único no pedido.db.test.ts (+virada do dia), regra 7 nas páginas de pedido, 16 🟡 de tela (domain/totais e quantidade, libs com teste); vendedor 253/253
2026-11-02 — T-0054 — retorno do ERP no pedido (status RN-INT-08/RN-VEN-30, faturado@1 RN-TRE-08, devolução RN-VEN-37 proposta), faturado no app (Campo/Gestão offline) e no BKO; consumidores atrás de FATURAMENTO_LIGADO até a migração (pedida ao banco-dados); vendedor 308/308 (46 com Postgres)
2026-11-02 — T-0059 — detalhe do pedido no BKO: leitura tolerante (documento nulo), aviso em português, ErrorBlock com fallback, tooltips nos PDFs
2026-11-02 — T-0059 — lint: removido import OrderDetail não usado em web/lib/queries.ts (exceção autorizada pelo gerente)
2026-11-02 — T-0061 — novo pedido de distribuidora: domain de preço (UN/CX, desconto/acréscimo item e pedido, efetivo × alçada, frete CIF/FOB, endereço), app em 3 abas com rodapé, API (receber, aprovado@1, detalhe, sync, transportadoras no BKO), PDFs com Medida/frete/endereço, página Transportadoras; vendedor 470/470 com Postgres; sem escrita de parâmetro (S0-014): recado ao modulo-core
2026-11-02 — T-0061 — RN-VEN-10: alçada pelo efetivo nominal exato (descontoEfetivoAlcadaPct, sem folga), API e app na mesma função; PDF interno do app com desconto/acréscimo do item
2026-11-02 — T-0064 — PDFs (limite de 20 s com erro amigável, CNPJ formatado, nome da tabela e da distribuidora, coluna Medida, frete CIF/FOB), vendedor no card de aprovação do BKO, lista do Campo por mês com mudança de status e seletor de mês, pedido_numero em status_alterado@1 e aprovacao_solicitada@1; timers do Vendedor já limpos na T-0054
2026-11-03 — T-0061 — O-3: opção promotor_ve_pedidos (padrão ligada) — podeLerPedidos no domain, ponto único promotorVePedidos(ctx) na API; lista, detalhe e pull de pedido/item/evento do promotor testados ligada e desligada; escrita segue 403
2026-11-03 — T-0061 — promotor_ve_pedidos: API consulta core.promotor_ve_pedidos@1 a cada requisição (lista/detalhe/pull 403 se desligada); testes unit + db 5434
2026-11-03 — T-0065 — vendedor.pedidos_da_meta@1 publicada (contrato, domain, API, manifest ofereceConsultas); testes unit + db 5434
2026-11-03 — T-0061 — corrige main vermelho: pull do promotor sem tx.consultar usa padrão ligada (teste explícito); manifest coerente; testes 5434 e typecheck verdes
