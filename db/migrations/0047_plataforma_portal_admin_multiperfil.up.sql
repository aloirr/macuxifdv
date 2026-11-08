-- 0047_plataforma_portal_admin_multiperfil (up) — T-0094/T-0111, resto do D-MP2 (apontado na entrega R-20261108-101610 da
-- 0046; decisão do gerente no despacho de 08/11, igual ao SDK e à ADR 0033: entre perfis de base admin vale a SOMA; admin +
-- qualquer base não admin fecha o portal; RN-CORE-33, RN-CORE-35, RN-AUD-01; ADR 0031, 0032 e 0033). Dicionário:
-- docs/banco/plataforma.md ("Resgate da senha do admin pelos perfis (0047)").
-- Migração em cima da 0046. Só funções: nenhuma tabela, coluna, índice, política, papel ou grant novo.
--
-- Defeito: as 2 sa_* da 0042 decidiam "é admin" pelo perfil PRINCIPAL (core.usuario.perfil = 'admin'). Com o multiperfil da
-- 0041: (a) quem tem vendedor (ou outra base) como principal e admin como perfil extra não era alcançado nem pelo suporte (não
-- aparece na lista; redefinir = P0002) nem pelo BKO (senha.redefinir nunca alcança alvo com perfil de base admin, SDK
-- permissoes-perfil.ts e Core) — ninguém resgatava a senha dele; (b) a lista não dizia que o admin + vendedor não entra no
-- portal (0046), e a tela do suporte mostrava a conta como um admin comum.
--
-- 1. plataforma.usuario_tem_perfil_admin(p_tenant uuid, p_usuario uuid) -> boolean — algum perfil vivo e ativo de base admin
--    entre os do usuário (os mesmos que plataforma.perfis_do_usuario devolve à API e que a usuario_entra_no_portal lê: vínculo
--    sem deleted_at, perfil ativo e sem deleted_at). É a SOMA (união) dos perfis, o mesmo critério com que o BKO recusa o alvo
--    (no SDK: o alvo com algum perfil de base admin nunca tem a senha redefinida por senha.redefinir). Assim o suporte alcança
--    exatamente quem o BKO não alcança: sem buraco e sem sobreposição. SECURITY INVOKER, stable, search_path fixo com pg_temp
--    por último, sem EXECUTE para ninguém além do dono (só as sa_* a chamam, como dono, pela política manutencao da 0041/0031).
--    Sem o prefixo sa_: as listas SA_PORTAL/SA_INTERNAS (apps/api/test/funcoes-sa.ts, banco-dbaas.sh passo 6) não mudam.
-- 2. sa_admins_da_empresa(p_sid uuid, p_tenant uuid) — mesma assinatura; o retorno GANHA a última coluna entra_no_portal
--    boolean (drop + create: o Postgres não troca o retorno com create or replace; revoke/grant repetidos, EXECUTE só ao
--    macuxi_portal, ACL igual à da 0042). Lista quem tem algum perfil vivo e ativo de base admin (usuario_tem_perfil_admin), no
--    lugar do principal 'admin'; entra_no_portal = plataforma.usuario_entra_no_portal (a regra MAIS RESTRITIVA dos acessos,
--    0046): admin só = true; admin + qualquer base não admin = false; personalizado de base admin com acesso.portal revogado,
--    sozinho = false. A coluna fala só dos PERFIS: ativo, bloqueado, tem_senha e trocar_senha, ao lado, completam se a conta
--    entra de fato. O resto é o texto da 0042 (sessão de super-admin, vivos, até 50 por nome e id, nunca hash, auditoria só da
--    contagem). Colunas novas no fim: o leitor da API (AdminDaEmpresaSchema, z.object) ignora a coluna até o SDK expô-la.
-- 3. sa_redefinir_senha_admin(...) — mesma assinatura e retorno (create or replace: a ACL fica; revoke/grant repetidos). O alvo
--    passa a ser quem tem algum perfil vivo e ativo de base admin (usuario_tem_perfil_admin), mesmo que o principal seja outro;
--    o resto é o texto da 0042 (vivo, ativo, sem bloqueio, empresa ativa e viva; e-mail atual; o update da 0040; outbox na mesma
--    transação; auditoria sem dado pessoal; idempotente por p_email_id). Quem não tem perfil de base admin continua P0002.
--
-- RN-CORE-35, regra mais restritiva (conferida, NÃO muda o alvo): ela vale para os ACESSOS (entrar no BKO e no portal), não para
-- as ações. Redefinir a senha é ação do super-admin sobre a conta; a redefinição não dá acesso nenhum (admin + vendedor segue
-- sem portal pela 0046 e sem BKO pela 0041/SDK, e troca a senha no próximo acesso pelo app). Aplicá-la aqui (só "todos admin")
-- devolveria o buraco: admin + vendedor fora do suporte e fora do BKO. Onde ela entra é na coluna entra_no_portal.
--
-- Volume e desempenho: raro (suporte). A lista lê core.usuario por tenant (usuario_tenant_id_uk) com um semi-join por usuário
-- em usuario_perfil_usuario_ix + perfil_tenant_id_uk (1 a 3 vínculos por usuário) e a usuario_entra_no_portal só nas até 50
-- linhas devolvidas; a redefinição, 1 usuário pela chave.
--
-- Conferência no fim (a da 0046, aborta com 42501 e nada muda): nenhuma sa_* executável pelo app, worker ou PUBLIC; exatamente
-- 14 sa_* do macuxi_portal; a interna e a criar_super_admin por ninguém; a usuario_entra_no_portal e a usuario_tem_perfil_admin
-- sem EXECUTE para app, worker, portal ou PUBLIC; o portal sem privilégio direto em plataforma.email_saida e em core.usuario.
--
-- Caminho de volta: 0047_plataforma_portal_admin_multiperfil.down.sql (recria as 2 sa_* com o texto EXATO da 0042 — a lista
-- volta ao retorno de 9 colunas, drop + create com a mesma ACL — e apaga a usuario_tem_perfil_admin; volta exatamente ao
-- catálogo e às ACLs da 0046). Nenhum dado muda nos dois sentidos (senha já redefinida pelo suporte segue temporária; e-mail
-- enfileirado segue; auditoria fica). Com o down, o defeito volta (vendedor + admin extra sem resgate de senha).

