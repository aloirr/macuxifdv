-- 0007_vendedor_pedido (down) — T-0018
-- Desfaz a 0007. APAGA todos os pedidos e itens (schema vendedor inteiro). Pré-condição: 0008+ desfeitas.
-- A rota de cancelar do Vendedor volta a falhar por falta da tabela (como antes da 0007).
drop schema if exists vendedor cascade;
