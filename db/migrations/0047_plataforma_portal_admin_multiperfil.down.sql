-- 0047_plataforma_portal_admin_multiperfil (down) — desfaz a 0047 (resto do D-MP2) e volta exatamente ao catálogo e às ACLs da
-- 0046.
-- 1. Recria as 2 sa_* com o texto EXATO da 0042: a sa_admins_da_empresa por drop + create (o retorno volta às 9 colunas, sem
--    entra_no_portal; revoke/grant: EXECUTE só ao macuxi_portal, a ACL da 0042); a sa_redefinir_senha_admin por create or
--    replace (mesma assinatura e retorno, a ACL fica; revoke/grant repetidos). Volta o critério do perfil PRINCIPAL
--    (core.usuario.perfil = 'admin'): quem tem outro principal e admin como extra volta a ficar sem resgate de senha pelo suporte
--    e pelo BKO. Se o SDK já exigir a coluna entra_no_portal (AdminDaEmpresaSchema), tire-a do SDK antes de descer.
-- 2. Apaga plataforma.usuario_tem_perfil_admin (depois das sa_*, que deixam de chamá-la).
-- Nenhum dado muda (senha já redefinida segue temporária; e-mail enfileirado segue; auditoria fica). Idempotente: rodar de
-- novo recria as 2 iguais e os drops usam if exists.

-- 1. As 2 sa_* com o texto da 0042 ------------------------------------------------------------------------------------------
drop function if exists plataforma.sa_admins_da_empresa(uuid, uuid);
create function plataforma.sa_admins_da_empresa(p_sid uuid, p_tenant uuid)
  returns table (usuario_id uuid, nome text, email text, ativo boolean, bloqueado boolean, tem_senha boolean, trocar_senha boolean,
                 senha_expira_em timestamptz, sessao_versao integer)
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
           u.sessao_versao
      from core.usuario u
      join plataforma.tenant t on t.id = u.tenant_id
     where u.tenant_id = p_tenant and u.perfil = 'admin' and u.deleted_at is null and t.deleted_at is null
     order by u.nome, u.id
     limit 50;
  get diagnostics v_n = row_count;
  perform plataforma.sa_registrar_auditoria('super_admin', v_sa, null, p_sid, p_tenant, 'sa.admin.listar', jsonb_build_object('admins', v_n));
end
$$;
revoke all on function plataforma.sa_admins_da_empresa(uuid, uuid) from public, macuxi_app, macuxi_worker;
grant execute on function plataforma.sa_admins_da_empresa(uuid, uuid) to macuxi_portal;

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

  -- alvo: admin (perfil principal, o critério do login do portal) vivo, ativo e sem bloqueio, de empresa ativa e viva
  select u.email into v_email_atual
    from core.usuario u
    join plataforma.tenant t on t.id = u.tenant_id
   where u.tenant_id = p_tenant and u.id = p_usuario and u.perfil = 'admin' and u.deleted_at is null and u.ativo
     and u.bloqueado_em is null and t.status = 'ativo' and t.deleted_at is null
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

-- 2. A função da 0047 ----------------------------------------------------------------------------------------------------
drop function if exists plataforma.usuario_tem_perfil_admin(uuid, uuid);

-- Conferência (a da 0046): de volta às 14 sa_* do portal; a usuario_entra_no_portal (0046) sem EXECUTE para ninguém
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
    raise exception '0047 down: função executável pelo macuxi_app, macuxi_worker ou PUBLIC: %', v_f using errcode = '42501';
  end if;
  select string_agg(p.oid::regprocedure::text, ', ' order by 1) into v_f
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'plataforma' and p.proname in ('sa_registrar_auditoria', 'criar_super_admin')
     and has_function_privilege('macuxi_portal', p.oid, 'execute');
  if v_f is not null then
    raise exception '0047 down: função interna ou de deploy executável pelo macuxi_portal: %', v_f using errcode = '42501';
  end if;
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'plataforma' and p.proname like 'sa\_%' and has_function_privilege('macuxi_portal', p.oid, 'execute');
  if v_n <> 14 then
    raise exception '0047 down: esperadas 14 funções sa_* executáveis pelo macuxi_portal, há %', v_n using errcode = '42501';
  end if;
  if has_function_privilege('macuxi_app', 'plataforma.usuario_entra_no_portal(uuid, uuid)', 'execute')
     or has_function_privilege('macuxi_worker', 'plataforma.usuario_entra_no_portal(uuid, uuid)', 'execute')
     or has_function_privilege('macuxi_portal', 'plataforma.usuario_entra_no_portal(uuid, uuid)', 'execute') then
    raise exception '0047 down: plataforma.usuario_entra_no_portal executável pelo app, worker ou portal' using errcode = '42501';
  end if;
  if has_table_privilege('macuxi_portal', 'plataforma.email_saida', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
     or has_table_privilege('macuxi_portal', 'core.usuario', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') then
    raise exception '0047 down: o macuxi_portal não pode ter privilégio direto na plataforma.email_saida nem em core.usuario' using errcode = '42501';
  end if;
end
$$;
