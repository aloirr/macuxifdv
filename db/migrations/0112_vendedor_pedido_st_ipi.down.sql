-- 0112_vendedor_pedido_st_ipi (down) — desfaz a 0112 (v1.0.44, T-0208, ADR 0077 D5) e volta à 0111.
-- APAGA os CHECKs pedido_v_icms_st_nao_negativo, pedido_v_ipi_nao_negativo, pedido_item_v_icms_st_nao_negativo e
-- pedido_item_v_ipi_nao_negativo e as colunas v_icms_st_cents e v_ipi_cents de vendedor.pedido e vendedor.pedido_item (o ST e
-- o IPI gravados se perdem; voltam no próximo retorno do ERP depois de reaplicar a 0112). Volte antes o Vendedor (consumidor do
-- retorno, pull, telas, PDF) e a Integração que leem ou gravam as colunas (senão 42703). Idempotente (if exists em tudo).
-- Pré-condição: 0113+ desfeitas.

alter table vendedor.pedido_item drop constraint if exists pedido_item_v_ipi_nao_negativo;
alter table vendedor.pedido_item drop constraint if exists pedido_item_v_icms_st_nao_negativo;
alter table vendedor.pedido_item drop column if exists v_ipi_cents;
alter table vendedor.pedido_item drop column if exists v_icms_st_cents;

alter table vendedor.pedido drop constraint if exists pedido_v_ipi_nao_negativo;
alter table vendedor.pedido drop constraint if exists pedido_v_icms_st_nao_negativo;
alter table vendedor.pedido drop column if exists v_ipi_cents;
alter table vendedor.pedido drop column if exists v_icms_st_cents;
