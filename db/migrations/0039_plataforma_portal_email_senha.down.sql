-- 0039_plataforma_portal_email_senha (down) — T-0093 fatia B (ADR 0031)
-- Desfaz a 0039: volta o portal da ADR 0029 (convite, TOTP e desafio). As 20 funções plataforma.sa_* e a interna
-- sa_registrar_auditoria(uuid, uuid, uuid, text, jsonb) voltam com o texto EXATO da 0035 (cópia de
-- 0035_plataforma_super_admin.up.sql §2 a §8 e da sa_provisionar_tenant do §9) e os grants da 0038 (EXECUTE só ao
-- macuxi_portal; nunca PUBLIC, o macuxi_app nem o macuxi_worker). Saem as funções novas (contas por e-mail, bloqueio por
-- chave, sessão por empresa, criar_super_admin).
-- APAGA: plataforma.portal_tentativa, plataforma.portal_sessao e plataforma.portal_sessao_empresa (sessões abertas caem:
-- todos entram de novo), o índice core.usuario_admin_email_ix e as colunas ator_tipo e usuario_id da
-- plataforma.auditoria_plataforma (as LINHAS da auditoria ficam; só perdem essas duas colunas: exporte antes se precisar).
-- Super-admins criados pela criar_super_admin FICAM; sem TOTP, entram pelo 1º acesso da 0035 (desafio cadastrar_totp).
-- Admins de cliente criados pelo passo Empresa ficam (são usuários do tenant).
-- Desfaça junto o Core e a API da T-0093 (eles chamam as funções novas). Idempotente (if exists antes de cada create).
-- Pré-condição: 0040+ desfeitas.

-- 1. Funções da 0039 (e as 20 da 0035, para recriar com o texto original) ---------------------------------------------------
drop function if exists plataforma.criar_super_admin(jsonb);
drop function if exists plataforma.sa_escolher_empresa(uuid, uuid);
drop function if exists plataforma.sa_abrir_sessao_portal(jsonb);
drop function if exists plataforma.sa_contas_para_login(text);
drop function if exists plataforma.sa_tentativa_sucesso(text);
drop function if exists plataforma.sa_tentativa_falha(text);
drop function if exists plataforma.sa_tentativa_estado(text);
drop function if exists plataforma.sa_registrar_auditoria(text, uuid, uuid, uuid, uuid, text, jsonb);
drop function if exists plataforma.sa_provisionar_tenant(uuid, jsonb);
drop function if exists plataforma.sa_tenant_ativo(uuid, uuid);
drop function if exists plataforma.sa_listar_tenants(uuid);
drop function if exists plataforma.sa_auditar(jsonb);
drop function if exists plataforma.sa_revogar(uuid);
drop function if exists plataforma.sa_sessao_valida(uuid);
drop function if exists plataforma.sa_abrir_sessao(text);
drop function if exists plataforma.sa_ver_desafio(text);
drop function if exists plataforma.sa_abrir_desafio(uuid, text);
drop function if exists plataforma.sa_regerar_recuperacao(uuid, text[]);
drop function if exists plataforma.sa_usar_recuperacao(uuid, text);
drop function if exists plataforma.sa_marcar_passo(uuid, bigint);
drop function if exists plataforma.sa_confirmar_totp(uuid, bigint, text[]);
drop function if exists plataforma.sa_gravar_totp_pendente(uuid, text);
drop function if exists plataforma.sa_registrar_sucesso(uuid);
drop function if exists plataforma.sa_registrar_falha(uuid);
drop function if exists plataforma.sa_por_id(uuid);
drop function if exists plataforma.sa_para_login(text);
drop function if exists plataforma.sa_criar_primeiro(text, text, text);
drop function if exists plataforma.sa_existe();
drop function if exists plataforma.sa_registrar_auditoria(uuid, uuid, uuid, text, jsonb);

-- 2. Tabelas, índice e colunas da 0039 --------------------------------------------------------------------------------------
alter table if exists plataforma.portal_sessao drop constraint if exists portal_sessao_empresa_atual_fk;
drop table if exists plataforma.portal_sessao_empresa;
drop table if exists plataforma.portal_sessao;
drop table if exists plataforma.portal_tentativa;
drop index if exists core.usuario_admin_email_ix;
drop index if exists plataforma.auditoria_plataforma_usuario_ix;
alter table plataforma.auditoria_plataforma drop constraint if exists auditoria_plataforma_ator_tipo_valido;
alter table plataforma.auditoria_plataforma drop column if exists usuario_id;
alter table plataforma.auditoria_plataforma drop column if exists ator_tipo;

