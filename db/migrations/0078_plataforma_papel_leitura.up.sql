-- 0078_plataforma_papel_leitura (up) — consulta SÓ LEITURA na produção (R-20261115-073000-alexandre, item 5; ADR 0055; pedido
-- do engenheiro-software, branch nuvem/consulta-producao-engenheiro-software). Dicionário: docs/banco/rls.md (papéis).
-- Migração ADITIVA e idempotente: um papel de cluster, os ajustes de sessão dele, USAGE nos schemas, SELECT nas tabelas de
-- tenant, EXECUTE em plataforma.tenant_por_codigo(text) e a política `leitura` em toda tabela com RLS. Nenhuma tabela, coluna,
-- política existente ou grant de outro papel muda.
--
-- Por quê: o workflow producao-consulta.yml roda o catálogo versionado scripts/producao/consultas/*.sql (serviço pgleitura do
-- compose) para diagnosticar a produção sem a conexão de administração, que ignora a RLS e pode escrever.
--
-- 1. Papel macuxi_leitura: criado só se falta, NOLOGIN, NOSUPERUSER, NOBYPASSRLS, NOCREATEDB, NOCREATEROLE, NOREPLICATION (o
--    padrão da 0038). O LOGIN e a senha vêm do passo de papéis (db/src/papeis.ts, garantirLeitura, B0 do plano B do DBaaS,
--    ADR 0024) com MACUXI_PG_LEITURA_SENHA (leitura.env da VM): papel existente só recebe "alter role ... login password
--    <verificador SCRAM>". Sem a senha o papel fica NOLOGIN.
-- 2. Trava (aborta com 42501 e nada muda): o macuxi_leitura membro de qualquer papel (macuxi_app, macuxi_worker,
--    macuxi_manutencao ou outro: herdaria escrita ou a política manutencao da 0031). O admin pode ser MEMBRO dele (o SET do B0
--    sem superusuário); o contrário, não.
-- 3. Ajustes de sessão (ALTER ROLE ... SET, valem em todo banco do servidor): default_transaction_read_only = on,
--    statement_timeout = '15s', idle_in_transaction_session_timeout = '60s'. Só os que faltam em pg_db_role_setting: o passo
--    de papéis (garantirAjustesLeitura, com advisory lock) grava antes; aqui, em geral, nada é gravado. O ajuste é só o padrão
--    da sessão (o cliente pode trocá-lo); quem impede a escrita são os grants: só SELECT.
-- 4. Laço no catálogo pg_class (o mesmo da 0031), em toda tabela com RLS dos schemas do Macuxi (fora pg_*, information_schema
--    e public):
--    - com coluna tenant_id: USAGE no schema, grant select e
--      create policy leitura ... for select to macuxi_leitura using (tenant_id = plataforma.tenant_atual());
--    - plataforma.tenant (o id é o tenant): o mesmo, com using (id = plataforma.tenant_atual());
--    - as demais (sem tenant_id: as só por função do super-admin e do portal, TABELAS_SO_POR_FUNCAO) ficam SEM grant e SEM
--      política (42501).
--    Sem app.tenant_id na sessão, tenant_atual() é NULL e a leitura devolve 0 linhas (falha fechada). Nenhum INSERT, UPDATE,
--    DELETE, TRUNCATE, REFERENCES ou TRIGGER; nenhuma sequência; nenhuma view.
-- 5. grant execute on function plataforma.tenant_por_codigo(text) to macuxi_leitura (SECURITY DEFINER, devolve só id e status;
--    é como a consulta resolve o tenant pelo código). Nenhuma outra função: as plataforma.sa_* seguem só do macuxi_portal.
-- 6. Conferência final pelo catálogo (42501): privilégio de escrita em qualquer tabela, EXECUTE em qualquer sa_* ou tabela com
--    RLS e tenant sem a política leitura.
--
-- Regra para tabela nova (0079 em diante; o repositório não usa ALTER DEFAULT PRIVILEGES): junto da isolamento_tenant e da
-- manutencao, a migração com tabela de tenant cria
--   grant select on <schema>.<tabela> to macuxi_leitura;
--   create policy leitura on <schema>.<tabela> for select to macuxi_leitura using (tenant_id = plataforma.tenant_atual());
-- db/scripts/conferir-rls.sql e db/testes/conformidade.test.ts no banco, e db/testes/papel-leitura.db.test.ts nas migrações,
-- falham sem elas. Schema novo também precisa do grant usage on schema ... to macuxi_leitura.
--
-- Caminho de volta: 0078_plataforma_papel_leitura.down.sql (apaga as políticas leitura, revoga SELECT, USAGE e o EXECUTE).
-- O papel e os ajustes de sessão ficam (objetos do cluster, como o macuxi_portal na 0038).

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'macuxi_leitura') then
    create role macuxi_leitura nologin nosuperuser nobypassrls nocreatedb nocreaterole noreplication;
  end if;
end
$$;

do $$
begin
  if exists (select 1 from pg_auth_members m where m.member = (select oid from pg_roles where rolname = 'macuxi_leitura')) then
    raise exception '0078: o papel macuxi_leitura é membro de outro papel (herdaria privilégios); revogue antes de migrar'
      using errcode = '42501';
  end if;
end
$$;

do $$
declare
  v_ajustes text[];
  v_a text[];
begin
  select s.setconfig into v_ajustes
    from pg_db_role_setting s
   where s.setdatabase = 0 and s.setrole = (select oid from pg_roles where rolname = 'macuxi_leitura');
  foreach v_a slice 1 in array array[
    ['default_transaction_read_only', 'on'],
    ['statement_timeout', '15s'],
    ['idle_in_transaction_session_timeout', '60s']
  ] loop
    if not (coalesce(v_ajustes, '{}') @> array[v_a[1] || '=' || v_a[2]]) then
      execute format('alter role macuxi_leitura set %s = %L', v_a[1], v_a[2]);
    end if;
  end loop;
end
$$;

do $$
declare
  v_t record;
begin
  for v_t in
    select c.oid, c.oid::regclass::text as tabela, n.nspname as esquema,
           (c.oid = 'plataforma.tenant'::regclass) as eh_tenant
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where c.relkind in ('r', 'p') and c.relrowsecurity
       and n.nspname not in ('pg_catalog', 'information_schema', 'public') and n.nspname not like 'pg\_%'
       and (c.oid = 'plataforma.tenant'::regclass
            or exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'tenant_id' and a.attnum > 0 and not a.attisdropped))
     order by 2
  loop
    execute format('grant usage on schema %I to macuxi_leitura', v_t.esquema);
    execute format('grant select on %s to macuxi_leitura', v_t.tabela);
    if not exists (select 1 from pg_policy p where p.polrelid = v_t.oid and p.polname = 'leitura') then
      if v_t.eh_tenant then
        execute format('create policy leitura on %s for select to macuxi_leitura using (id = plataforma.tenant_atual())', v_t.tabela);
      else
        execute format('create policy leitura on %s for select to macuxi_leitura using (tenant_id = plataforma.tenant_atual())', v_t.tabela);
      end if;
    end if;
  end loop;
end
$$;

grant execute on function plataforma.tenant_por_codigo(text) to macuxi_leitura;

-- Conferência pelo catálogo: nenhuma escrita em tabela, nenhuma sa_* executável, toda tabela de tenant com RLS com a leitura.
do $$
declare
  v_x text;
begin
  select string_agg(c.oid::regclass::text, ', ' order by 1) into v_x
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where c.relkind in ('r', 'p', 'v', 'm', 'f') and n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg\_%'
     and has_table_privilege('macuxi_leitura', c.oid, 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER');
  if v_x is not null then
    raise exception '0078: macuxi_leitura com privilégio de escrita em: %', v_x using errcode = '42501';
  end if;
  select string_agg(p.oid::regprocedure::text, ', ' order by 1) into v_x
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'plataforma' and p.proname like 'sa\_%' and has_function_privilege('macuxi_leitura', p.oid, 'execute');
  if v_x is not null then
    raise exception '0078: função sa_* executável pelo macuxi_leitura: %', v_x using errcode = '42501';
  end if;
  select string_agg(c.oid::regclass::text, ', ' order by 1) into v_x
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where c.relkind in ('r', 'p') and c.relrowsecurity
     and n.nspname not in ('pg_catalog', 'information_schema', 'public') and n.nspname not like 'pg\_%'
     and (c.oid = 'plataforma.tenant'::regclass
          or exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'tenant_id' and a.attnum > 0 and not a.attisdropped))
     and not exists (select 1 from pg_policy p where p.polrelid = c.oid and p.polname = 'leitura');
  if v_x is not null then
    raise exception '0078: tabela de tenant sem a política leitura: %', v_x using errcode = '42501';
  end if;
end
$$;
