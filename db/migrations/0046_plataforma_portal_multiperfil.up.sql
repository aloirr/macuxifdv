-- 0046_plataforma_portal_multiperfil (up) — T-0094/T-0111, defeito D-MP2 (pedidos R-20261108-062613-testes e
-- R-20261108-091451-engenheiro-software; revisão R-20261108-061253-engenheiro-software 🟡 1; ADR 0031 e 0033; RN-CORE-33,
-- RN-CORE-35). Dicionário: docs/banco/plataforma.md ("Portal e multiperfil (0046)").
-- Migração em cima da 0045. Só funções: nenhuma tabela, coluna, índice, política, papel ou grant novo.
--
-- Por que numa migração nova (e não na 0040, onde a sa_contas_para_login nasce): o filtro lê plataforma.usuario_perfil,
-- plataforma.perfil e plataforma.perfil_permissao, que só existem a partir da 0041. A 0040 não pode depender da 0041 (a
-- ordem 0040 → 0041 tem de continuar válida e o down da 0041 apaga as tabelas); recriar as 4 funções aqui mantém a 0040 e a
-- 0041 intactas e a descida em ordem (0046 → 0045 → ... → 0040) volta ao texto da 0040.
--
-- Defeito: o portal (config.) decidia a entrada do admin do cliente só pelo perfil PRINCIPAL (core.usuario.perfil = 'admin').
-- Com o multiperfil da 0041, um admin com outro vínculo (admin + vendedor, permitido se sobra outro admin com gestão) ou com
-- acesso.portal revogado por sobreposição continuava entrando. RN-CORE-35: nos acessos (BKO, portal) vale a regra MAIS
-- RESTRITIVA; RN-CORE-33/ADR 0033: o portal é só de base admin, então basta UM perfil vivo de outra base (vendedor, promotor,
-- supervisor, gerente, analista ou assistente) para fechar o portal.
--
-- 1. plataforma.usuario_entra_no_portal(p_tenant uuid, p_usuario uuid) -> boolean — gêmea de podeEntrar(perfis, 'portal') do
--    SDK (packages/platform-sdk/src/permissoes-perfil.ts: combinarPerfis + travaDaChave), sobre os perfis vivos e ativos do
--    usuário (os mesmos que plataforma.perfis_do_usuario devolve à API: vínculo sem deleted_at, perfil ativo e sem deleted_at):
--      - ao menos um perfil (sem perfil = não; falha fechada, como o SDK);
--      - TODOS de base admin (um de outra base fecha o portal pela regra mais restritiva);
--      - acesso.portal pela UNIÃO dos perfis (como nas outras chaves do SDK): algum perfil com a chave efetiva, isto é, a
--        sobreposição viva (concedida) se houver, senão a fábrica (acesso.portal só no admin). Um perfil personalizado de base
--        admin com acesso.portal revogado, SOZINHO, fecha o portal; junto do admin de fábrica, não (igual ao SDK e à tela).
--    SECURITY INVOKER, stable, search_path fixo com pg_temp por último, sem EXECUTE para ninguém além do dono: só é chamada
--    de dentro das sa_* (SECURITY DEFINER, executam como o dono, que lê as tabelas pela política manutencao da 0041 / 0031).
--    Não tem o prefixo sa_: as listas SA_PORTAL/SA_INTERNAS (apps/api/test/funcoes-sa.ts, banco-dbaas.sh passo 6) não mudam.
-- 2. As 4 sa_* do login e da sessão do portal (texto da 0040 + o filtro; mesmas assinaturas, mesmos retornos, recriadas com
--    create or replace, então as ACLs ficam; revoke/grant repetidos por clareza: EXECUTE só ao macuxi_portal):
--      sa_contas_para_login   admin do cliente só com usuario_entra_no_portal (sem oráculo: quem não entra = 0 linhas, a
--                             mesma resposta de e-mail inexistente; a API devolve 401 igual à senha errada);
--      sa_abrir_sessao_portal reconfere na abertura (perfil ganho entre a busca e a sessão = sem sessão);
--      sa_escolher_empresa    reconfere na troca de empresa;
--      sa_sessao_valida       a sessão do admin cai NA HORA se a conta da empresa atual ganhar um perfil de outra base ou
--                             perder o acesso.portal (como "cliente rebaixado cai na hora"), sem depender da sessao_versao.
--    O critério u.perfil = 'admin' fica (usa o índice parcial usuario_admin_email_ix da 0039 na busca por e-mail): com a
--    conferência da 0041 (um perfil vivo da base do principal), todos de base admin implica principal admin.
-- 3. NÃO mudam (decisão desta migração): sa_admins_da_empresa e sa_redefinir_senha_admin (0042) seguem pelo perfil principal
--    'admin'. São a ação do super-admin de resgatar a senha do admin (P7), não a entrada no portal: o admin + vendedor continua
--    resgatável pelo suporte (no BKO, senha.redefinir nunca alcança alvo com perfil de base admin).
--
-- Volume e desempenho: a função roda por conta candidata (até 20 no login; 1 por chamada de sessão), por índices da 0041
-- (usuario_perfil_usuario_ix, perfil_tenant_id_uk, perfil_permissao_uk): 1 a 3 vínculos por usuário.
--
-- Conferência no fim (a da 0042, aborta com 42501 e nada muda): nenhuma sa_* executável pelo app, worker ou PUBLIC; exatamente
-- 14 sa_* do macuxi_portal; a interna e a criar_super_admin por ninguém; e a usuario_entra_no_portal sem EXECUTE para app,
-- worker, portal ou PUBLIC.
--
-- Caminho de volta: 0046_plataforma_portal_multiperfil.down.sql (recria as 4 sa_* com o texto exato da 0040 — mesmas ACLs — e
-- apaga a usuario_entra_no_portal; volta exatamente ao catálogo e às ACLs da 0045). Nenhum dado muda nos dois sentidos. Com o
-- down, o defeito D-MP2 volta (admin + outro perfil entra no portal): só desfaça junto com o código que grava usuario_perfil.

