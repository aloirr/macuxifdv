-- 0023_core_positivacao_mes (down)
-- Desfaz a 0023 na ordem inversa. APAGA a função core.positivacao_do_mes e as listas core.indicador_diario.
-- clientes_positivados_ids (pedidos, vendido_cents, cancelado_cents e clientes_positivados do dia ficam; o Início sem o
-- Vendedor volta à positivação sem fonte). Idempotente (if exists em tudo).
-- Pré-condição: 0024+ desfeitas.

drop function if exists core.positivacao_do_mes(uuid[], text, date);
alter table core.indicador_diario drop constraint if exists indicador_diario_clientes_positivados_ids_coerente;
alter table core.indicador_diario drop column if exists clientes_positivados_ids;