-- 3. Funções da 0035, texto original (as seções abaixo mantêm a numeração da 0035) ----------------------------------
-- 2. Auditoria interna (só o dono executa; chamada de dentro das SECURITY DEFINER) -----------------------------------------
create function plataforma.sa_registrar_auditoria(p_super_admin uuid, p_sessao uuid, p_tenant uuid, p_acao text, p_detalhes jsonb)
  returns void
  language sql volatile security invoker
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
    insert into plataforma.auditoria_plataforma (super_admin_id, sessao_id, tenant_alvo_id, acao, detalhes)
    values (p_super_admin, p_sessao, p_tenant, p_acao, coalesce(p_detalhes, '{}'::jsonb) || '{"origem": "banco"}'::jsonb)
  $$;
revoke all on function plataforma.sa_registrar_auditoria(uuid, uuid, uuid, text, jsonb) from public;

-- 3. Primeiro acesso e leitura para o login ------------------------------------------------------------------------------
create function plataforma.sa_existe()
  returns boolean
  language sql stable security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
    select exists (select 1 from plataforma.super_admin s)
  $$;

create function plataforma.sa_criar_primeiro(p_email text, p_nome text, p_senha_hash text)
  returns uuid
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_email text := btrim(p_email);
  v_nome text := nullif(btrim(p_nome), '');
  v_id uuid;
begin
  -- mensagens sem dado pessoal (nem e-mail nem hash)
  if v_email is null or char_length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'sa_criar_primeiro: e-mail inválido' using errcode = '22023';
  end if;
  if v_nome is null or char_length(v_nome) > 200 then
    raise exception 'sa_criar_primeiro: nome obrigatório (até 200 caracteres)' using errcode = '22023';
  end if;
  if p_senha_hash is null
     or p_senha_hash !~ '^\$argon2id\$v=[0-9]+\$m=[0-9]+,t=[0-9]+,p=[0-9]+\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$' then
    raise exception 'sa_criar_primeiro: senha_hash deve ser argon2id (formato PHC)' using errcode = '22023';
  end if;
  -- duas chamadas ao mesmo tempo: a segunda espera a primeira terminar e, em READ COMMITTED, vê a linha criada
  perform pg_advisory_xact_lock(hashtext('plataforma.sa_criar_primeiro'));
  if exists (select 1 from plataforma.super_admin s) then
    return null;
  end if;
  insert into plataforma.super_admin (email, nome, senha_hash) values (v_email, v_nome, p_senha_hash) returning id into v_id;
  perform plataforma.sa_registrar_auditoria(v_id, null, null, 'sa.primeiro_acesso', '{}'::jsonb);
  return v_id;
end
$$;

create function plataforma.sa_para_login(p_email text)
  returns table (id uuid, email text, nome text, senha_hash text, ativo boolean, falhas integer, bloqueado_ate timestamptz,
                 totp_confirmado_em timestamptz, totp_segredo_cifrado text, totp_pendente_cifrado text, totp_ultimo_passo bigint,
                 recuperacao_restantes integer)
  language sql stable security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
    select s.id, s.email, s.nome, s.senha_hash, s.ativo, s.falhas, s.bloqueado_ate, s.totp_confirmado_em, s.totp_segredo_cifrado,
           s.totp_pendente_cifrado, s.totp_ultimo_passo, cardinality(s.recuperacao_hashes)
      from plataforma.super_admin s
     where lower(s.email) = lower(btrim(p_email)) and s.deleted_at is null
  $$;

create function plataforma.sa_por_id(p_id uuid)
  returns table (id uuid, email text, nome text, senha_hash text, ativo boolean, falhas integer, bloqueado_ate timestamptz,
                 totp_confirmado_em timestamptz, totp_segredo_cifrado text, totp_pendente_cifrado text, totp_ultimo_passo bigint,
                 recuperacao_restantes integer)
  language sql stable security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
    select s.id, s.email, s.nome, s.senha_hash, s.ativo, s.falhas, s.bloqueado_ate, s.totp_confirmado_em, s.totp_segredo_cifrado,
           s.totp_pendente_cifrado, s.totp_ultimo_passo, cardinality(s.recuperacao_hashes)
      from plataforma.super_admin s
     where s.id = p_id and s.deleted_at is null
  $$;