-- 1. Algum perfil vivo e ativo de base admin (a soma dos perfis; o critério com que o BKO recusa o alvo) ---------------------
create function plataforma.usuario_tem_perfil_admin(p_tenant uuid, p_usuario uuid) returns boolean
  language sql stable security invoker
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
    select exists (
      select 1
        from plataforma.usuario_perfil up
        join plataforma.perfil p on p.tenant_id = up.tenant_id and p.id = up.perfil_id and p.ativo and p.deleted_at is null
       where up.tenant_id = p_tenant and up.usuario_id = p_usuario and up.deleted_at is null and p.base = 'admin')
  $$;
revoke all on function plataforma.usuario_tem_perfil_admin(uuid, uuid) from public, macuxi_app, macuxi_worker, macuxi_portal;

-- 2. Lista dos admins da empresa pelos perfis, com a entrada no portal (só super-admin; retorno novo = drop + create) ----------
drop function plataforma.sa_admins_da_empresa(uuid, uuid);
create function plataforma.sa_admins_da_empresa(p_sid uuid, p_tenant uuid)
  returns table (usuario_id uuid, nome text, email text, ativo boolean, bloqueado boolean, tem_senha boolean, trocar_senha boolean,
                 senha_expira_em timestamptz, sessao_versao integer, entra_no_portal boolean)
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
#variable_conflict use_column
declare
  v_tipo text;
  v_sa uuid;
  v_n integer := 0;
begin
  select v.tipo, v.super_admin_id into v_tipo, v_sa from plataforma.sa_sessao_valida(p_sid) v;
  if v_tipo is distinct from 'super_admin' or v_sa is null then
    raise exception 'sa_admins_da_empresa: só com sessão de super-admin' using errcode = '28000';
  end if;
  if p_tenant is null then
    raise exception 'sa_admins_da_empresa: p_tenant obrigatório' using errcode = '22023';
  end if;
  return query
    select u.id, u.nome, u.email, u.ativo, u.bloqueado_em is not null, u.senha_hash is not null, u.trocar_senha, u.senha_expira_em,
           u.sessao_versao,
           -- 0047: entra no portal pelos perfis (0046, regra mais restritiva); ativo/bloqueado/senha completam ao lado
           plataforma.usuario_entra_no_portal(u.tenant_id, u.id)
      from core.usuario u
      join plataforma.tenant t on t.id = u.tenant_id
     where u.tenant_id = p_tenant and u.deleted_at is null and t.deleted_at is null
       -- 0047: algum perfil vivo e ativo de base admin (a soma dos perfis), não só o principal
       and plataforma.usuario_tem_perfil_admin(u.tenant_id, u.id)
     order by u.nome, u.id
     limit 50;
  get diagnostics v_n = row_count;
  perform plataforma.sa_registrar_auditoria('super_admin', v_sa, null, p_sid, p_tenant, 'sa.admin.listar', jsonb_build_object('admins', v_n));
end
$$;
revoke all on function plataforma.sa_admins_da_empresa(uuid, uuid) from public, macuxi_app, macuxi_worker;
grant execute on function plataforma.sa_admins_da_empresa(uuid, uuid) to macuxi_portal;

