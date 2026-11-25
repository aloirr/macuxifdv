-- 0103_plataforma_senha_admin_portal (up) — troca da senha do ADMIN DO CLIENTE pela sessão do portal (v1.0.35, item 3; a rota
-- POST /v1/plataforma/auth/senha deixa de responder 403 TROCA_SO_SUPER_ADMIN para ele). Dicionário: docs/banco/plataforma.md,
-- "Senha do admin do cliente no portal (0103)". Teste: db/testes/senha-admin-portal.db.test.ts. Migração ADITIVA: só 3 funções
-- novas; nenhuma tabela, coluna, política ou grant existente muda.
--
-- O mecanismo de bloqueio é o da conta do admin na empresa, o mesmo do login do BKO/app e da rota pública
-- POST /v1/auth/senha/trocar: core.usuario.tentativas_falhas e bloqueio_ate (0004; RN-CORE-01: 5 falhas seguidas = 15 min;
-- bloqueio vencido recomeça a contagem; bloqueio vivo não conta nem estende). A troca grava como o repositório da rota pública
-- (core/api/repositorio.ts, trocarSenha) e a redefinição do portal (0042): hash novo, sem senha a trocar nem temporária, falhas
-- zeradas, sessao_versao + 1 e core.sessao revogadas; além disso revoga as sessões do portal que nasceram dessa conta (a
-- sa_sessao_valida, 0040/0077, já as derrubaria pela sessao_versao).
--
-- Funções do portal (SECURITY DEFINER, search_path fixo com pg_temp por último; EXECUTE só ao macuxi_portal). Todas exigem
-- sessão viva de admin do cliente COM empresa escolhida (a conta é a da empresa atual da sessão: tenant_atual_id e
-- usuario_atual_id); sessão inválida = 28000; super-admin ou admin sem empresa escolhida = 42501. Nunca hash nem e-mail em
-- mensagem de erro ou auditoria.
--   - sa_reautenticar_admin(p_sid uuid) -> table (tenant_id uuid, usuario_id uuid, email text, senha_hash text, falhas integer,
--     bloqueado_ate timestamptz): a conta para a API conferir a senha atual com o argon2. bloqueado_ate só quando vivo (> now());
--     falhas = 0 se o bloqueio já venceu. Audita 'sa.reautenticar' quando acha a conta (como a sa_reautenticar, 0072).
--   - sa_falha_senha_admin(p_sid uuid) -> table (falhas integer, bloqueado_ate timestamptz): senha atual errada. Bloqueio vivo =
--     nada muda (devolve o estado); senão falhas = (bloqueio vencido ? 0 : falhas) + 1 e, na 5ª, bloqueio_ate = now() + 15 min
--     (falhas fica 5, como o registrarFalhaDeLogin do domínio). Trava a linha (for update): duas falhas ao mesmo tempo contam
--     duas. Audita 'sa.bloqueio' { minutos: 15 } quando bloqueia.
--   - sa_gravar_senha_admin(p_sid uuid, p_hash_atual text, p_hash_novo text) -> boolean: hash atual nulo ou hash novo fora do
--     PHC argon2id = 22023. Grava só se senha_hash = p_hash_atual e a conta não está bloqueada (bloqueio vivo: false, como hash
--     divergente; nada muda; pedidos paralelos que passaram juntos pelo 423 da rota). Zera falhas e bloqueio, tira senha
--     a trocar e temporária, sessao_versao + 1, revoga as core.sessao vivas da conta e as portal_sessao vivas de admin do
--     cliente que têm a conta em portal_sessao_empresa (inclusive a atual). Audita no tenant 'usuario.senha_trocar' (a mesma
--     ação da rota pública, origem 'portal') e na plataforma 'sa.senha.trocada' { sessoes_revogadas, sessoes_app_revogadas }.
--
-- Caminho de volta: 0103_plataforma_senha_admin_portal.down.sql (apaga as 3 funções). Nada de dado se perde: a senha trocada fica
-- em core.usuario.senha_hash e as linhas de auditoria ficam (append-only). Antes do down, volte a API ao 403 TROCA_SO_SUPER_ADMIN
-- (sem as funções a rota responde 503).