-- 4. Falhas e bloqueio ---------------------------------------------------------------------------------------------------
create function plataforma.sa_registrar_falha(p_id uuid)
  returns table (falhas integer, bloqueado_ate timestamptz)
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
#variable_conflict use_column
declare
  v_falhas integer;
  v_ate timestamptz;
begin
  -- bloqueado: nada muda (devolve o estado). Bloqueio vencido é limpo na próxima falha. 5ª falha seguida: +15 min e zera.
  update plataforma.super_admin s
     set falhas = case when s.falhas + 1 >= 5 then 0 else s.falhas + 1 end,
         bloqueado_ate = case when s.falhas + 1 >= 5 then now() + interval '15 minutes' end
   where s.id = p_id and s.deleted_at is null and (s.bloqueado_ate is null or s.bloqueado_ate <= now())
  returning s.falhas, s.bloqueado_ate into v_falhas, v_ate;
  if found then
    if v_ate is not null then
      perform plataforma.sa_registrar_auditoria(p_id, null, null, 'sa.bloqueio', '{"minutos": 15}'::jsonb);
    end if;
  else
    select s.falhas, s.bloqueado_ate into v_falhas, v_ate from plataforma.super_admin s where s.id = p_id and s.deleted_at is null;
    if not found then
      return;
    end if;
  end if;
  falhas := v_falhas;
  bloqueado_ate := v_ate;
  return next;
end
$$;

create function plataforma.sa_registrar_sucesso(p_id uuid)
  returns void
  language sql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
    update plataforma.super_admin s
       set falhas = 0, bloqueado_ate = null
     where s.id = p_id and s.deleted_at is null and (s.bloqueado_ate is null or s.bloqueado_ate <= now())
       and (s.falhas <> 0 or s.bloqueado_ate is not null)
  $$;

-- 5. TOTP e códigos de recuperação ---------------------------------------------------------------------------------------
create function plataforma.sa_gravar_totp_pendente(p_id uuid, p_cifrado text)
  returns boolean
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
begin
  if p_cifrado is null or p_cifrado !~ '^v1\.[A-Za-z0-9+/=_-]+\.[A-Za-z0-9+/=_-]+\.[A-Za-z0-9+/=_-]+$' then
    raise exception 'sa_gravar_totp_pendente: segredo cifrado fora do formato v1.<iv>.<tag>.<cifra>' using errcode = '22023';
  end if;
  update plataforma.super_admin s
     set totp_pendente_cifrado = p_cifrado
   where s.id = p_id and s.deleted_at is null and s.ativo and s.totp_confirmado_em is null;
  return found;
end
$$;

create function plataforma.sa_confirmar_totp(p_id uuid, p_passo bigint, p_recuperacao_hashes text[])
  returns boolean
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
begin
  if p_passo is null or p_passo < 0 then
    raise exception 'sa_confirmar_totp: passo inválido' using errcode = '22023';
  end if;
  if p_recuperacao_hashes is null or coalesce(array_ndims(p_recuperacao_hashes), 0) <> 1
     or cardinality(p_recuperacao_hashes) not between 1 and 20
     or exists (select 1 from unnest(p_recuperacao_hashes) h where h is null or h !~ '^[0-9a-f]{64}$')
     or (select count(distinct h) from unnest(p_recuperacao_hashes) h) <> cardinality(p_recuperacao_hashes) then
    raise exception 'sa_confirmar_totp: hashes de recuperação devem ser 1 a 20 SHA-256 hex distintos' using errcode = '22023';
  end if;
  update plataforma.super_admin s
     set totp_segredo_cifrado = s.totp_pendente_cifrado, totp_pendente_cifrado = null, totp_confirmado_em = now(),
         totp_ultimo_passo = p_passo, recuperacao_hashes = p_recuperacao_hashes
   where s.id = p_id and s.deleted_at is null and s.ativo and s.totp_confirmado_em is null and s.totp_pendente_cifrado is not null;
  if not found then
    return false;
  end if;
  perform plataforma.sa_registrar_auditoria(p_id, null, null, 'sa.totp.confirmado',
    jsonb_build_object('recuperacao', cardinality(p_recuperacao_hashes)));
  return true;
end
$$;

