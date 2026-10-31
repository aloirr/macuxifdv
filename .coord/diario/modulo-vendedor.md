# Diário — modulo-vendedor

2026-10-31 — T-0001 — Fase B: esqueleto modules/vendedor, domain order (32) e contracts de pedido (5) = 37 testes verdes; manifesto sem promotor + acoesPedido (T-0006).
2026-10-31 — T-0001 — Fase B2: manifesto com acoes (RN-PRO-01 testado), moduloWeb (Pedidos, Alçadas) e moduloApp (Pedidos, Pedido, Novo pedido) sobre o motor de sync; 68 testes (29 da Fase M + 2 do manifesto); depende do engenheiro ligar definirAmbienteVendedor no shell.
2026-10-31 — T-0001 — slots cliente.abas/cliente.acoes (mix, últimos pedidos, novo pedido) e total_cents na fila; 73 testes
2026-10-31 — T-0001 — A3 item 4: vendedor usa o ambiente do SDK; ponte @deprecated mantida até o shell sair
2026-10-31 — T-0009/T-0001 — cancelar após envio ao ERP (domain+telas), ponte ambiente.ts removida
2026-10-31 — T-0009 — rota de cancelamento na API ligada a verificarCancelamento (422 após envio), com testes
2026-10-31 — T-0009/T-0011 — OrderStatus com status do ERP (invoiced_partial/invoiced), PedidoFaturadoEvento + montarEventoFaturado, manifesto publica vendedor.pedido.faturado@1; 104 testes
