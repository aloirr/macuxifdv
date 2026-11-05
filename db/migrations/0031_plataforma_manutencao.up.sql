-- 0031_plataforma_manutencao (up) — T-0075, plano B do DBaaS da Magalu, item B1 (ADR 0024; relatório do run 42021914715;
-- pedido R-20261105-082502-engenheiro-software). Dicionário: docs/banco/rls.md (papel de manutenção) e docs/banco/plataforma.md.
-- Migração ADITIVA e idempotente: um papel de cluster, uma filiação e uma política permissiva por tabela com RLS. Nenhuma
-- tabela, coluna, grant de tabela ou política existente muda.
--
-- Por quê: no DBaaS o admin (migrador, dono das tabelas e das funções SECURITY DEFINER) NÃO é superusuário nem tem
-- BYPASSRLS, e não consegue ganhar BYPASSRLS de nenhum jeito (X1.2). Com FORCE RLS em toda tabela, o dono sem política não
-- lê nem grava linha de tenant: o seed demo e a Fase M, as fixtures dos testes, o backfill de migração (0 linhas, sem erro)
-- e as funções SECURITY DEFINER entre tenants (plataforma.tenants_ativos, resumo_outbox, tenant_por_codigo, expurgos,
-- integracao.autenticar_chave) quebravam. No Postgres da demo e do CI o dono é superusuário: lá nada muda.
--
-- 1. Papel macuxi_manutencao: NOLOGIN, NOSUPERUSER, NOBYPASSRLS, NOCREATEDB, NOCREATEROLE, NOREPLICATION (ninguém conecta
--    com ele). Papel é do cluster: criado só se não existe.
-- 2. grant macuxi_manutencao to current_user WITH INHERIT TRUE (PG 16): o migrador herda o papel, então as políticas
--    "to macuxi_manutencao" valem para ele em toda sessão e dentro das funções SECURITY DEFINER de que é dono (current_user
--    = dono), sem ALTER FUNCTION. Num superusuário a filiação é inócua. O admin do DBaaS (CREATEROLE) tem ADMIN OPTION no
--    papel que criou e pode concedê-lo a si mesmo (medido no B1 da 2ª execução).
-- 3. Política manutencao em TODA tabela com RLS ligado dos schemas do Macuxi (catálogo pg_class; plataforma.tenant
--    inclusive): for all to macuxi_manutencao using (true) with check (true) — o mesmo padrão das políticas
--    despacho_outbox* do macuxi_worker (0003). Só onde ainda não existe (idempotente).
-- Trava: macuxi_app e macuxi_worker NUNCA herdam nem podem assumir o papel (eles ignorariam a RLS). Se algum deles for
-- membro, direto ou indireto, a migração aborta (erro 42501) e nada muda.
--
-- Regra para tabela nova (migração 0032 em diante): junto da isolamento_tenant, a migração cria
--   create policy manutencao on <schema>.<tabela> for all to macuxi_manutencao using (true) with check (true);
-- db/scripts/conferir-rls.sql ("sem política de manutenção") e db/testes/conformidade.test.ts no banco, e
-- db/testes/estatico.test.ts nas migrações, falham sem ela.
--
-- Risco: o mesmo de hoje com superusuário (a conexão de administração vê todos os tenants). A API usa só o macuxi_app e o
-- worker só o macuxi_worker (S0-028); a conexão de administração fica só com o migrador, o seed e a manutenção manual.
--
-- Caminho de volta: 0031_plataforma_manutencao.down.sql (apaga as políticas manutencao). O papel e a filiação ficam
-- (objetos do cluster, como o macuxi_worker na 0003: outro banco do mesmo servidor pode depender deles). Sem a política,
-- num servidor sem superusuário o seed, as fixtures e as funções SECURITY DEFINER voltam a enxergar 0 linhas.

-- Papel e filiação só se faltam (o mesmo que db/src/papeis.ts, garantirPapelManutencao, faz antes, com advisory lock, nos
-- bancos de teste criados em paralelo: aqui as duas coisas já existem e nada é gravado em pg_authid/pg_auth_members).
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'macuxi_manutencao') then
    create role macuxi_manutencao nologin nosuperuser nobypassrls nocreatedb nocreaterole noreplication;
  end if;
  if not exists (
    select 1 from pg_auth_members m
     where m.roleid = (select oid from pg_roles where rolname = 'macuxi_manutencao')
       and m.member = (select oid from pg_roles where rolname = current_user)
       and m.inherit_option
  ) then
    grant macuxi_manutencao to current_user with inherit true;
  end if;
end
$$;

do $$
declare
  v_papel text;
begin
  foreach v_papel in array array['macuxi_app', 'macuxi_worker'] loop
    if exists (select 1 from pg_roles where rolname = v_papel)
       and pg_has_role(v_papel, 'macuxi_manutencao', 'MEMBER') then
      raise exception '0031: o papel % é membro de macuxi_manutencao (ignoraria a RLS); revogue antes de migrar', v_papel
        using errcode = '42501';
    end if;
  end loop;
end
$$;

do $$
declare
  v_t record;
begin
  for v_t in
    select c.oid::regclass::text as tabela
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where c.relkind in ('r', 'p') and c.relrowsecurity
       and n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg\_%'
       and not exists (select 1 from pg_policy p where p.polrelid = c.oid and p.polname = 'manutencao')
     order by 1
  loop
    execute format('create policy manutencao on %s for all to macuxi_manutencao using (true) with check (true)', v_t.tabela);
  end loop;
end
$$;
