-- 0077_core_usuario_filial (down) — desfaz a 0077 (filial de cadastro e filiais de venda) e volta ao catálogo da 0076 (a
-- anterior). Ordem: o gatilho adiado em core.usuario (a tabela que fica); a tabela core.usuario_filial (leva o gatilho dela,
-- os índices e as políticas); a função; por fim o índice, a FK e a coluna filial_cadastro_id de core.usuario.
-- Limites: as filiais de cadastro e de venda se perdem (a 0077, reaplicada, refaz o backfill da empresa com uma filial viva;
-- nas demais a carga do ERP ou o BKO regrava). O updated_at que o backfill subiu não volta.
-- Idempotente. Pré-condição: 0078+ desfeitas e o código do Core que lê/grava a coluna e a tabela já desfeito.

drop trigger if exists usuario_filial_inclui_cadastro on core.usuario;
drop table if exists core.usuario_filial;
drop function if exists core.filial_cadastro_conferir();
drop index if exists core.usuario_filial_cadastro_ix;
alter table core.usuario drop constraint if exists usuario_filial_cadastro_fk;
alter table core.usuario drop column if exists filial_cadastro_id;
