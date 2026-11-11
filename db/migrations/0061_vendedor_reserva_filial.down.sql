-- 0061_vendedor_reserva_filial (down) — desfaz a 0061 (T-0149) e volta ao vendedor.pedido_item da 0060.
-- Apaga vendedor.pedido_item.filial_id, o índice da reserva por filial, os 2 gatilhos e as 2 funções. Nada se perde: a filial
-- continua em vendedor.pedido.filial_id (reaplicar a 0061 refaz o backfill). Volte antes o Vendedor que lê a coluna (senão
-- 42703). Idempotente. Pré-condição: 0062+ desfeitas.

drop index if exists vendedor.pedido_item_reserva_filial_ix;
drop trigger if exists pedido_filial_nos_itens on vendedor.pedido;
drop function if exists vendedor.pedido_filial_nos_itens();
drop trigger if exists pedido_item_filial on vendedor.pedido_item;
drop function if exists vendedor.pedido_item_filial();
alter table vendedor.pedido_item drop column if exists filial_id;