-- 1. Entrada no portal pelos perfis do usuário (gêmea de podeEntrar(perfis, 'portal')) ------------------------------------
create function plataforma.usuario_entra_no_portal(p_tenant uuid, p_usuario uuid) returns boolean
  language sql stable security invoker
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
    with perfis as (
      select p.id, p.base
        from plataforma.usuario_perfil up
        join plataforma.perfil p on p.tenant_id = up.tenant_id and p.id = up.perfil_id and p.ativo and p.deleted_at is null
       where up.tenant_id = p_tenant and up.usuario_id = p_usuario and up.deleted_at is null
    )
    select exists (select 1 from perfis)
       and not exists (select 1 from perfis f where f.base <> 'admin')
       and exists (
         select 1 from perfis f
          where coalesce(
                  (select pp.concedida from plataforma.perfil_permissao pp
                    where pp.tenant_id = p_tenant and pp.perfil_id = f.id and pp.chave = 'acesso.portal' and pp.deleted_at is null),
                  f.base = 'admin'))
  $$;
revoke all on function plataforma.usuario_entra_no_portal(uuid, uuid) from public, macuxi_app, macuxi_worker, macuxi_portal;

-- 2. As 4 sa_* do login e da sessão do portal (texto da 0040 + usuario_entra_no_portal) -----------------------------------
create or replace function plataforma.sa_contas_para_login(p_email text)
  returns table (tipo text, conta_id uuid, tenant_id uuid, tenant_codigo text, tenant_nome text, senha_hash text,
                 trocar_senha boolean, senha_expira_em timestamptz, sessao_versao integer)
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
#variable_conflict use_column
declare
  v_email text := lower(btrim(p_email));
  v_n integer := 0;
