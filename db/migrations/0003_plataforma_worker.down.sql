-- 0003_plataforma_worker (down) — T-0004
-- Desfaz a 0003 na ordem inversa. APAGA os registros de plataforma.evento_consumo e as colunas usuario_id e
-- request_id de plataforma.evento (os eventos continuam). Pré-condição: nenhuma migração posterior aplicada.
-- O papel macuxi_worker é do cluster (compartilhado com outros bancos, ex.: bancos de teste) e FICA, mas sem
-- nenhum privilégio neste banco (revoke abaixo), como o macuxi_app na 0001.
drop index if exists core.carteira_usuario_sync_ix;

drop table if exists plataforma.evento_consumo;

drop policy if exists despacho_outbox_marcar on plataforma.evento;
drop policy if exists despacho_outbox on plataforma.evento;
revoke all on plataforma.evento from macuxi_worker;
drop index if exists plataforma.evento_tenant_id_uk;
alter table plataforma.evento drop column if exists request_id;
alter table plataforma.evento drop column if exists usuario_id;

revoke usage on schema plataforma from macuxi_worker;
