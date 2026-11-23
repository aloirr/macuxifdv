-- Descarte da cópia de segurança de UM lote (LGPD; workflow producao-limpar-cadastros.yml, modo descartar; montado por
-- montar-limpeza.sh). Prazo: 7 dias depois de o reenvio do ERP ser confirmado. Variáveis (psql -v): empresa, lote.
select :'lote' ~ '^[0-9]{8}T[0-9]{6}Z$' and :'empresa' ~ '^([a-z0-9][a-z0-9-]{1,39}|[A-Z]{2}[0-9]{4})$' as entradas_ok \gset
\if :entradas_ok
\else
do $$ begin raise exception 'entradas inválidas (lote ou empresa)'; end $$;
\endif

begin;
select id as tenant from plataforma.tenant_por_codigo(:'empresa') \gset
with d as (delete from public.macuxi_limpeza_backup where lote = :'lote' and tenant_id = :'tenant' returning 1)
select count(*) as linhas_descartadas from d;
commit;
\echo 'DESCARTADO'