begin
  -- e-mail vazio ou fora do formato: 0 linhas, sem erro (a resposta não pode diferir da de um e-mail que não existe)
  if v_email is null or v_email = '' or char_length(v_email) > 254
     or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    v_email := null;
  end if;
  if v_email is not null then
    return query
      select c.tipo, c.conta_id, c.tenant_id, c.tenant_codigo, c.tenant_nome, c.senha_hash, c.trocar_senha, c.senha_expira_em,
             c.sessao_versao
        from (
          select 'super_admin'::text as tipo, s.id as conta_id, null::uuid as tenant_id, null::text as tenant_codigo,
                 null::text as tenant_nome, s.senha_hash, false as trocar_senha, null::timestamptz as senha_expira_em,
                 null::integer as sessao_versao, 0 as ordem, ''::text as nome_ordem, s.id as id_ordem
            from plataforma.super_admin s
           where lower(s.email) = v_email and s.deleted_at is null and s.ativo
          union all
          select 'admin_cliente'::text, u.id, t.id, t.codigo, t.nome, u.senha_hash, u.trocar_senha, u.senha_expira_em, u.sessao_versao,
                 1, t.nome, t.id
            from core.usuario u
            join plataforma.tenant t on t.id = u.tenant_id
           where lower(u.email) = v_email and u.perfil = 'admin' and u.deleted_at is null and u.ativo and u.bloqueado_em is null
             and u.senha_hash is not null and t.status = 'ativo' and t.deleted_at is null
             -- 0046 (RN-CORE-33/RN-CORE-35, D-MP2): TODOS os perfis vivos do usuário de base admin e acesso.portal efetivo
             and plataforma.usuario_entra_no_portal(u.tenant_id, u.id)
        ) as c
       order by c.ordem, c.nome_ordem, c.id_ordem
       limit 20;
    get diagnostics v_n = row_count;
  end if;
  perform plataforma.sa_registrar_auditoria(null, null, null, null, null, 'sa.login.consulta', jsonb_build_object('contas', v_n));
end
$$;
revoke all on function plataforma.sa_contas_para_login(text) from public, macuxi_app, macuxi_worker;
grant execute on function plataforma.sa_contas_para_login(text) to macuxi_portal;

