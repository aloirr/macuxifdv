-- 0060_vendedor_pedido_item_marca (down) — desfaz a 0060 (T-0159) e volta ao vendedor.pedido_item da 0059.
-- APAGA vendedor.pedido_item.marca (as marcas retratadas nos itens se perdem; reaplicar a 0060 volta a coluna vazia).
-- Volte antes o Vendedor que grava/lê a coluna (senão 42703). Idempotente. Pré-condição: 0061+ desfeitas.

alter table vendedor.pedido_item drop constraint if exists pedido_item_marca_tamanho;
alter table vendedor.pedido_item drop column if exists marca;
