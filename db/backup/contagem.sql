-- Retrato do banco para conferir uma restauração (dono: banco-dados; db/backup/LEIA-ME.md).
-- Uma linha por tabela (linhas exatas, count(*)) e, no fim, os totais de políticas de RLS, tabelas com FORCE RLS e
-- privilégios dos papéis macuxi_app/macuxi_worker. Dois bancos iguais dão a MESMA saída (ordenada).
-- Rodar como admin (superusuário ignora RLS, então conta as linhas de todos os tenants):
--   psql -U postgres -d <banco> -At -F '|' -f contagem.sql
select 'linhas|' || n.nspname || '.' || c.relname || '|' ||
       (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from %I.%I', n.nspname, c.relname), false, true, '')))[1]::text
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where c.relkind in ('r', 'p')
   and n.nspname not in ('pg_catalog', 'information_schema')
   and n.nspname not like 'pg\_%'
union all
select 'politicas|' || count(*)::text from pg_policies
union all
select 'force_rls|' || count(*)::text
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where c.relforcerowsecurity and n.nspname not in ('pg_catalog', 'information_schema')
union all
select 'privilegios|' || grantee || '|' || count(*)::text
  from information_schema.role_table_grants
 where grantee in ('macuxi_app', 'macuxi_worker')
 group by grantee
order by 1;
