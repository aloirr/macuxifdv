-- 0011_plataforma_outbox_retencao (down) — T-0032
-- Remove o comentário de legado de tenant_modulo.parametros, a função de expurgo da outbox e o índice dos eventos
-- publicados. Nenhum dado é apagado pelo down (o que o expurgo já apagou não volta). Pré-condição: 0012+ desfeitas.
comment on column plataforma.tenant_modulo.parametros is null;
drop function if exists plataforma.expurgar_outbox(timestamptz, integer);
drop index if exists plataforma.evento_publicado_ix;
