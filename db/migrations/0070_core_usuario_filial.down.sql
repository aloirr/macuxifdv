-- 0070_core_usuario_filial (down) — desfaz a 0070 (filial do usuário) e volta ao catálogo da 0069. Ordem: os 4 gatilhos de
-- restrição nas tabelas que continuam (core.usuario, plataforma.usuario_perfil, plataforma.perfil) e a função deles; a
-- tabela core.usuario_filial (leva os 2 gatilhos dela, os índices e as políticas); por fim as 2 funções que sobram.
-- Limites: os vínculos de filial dos usuários se perdem (o backfill da 0070, reaplicada, refaz só o do vendedor com a padrão).
-- Idempotente. Pré-condição: 0071+ desfeitas e o código do Core que lê/grava core.usuario_filial já desfeito.

drop trigger if exists usuario_conferir_filial_vendedor on core.usuario;
drop trigger if exists usuario_perfil_conferir_filial_vendedor on plataforma.usuario_perfil;
drop trigger if exists perfil_conferir_filial_vendedor on plataforma.perfil;
drop table if exists core.usuario_filial;
drop function if exists core.filial_vendedor_conferir();
drop function if exists core.conferir_filial_vendedor(uuid, uuid[]);
drop function if exists core.usuario_filial_travar();
