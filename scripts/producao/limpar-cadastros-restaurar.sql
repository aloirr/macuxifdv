-- Restauração de UM lote da limpeza pela cópia plataforma.limpeza_copia (workflow producao-limpar-cadastros.yml, modo
-- restaurar; montado por montar-limpeza.sh). Variáveis (psql -v): empresa, lote (o do workflow ou o do portal, com sufixo).
-- A regra é a plataforma.restaurar_limpeza da 0100 (ADR 0068, docs/desenho/empresa-zerar.md §2): tudo volta ou nada volta.
-- Só serve ANTES do reenvio do ERP: depois dele, a linha nova com o mesmo external_id bate no índice único parcial e a
-- transação inteira aborta sem mudar nada.
begin;
set local lock_timeout = '15s';
select set_config('app.tenant_id', :'tenant', true) <> '' as ok \gset
select * from plataforma.restaurar_limpeza(:'tenant'::uuid, :'lote');
commit;
\echo 'RESTAURADO'