create function plataforma.sa_marcar_passo(p_id uuid, p_passo bigint)
  returns boolean
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
begin
  if p_passo is null or p_passo < 0 then
    return false;
  end if;
  update plataforma.super_admin s
     set totp_ultimo_passo = p_passo
   where s.id = p_id and s.deleted_at is null and s.totp_confirmado_em is not null
     and (s.totp_ultimo_passo is null or p_passo > s.totp_ultimo_passo);
  return found;
end
$$;

create function plataforma.sa_usar_recuperacao(p_id uuid, p_hash text)
  returns integer
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_restantes integer;
begin
  if p_hash is null or p_hash !~ '^[0-9a-f]{64}$' then
    return null;
  end if;
  update plataforma.super_admin s
     set recuperacao_hashes = array_remove(s.recuperacao_hashes, p_hash)
   where s.id = p_id and s.deleted_at is null and s.totp_confirmado_em is not null and p_hash = any (s.recuperacao_hashes)
  returning cardinality(s.recuperacao_hashes) into v_restantes;
  if not found then
    return null;
  end if;
  perform plataforma.sa_registrar_auditoria(p_id, null, null, 'sa.recuperacao.usada', jsonb_build_object('restantes', v_restantes));
  return v_restantes;
end
$$;

create function plataforma.sa_regerar_recuperacao(p_id uuid, p_hashes text[])
  returns integer
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
begin
  if p_hashes is null or coalesce(array_ndims(p_hashes), 0) <> 1 or cardinality(p_hashes) not between 1 and 20
     or exists (select 1 from unnest(p_hashes) h where h is null or h !~ '^[0-9a-f]{64}$')
     or (select count(distinct h) from unnest(p_hashes) h) <> cardinality(p_hashes) then
    raise exception 'sa_regerar_recuperacao: hashes de recuperação devem ser 1 a 20 SHA-256 hex distintos' using errcode = '22023';
  end if;
  update plataforma.super_admin s
     set recuperacao_hashes = p_hashes
   where s.id = p_id and s.deleted_at is null and s.ativo and s.totp_confirmado_em is not null;
  if not found then
    return null;
  end if;
  perform plataforma.sa_registrar_auditoria(p_id, null, null, 'sa.recuperacao.regerada', jsonb_build_object('quantidade', cardinality(p_hashes)));
  return cardinality(p_hashes);
end
$$;

-- 6. Desafio da 2ª etapa e sessão ----------------------------------------------------------------------------------------
create function plataforma.sa_abrir_desafio(p_id uuid, p_desafio_hash text)
  returns table (etapa text, expira_em timestamptz)
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
#variable_conflict use_column
declare
  v_confirmado timestamptz;
  v_etapa text;
  v_expira timestamptz := now() + interval '5 minutes';
begin
  if p_desafio_hash is null or p_desafio_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'sa_abrir_desafio: desafio deve ser SHA-256 hex' using errcode = '22023';
  end if;
  select s.totp_confirmado_em into v_confirmado
    from plataforma.super_admin s
   where s.id = p_id and s.deleted_at is null and s.ativo and (s.bloqueado_ate is null or s.bloqueado_ate <= now())
     for update;
  if not found then
    return;
  end if;
  v_etapa := case when v_confirmado is null then 'cadastrar_totp' else 'segundo_fator' end;
  -- um desafio aberto por vez: os anteriores do mesmo super-admin deixam de valer
  update plataforma.super_admin_desafio d set consumido_em = now() where d.super_admin_id = p_id and d.consumido_em is null;
  insert into plataforma.super_admin_desafio (super_admin_id, desafio_hash, etapa, expira_em)
  values (p_id, p_desafio_hash, v_etapa, v_expira);
  etapa := v_etapa;
  expira_em := v_expira;
  return next;
end
$$;

create function plataforma.sa_ver_desafio(p_desafio_hash text)
  returns table (super_admin_id uuid, etapa text, expira_em timestamptz)
  language sql stable security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
    select d.super_admin_id, d.etapa, d.expira_em
      from plataforma.super_admin_desafio d
      join plataforma.super_admin s on s.id = d.super_admin_id
     where d.desafio_hash = p_desafio_hash and d.consumido_em is null and d.expira_em > now() and d.deleted_at is null
       and s.deleted_at is null and s.ativo and (s.bloqueado_ate is null or s.bloqueado_ate <= now())
  $$;

