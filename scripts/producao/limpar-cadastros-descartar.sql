-- Descarte da cópia de segurança de UM lote (LGPD; workflow producao-limpar-cadastros.yml, modo descartar; montado por
-- montar-limpeza.sh). Prazo: 7 dias depois de o reenvio do ERP ser confirmado. Variáveis (psql -v): empresa, lote.
-- A regra é a plataforma.descartar_limpeza da 0099 (ADR 0068).
begin;
select set_config('app.tenant_id', :'tenant', true) <> '' as ok \gset
select * from plataforma.descartar_limpeza(:'tenant'::uuid, :'lote');
commit;
\echo 'DESCARTADO'
