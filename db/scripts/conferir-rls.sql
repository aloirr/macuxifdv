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
-- Despachantes (0003, ADR 0007; 0040, ADR 0032; 0058, ADR 0043; 0074, ADR 0054): política para o macuxi_worker (que lê todos
--   os tenants) só em plataforma.evento, plataforma.email_saida, plataforma.diagnostico (alerta do diagnóstico),
--   plataforma.sync_pacote e plataforma.sync_pacote_pedido (gerador do pacote da primeira carga); em qualquer outra tabela
--   aparece como problema.
-- Consulta só leitura (0078, ADR 0055): toda tabela com RLS e tenant_id (e a plataforma.tenant, por id) com a política
--   `leitura` for select to macuxi_leitura using (tenant_id = plataforma.tenant_atual()) e o SELECT (na tabela ou por coluna);
--   nas só por função, nenhuma política nem grant para ele; em nenhuma tabela privilégio de escrita; nenhuma outra política
--   para ele; e nenhum SELECT dele em coluna sensível (nome com hash, token, senha, segredo, chave, carga ou cifrad, tipo que
--   não seja boolean), em tabela ou view: a saída da consulta vai para o log do Actions (regra 8). E o papel: membro de
--   qualquer papel, EXECUTE em alguma plataforma.sa_* ou em função SECURITY DEFINER além de plataforma.tenant_por_codigo(text)
--   aparece como "(papel) macuxi_leitura". Função que retorna event_trigger (a do pgaudit do DBaaS) fica fora: SQL não a chama.
--   Exceção (0089, ADR 0061; TABELAS_SEM_LEITURA): as tabelas do rastreamento ficam SEM política e SEM grant para ele.
-- Resultado esperado: ZERO linhas. Exceções (iguais a db/src/excecoes.ts, TABELAS_SEM_TENANT_ID): plataforma.tenant não tem
-- tenant_id (o id é o tenant; RLS por id), plataforma.plano não tem tenant_id (catálogo; desde a 0086 o app lê só o plano da
-- assinatura do próprio tenant, política pelo id) e public.macuxi_migracao fica fora (schema public, sem acesso do macuxi_app).
-- Super-admin, portal, ações da empresa e dados legais (0035, ADR 0029; 0039, ADR 0031; 0072, ADR 0052; 0073, rodapé legal; TABELAS_SO_POR_FUNCAO): sem tenant_id e SEM política para o macuxi_app (só por função
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
         ('plataforma.dados_legais'),
         ('plataforma.frase_carga')
),
so_por_funcao (nome) as (
  values ('plataforma.super_admin'),
         ('plataforma.super_admin_desafio'),
         ('plataforma.super_admin_sessao'),
         ('plataforma.auditoria_plataforma'),
         ('plataforma.portal_tentativa'),
         ('plataforma.portal_sessao'),
         ('plataforma.portal_sessao_empresa'),
         ('plataforma.backup_empresa'),
         ('plataforma.backup_empresa_parte'),
         ('plataforma.exclusao_empresa'),
         ('plataforma.empresa_excluida'),
         ('plataforma.dados_legais'),
         ('plataforma.frase_carga')
),
sem_leitura (nome) as (
  values ('core.ponto_trajeto'),
         ('core.pausa_trajeto'),
         ('core.ausencia_usuario'),
         ('core.termo_rastreamento'),
         ('core.aceite_termo_rastreamento')
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
  select t.nome, 'política para o macuxi_worker fora das outboxes (plataforma.evento, plataforma.email_saida, plataforma.diagnostico) e do gerador de pacotes (plataforma.sync_pacote, plataforma.sync_pacote_pedido)' from tabelas t
   where t.nome not in ('plataforma.evento', 'plataforma.email_saida', 'plataforma.diagnostico', 'plataforma.sync_pacote', 'plataforma.sync_pacote_pedido')
     and exists (select 1 from pg_policy p join pg_roles r on r.oid = any (p.polroles)
                  where p.polrelid = t.oid and r.rolname = 'macuxi_worker')
  union all
  select t.nome, 'sem a política leitura ou o SELECT do macuxi_leitura (0078)' from tabelas t
   where t.rls and t.nome not in (select f.nome from so_por_funcao f) and t.nome not in (select l.nome from sem_leitura l)
     and (t.nome = 'plataforma.tenant' or exists (select 1 from pg_attribute a where a.attrelid = t.oid and a.attname = 'tenant_id' and a.attnum > 0 and not a.attisdropped))
     and (not exists (
            select 1 from pg_policy p join pg_roles r on r.oid = any (p.polroles)
             where p.polrelid = t.oid and p.polname = 'leitura' and r.rolname = 'macuxi_leitura' and cardinality(p.polroles) = 1
               and p.polcmd = 'r' and p.polpermissive and p.polwithcheck is null
               and pg_get_expr(p.polqual, p.polrelid) = case when t.nome = 'plataforma.tenant' then '(id = plataforma.tenant_atual())'
                                                            else '(tenant_id = plataforma.tenant_atual())' end)
          or not exists (select 1 from pg_roles r where r.rolname = 'macuxi_leitura' and has_any_column_privilege(r.oid, t.oid, 'SELECT')))
  union all
  select t.nome, 'só por função ou sem leitura (0078; 0089, ADR 0061), mas com política ou grant para o macuxi_leitura' from tabelas t
   where (t.nome in (select f.nome from so_por_funcao f) or t.nome in (select l.nome from sem_leitura l))
     and (exists (select 1 from pg_policy p join pg_roles r on r.oid = any (p.polroles)
                   where p.polrelid = t.oid and r.rolname = 'macuxi_leitura')
          or exists (select 1 from pg_roles r where r.rolname = 'macuxi_leitura'
                       and (has_table_privilege(r.oid, t.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
                            or has_any_column_privilege(r.oid, t.oid, 'SELECT, INSERT, UPDATE, REFERENCES'))))
  union all
  select t.nome, 'privilégio de escrita para o macuxi_leitura (0078: só SELECT)' from tabelas t
   where exists (select 1 from pg_roles r where r.rolname = 'macuxi_leitura'
                   and (has_table_privilege(r.oid, t.oid, 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
                        or has_any_column_privilege(r.oid, t.oid, 'INSERT, UPDATE, REFERENCES')))
  union all
  select c.oid::regclass::text, 'SELECT do macuxi_leitura na coluna sensível ' || a.attname || ' (0078)'
    from pg_class c join pg_namespace n on n.oid = c.relnamespace join pg_attribute a on a.attrelid = c.oid
    join pg_roles r on r.rolname = 'macuxi_leitura'
   where c.relkind in ('r', 'p', 'v', 'm', 'f') and n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg\_%'
     and a.attnum > 0 and not a.attisdropped and a.attname ~ '(hash|token|senha|segredo|chave|carga|cifrad)' and a.atttypid <> 'boolean'::regtype
     and has_column_privilege(r.oid, c.oid, a.attnum, 'SELECT')
  union all
  select t.nome, 'política para o macuxi_leitura fora do padrão leitura (0078)' from tabelas t
   where exists (select 1 from pg_policy p join pg_roles r on r.oid = any (p.polroles)
                  where p.polrelid = t.oid and r.rolname = 'macuxi_leitura' and (p.polname <> 'leitura' or p.polcmd <> 'r'))
  union all
  select '(papel) macuxi_leitura', 'membro de ' || m.roleid::regrole::text || ' (herdaria privilégios)'
    from pg_auth_members m where m.member = (select oid from pg_roles where rolname = 'macuxi_leitura')
  union all
  select '(papel) macuxi_leitura', 'EXECUTE em ' || p.oid::regprocedure::text || ' (0078: só plataforma.tenant_por_codigo(text))'
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_roles r on r.rolname = 'macuxi_leitura'
   where n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg\_%'
     and ((n.nspname = 'plataforma' and p.proname like 'sa\_%') or p.prosecdef)
     and p.prorettype <> 'event_trigger'::regtype
     and p.oid <> 'plataforma.tenant_por_codigo(text)'::regprocedure
     and has_function_privilege(r.oid, p.oid, 'execute')
  union all
  select '(papel) ' || a.rolname, 'membro de macuxi_manutencao (ignoraria a RLS)'
    from pg_roles a join pg_roles m on m.rolname = 'macuxi_manutencao'
   where a.rolname in ('macuxi_app', 'macuxi_worker', 'macuxi_portal', 'macuxi_leitura') and pg_has_role(a.oid, m.oid, 'MEMBER')
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