-- 3. Redefinir a senha de quem tem algum perfil de base admin (só super-admin; mesma assinatura e retorno) ---------------------
create or replace function plataforma.sa_redefinir_senha_admin(p_sid uuid, p_tenant uuid, p_usuario uuid, p_senha_hash text, p_email text,
                                                    p_email_id uuid, p_carga bytea)
  returns table (email_id uuid, chave_idempotencia text, sessao_versao integer, senha_expira_em timestamptz, repetida boolean)
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
#variable_conflict use_column
declare
  c_argon2id constant text := '^\$argon2id\$v=[0-9]+\$m=[0-9]+,t=[0-9]+,p=[0-9]+\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$';
  v_tipo text;
  v_sa uuid;
  v_email_atual text;
  v_existente record;
  v_expira timestamptz := now() + interval '72 hours';
  v_versao integer;
  v_chave text;
  v_sessoes integer;
begin
  select v.tipo, v.super_admin_id into v_tipo, v_sa from plataforma.sa_sessao_valida(p_sid) v;
  if v_tipo is distinct from 'super_admin' or v_sa is null then
    raise exception 'sa_redefinir_senha_admin: só com sessão de super-admin' using errcode = '28000';
  end if;
  -- entrada (mensagens sem dado pessoal: nem e-mail, nem hash, nem carga)
  if p_tenant is null or p_usuario is null or p_email_id is null then
    raise exception 'sa_redefinir_senha_admin: p_tenant, p_usuario e p_email_id obrigatórios' using errcode = '22023';
  end if;
  if p_senha_hash is null or p_senha_hash !~ c_argon2id then
    raise exception 'sa_redefinir_senha_admin: p_senha_hash deve ser argon2id (formato PHC)' using errcode = '22023';
  end if;
  if p_email is null or char_length(btrim(p_email)) > 254 or btrim(p_email) !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'sa_redefinir_senha_admin: p_email inválido' using errcode = '22023';
  end if;
  if p_carga is null or octet_length(p_carga) not between 1 and 16384 then
    raise exception 'sa_redefinir_senha_admin: p_carga (cifrada) deve ter de 1 a 16384 bytes' using errcode = '22023';
  end if;

  -- idempotência pela linha do e-mail (retentativa da API com o mesmo p_email_id): devolve o que já foi gravado, nada muda
  select e.tenant_id, e.usuario_id, e.chave_idempotencia, e.expira_em into v_existente
    from plataforma.email_saida e where e.id = p_email_id;
  if found then
    if v_existente.tenant_id <> p_tenant or v_existente.usuario_id <> p_usuario
       or v_existente.chave_idempotencia !~ ('^' || p_usuario::text || ':redefinida_portal:[0-9]+$') then
      raise exception 'sa_redefinir_senha_admin: p_email_id já usado em outro e-mail' using errcode = '22023';
    end if;
    email_id := p_email_id;
    chave_idempotencia := v_existente.chave_idempotencia;
    sessao_versao := split_part(v_existente.chave_idempotencia, ':', 3)::integer;
    senha_expira_em := v_existente.expira_em;
    repetida := true;
    return next;
    return;
  end if;

  -- alvo: admin vivo, ativo e sem bloqueio, de empresa ativa e viva
  select u.email into v_email_atual
    from core.usuario u
    join plataforma.tenant t on t.id = u.tenant_id
   where u.tenant_id = p_tenant and u.id = p_usuario and u.deleted_at is null and u.ativo
     and u.bloqueado_em is null and t.status = 'ativo' and t.deleted_at is null
     -- 0047: algum perfil vivo e ativo de base admin (a soma dos perfis), mesmo que o principal seja outro
     and plataforma.usuario_tem_perfil_admin(u.tenant_id, u.id)
     for update of u;
  if not found then
    raise exception 'sa_redefinir_senha_admin: o alvo não é admin ativo desta empresa' using errcode = 'P0002';
  end if;
  -- a carga foi cifrada para o endereço que a API leu: se ele mudou, a senha não sai (a API recarrega e cifra de novo)
  if lower(btrim(v_email_atual)) <> lower(btrim(p_email)) then
    raise exception 'sa_redefinir_senha_admin: o e-mail do admin mudou desde a leitura' using errcode = '55000';
  end if;

  -- senha temporária (0040; o mesmo update do reset do BKO): só o hash, 72 h, troca obrigatória, versão nova
  update core.usuario u
     set senha_hash = p_senha_hash, trocar_senha = true, senha_expira_em = v_expira,
         senha_temporaria_hash = null, senha_temporaria_expira_em = null, senha_temporaria_criada_em = null,
         tentativas_falhas = 0, bloqueio_ate = null, sessao_versao = u.sessao_versao + 1
   where u.tenant_id = p_tenant and u.id = p_usuario
  returning u.sessao_versao into v_versao;
  update core.sessao s set revogado_em = now()
   where s.tenant_id = p_tenant and s.usuario_id = p_usuario and s.revogado_em is null;
  get diagnostics v_sessoes = row_count;

  -- e-mail na outbox, na mesma transação (a carga já vem cifrada da API)
  v_chave := p_usuario::text || ':redefinida_portal:' || v_versao::text;
  insert into plataforma.email_saida (id, tenant_id, usuario_id, modelo, chave_idempotencia, carga, expira_em)
  values (p_email_id, p_tenant, p_usuario, 'nova_senha', v_chave, p_carga, v_expira);

  -- auditoria sem dado pessoal (RN-AUD-01): a do tenant (o admin do cliente vê no BKO) e a da plataforma (o ator)
  insert into plataforma.auditoria (tenant_id, usuario_id, modulo, acao, entidade, entidade_id, antes, depois)
  values (p_tenant, null, 'core', 'usuario.senha_redefinir', 'usuario', p_usuario, null,
          jsonb_build_object('trocar_senha', true, 'sessoes_revogadas', true, 'origem', 'portal', 'email', 'enfileirado'));
  perform plataforma.sa_registrar_auditoria('super_admin', v_sa, null, p_sid, p_tenant, 'sa.admin.senha_redefinir',
    jsonb_build_object('alvo', p_usuario, 'email_id', p_email_id, 'sessoes_revogadas', v_sessoes));

  email_id := p_email_id;
  chave_idempotencia := v_chave;
  sessao_versao := v_versao;
  senha_expira_em := v_expira;
  repetida := false;
  return next;