create function plataforma.sa_abrir_sessao(p_desafio_hash text)
  returns table (sessao_id uuid, super_admin_id uuid, expira_em timestamptz)
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
#variable_conflict use_column
declare
  v_sa uuid;
  v_sid uuid;
  v_expira timestamptz := now() + interval '8 hours';
begin
  -- uso único: o desafio é consumido aqui, mesmo que a sessão seja recusada abaixo
  update plataforma.super_admin_desafio d
     set consumido_em = now()
   where d.desafio_hash = p_desafio_hash and d.consumido_em is null and d.expira_em > now() and d.deleted_at is null
  returning d.super_admin_id into v_sa;
  if v_sa is null then
    return;
  end if;
  if not exists (select 1 from plataforma.super_admin s
                  where s.id = v_sa and s.deleted_at is null and s.ativo and s.totp_confirmado_em is not null
                    and (s.bloqueado_ate is null or s.bloqueado_ate <= now())) then
    return;
  end if;
  insert into plataforma.super_admin_sessao (super_admin_id, criada_em, ultimo_uso_em, expira_em)
  values (v_sa, now(), now(), v_expira)
  returning id into v_sid;
  perform plataforma.sa_registrar_auditoria(v_sa, v_sid, null, 'sa.sessao.aberta', '{}'::jsonb);
  sessao_id := v_sid;
  super_admin_id := v_sa;
  expira_em := v_expira;
  return next;
end
$$;

create function plataforma.sa_sessao_valida(p_sid uuid)
  returns table (super_admin_id uuid, expira_em timestamptz)
  language sql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
    update plataforma.super_admin_sessao x
       set ultimo_uso_em = now()
      from plataforma.super_admin s
     where x.id = p_sid and s.id = x.super_admin_id and x.revogada_em is null and x.deleted_at is null and x.expira_em > now()
       and s.deleted_at is null and s.ativo and s.totp_confirmado_em is not null
    returning x.super_admin_id, x.expira_em
  $$;

create function plataforma.sa_revogar(p_sid uuid)
  returns boolean
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_sa uuid;
begin
  update plataforma.super_admin_sessao x set revogada_em = now()
   where x.id = p_sid and x.revogada_em is null
  returning x.super_admin_id into v_sa;
  if v_sa is null then
    return false;
  end if;
  perform plataforma.sa_registrar_auditoria(v_sa, p_sid, null, 'sa.sessao.revogada', '{}'::jsonb);
  return true;
end
$$;

-- 7. Auditoria gravada pela API e pelo Core ------------------------------------------------------------------------------
create function plataforma.sa_auditar(p jsonb)
  returns uuid
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_acao text;
  v_metodo text;
  v_rota text;
  v_status integer;
  v_ip text;
  v_detalhes jsonb;
  v_id uuid;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'sa_auditar: a entrada deve ser um objeto JSON' using errcode = '22023';
  end if;
  v_acao := p ->> 'acao';
  if v_acao is null or v_acao !~ '^[a-z][a-z0-9_.]{0,79}$' then
    raise exception 'sa_auditar: acao inválida (minúsculas, dígitos, ponto e sublinhado; até 80)' using errcode = '22023';
  end if;
  v_metodo := upper(nullif(btrim(p ->> 'metodo'), ''));
  if v_metodo is not null and v_metodo !~ '^[A-Z]{3,10}$' then
    raise exception 'sa_auditar: metodo inválido' using errcode = '22023';
  end if;
  -- rota é o MODELO; se vier com query, a query cai (nunca vai valor de filtro para a auditoria)
  v_rota := left(nullif(split_part(p ->> 'rota', '?', 1), ''), 300);
  v_status := case when jsonb_typeof(p -> 'status') = 'number' and (p ->> 'status') ~ '^[1-5][0-9]{2}$' then (p ->> 'status')::integer end;
  -- só o prefixo (/24 ou /48); outro formato não é gravado
  v_ip := p ->> 'ip_prefixo';
  if v_ip is not null and v_ip !~ '^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.0/24$' and v_ip !~ '^[0-9a-f:]{1,40}::/48$' then
    v_ip := null;
  end if;
  v_detalhes := coalesce(p -> 'detalhes', '{}'::jsonb);
  if jsonb_typeof(v_detalhes) <> 'object' or octet_length(v_detalhes::text) > 4096 then
    raise exception 'sa_auditar: detalhes deve ser um objeto JSON de até 4 KB' using errcode = '22023';
  end if;
  insert into plataforma.auditoria_plataforma
    (super_admin_id, sessao_id, tenant_alvo_id, acao, metodo, rota, status, request_id, ip_prefixo, detalhes)
  values (nullif(p ->> 'super_admin_id', '')::uuid, nullif(p ->> 'sessao_id', '')::uuid, nullif(p ->> 'tenant_id', '')::uuid,
          v_acao, v_metodo, v_rota, v_status, left(nullif(p ->> 'request_id', ''), 100), v_ip, v_detalhes)
  returning id into v_id;
  return v_id;
