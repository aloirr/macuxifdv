-- 0042_plataforma_portal_redefinir_senha_admin (up) — T-0094 (padrão de fábrica da T-0111): o super-admin da Macuxi redefine,
-- pelo portal config., a senha do admin do cliente (R-20261107-185546; doc 03 §2; ADR 0031, 0032 e 0033; RN-CORE-32, RN-CORE-34,
-- RN-CORE-35, RN-AUD-01). Dicionário: docs/banco/plataforma.md ("Redefinir a senha do admin pelo portal (0042)").
-- Migração em cima da 0041, no MESMO lote da 0039, 0040 e 0041 (nenhuma delas muda). Só funções: nenhuma tabela, coluna,
-- índice ou política nova. Usa o que a 0040 criou (estado da senha em core.usuario, sessao_versao, plataforma.email_saida).
--
-- Duas funções SECURITY DEFINER (search_path = pg_catalog, plataforma, pg_temp; revoke de PUBLIC, macuxi_app e macuxi_worker;
-- EXECUTE SÓ ao macuxi_portal, regra da 0038). Só com sessão viva de SUPER-ADMIN (admin do cliente ou sessão inválida = 28000):
--
--   sa_admins_da_empresa(p_sid uuid, p_tenant uuid)
--     -> table (usuario_id, nome, email, ativo, bloqueado, tem_senha, trocar_senha, senha_expira_em, sessao_versao)
--        os admins (core.usuario.perfil = 'admin', o perfil principal, o mesmo critério do login do portal) vivos da empresa,
--        por nome e id, até 50; empresa inexistente ou apagada = 0 linhas. Serve à tela (escolher o admin) e à API, que cifra a
--        carga do e-mail com o endereço e o nome ANTES de chamar a redefinição (a carga é cifrada na API: AAD = id|tenant|modelo).
--        Nunca devolve hash. Grava sa.admin.listar {admins: n} (sem dado pessoal).
--
--   sa_redefinir_senha_admin(p_sid uuid, p_tenant uuid, p_usuario uuid, p_senha_hash text, p_email text, p_email_id uuid,
--                            p_carga bytea)
--     -> table (email_id uuid, chave_idempotencia text, sessao_versao integer, senha_expira_em timestamptz, repetida boolean)
--        Numa transação só (a da chamada):
--        1. alvo = admin (perfil principal 'admin') vivo, ATIVO e sem bloqueio administrativo da empresa p_tenant, e empresa
--           'ativo' e viva; outro usuário, outro tenant, admin inativo/bloqueado/apagado = P0002 (a API traduz em 404);
--        2. p_email tem de ser o e-mail ATUAL do alvo (lower/btrim): a carga foi cifrada para ele; diferente = 55000 (a API
--           traduz em 409 e recarrega a lista) — a senha nunca vai para um endereço antigo;
--        3. grava a senha temporária como a 0040 define (o mesmo update do reset do BKO): senha_hash = p_senha_hash (argon2id,
--           só o hash; a senha nunca chega ao banco), trocar_senha = true, senha_expira_em = now() + 72 h (P4), some a
--           temporária paralela do "Esqueci", zera tentativas e bloqueio temporário, sessao_versao + 1 (token, refresh e sessão
--           do portal do admin caem na hora) e revoga os refresh (core.sessao);
--        4. enfileira o e-mail em plataforma.email_saida com id = p_email_id, modelo 'nova_senha', a carga JÁ CIFRADA recebida
--           (p_carga, 1 a 16 KB), chave_idempotencia '<usuario>:redefinida_portal:<versao nova>' e expira_em = a validade da
--           senha. O portal continua SEM privilégio na tabela (a função é que grava, como dona);
--        5. audita sem dado pessoal: plataforma.auditoria do tenant (modulo core, acao usuario.senha_redefinir, entidade usuario,
--           depois {trocar_senha, sessoes_revogadas, origem 'portal', email 'enfileirado'}; usuario_id nulo = não foi um usuário
--           do tenant) e auditoria_plataforma (sa.admin.senha_redefinir {alvo, email_id, sessoes_revogadas}; sem e-mail, hash
--           nem carga).
--        Idempotente por p_email_id: a mesma chamada de novo (retentativa da API) devolve a linha já gravada com repetida = true
--        e nada muda (nem a senha, nem a versão); o mesmo id com outro tenant/usuário = 22023.
--        Entrada inválida (nulo, hash fora do PHC argon2id, e-mail fora do formato, carga vazia ou > 16 KB) = 22023 sem dado
--        pessoal na mensagem.
--
-- Fora daqui (API, fatia S): gerar a senha (RN-CORE-32), o hash argon2id, cifrar a carga, o e-mail pelo despachante e o log
-- sem a senha. O super-admin nunca troca a senha de usuário que não seja admin (o resto é pelo BKO, RN-CORE-35/P7).
-- Volume: raro (suporte). Consultas pela chave do usuário e pelo índice core.usuario_admin_email_ix não são necessárias aqui:
-- a lista lê core.usuario por (tenant_id) com perfil 'admin' (poucas linhas por tenant; usuario_tenant_id_uk).
--
-- Conferência no fim (aborta com 42501 e nada muda): nenhuma sa_* executável pelo app, worker ou PUBLIC; exatamente 14 sa_*
-- executáveis pelo macuxi_portal (as 12 da 0039/0040 + as 2 daqui); a interna e a criar_super_admin por ninguém; o portal
-- continua sem privilégio direto em plataforma.email_saida e em core.usuario.
--
-- Caminho de volta: 0042_plataforma_portal_redefinir_senha_admin.down.sql (drop das 2 funções; volta exatamente ao catálogo e
-- às ACLs da 0041). Dados NÃO voltam: senhas já redefinidas continuam temporárias (o admin troca no próximo acesso), e-mails já
-- enfileirados seguem para o despachante e a auditoria fica (append-only). Desfaça junto a rota do portal da fatia S.

