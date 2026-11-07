-- 0038_plataforma_papel_portal (up) — T-0091 (condição do aceite da ADR 0029, R-20261106-182000-alexandre item 3; desenho
-- docs/desenho/T-0091.md §2; pedido R-20261106-231440-engenheiro-software; RN-CORE-31). Dicionário: docs/banco/plataforma.md
-- ("Super-admin de plataforma", papel macuxi_portal) e docs/banco/rls.md (papéis).
-- Migração ADITIVA e idempotente: um papel de cluster, USAGE no schema plataforma e a troca do EXECUTE das 20 funções
-- plataforma.sa_* (0035 §10) do macuxi_app para o macuxi_portal. Nenhuma tabela, coluna, política ou grant de tabela muda.
--
-- Por quê: até a 0035 a sessão do macuxi_app (toda a API, o worker de eventos que usa o app nos handlers e as ferramentas)
-- conseguia abrir sessão de super-admin e criar tenant pelas sa_*. Uma injeção de SQL numa rota de tenant ou a senha do
-- macuxi_app vazada bastavam. Agora só o pool do portal na API (MACUXI_PG_PORTAL_SENHA, arquivo portal.env da VM) chega a elas.
--
-- 1. Papel macuxi_portal: criado só se falta, NOLOGIN, NOSUPERUSER, NOBYPASSRLS, NOCREATEDB, NOCREATEROLE, NOREPLICATION (o
--    padrão da 0031). O LOGIN e a senha vêm do passo de papéis (db/src/papeis.ts, garantirPapelPortal, B0 do plano B do DBaaS,
--    ADR 0024): papel existente só recebe "alter role ... login password <verificador SCRAM>". Esta migração não faz ALTER ROLE.
-- 2. Trava (aborta com 42501 e nada muda): o macuxi_portal membro de qualquer papel (herdaria privilégio de tabela ou a
--    política manutencao da 0031). O admin pode ser MEMBRO do macuxi_portal (o SET do B0 sem superusuário); o contrário,
--    não. Os atributos de um papel existente (superusuário, ignorar RLS, CREATEDB, CREATEROLE, REPLICATION) são conferidos
--    ANTES, pelo passo de papéis (garantirPapelPortal e garantirPapelSemLogin em db/src/papeis.ts: erro claro, nada muda),
--    e depois pelo diagnóstico S0-028 (diagnosticarPapelApp) nos testes de conformidade.
-- 3. grant usage on schema plataforma to macuxi_portal. NENHUM grant de tabela, sequência ou outro schema: o portal não lê
--    tabela de tenant nem as 4 do super-admin direto (RLS forçado, só a política manutencao; 42501 antes da RLS).
-- 4. As 20 sa_* (assinaturas exatas da 0035 §10): revoke execute from public, macuxi_app, macuxi_worker (o worker nunca teve;
--    o revoke explícito deixa a migração idempotente) e grant execute to macuxi_portal. Nada muda dentro das funções (nenhuma
--    usa current_user/session_user; seguem SECURITY DEFINER do migrador, search_path com pg_temp por último).
--    plataforma.sa_registrar_auditoria (interna) e plataforma.provisionar_tenant (só a conexão de administração) seguem sem
--    EXECUTE para ninguém além do dono.
-- Regra para as migrações seguintes: toda função plataforma.sa_* nova nasce com "revoke all ... from public" e EXECUTE SÓ ao
-- macuxi_portal (nunca ao macuxi_app nem ao macuxi_worker). db/testes/super-admin.test.ts e
-- tests/integracao/banco/conformidade.test.ts conferem pelo catálogo (toda sa_* do pg_proc), não por lista fixa.
--
-- Risco conhecido (desenho §3.5, do lado da API): a sa_provisionar_tenant grava plataforma.parametro, entidade de sync, e
-- passa a rodar noutro papel, que o cálculo do horizonte do pull (pg_stat_activity do macuxi_app) não enxerga. A API roda a
-- chamada com "set local statement_timeout = '1500ms'" (abaixo da margem de 2 s do horizonte), numa transação de um comando.
--
-- Ordem do deploy: o papel com LOGIN pelo passo de papéis (banco migrar up chama garantirPapelPortal antes das migrações,
-- com MACUXI_PG_PORTAL_SENHA) e a API com os dois pools NA MESMA VERSÃO: esta migração sozinha deixa o portal em 42501.
--
-- Caminho de volta: 0038_plataforma_papel_portal.down.sql (EXECUTE de volta ao macuxi_app, como na 0035; o macuxi_portal perde
-- o EXECUTE e o USAGE). O papel fica (objeto do cluster, como o macuxi_manutencao na 0031).

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'macuxi_portal') then
    create role macuxi_portal nologin nosuperuser nobypassrls nocreatedb nocreaterole noreplication;
  end if;
end
$$;

do $$
begin
  if exists (select 1 from pg_auth_members m where m.member = (select oid from pg_roles where rolname = 'macuxi_portal')) then
    raise exception '0038: o papel macuxi_portal é membro de outro papel (herdaria privilégios); revogue antes de migrar'
      using errcode = '42501';
  end if;
end
$$;

grant usage on schema plataforma to macuxi_portal;

