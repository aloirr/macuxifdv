-- 0057_core_foto_pdv (down) — desfaz a 0057 (T-0147) e volta ao catálogo da 0056.
-- APAGA core.cliente_foto (as fotos do PDV de cada cliente) e core.foto_tipo (os tipos cadastrados no BKO e a "Fachada"
-- semeada), a coluna core.cliente.inativado_em (o relógio da retenção: reaplicar a 0057 refaz o backfill pelo updated_at) e a
-- coluna plataforma.arquivo.perfis_leitura. Os metadados dos arquivos (finalidade 'pdv') e os bytes no armazenamento FICAM:
-- sem perfis_leitura, a leitura deles volta à regra da ADR 0010 (carteira) — volte antes a rota GET /v1/arquivos/:id e, se os
-- documentos sensíveis não puderem ficar abertos à carteira, apague esses arquivos ANTES (plataforma.arquivo where modulo =
-- 'core' and finalidade = 'pdv' and perfis_leitura is not null, e os bytes pela chave).
-- Volte antes o Core que lê/grava as tabelas e colunas novas (senão 42P01/42703). Idempotente. Pré-condição: 0058+ desfeitas.

alter table plataforma.arquivo drop constraint if exists arquivo_perfis_leitura_validos;
alter table plataforma.arquivo drop column if exists perfis_leitura;

drop trigger if exists cliente_inativado_em on core.cliente;
drop function if exists core.marcar_cliente_inativado();
alter table core.cliente drop column if exists inativado_em;

drop trigger if exists tenant_semear_foto_tipo on plataforma.tenant;
drop function if exists core.semear_tenant_foto_tipo();
drop function if exists core.semear_foto_tipo(uuid);

drop table if exists core.cliente_foto;
drop table if exists core.foto_tipo;