-- 1. Lista dos admins da empresa (só super-admin) -------------------------------------------------------------------------
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

-- 2. Redefinir a senha do admin do cliente (só super-admin) ----------------------------------------------------------------
create function plataforma.sa_redefinir_senha_admin(p_sid uuid, p_tenant uuid, p_usuario uuid, p_senha_hash text, p_email text,
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

-- Conferência pelo catálogo (a da 0040, com as 14): nenhuma plataforma.sa_* nem a criar_super_admin executável pelo macuxi_app,
-- pelo macuxi_worker ou por PUBLIC; exatamente as 14 sa_* públicas executáveis pelo macuxi_portal; a interna e a
-- criar_super_admin, por ninguém; o macuxi_portal sem privilégio direto na outbox de e-mail nem em core.usuario.
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
    raise exception '0042: função executável pelo macuxi_app, macuxi_worker ou PUBLIC: %', v_f using errcode = '42501';
  end if;
  select string_agg(p.oid::regprocedure::text, ', ' order by 1) into v_f
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'plataforma' and p.proname in ('sa_registrar_auditoria', 'criar_super_admin')
     and has_function_privilege('macuxi_portal', p.oid, 'execute');
  if v_f is not null then
    raise exception '0042: função interna ou de deploy executável pelo macuxi_portal: %', v_f using errcode = '42501';
  end if;
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'plataforma' and p.proname like 'sa\_%' and has_function_privilege('macuxi_portal', p.oid, 'execute');
  if v_n <> 14 then
    raise exception '0042: esperadas 14 funções sa_* executáveis pelo macuxi_portal, há %', v_n using errcode = '42501';
  end if;
  if has_table_privilege('macuxi_portal', 'plataforma.email_saida', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
     or has_table_privilege('macuxi_portal', 'core.usuario', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') then
    raise exception '0042: o macuxi_portal não pode ter privilégio direto na plataforma.email_saida nem em core.usuario' using errcode = '42501';
  end if;
end
$$;