end
$$;

-- 8. Tenants pelo portal (sessão viva conferida em cada chamada) ---------------------------------------------------------
create function plataforma.sa_listar_tenants(p_sid uuid)
  returns jsonb
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
begin
  if not exists (select 1 from plataforma.sa_sessao_valida(p_sid)) then
    raise exception 'sa_listar_tenants: sessão do super-admin inválida' using errcode = '28000';
  end if;
  -- módulos: só os vivos e ativos, e só os do contrato (MODULOS de packages/platform-sdk/src/nomes.ts; teste estático)
  return jsonb_build_object('itens', coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', t.id, 'codigo', t.codigo, 'razao_social', t.nome, 'cnpj', t.documento, 'fuso', t.fuso, 'status', t.status,
             'criada_em', to_char(t.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
             'modulos', coalesce((
               select jsonb_agg(jsonb_build_object('modulo', tm.modulo, 'licencas', tm.licencas) order by tm.modulo)
                 from plataforma.tenant_modulo tm
                where tm.tenant_id = t.id and tm.deleted_at is null and tm.ativo
                  and tm.modulo = any (array['core', 'catalogo', 'vendedor', 'promotor', 'gestor', 'pesquisa', 'treinamento', 'integracao'])
             ), '[]'::jsonb)
           ) order by t.nome, t.id)
      from plataforma.tenant t
     where t.deleted_at is null
  ), '[]'::jsonb));
end
$$;

create function plataforma.sa_tenant_ativo(p_sid uuid, p_tenant uuid)
  returns boolean
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
begin
  if not exists (select 1 from plataforma.sa_sessao_valida(p_sid)) then
    return false;
  end if;
  return exists (select 1 from plataforma.tenant t where t.id = p_tenant and t.status = 'ativo' and t.deleted_at is null);
end
$$;

create function plataforma.sa_provisionar_tenant(p_sid uuid, p jsonb)
  returns jsonb
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_sa uuid;
  v_r jsonb;
begin
  select v.super_admin_id into v_sa from plataforma.sa_sessao_valida(p_sid) v;
  if v_sa is null then
    raise exception 'sa_provisionar_tenant: sessão do super-admin inválida' using errcode = '28000';
  end if;
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'sa_provisionar_tenant: a entrada deve ser um objeto JSON' using errcode = '22023';
  end if;
  -- o portal nunca cria admin nem mexe em senha (o admin do cliente vem na Equipe, com convite)
  if p ? 'admin' or p ? 'redefinir_senha' then
    raise exception 'sa_provisionar_tenant: o portal não aceita admin nem redefinir_senha' using errcode = '22023';
  end if;
  v_r := plataforma.provisionar_tenant((p - 'ator_id') || jsonb_build_object('sem_admin', true, 'ator_id', v_sa));
  perform plataforma.sa_registrar_auditoria(v_sa, p_sid, (v_r ->> 'tenant_id')::uuid, 'sa.tenant.provisionar',
    jsonb_build_object('resultado', v_r -> 'resultado', 'modulos_adicionados', v_r -> 'modulos_adicionados',
                       'parametros_gravados', v_r -> 'parametros_gravados'));
  return v_r;
end
$$;

-- 4. EXECUTE como na 0038: só o macuxi_portal ----------------------------------------------------------------------------
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

-- =====================================================================================================================
-- T-0095: guarda de ordem do ERP (seção separada; desfaz a seção T-0095 do up). Desfaça junto o Core da T-0095 (os
-- consumidores do ERP e a API de usuários leem e gravam estas colunas). Idempotente.
-- =====================================================================================================================
alter table core.usuario drop column if exists desligado_no_bko_em;
alter table core.produto drop column if exists erp_alterado_em;
alter table core.usuario drop column if exists erp_alterado_em;
alter table core.cliente drop column if exists erp_alterado_em;