create or replace function plataforma.sa_abrir_sessao_portal(p jsonb)
  returns table (sessao_id uuid, expira_em timestamptz)
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
#variable_conflict use_column
declare
  c_uuid constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_tipo text;
  v_sa uuid;
  v_sid uuid;
  v_expira timestamptz := now() + interval '8 hours';
  v_e jsonb;
  v_n integer;
  v_t uuid;
  v_u uuid;
  v_vistos uuid[] := '{}';
  v_usuarios uuid[] := '{}';
  v_versoes integer[] := '{}';
  v_versao integer;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'sa_abrir_sessao_portal: a entrada deve ser um objeto JSON' using errcode = '22023';
  end if;
  v_tipo := p ->> 'tipo';
  if v_tipo = 'super_admin' then
    if p ? 'empresas' or coalesce(jsonb_typeof(p -> 'super_admin_id'), 'null') <> 'string' or (p ->> 'super_admin_id') !~ c_uuid then
      raise exception 'sa_abrir_sessao_portal: super_admin exige super_admin_id (UUID) e não aceita empresas' using errcode = '22023';
    end if;
    v_sa := (p ->> 'super_admin_id')::uuid;
    if not exists (select 1 from plataforma.super_admin s where s.id = v_sa and s.deleted_at is null and s.ativo) then
      return;
    end if;
    insert into plataforma.portal_sessao (tipo, super_admin_id, criada_em, ultimo_uso_em, expira_em)
    values ('super_admin', v_sa, now(), now(), v_expira)
    returning id into v_sid;
    perform plataforma.sa_registrar_auditoria('super_admin', v_sa, null, v_sid, null, 'sa.sessao.aberta', '{}'::jsonb);
  elsif v_tipo = 'admin_cliente' then
    if p ? 'super_admin_id' or coalesce(jsonb_typeof(p -> 'empresas'), 'null') <> 'array' then
      raise exception 'sa_abrir_sessao_portal: admin_cliente exige a lista empresas e não aceita super_admin_id' using errcode = '22023';
    end if;
    v_n := jsonb_array_length(p -> 'empresas');
    if v_n not between 1 and 20 then
      raise exception 'sa_abrir_sessao_portal: de 1 a 20 empresas' using errcode = '22023';
    end if;
    for v_e in select x.value from jsonb_array_elements(p -> 'empresas') x loop
      if jsonb_typeof(v_e) <> 'object' or coalesce(jsonb_typeof(v_e -> 'tenant_id'), 'null') <> 'string'
         or coalesce(jsonb_typeof(v_e -> 'usuario_id'), 'null') <> 'string'
         or (v_e ->> 'tenant_id') !~ c_uuid or (v_e ->> 'usuario_id') !~ c_uuid then
        raise exception 'sa_abrir_sessao_portal: cada empresa é { tenant_id, usuario_id } (UUID)' using errcode = '22023';
      end if;
      -- 0040: sessao_versao opcional (a que a sa_contas_para_login devolveu): inteiro >= 0
      if coalesce(jsonb_typeof(v_e -> 'sessao_versao'), 'null') <> 'null'
         and (jsonb_typeof(v_e -> 'sessao_versao') <> 'number' or (v_e ->> 'sessao_versao') !~ '^[0-9]{1,9}$') then
        raise exception 'sa_abrir_sessao_portal: sessao_versao deve ser inteiro >= 0' using errcode = '22023';
      end if;
      v_t := (v_e ->> 'tenant_id')::uuid;
      v_u := (v_e ->> 'usuario_id')::uuid;
      if v_t = any (v_vistos) then
        raise exception 'sa_abrir_sessao_portal: empresa repetida' using errcode = '22023';
      end if;
      v_vistos := v_vistos || v_t;
      -- reconfere no banco (entre a busca e a sessão o admin pode ter sido desativado): uma que não vale = sem sessão.
      -- 0040: conta com senha a trocar (RN-CORE-34) não entra; com a sessao_versao informada, a senha não pode ter mudado
      -- desde a conferência (versão diferente = sem sessão). A versão gravada é a de agora.
      select u.sessao_versao into v_versao
        from core.usuario u join plataforma.tenant t on t.id = u.tenant_id
       where u.tenant_id = v_t and u.id = v_u and u.perfil = 'admin' and u.ativo and u.bloqueado_em is null
         and u.senha_hash is not null and not u.trocar_senha and u.deleted_at is null and t.status = 'ativo' and t.deleted_at is null
         -- 0046: um perfil de outra base (ou acesso.portal revogado) ganho entre a busca e a sessão = sem sessão
         and plataforma.usuario_entra_no_portal(u.tenant_id, u.id);
      if not found then
        return;
      end if;
      if coalesce(jsonb_typeof(v_e -> 'sessao_versao'), 'null') <> 'null' and (v_e ->> 'sessao_versao')::integer <> v_versao then
        return;
      end if;
      v_usuarios := v_usuarios || v_u;
      v_versoes := v_versoes || v_versao;
    end loop;
    insert into plataforma.portal_sessao (tipo, criada_em, ultimo_uso_em, expira_em)
    values ('admin_cliente', now(), now(), v_expira)
    returning id into v_sid;
    insert into plataforma.portal_sessao_empresa (sessao_id, tenant_alvo_id, usuario_id, sessao_versao)
    select v_sid, x.t, x.u, x.v
      from unnest(v_vistos, v_usuarios, v_versoes) as x (t, u, v);
    if v_n = 1 then
      update plataforma.portal_sessao x set tenant_atual_id = v_t, usuario_atual_id = v_u where x.id = v_sid;
    end if;
    perform plataforma.sa_registrar_auditoria('admin_cliente', null, case when v_n = 1 then v_u end, v_sid,
      case when v_n = 1 then v_t end, 'sa.sessao.aberta', jsonb_build_object('empresas', v_n));
  else
    raise exception 'sa_abrir_sessao_portal: tipo deve ser super_admin ou admin_cliente' using errcode = '22023';
  end if;
  sessao_id := v_sid;
  expira_em := v_expira;
  return next;