-- =============================================================================================
-- 1. Leitura da conta (hash e estado do bloqueio) para a API conferir a senha atual
-- =============================================================================================
create function plataforma.sa_reautenticar_admin(p_sid uuid)
  returns table (tenant_id uuid, usuario_id uuid, email text, senha_hash text, falhas integer, bloqueado_ate timestamptz)
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
#variable_conflict use_column
declare
  v_tipo text;
  v_t uuid;
  v_u uuid;
begin
  select v.tipo, v.tenant_id, v.usuario_id into v_tipo, v_t, v_u from plataforma.sa_sessao_valida(p_sid) v;
  if v_tipo is null then
    raise exception 'sa_reautenticar_admin: sessão do portal inválida' using errcode = '28000';
  end if;
  if v_tipo is distinct from 'admin_cliente' or v_t is null or v_u is null then
    raise exception 'sa_reautenticar_admin: só o admin do cliente com empresa escolhida' using errcode = '42501';
  end if;
  return query
    select u.tenant_id, u.id, u.email, u.senha_hash,
           case when u.bloqueio_ate is not null and u.bloqueio_ate <= now() then 0 else u.tentativas_falhas::integer end,
           case when u.bloqueio_ate > now() then u.bloqueio_ate end
      from core.usuario u
     where u.tenant_id = v_t and u.id = v_u and u.deleted_at is null;
  -- só audita quando achou a conta (return query liga o found)
  if found then
    perform plataforma.sa_registrar_auditoria('admin_cliente', null, v_u, p_sid, v_t, 'sa.reautenticar', '{}'::jsonb);
  end if;
end
$$;
revoke all on function plataforma.sa_reautenticar_admin(uuid) from public, macuxi_app, macuxi_worker;
grant execute on function plataforma.sa_reautenticar_admin(uuid) to macuxi_portal;

-- =============================================================================================
-- 2. Senha atual errada: conta a falha na conta (RN-CORE-01, o mesmo contador do login e da rota pública)
-- =============================================================================================
create function plataforma.sa_falha_senha_admin(p_sid uuid)
  returns table (falhas integer, bloqueado_ate timestamptz)
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
#variable_conflict use_column
declare
  v_tipo text;
  v_t uuid;
  v_u uuid;
  v_falhas integer;
  v_ate timestamptz;
begin
  select v.tipo, v.tenant_id, v.usuario_id into v_tipo, v_t, v_u from plataforma.sa_sessao_valida(p_sid) v;
  if v_tipo is null then
    raise exception 'sa_falha_senha_admin: sessão do portal inválida' using errcode = '28000';
  end if;
  if v_tipo is distinct from 'admin_cliente' or v_t is null or v_u is null then
    raise exception 'sa_falha_senha_admin: só o admin do cliente com empresa escolhida' using errcode = '42501';
  end if;
  select u.tentativas_falhas, u.bloqueio_ate into v_falhas, v_ate
    from core.usuario u
   where u.tenant_id = v_t and u.id = v_u and u.deleted_at is null
     for update of u;
  if not found then
    raise exception 'sa_falha_senha_admin: só o admin do cliente com empresa escolhida' using errcode = '42501';
  end if;
  if v_ate is not null and v_ate > now() then
    -- bloqueio vivo: não conta nem estende
    falhas := v_falhas;
    bloqueado_ate := v_ate;
    return next;
    return;
  end if;
  v_falhas := (case when v_ate is not null then 0 else v_falhas end) + 1;
  v_ate := case when v_falhas >= 5 then now() + interval '15 minutes' end;
  update core.usuario u set tentativas_falhas = v_falhas, bloqueio_ate = v_ate where u.tenant_id = v_t and u.id = v_u;
  if v_ate is not null then
    perform plataforma.sa_registrar_auditoria('admin_cliente', null, v_u, p_sid, v_t, 'sa.bloqueio', '{"minutos": 15}'::jsonb);
  end if;
  falhas := v_falhas;
  bloqueado_ate := v_ate;
  return next;
