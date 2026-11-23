-- Descarte da cópia de segurança de UM lote (LGPD; workflow producao-limpar-cadastros.yml, modo descartar; montado por
-- montar-limpeza.sh). Prazo: 7 dias depois de o reenvio do ERP ser confirmado. Variáveis (psql -v): empresa, lote.
begin;
with d as (delete from public.macuxi_limpeza_backup where lote = :'lote' and tenant_id = :'tenant' returning 1)
select count(*) as linhas_descartadas from d;
commit;
\echo 'DESCARTADO'
