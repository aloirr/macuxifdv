-- Conferência de RLS e da regra 5 do CLAUDE.md (T-0078, checklist B1). Dono: banco-dados.
-- Lista TODA tabela dos schemas de domínio (tudo menos pg_*, information_schema e public) com problema:
--   RLS desligado, RLS não forçado, sem política, sem política para o macuxi_app, sem a política de manutenção (0031, B1 do
--   DBaaS, T-0075: `manutencao` for all to macuxi_manutencao using (true) with check (true), que toda migração com tabela
--   nova cria junto da isolamento_tenant), coluna comum ausente ou com outro tipo (id uuid, tenant_id uuid not null,
--   created_at/updated_at/deleted_at timestamptz, external_id text).
-- E os papéis da aplicação: macuxi_app, macuxi_worker ou macuxi_portal membro (direto ou indireto) do macuxi_manutencao
--   ignoraria a RLS; aparece como tabela "(papel) <nome>".
-- Portal do super-admin (0038, T-0091, ADR 0029): o macuxi_portal só executa as plataforma.sa_*; política ou qualquer grant de
--   tabela para ele (em qualquer tabela, direto ou via PUBLIC) aparece como problema.
-- Despachantes (0003, ADR 0007; 0040, ADR 0032; 0058, ADR 0043): política para o macuxi_worker (que lê todos os tenants) só em
--   plataforma.evento, plataforma.email_saida e plataforma.diagnostico (alerta do diagnóstico); em qualquer outra tabela aparece
--   como problema.
-- Resultado esperado: ZERO linhas. Exceções (iguais a db/src/excecoes.ts, TABELAS_SEM_TENANT_ID): plataforma.tenant não tem
-- tenant_id (o id é o tenant; RLS por id) e public.macuxi_migracao fica fora (schema public, sem acesso do macuxi_app).
-- Super-admin, portal, catálogo de planos, ações da empresa e dados legais (0035, ADR 0029; 0039, ADR 0031; 0070, ADR 0047; 0072, ADR 0052; 0073, rodapé legal; TABELAS_SO_POR_FUNCAO): sem tenant_id e SEM política para o macuxi_app (só por função
-- SECURITY DEFINER); para elas o problema é o contrário: política ou qualquer grant de tabela para o macuxi_app/macuxi_worker.
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
  values ('plataforma.tenant'),
         ('plataforma.super_admin'),
         ('plataforma.super_admin_desafio'),
         ('plataforma.super_admin_sessao'),
         ('plataforma.auditoria_plataforma'),
         ('plataforma.portal_tentativa'),
         ('plataforma.portal_sessao'),
         ('plataforma.portal_sessao_empresa'),
         ('plataforma.plano'),
         ('plataforma.backup_empresa'),
         ('plataforma.backup_empresa_parte'),
         ('plataforma.exclusao_empresa'),
         ('plataforma.empresa_excluida'),
         ('plataforma.dados_legais')
),
so_por_funcao (nome) as (
  values ('plataforma.super_admin'),
         ('plataforma.super_admin_desafio'),
         ('plataforma.super_admin_sessao'),
         ('plataforma.auditoria_plataforma'),
         ('plataforma.portal_tentativa'),
         ('plataforma.portal_sessao'),
         ('plataforma.portal_sessao_empresa'),
         ('plataforma.plano'),
         ('plataforma.backup_empresa'),
         ('plataforma.backup_empresa_parte'),
         ('plataforma.exclusao_empresa'),
         ('plataforma.empresa_excluida'),
         ('plataforma.dados_legais')
),
problemas as (
  select t.nome, 'RLS desligado' as problema from tabelas t where not t.rls
  union all
  select t.nome, 'RLS não forçado' from tabelas t where not t.forcado
  union all
  select t.nome, 'sem política' from tabelas t where not exists (select 1 from pg_policy p where p.polrelid = t.oid)
  union all
  select t.nome, 'sem política para o macuxi_app' from tabelas t
   where t.nome not in (select f.nome from so_por_funcao f)
     and not exists (
     select 1 from pg_policy p join pg_roles r on r.oid = any (p.polroles)
      where p.polrelid = t.oid and r.rolname = 'macuxi_app')
  union all
  select t.nome, 'só por função, mas com política ou grant para o macuxi_app/macuxi_worker' from tabelas t
   where t.nome in (select f.nome from so_por_funcao f)
     and (exists (select 1 from pg_policy p join pg_roles r on r.oid = any (p.polroles)
                   where p.polrelid = t.oid and r.rolname in ('macuxi_app', 'macuxi_worker'))
          or exists (select 1 from pg_roles r where r.rolname in ('macuxi_app', 'macuxi_worker')
                       and has_table_privilege(r.oid, t.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')))
  union all
  select t.nome, 'sem política de manutenção' from tabelas t
   where not exists (
     select 1 from pg_policy p join pg_roles r on r.oid = any (p.polroles)
      where p.polrelid = t.oid and p.polname = 'manutencao' and r.rolname = 'macuxi_manutencao'
        and p.polcmd = '*' and p.polpermissive
        and pg_get_expr(p.polqual, p.polrelid) = 'true' and pg_get_expr(p.polwithcheck, p.polrelid) = 'true')
  union all
  select t.nome, 'política ou grant de tabela para o macuxi_portal (0038: ele só executa as sa_*)' from tabelas t
   where exists (select 1 from pg_policy p join pg_roles r on r.oid = any (p.polroles)
                  where p.polrelid = t.oid and r.rolname = 'macuxi_portal')
      or exists (select 1 from pg_roles r where r.rolname = 'macuxi_portal'
                  and has_table_privilege(r.oid, t.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'))
  union all
  select t.nome, 'política para o macuxi_worker fora das outboxes (plataforma.evento, plataforma.email_saida, plataforma.diagnostico)' from tabelas t
   where t.nome not in ('plataforma.evento', 'plataforma.email_saida', 'plataforma.diagnostico')
     and exists (select 1 from pg_policy p join pg_roles r on r.oid = any (p.polroles)
                  where p.polrelid = t.oid and r.rolname = 'macuxi_worker')  union all
  select '(papel) ' || a.rolname, 'membro de macuxi_manutencao (ignoraria a RLS)'
    from pg_roles a join pg_roles m on m.rolname = 'macuxi_manutencao'
   where a.rolname in ('macuxi_app', 'macuxi_worker', 'macuxi_portal') and pg_has_role(a.oid, m.oid, 'MEMBER')
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