end
$$;
revoke all on function plataforma.sa_falha_senha_admin(uuid) from public, macuxi_app, macuxi_worker;
grant execute on function plataforma.sa_falha_senha_admin(uuid) to macuxi_portal;

-- =============================================================================================
-- 3. Gravação da senha nova (só se o hash não mudou desde a leitura) e queda das sessões da conta
-- =============================================================================================
create function plataforma.sa_gravar_senha_admin(p_sid uuid, p_hash_atual text, p_hash_novo text)
  returns boolean
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_tipo text;
  v_t uuid;
  v_u uuid;
  v_app integer;
  v_portal integer;
begin
  select v.tipo, v.tenant_id, v.usuario_id into v_tipo, v_t, v_u from plataforma.sa_sessao_valida(p_sid) v;
  if v_tipo is null then
    raise exception 'sa_gravar_senha_admin: sessão do portal inválida' using errcode = '28000';
  end if;
  if v_tipo is distinct from 'admin_cliente' or v_t is null or v_u is null then
    raise exception 'sa_gravar_senha_admin: só o admin do cliente com empresa escolhida' using errcode = '42501';
  end if;
  -- nunca o hash na mensagem: o erro pode ir a log
  if p_hash_atual is null then
    raise exception 'sa_gravar_senha_admin: hash atual obrigatório' using errcode = '22023';
  end if;
  if p_hash_novo is null or p_hash_novo !~ '^\$argon2id\$v=[0-9]+\$m=[0-9]+,t=[0-9]+,p=[0-9]+\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$' then
    raise exception 'sa_gravar_senha_admin: hash novo fora do formato PHC argon2id' using errcode = '22023';
  end if;
  update core.usuario u
     set senha_hash = p_hash_novo, trocar_senha = false, senha_expira_em = null,
         senha_temporaria_hash = null, senha_temporaria_expira_em = null, senha_temporaria_criada_em = null,
         tentativas_falhas = 0, bloqueio_ate = null, sessao_versao = u.sessao_versao + 1
   where u.tenant_id = v_t and u.id = v_u and u.senha_hash = p_hash_atual and u.deleted_at is null
     and (u.bloqueio_ate is null or u.bloqueio_ate <= now());
  if not found then
    return false;
  end if;
  update core.sessao s set revogado_em = now()
   where s.tenant_id = v_t and s.usuario_id = v_u and s.revogado_em is null;
  get diagnostics v_app = row_count;
  update plataforma.portal_sessao x
     set revogada_em = now()
   where x.tipo = 'admin_cliente' and x.revogada_em is null
     and exists (select 1 from plataforma.portal_sessao_empresa e
                  where e.sessao_id = x.id and e.tenant_alvo_id = v_t and e.usuario_id = v_u and e.deleted_at is null);
  get diagnostics v_portal = row_count;
  -- auditoria sem dado pessoal (RN-AUD-01): a do tenant (o admin vê no BKO; a mesma ação da rota pública) e a da plataforma
  insert into plataforma.auditoria (tenant_id, usuario_id, modulo, acao, entidade, entidade_id, antes, depois)
  values (v_t, v_u, 'core', 'usuario.senha_trocar', 'usuario', v_u, null,
          jsonb_build_object('motivo', 'voluntaria', 'sessoes_revogadas', true, 'origem', 'portal'));
  perform plataforma.sa_registrar_auditoria('admin_cliente', null, v_u, p_sid, v_t, 'sa.senha.trocada',
    jsonb_build_object('sessoes_revogadas', v_portal, 'sessoes_app_revogadas', v_app));
  return true;
end
$$;
revoke all on function plataforma.sa_gravar_senha_admin(uuid, text, text) from public, macuxi_app, macuxi_worker;
grant execute on function plataforma.sa_gravar_senha_admin(uuid, text, text) to macuxi_portal;