end
$$;
revoke all on function plataforma.sa_abrir_sessao_portal(jsonb) from public, macuxi_app, macuxi_worker;
grant execute on function plataforma.sa_abrir_sessao_portal(jsonb) to macuxi_portal;

create or replace function plataforma.sa_escolher_empresa(p_sid uuid, p_tenant uuid)
  returns table (tenant_id uuid, usuario_id uuid, codigo text, nome text)
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
#variable_conflict use_column
declare
  v_u uuid;
  v_versao integer;
  v_codigo text;
  v_nome text;
begin
  select e.usuario_id, e.sessao_versao into v_u, v_versao
    from plataforma.portal_sessao x
    join plataforma.portal_sessao_empresa e on e.sessao_id = x.id
   where x.id = p_sid and x.tipo = 'admin_cliente' and x.revogada_em is null and x.deleted_at is null and x.expira_em > now()
     and e.tenant_alvo_id = p_tenant and e.deleted_at is null
     -- 0040: a sessão já caiu se a senha de alguma conta conferida mudou ou ficou a trocar (a mesma regra da sa_sessao_valida)
     and not exists (select 1 from plataforma.portal_sessao_empresa o
                       join core.usuario w on w.tenant_id = o.tenant_alvo_id and w.id = o.usuario_id
                      where o.sessao_id = x.id and o.deleted_at is null and (w.sessao_versao <> o.sessao_versao or w.trocar_senha))
     for update of x;
  if v_u is null then
    return;
  end if;
  select t.codigo, t.nome into v_codigo, v_nome
    from core.usuario u
    join plataforma.tenant t on t.id = u.tenant_id
   where u.tenant_id = p_tenant and u.id = v_u and u.perfil = 'admin' and u.ativo and u.bloqueado_em is null
     and u.senha_hash is not null and u.deleted_at is null and t.status = 'ativo' and t.deleted_at is null
     -- 0040: senha trocada/redefinida depois do login (versão nova) ou senha a trocar = a empresa não abre
     and not u.trocar_senha and u.sessao_versao = v_versao
     -- 0046: a conta ganhou um perfil de outra base (ou perdeu o acesso.portal) depois do login = a empresa não abre
     and plataforma.usuario_entra_no_portal(u.tenant_id, u.id);
  if not found then
    return;
  end if;
  update plataforma.portal_sessao x
     set tenant_atual_id = p_tenant, usuario_atual_id = v_u, ultimo_uso_em = now()
   where x.id = p_sid;
  perform plataforma.sa_registrar_auditoria('admin_cliente', null, v_u, p_sid, p_tenant, 'sa.empresa.escolher', '{}'::jsonb);
  tenant_id := p_tenant;
  usuario_id := v_u;
  codigo := v_codigo;
  nome := v_nome;
  return next;
end
$$;
revoke all on function plataforma.sa_escolher_empresa(uuid, uuid) from public, macuxi_app, macuxi_worker;
grant execute on function plataforma.sa_escolher_empresa(uuid, uuid) to macuxi_portal;