revoke all on function plataforma.sa_existe() from public, macuxi_app, macuxi_worker;
grant execute on function plataforma.sa_existe() to macuxi_portal;
revoke all on function plataforma.sa_criar_primeiro(text, text, text) from public, macuxi_app, macuxi_worker;
grant execute on function plataforma.sa_criar_primeiro(text, text, text) to macuxi_portal;
revoke all on function plataforma.sa_para_login(text) from public, macuxi_app, macuxi_worker;
grant execute on function plataforma.sa_para_login(text) to macuxi_portal;
revoke all on function plataforma.sa_por_id(uuid) from public, macuxi_app, macuxi_worker;
grant execute on function plataforma.sa_por_id(uuid) to macuxi_portal;
revoke all on function plataforma.sa_registrar_falha(uuid) from public, macuxi_app, macuxi_worker;
grant execute on function plataforma.sa_registrar_falha(uuid) to macuxi_portal;
revoke all on function plataforma.sa_registrar_sucesso(uuid) from public, macuxi_app, macuxi_worker;
grant execute on function plataforma.sa_registrar_sucesso(uuid) to macuxi_portal;
revoke all on function plataforma.sa_gravar_totp_pendente(uuid, text) from public, macuxi_app, macuxi_worker;
grant execute on function plataforma.sa_gravar_totp_pendente(uuid, text) to macuxi_portal;
revoke all on function plataforma.sa_confirmar_totp(uuid, bigint, text[]) from public, macuxi_app, macuxi_worker;
grant execute on function plataforma.sa_confirmar_totp(uuid, bigint, text[]) to macuxi_portal;
revoke all on function plataforma.sa_marcar_passo(uuid, bigint) from public, macuxi_app, macuxi_worker;
grant execute on function plataforma.sa_marcar_passo(uuid, bigint) to macuxi_portal;
revoke all on function plataforma.sa_usar_recuperacao(uuid, text) from public, macuxi_app, macuxi_worker;
grant execute on function plataforma.sa_usar_recuperacao(uuid, text) to macuxi_portal;
revoke all on function plataforma.sa_regerar_recuperacao(uuid, text[]) from public, macuxi_app, macuxi_worker;
grant execute on function plataforma.sa_regerar_recuperacao(uuid, text[]) to macuxi_portal;
revoke all on function plataforma.sa_abrir_desafio(uuid, text) from public, macuxi_app, macuxi_worker;
grant execute on function plataforma.sa_abrir_desafio(uuid, text) to macuxi_portal;
revoke all on function plataforma.sa_ver_desafio(text) from public, macuxi_app, macuxi_worker;
grant execute on function plataforma.sa_ver_desafio(text) to macuxi_portal;
revoke all on function plataforma.sa_abrir_sessao(text) from public, macuxi_app, macuxi_worker;
grant execute on function plataforma.sa_abrir_sessao(text) to macuxi_portal;
revoke all on function plataforma.sa_sessao_valida(uuid) from public, macuxi_app, macuxi_worker;
grant execute on function plataforma.sa_sessao_valida(uuid) to macuxi_portal;
revoke all on function plataforma.sa_revogar(uuid) from public, macuxi_app, macuxi_worker;
grant execute on function plataforma.sa_revogar(uuid) to macuxi_portal;
revoke all on function plataforma.sa_auditar(jsonb) from public, macuxi_app, macuxi_worker;
grant execute on function plataforma.sa_auditar(jsonb) to macuxi_portal;
revoke all on function plataforma.sa_listar_tenants(uuid) from public, macuxi_app, macuxi_worker;
grant execute on function plataforma.sa_listar_tenants(uuid) to macuxi_portal;
revoke all on function plataforma.sa_tenant_ativo(uuid, uuid) from public, macuxi_app, macuxi_worker;
grant execute on function plataforma.sa_tenant_ativo(uuid, uuid) to macuxi_portal;
revoke all on function plataforma.sa_provisionar_tenant(uuid, jsonb) from public, macuxi_app, macuxi_worker;
grant execute on function plataforma.sa_provisionar_tenant(uuid, jsonb) to macuxi_portal;

-- Conferência pelo catálogo: nenhuma plataforma.sa_* (inclusive uma que escapou da lista acima) executável pelo macuxi_app,
-- pelo macuxi_worker ou por PUBLIC; as 20 públicas da 0035 executáveis pelo macuxi_portal.
do $$
declare
  v_f text;
  v_n int;
begin
  select string_agg(p.oid::regprocedure::text, ', ' order by 1) into v_f
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'plataforma' and p.proname like 'sa\_%'
     and (has_function_privilege('macuxi_app', p.oid, 'execute') or has_function_privilege('macuxi_worker', p.oid, 'execute'));
  if v_f is not null then
    raise exception '0038: função sa_* ainda executável pelo macuxi_app ou macuxi_worker: %', v_f using errcode = '42501';
  end if;
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'plataforma' and p.proname like 'sa\_%' and has_function_privilege('macuxi_portal', p.oid, 'execute');
  if v_n <> 20 then
    raise exception '0038: esperadas 20 funções sa_* executáveis pelo macuxi_portal, há %', v_n using errcode = '42501';
  end if;
end
$$;
