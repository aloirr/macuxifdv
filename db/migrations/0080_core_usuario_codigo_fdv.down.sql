-- 0080_core_usuario_codigo_fdv (down) — desfaz a 0080 (T-0175, RN-CORE-59) e volta ao catálogo da 0079.
-- Ordem: os 2 gatilhos de core.usuario e a função deles; o contador (leva os gatilhos dele) e as funções do "nunca diminui" e do piso; o
-- índice único, o CHECK e a coluna (levam a política leitura e os grants do macuxi_leitura, 0078). PERDE os códigos emitidos e o contador: reaplicar a 0080 renumera os vivos por
-- created_at, id. Volte antes o Core que lê o código (COLUNA_CODIGO_FDV_PRONTA = false), senão 42703. Idempotente.
-- Pré-condição: 0081+ desfeitas.

drop trigger if exists usuario_codigo_fdv_emitir on core.usuario;
drop trigger if exists usuario_codigo_fdv_somente_leitura on core.usuario;
drop function if exists core.usuario_codigo_fdv();
drop table if exists core.usuario_codigo_fdv_contador; -- leva os gatilhos _updated_at, _nao_diminui e _piso
drop function if exists core.usuario_codigo_fdv_contador_nao_diminui();
drop function if exists core.usuario_codigo_fdv_contador_piso();
drop index if exists core.usuario_codigo_fdv_uk;
alter table core.usuario drop constraint if exists usuario_codigo_fdv_formato;
alter table core.usuario drop column if exists codigo_fdv;