create or replace function plataforma.sa_sessao_valida(p_sid uuid)
  returns table (tipo text, super_admin_id uuid, tenant_id uuid, usuario_id uuid, expira_em timestamptz)
  language sql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
    update plataforma.portal_sessao x
       set ultimo_uso_em = now()
     where x.id = p_sid and x.revogada_em is null and x.deleted_at is null and x.expira_em > now()
       and (
         (x.tipo = 'super_admin'
          and exists (select 1 from plataforma.super_admin s where s.id = x.super_admin_id and s.deleted_at is null and s.ativo))
         or (x.tipo = 'admin_cliente' and x.tenant_atual_id is null)
         or (x.tipo = 'admin_cliente'
             and exists (select 1 from core.usuario u join plataforma.tenant t on t.id = u.tenant_id
                          where u.tenant_id = x.tenant_atual_id and u.id = x.usuario_atual_id and u.perfil = 'admin' and u.ativo
                            and u.bloqueado_em is null and u.senha_hash is not null and u.deleted_at is null
                            and t.status = 'ativo' and t.deleted_at is null
                            -- 0046: cai na hora se a conta da empresa atual deixou de ser só admin com acesso.portal
                            and plataforma.usuario_entra_no_portal(u.tenant_id, u.id)))
       )
       -- 0040: admin do cliente cai na hora se a senha de QUALQUER conta conferida no login mudou (sessao_versao) ou ficou
       -- a trocar (RN-CORE-34): a sessão inteira nasceu do conhecimento daquela senha
       and (x.tipo <> 'admin_cliente'
            or not exists (select 1 from plataforma.portal_sessao_empresa e
                             join core.usuario u on u.tenant_id = e.tenant_alvo_id and u.id = e.usuario_id
                            where e.sessao_id = x.id and e.deleted_at is null
                              and (u.sessao_versao <> e.sessao_versao or u.trocar_senha)))
    returning x.tipo, x.super_admin_id, x.tenant_atual_id, x.usuario_atual_id, x.expira_em
  $$;
revoke all on function plataforma.sa_sessao_valida(uuid) from public, macuxi_app, macuxi_worker;
grant execute on function plataforma.sa_sessao_valida(uuid) to macuxi_portal;

-- Conferência pelo catálogo (a da 0042, com as 14, + a função nova): nenhuma plataforma.sa_* nem a criar_super_admin
-- executável pelo macuxi_app, pelo macuxi_worker ou por PUBLIC; exatamente as 14 sa_* públicas executáveis pelo
-- macuxi_portal; a interna e a criar_super_admin, por ninguém; a usuario_entra_no_portal, por ninguém além do dono.
do $$
declare
  v_f text;
  v_n int;
begin
  select string_agg(p.oid::regprocedure::text, ', ' order by 1) into v_f
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'plataforma' and (p.proname like 'sa\_%' or p.proname = 'criar_super_admin')
     and (has_function_privilege('macuxi_app', p.oid, 'execute') or has_function_privilege('macuxi_worker', p.oid, 'execute')
          or exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                      where a.grantee = 0 and a.privilege_type = 'EXECUTE'));
  if v_f is not null then
    raise exception '0046: função executável pelo macuxi_app, macuxi_worker ou PUBLIC: %', v_f using errcode = '42501';
  end if;
  select string_agg(p.oid::regprocedure::text, ', ' order by 1) into v_f
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'plataforma' and p.proname in ('sa_registrar_auditoria', 'criar_super_admin')
     and has_function_privilege('macuxi_portal', p.oid, 'execute');
  if v_f is not null then
    raise exception '0046: função interna ou de deploy executável pelo macuxi_portal: %', v_f using errcode = '42501';
  end if;
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'plataforma' and p.proname like 'sa\_%' and has_function_privilege('macuxi_portal', p.oid, 'execute');
  if v_n <> 14 then
    raise exception '0046: esperadas 14 funções sa_* executáveis pelo macuxi_portal, há %', v_n using errcode = '42501';
  end if;
  if has_function_privilege('macuxi_app', 'plataforma.usuario_entra_no_portal(uuid, uuid)', 'execute')
     or has_function_privilege('macuxi_worker', 'plataforma.usuario_entra_no_portal(uuid, uuid)', 'execute')
     or has_function_privilege('macuxi_portal', 'plataforma.usuario_entra_no_portal(uuid, uuid)', 'execute') then
    raise exception '0046: plataforma.usuario_entra_no_portal executável pelo app, worker ou portal' using errcode = '42501';
  end if;
end
$$;