end
$$;
revoke all on function plataforma.sa_redefinir_senha_admin(uuid, uuid, uuid, text, text, uuid, bytea) from public, macuxi_app, macuxi_worker;
grant execute on function plataforma.sa_redefinir_senha_admin(uuid, uuid, uuid, text, text, uuid, bytea) to macuxi_portal;

-- Conferência pelo catálogo (a da 0046, com as 14, + a função nova e a outbox/core.usuario da 0042): nenhuma plataforma.sa_*
-- nem a criar_super_admin executável pelo macuxi_app, pelo macuxi_worker ou por PUBLIC; exatamente as 14 sa_* públicas
-- executáveis pelo macuxi_portal; a interna e a criar_super_admin, por ninguém; a usuario_entra_no_portal e a
-- usuario_tem_perfil_admin, por ninguém além do dono; o portal sem privilégio direto na outbox de e-mail nem em core.usuario.
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
    raise exception '0047: função executável pelo macuxi_app, macuxi_worker ou PUBLIC: %', v_f using errcode = '42501';
  end if;
  select string_agg(p.oid::regprocedure::text, ', ' order by 1) into v_f
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'plataforma' and p.proname in ('sa_registrar_auditoria', 'criar_super_admin')
     and has_function_privilege('macuxi_portal', p.oid, 'execute');
  if v_f is not null then
    raise exception '0047: função interna ou de deploy executável pelo macuxi_portal: %', v_f using errcode = '42501';
  end if;
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'plataforma' and p.proname like 'sa\_%' and has_function_privilege('macuxi_portal', p.oid, 'execute');
  if v_n <> 14 then
    raise exception '0047: esperadas 14 funções sa_* executáveis pelo macuxi_portal, há %', v_n using errcode = '42501';
  end if;
  if has_function_privilege('macuxi_app', 'plataforma.usuario_entra_no_portal(uuid, uuid)', 'execute')
     or has_function_privilege('macuxi_worker', 'plataforma.usuario_entra_no_portal(uuid, uuid)', 'execute')
     or has_function_privilege('macuxi_portal', 'plataforma.usuario_entra_no_portal(uuid, uuid)', 'execute') then
    raise exception '0047: plataforma.usuario_entra_no_portal executável pelo app, worker ou portal' using errcode = '42501';
  end if;
  if has_function_privilege('macuxi_app', 'plataforma.usuario_tem_perfil_admin(uuid, uuid)', 'execute')
     or has_function_privilege('macuxi_worker', 'plataforma.usuario_tem_perfil_admin(uuid, uuid)', 'execute')
     or has_function_privilege('macuxi_portal', 'plataforma.usuario_tem_perfil_admin(uuid, uuid)', 'execute') then
    raise exception '0047: plataforma.usuario_tem_perfil_admin executável pelo app, worker ou portal' using errcode = '42501';
  end if;
  if has_table_privilege('macuxi_portal', 'plataforma.email_saida', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
     or has_table_privilege('macuxi_portal', 'core.usuario', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') then
    raise exception '0047: o macuxi_portal não pode ter privilégio direto na plataforma.email_saida nem em core.usuario' using errcode = '42501';
  end if;
end
$$;
