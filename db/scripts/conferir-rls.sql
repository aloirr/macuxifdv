-- Conferência de RLS e da regra 5 do CLAUDE.md (T-0078, checklist B1). Dono: banco-dados.
-- Lista TODA tabela dos schemas de domínio (tudo menos pg_*, information_schema e public) com problema:
--   RLS desligado, RLS não forçado, sem política, sem política para o macuxi_app, coluna comum ausente ou com outro tipo
--   (id uuid, tenant_id uuid not null, created_at/updated_at/deleted_at timestamptz, external_id text).
-- Resultado esperado: ZERO linhas. Exceções (iguais a db/src/excecoes.ts, TABELAS_SEM_TENANT_ID): plataforma.tenant não tem
-- tenant_id (o id é o tenant; RLS por id) e public.macuxi_migracao fica fora (schema public, sem acesso do macuxi_app).
-- Prova: db/testes/conformidade.test.ts ("B1 conferência de RLS") roda este arquivo no Postgres de testes do CI.
-- À mão (só leitura): psql "$URL_ADMIN" -v ON_ERROR_STOP=1 -f db/scripts/conferir-rls.sql
with tabelas as (
  select c.oid, n.nspname || '.' || c.relname as nome, c.relrowsecurity as rls, c.relforcerowsecurity as forcado
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where c.relkind in ('r', 'p')
     and n.nspname not in ('pg_catalog', 'information_schema', 'public')
     and n.nspname not like 'pg\_%'
),
comuns (coluna, tipo, nao_nulo) as (
  values ('id', 'uuid', true),
         ('tenant_id', 'uuid', true),
         ('created_at', 'timestamp with time zone', true),
         ('updated_at', 'timestamp with time zone', true),
         ('deleted_at', 'timestamp with time zone', false),
         ('external_id', 'text', false)
),
sem_tenant_id (nome) as (
  values ('plataforma.tenant')
),
problemas as (
  select t.nome, 'RLS desligado' as problema from tabelas t where not t.rls
  union all
  select t.nome, 'RLS não forçado' from tabelas t where not t.forcado
  union all
  select t.nome, 'sem política' from tabelas t where not exists (select 1 from pg_policy p where p.polrelid = t.oid)
  union all
  select t.nome, 'sem política para o macuxi_app' from tabelas t
   where not exists (
     select 1 from pg_policy p join pg_roles r on r.oid = any (p.polroles)
      where p.polrelid = t.oid and r.rolname = 'macuxi_app')
  union all
  select t.nome, 'coluna ' || k.coluna || ' ausente, de outro tipo ou anulável' from tabelas t cross join comuns k
   where not (k.coluna = 'tenant_id' and t.nome in (select s.nome from sem_tenant_id s))
     and not exists (
       select 1 from pg_attribute a
        where a.attrelid = t.oid and a.attname = k.coluna and a.attnum > 0 and not a.attisdropped
          and format_type(a.atttypid, a.atttypmod) = k.tipo
          and (not k.nao_nulo or a.attnotnull))
)
select nome as tabela, problema from problemas order by 1, 2;
