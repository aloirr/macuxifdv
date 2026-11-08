-- 0039_plataforma_portal_email_senha (up) — T-0093 fatia B (ADR 0031, que substitui o convite, o TOTP e o mínimo de 12 da
-- ADR 0029; desenho docs/desenho/T-0093.md §3, §4, §7, §9 e §10; pedido R-20261107-145424-engenheiro-software; RN-CORE-31,
-- RN-CORE-33, RN-CORE-34, RN-AUD-01). Dicionário: docs/banco/plataforma.md ("Portal config.: login por e-mail e senha").
-- Migração ADITIVA no dado (nenhuma linha apagada; super_admin, super_admin_desafio e super_admin_sessao ficam, só de
-- histórico), mas TROCA o contrato das funções do portal: 14 sa_* da 0035 saem e a sa_sessao_valida muda o retorno. Entra no
-- main no MESMO commit do Core (fatia C) e da API (fatia S): o Core e a API velhos chamam funções que somem (o portal daria 500).
--
-- O portal passa a ter dois tipos de acesso (ADR 0031 §2): super_admin (plataforma.super_admin; vê todas as empresas) e
-- admin_cliente (core.usuario perfil 'admin', ativo, sem bloqueio administrativo, com senha, sem deleted_at, de tenant
-- 'ativo' sem deleted_at; só nas empresas em que a senha conferiu). A senha é conferida no Node (argon2id): o banco só devolve
-- os hashes das contas candidatas do e-mail e grava cada consulta na auditoria append-only.
--
-- 1. plataforma.auditoria_plataforma ganha ator_tipo ('super_admin' | 'admin_cliente', nulo nas linhas antigas, no login sem
--    conta e nos fatos do deploy) e usuario_id (core.usuario.id do admin do cliente, SEM FK: a auditoria sobrevive à exclusão
--    do tenant e do usuário). Append-only continua (ADD COLUMN sem default não reescreve nem dispara o gatilho).
-- 2. Tabelas novas (sem tenant_id, exceção à regra 5 como as da 0035; db/src/excecoes.ts TABELAS_SEM_TENANT_ID e
--    TABELAS_SO_POR_FUNCAO). RLS ligado e FORÇADO, só a política manutencao (0031), nenhum grant de tabela (app, worker e
--    portal: 42501):
--      plataforma.portal_tentativa       bloqueio por CHAVE do e-mail (HMAC-SHA256 hex calculado no Node com o segredo da
--                                        plataforma; o e-mail nunca chega aqui). Igual para e-mail que existe e que não existe.
--      plataforma.portal_sessao          sessão do portal: tipo, super_admin_id OU a empresa atual (tenant_atual_id,
--                                        usuario_atual_id), teto de 8 h (CHECK), revogável, conferida a cada requisição.
--      plataforma.portal_sessao_empresa  as empresas conferidas no login (1 a 20 por sessão). A empresa fica em tenant_alvo_id
--                                        e NÃO tenant_id, de propósito (como na auditoria_plataforma): com tenant_id ela viraria
--                                        "tabela de tenant" para a conformidade, o vazamento e a plataforma.excluir_tenant.
--                                        A empresa atual da sessão é sempre uma desta lista (FK composta).
-- 3. Índice core.usuario_admin_email_ix (lower(email)) parcial dos admins vivos: a busca entre empresas por e-mail
--    (sa_contas_para_login) sem varrer core.usuario de todos os tenants.
-- 4. Funções (SECURITY DEFINER, search_path = pg_catalog, plataforma, pg_temp; revoke de PUBLIC, macuxi_app e macuxi_worker;
--    EXECUTE SÓ ao macuxi_portal, regra da 0038). Assinaturas = contrato com o Core e a API (R-20261107-150432-banco-dados):
--      sa_tentativa_estado(p_chave)        -> 1 linha (falhas, bloqueado_ate); bloqueado_ate só com bloqueio vivo
--      sa_tentativa_falha(p_chave)         -> 1 linha; bloqueio vivo não conta nem estende; a 5ª seguida = +15 min e zera
--      sa_tentativa_sucesso(p_chave)       -> apaga o registro da chave (bloqueio vivo: nada muda)
--      sa_contas_para_login(p_email)       -> até 20 linhas (tipo, conta_id, tenant_id, tenant_codigo, tenant_nome,
--                                             senha_hash): super-admin primeiro, depois os admins por nome da empresa;
--                                             grava sa.login.consulta só com a contagem
--      sa_abrir_sessao_portal(p jsonb)     -> (sessao_id, expira_em); reconfere TODAS as contas; 1 empresa = já escolhida
--      sa_escolher_empresa(p_sid, p_tenant)-> (tenant_id, usuario_id, codigo, nome) ou nada
--      sa_sessao_valida(p_sid)             -> (tipo, super_admin_id, tenant_id, usuario_id, expira_em); RETORNO NOVO (drop +
--                                             create); admin do cliente com empresa cai na hora se deixou de valer
--      sa_listar_tenants, sa_tenant_ativo, sa_provisionar_tenant, sa_revogar, sa_auditar: mesmas assinaturas, corpo novo
--    Interna (SECURITY INVOKER, sem EXECUTE para ninguém além do dono): sa_registrar_auditoria com ator_tipo e usuario_id
--    (7 argumentos) no lugar da de 5.
--    Deploy (fora do prefixo sa_, SECURITY INVOKER, sem EXECUTE para app, worker ou portal; chamada pela conexão de
--    administração, como a provisionar_tenant): plataforma.criar_super_admin(p jsonb) — criar | redefinir | desativar.
-- 5. Saem (drop; o down as recria com o texto da 0035 e os grants da 0038): sa_existe, sa_criar_primeiro, sa_para_login,
--    sa_por_id, sa_registrar_falha, sa_registrar_sucesso, sa_gravar_totp_pendente, sa_confirmar_totp, sa_marcar_passo,
--    sa_usar_recuperacao, sa_regerar_recuperacao, sa_abrir_desafio, sa_ver_desafio, sa_abrir_sessao e a
--    sa_registrar_auditoria(uuid, uuid, uuid, text, jsonb). As colunas de TOTP da super_admin ficam (TOTP opcional no backlog).
-- Conferência no fim (aborta com 42501 e nada muda): nenhuma sa_* executável pelo app, pelo worker ou por PUBLIC; exatamente
-- as 12 sa_* públicas executáveis pelo portal; a interna e a criar_super_admin por nenhum dos três.
--
-- Limite registrado (ADR 0031, Consequências): quem tiver a senha do macuxi_portal abre sessão sem senha também de admin do
-- cliente e lê o hash dos admins de um e-mail que já conheça. Toda consulta e toda sessão ficam na auditoria pelo próprio banco.
-- Volume: poucas sessões por dia; portal_tentativa com 1 linha por e-mail que errou a senha (apagada no acerto); sem expurgo.
-- Quem estava logado no portal entra de novo (as sessões da super_admin_sessao não valem mais).
--
-- Caminho de volta: 0039_plataforma_portal_email_senha.down.sql (recria as 14 funções e as 6 de antes com o texto da 0035,
-- EXECUTE ao macuxi_portal como na 0038; APAGA as 3 tabelas novas e as colunas ator_tipo/usuario_id da auditoria_plataforma;
-- super-admins criados pela criar_super_admin ficam e entram pelo fluxo da 0035, que exige o primeiro acesso com TOTP).
-- Desfaça junto o Core e a API desta tarefa.

-- 1. auditoria_plataforma: quem agiu ------------------------------------------------------------------------------------
alter table plataforma.auditoria_plataforma add column ator_tipo text;
alter table plataforma.auditoria_plataforma add column usuario_id uuid;
alter table plataforma.auditoria_plataforma
  add constraint auditoria_plataforma_ator_tipo_valido check (ator_tipo is null or ator_tipo in ('super_admin', 'admin_cliente'));
create index auditoria_plataforma_usuario_ix on plataforma.auditoria_plataforma (usuario_id, ocorrido_em) where usuario_id is not null;

-- 2. Tabelas do portal --------------------------------------------------------------------------------------------------
create table plataforma.portal_tentativa (
  id             uuid primary key default gen_random_uuid(),
  chave          text not null,
  falhas         integer not null default 0,
  bloqueado_ate  timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  external_id    text,
  constraint portal_tentativa_chave_formato check (chave ~ '^[0-9a-f]{64}$'),
  constraint portal_tentativa_falhas_faixa check (falhas between 0 and 4)
);
create unique index portal_tentativa_chave_uk on plataforma.portal_tentativa (chave);
create trigger portal_tentativa_updated_at before update on plataforma.portal_tentativa
  for each row execute function plataforma.definir_updated_at();
alter table plataforma.portal_tentativa enable row level security;
alter table plataforma.portal_tentativa force row level security;
create policy manutencao on plataforma.portal_tentativa for all to macuxi_manutencao using (true) with check (true);
revoke all on plataforma.portal_tentativa from public, macuxi_app, macuxi_worker;

create table plataforma.portal_sessao (
  id                uuid primary key default gen_random_uuid(),
  tipo              text not null,
  super_admin_id    uuid references plataforma.super_admin (id),
  tenant_atual_id   uuid,
  usuario_atual_id  uuid,
  criada_em         timestamptz not null default now(),
  ultimo_uso_em     timestamptz not null default now(),
  expira_em         timestamptz not null,
  revogada_em       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  external_id       text,
  constraint portal_sessao_tipo_valido check (tipo in ('super_admin', 'admin_cliente')),
  constraint portal_sessao_ator check (
    (tipo = 'super_admin' and super_admin_id is not null and tenant_atual_id is null and usuario_atual_id is null)
    or (tipo = 'admin_cliente' and super_admin_id is null and (tenant_atual_id is null) = (usuario_atual_id is null))),
  constraint portal_sessao_teto check (expira_em > criada_em and expira_em <= criada_em + interval '8 hours'),
  constraint portal_sessao_uso check (ultimo_uso_em >= criada_em)
);
create index portal_sessao_super_admin_viva_ix on plataforma.portal_sessao (super_admin_id)
  where revogada_em is null and super_admin_id is not null;
create trigger portal_sessao_updated_at before update on plataforma.portal_sessao
  for each row execute function plataforma.definir_updated_at();
alter table plataforma.portal_sessao enable row level security;
alter table plataforma.portal_sessao force row level security;
create policy manutencao on plataforma.portal_sessao for all to macuxi_manutencao using (true) with check (true);
revoke all on plataforma.portal_sessao from public, macuxi_app, macuxi_worker;

create table plataforma.portal_sessao_empresa (
  id              uuid primary key default gen_random_uuid(),
  sessao_id       uuid not null references plataforma.portal_sessao (id),
  tenant_alvo_id  uuid not null,
  usuario_id      uuid not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  external_id     text,
  constraint portal_sessao_empresa_uk unique (sessao_id, tenant_alvo_id),
  constraint portal_sessao_empresa_usuario_uk unique (sessao_id, tenant_alvo_id, usuario_id)
);
create trigger portal_sessao_empresa_updated_at before update on plataforma.portal_sessao_empresa
  for each row execute function plataforma.definir_updated_at();
alter table plataforma.portal_sessao_empresa enable row level security;
alter table plataforma.portal_sessao_empresa force row level security;
create policy manutencao on plataforma.portal_sessao_empresa for all to macuxi_manutencao using (true) with check (true);
revoke all on plataforma.portal_sessao_empresa from public, macuxi_app, macuxi_worker;

-- a empresa atual é sempre uma das conferidas no login (nulas = ainda não escolheu: a FK não confere)
alter table plataforma.portal_sessao
  add constraint portal_sessao_empresa_atual_fk foreign key (id, tenant_atual_id, usuario_atual_id)
  references plataforma.portal_sessao_empresa (sessao_id, tenant_alvo_id, usuario_id);

-- 3. Busca dos admins por e-mail entre empresas -------------------------------------------------------------------------
create index usuario_admin_email_ix on core.usuario (lower(email)) where deleted_at is null and perfil = 'admin';

-- 4. Saem as funções do convite, do TOTP e do desafio (0035 §3 a §6) -----------------------------------------------------
drop function if exists plataforma.sa_existe();
drop function if exists plataforma.sa_criar_primeiro(text, text, text);
drop function if exists plataforma.sa_para_login(text);
drop function if exists plataforma.sa_por_id(uuid);
drop function if exists plataforma.sa_registrar_falha(uuid);
drop function if exists plataforma.sa_registrar_sucesso(uuid);
drop function if exists plataforma.sa_gravar_totp_pendente(uuid, text);
drop function if exists plataforma.sa_confirmar_totp(uuid, bigint, text[]);
drop function if exists plataforma.sa_marcar_passo(uuid, bigint);
drop function if exists plataforma.sa_usar_recuperacao(uuid, text);
drop function if exists plataforma.sa_regerar_recuperacao(uuid, text[]);
drop function if exists plataforma.sa_abrir_desafio(uuid, text);
drop function if exists plataforma.sa_ver_desafio(text);
drop function if exists plataforma.sa_abrir_sessao(text);
drop function if exists plataforma.sa_registrar_auditoria(uuid, uuid, uuid, text, jsonb);
drop function if exists plataforma.sa_sessao_valida(uuid);

-- 5. Auditoria interna (só o dono executa; chamada de dentro das SECURITY DEFINER) -----------------------------------------
create function plataforma.sa_registrar_auditoria(p_ator_tipo text, p_super_admin uuid, p_usuario uuid, p_sessao uuid, p_tenant uuid,
                                                  p_acao text, p_detalhes jsonb)
  returns void
  language sql volatile security invoker
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
    insert into plataforma.auditoria_plataforma (ator_tipo, super_admin_id, usuario_id, sessao_id, tenant_alvo_id, acao, detalhes)
    values (p_ator_tipo, p_super_admin, p_usuario, p_sessao, p_tenant, p_acao,
            coalesce(p_detalhes, '{}'::jsonb) || '{"origem": "banco"}'::jsonb)
  $$;
revoke all on function plataforma.sa_registrar_auditoria(text, uuid, uuid, uuid, uuid, text, jsonb) from public;

-- 6. Bloqueio por chave do e-mail -----------------------------------------------------------------------------------------
create function plataforma.sa_tentativa_estado(p_chave text)
  returns table (falhas integer, bloqueado_ate timestamptz)
  language plpgsql stable security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
#variable_conflict use_column
begin
  if p_chave is null or p_chave !~ '^[0-9a-f]{64}$' then
    raise exception 'sa_tentativa_estado: a chave deve ser SHA-256 hex' using errcode = '22023';
  end if;
  return query
    select coalesce(x.falhas, 0), case when x.bloqueado_ate > now() then x.bloqueado_ate end
      from (select 1) as um
      left join plataforma.portal_tentativa x on x.chave = p_chave;
end
$$;

create function plataforma.sa_tentativa_falha(p_chave text)
  returns table (falhas integer, bloqueado_ate timestamptz)
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
#variable_conflict use_column
declare
  v_falhas integer;
  v_ate timestamptz;
begin
  if p_chave is null or p_chave !~ '^[0-9a-f]{64}$' then
    raise exception 'sa_tentativa_falha: a chave deve ser SHA-256 hex' using errcode = '22023';
  end if;
  -- bloqueio vivo: nada muda (devolve o estado). Bloqueio vencido: a contagem recomeça (zerada no bloqueio). 5ª seguida:
  -- +15 min e zera. Corrida: o ON CONFLICT trava a linha, duas falhas ao mesmo tempo contam duas.
  insert into plataforma.portal_tentativa as x (chave, falhas, bloqueado_ate)
  values (p_chave, 1, null)
  on conflict (chave) do update
     set falhas = case when x.falhas + 1 >= 5 then 0 else x.falhas + 1 end,
         bloqueado_ate = case when x.falhas + 1 >= 5 then now() + interval '15 minutes' end
   where x.bloqueado_ate is null or x.bloqueado_ate <= now()
  returning x.falhas, x.bloqueado_ate into v_falhas, v_ate;
  if found then
    if v_ate is not null then
      perform plataforma.sa_registrar_auditoria(null, null, null, null, null, 'sa.bloqueio', '{"minutos": 15}'::jsonb);
    end if;
  else
    select x.falhas, x.bloqueado_ate into v_falhas, v_ate from plataforma.portal_tentativa x where x.chave = p_chave;
  end if;
  falhas := v_falhas;
  bloqueado_ate := v_ate;
  return next;
end
$$;

create function plataforma.sa_tentativa_sucesso(p_chave text)
  returns void
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
begin
  if p_chave is null or p_chave !~ '^[0-9a-f]{64}$' then
    raise exception 'sa_tentativa_sucesso: a chave deve ser SHA-256 hex' using errcode = '22023';
  end if;
  delete from plataforma.portal_tentativa x
   where x.chave = p_chave and (x.bloqueado_ate is null or x.bloqueado_ate <= now());
end
$$;

-- 7. Contas do e-mail (o hash para o Node conferir) -----------------------------------------------------------------------
create function plataforma.sa_contas_para_login(p_email text)
  returns table (tipo text, conta_id uuid, tenant_id uuid, tenant_codigo text, tenant_nome text, senha_hash text)
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
      select c.tipo, c.conta_id, c.tenant_id, c.tenant_codigo, c.tenant_nome, c.senha_hash
        from (
          select 'super_admin'::text as tipo, s.id as conta_id, null::uuid as tenant_id, null::text as tenant_codigo,
                 null::text as tenant_nome, s.senha_hash, 0 as ordem, ''::text as nome_ordem, s.id as id_ordem
            from plataforma.super_admin s
           where lower(s.email) = v_email and s.deleted_at is null and s.ativo
          union all
          select 'admin_cliente'::text, u.id, t.id, t.codigo, t.nome, u.senha_hash, 1, t.nome, t.id
            from core.usuario u
            join plataforma.tenant t on t.id = u.tenant_id
           where lower(u.email) = v_email and u.perfil = 'admin' and u.deleted_at is null and u.ativo and u.bloqueado_em is null
             and u.senha_hash is not null and t.status = 'ativo' and t.deleted_at is null
        ) as c
       order by c.ordem, c.nome_ordem, c.id_ordem
       limit 20;
    get diagnostics v_n = row_count;
  end if;
  perform plataforma.sa_registrar_auditoria(null, null, null, null, null, 'sa.login.consulta', jsonb_build_object('contas', v_n));
end
$$;

-- 8. Sessão do portal ---------------------------------------------------------------------------------------------------
create function plataforma.sa_abrir_sessao_portal(p jsonb)
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
      v_t := (v_e ->> 'tenant_id')::uuid;
      v_u := (v_e ->> 'usuario_id')::uuid;
      if v_t = any (v_vistos) then
        raise exception 'sa_abrir_sessao_portal: empresa repetida' using errcode = '22023';
      end if;
      v_vistos := v_vistos || v_t;
      -- reconfere no banco (entre a busca e a sessão o admin pode ter sido desativado): uma que não vale = sem sessão
      if not exists (select 1 from core.usuario u join plataforma.tenant t on t.id = u.tenant_id
                      where u.tenant_id = v_t and u.id = v_u and u.perfil = 'admin' and u.ativo and u.bloqueado_em is null
                        and u.senha_hash is not null and u.deleted_at is null and t.status = 'ativo' and t.deleted_at is null) then
        return;
      end if;
    end loop;
    insert into plataforma.portal_sessao (tipo, criada_em, ultimo_uso_em, expira_em)
    values ('admin_cliente', now(), now(), v_expira)
    returning id into v_sid;
    insert into plataforma.portal_sessao_empresa (sessao_id, tenant_alvo_id, usuario_id)
    select v_sid, (x.value ->> 'tenant_id')::uuid, (x.value ->> 'usuario_id')::uuid
      from jsonb_array_elements(p -> 'empresas') x;
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

create function plataforma.sa_escolher_empresa(p_sid uuid, p_tenant uuid)
  returns table (tenant_id uuid, usuario_id uuid, codigo text, nome text)
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
#variable_conflict use_column
declare
  v_u uuid;
  v_codigo text;
  v_nome text;
begin
  select e.usuario_id into v_u
    from plataforma.portal_sessao x
    join plataforma.portal_sessao_empresa e on e.sessao_id = x.id
   where x.id = p_sid and x.tipo = 'admin_cliente' and x.revogada_em is null and x.deleted_at is null and x.expira_em > now()
     and e.tenant_alvo_id = p_tenant and e.deleted_at is null
     for update of x;
  if v_u is null then
    return;
  end if;
  select t.codigo, t.nome into v_codigo, v_nome
    from core.usuario u
    join plataforma.tenant t on t.id = u.tenant_id
   where u.tenant_id = p_tenant and u.id = v_u and u.perfil = 'admin' and u.ativo and u.bloqueado_em is null
     and u.senha_hash is not null and u.deleted_at is null and t.status = 'ativo' and t.deleted_at is null;
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

create function plataforma.sa_sessao_valida(p_sid uuid)
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
                            and t.status = 'ativo' and t.deleted_at is null))
       )
    returning x.tipo, x.super_admin_id, x.tenant_atual_id, x.usuario_atual_id, x.expira_em
  $$;

create or replace function plataforma.sa_revogar(p_sid uuid)
  returns boolean
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_tipo text;
  v_sa uuid;
  v_u uuid;
  v_t uuid;
begin
  update plataforma.portal_sessao x set revogada_em = now()
   where x.id = p_sid and x.revogada_em is null
  returning x.tipo, x.super_admin_id, x.usuario_atual_id, x.tenant_atual_id into v_tipo, v_sa, v_u, v_t;
  if v_tipo is null then
    return false;
  end if;
  perform plataforma.sa_registrar_auditoria(v_tipo, v_sa, v_u, p_sid, v_t, 'sa.sessao.revogada', '{}'::jsonb);
  return true;
end
$$;

-- 9. Auditoria gravada pela API e pelo Core (aceita ator_tipo e usuario_id) -------------------------------------------------
create or replace function plataforma.sa_auditar(p jsonb)
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
  v_ator text;
  v_id uuid;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'sa_auditar: a entrada deve ser um objeto JSON' using errcode = '22023';
  end if;
  v_acao := p ->> 'acao';
  if v_acao is null or v_acao !~ '^[a-z][a-z0-9_.]{0,79}$' then
    raise exception 'sa_auditar: acao inválida (minúsculas, dígitos, ponto e sublinhado; até 80)' using errcode = '22023';
  end if;
  v_ator := nullif(p ->> 'ator_tipo', '');
  if v_ator is not null and v_ator not in ('super_admin', 'admin_cliente') then
    raise exception 'sa_auditar: ator_tipo deve ser super_admin ou admin_cliente' using errcode = '22023';
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
    (ator_tipo, super_admin_id, usuario_id, sessao_id, tenant_alvo_id, acao, metodo, rota, status, request_id, ip_prefixo, detalhes)
  values (v_ator, nullif(p ->> 'super_admin_id', '')::uuid, nullif(p ->> 'usuario_id', '')::uuid, nullif(p ->> 'sessao_id', '')::uuid,
          nullif(p ->> 'tenant_id', '')::uuid, v_acao, v_metodo, v_rota, v_status, left(nullif(p ->> 'request_id', ''), 100), v_ip,
          v_detalhes)
  returning id into v_id;
  return v_id;
end
$$;

-- 10. Empresas pelo portal (sessão viva conferida em cada chamada) --------------------------------------------------------
create or replace function plataforma.sa_listar_tenants(p_sid uuid)
  returns jsonb
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_tipo text;
begin
  select v.tipo into v_tipo from plataforma.sa_sessao_valida(p_sid) v;
  if v_tipo is null then
    raise exception 'sa_listar_tenants: sessão do portal inválida' using errcode = '28000';
  end if;
  -- super-admin: todas as vivas; admin do cliente: só as conferidas no login. Módulos: só os vivos e ativos, e só os do
  -- contrato (MODULOS de packages/platform-sdk/src/nomes.ts; teste estático)
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
       and (v_tipo = 'super_admin'
            or exists (select 1 from plataforma.portal_sessao_empresa e
                        where e.sessao_id = p_sid and e.tenant_alvo_id = t.id and e.deleted_at is null))
  ), '[]'::jsonb));
end
$$;

create or replace function plataforma.sa_tenant_ativo(p_sid uuid, p_tenant uuid)
  returns boolean
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_tipo text;
  v_tenant uuid;
begin
  select v.tipo, v.tenant_id into v_tipo, v_tenant from plataforma.sa_sessao_valida(p_sid) v;
  if v_tipo is null then
    return false;
  end if;
  if v_tipo = 'super_admin' then
    return exists (select 1 from plataforma.tenant t where t.id = p_tenant and t.status = 'ativo' and t.deleted_at is null);
  end if;
  -- admin do cliente: só a empresa atual (a sa_sessao_valida já conferiu que ela e o admin continuam ativos)
  return v_tenant is not null and v_tenant = p_tenant;
end
$$;

create or replace function plataforma.sa_provisionar_tenant(p_sid uuid, p jsonb)
  returns jsonb
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_tipo text;
  v_sa uuid;
  v_entrada jsonb;
  v_r jsonb;
begin
  select v.tipo, v.super_admin_id into v_tipo, v_sa from plataforma.sa_sessao_valida(p_sid) v;
  if v_tipo is distinct from 'super_admin' or v_sa is null then
    raise exception 'sa_provisionar_tenant: só com sessão de super-admin' using errcode = '28000';
  end if;
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'sa_provisionar_tenant: a entrada deve ser um objeto JSON' using errcode = '22023';
  end if;
  -- o portal nunca troca senha de usuário existente (RN-CORE-31) e não escolhe sem_admin: ele vem do admin informado
  if p ? 'redefinir_senha' or p ? 'sem_admin' then
    raise exception 'sa_provisionar_tenant: o portal não aceita redefinir_senha nem sem_admin' using errcode = '22023';
  end if;
  -- admin inicial (RN-CORE-34): { email, nome, senha_hash argon2id }, validado pela provisionar_tenant. Empresa NOVA sem admin
  -- = 22023 com hint RN-CORE-34 (a API traduz em 422); empresa existente sem admin = sem_admin (só módulos e parâmetros). Código
  -- fora do formato segue para a provisionar_tenant, que dá o 22023 dela.
  if coalesce(jsonb_typeof(p -> 'admin'), 'null') = 'null' then
    if jsonb_typeof(p -> 'codigo') = 'string' and (p ->> 'codigo') ~ '^[a-z0-9][a-z0-9-]{1,39}$'
       and not exists (select 1 from plataforma.tenant t where lower(t.codigo) = lower(p ->> 'codigo') and t.deleted_at is null) then
      raise exception 'sa_provisionar_tenant: empresa nova exige o admin inicial' using errcode = '22023', hint = 'RN-CORE-34';
    end if;
    v_entrada := (p - 'ator_id' - 'admin') || jsonb_build_object('sem_admin', true, 'ator_id', v_sa);
  else
    v_entrada := (p - 'ator_id') || jsonb_build_object('ator_id', v_sa);
  end if;
  v_r := plataforma.provisionar_tenant(v_entrada);
  perform plataforma.sa_registrar_auditoria('super_admin', v_sa, null, p_sid, (v_r ->> 'tenant_id')::uuid, 'sa.tenant.provisionar',
    jsonb_build_object('resultado', v_r -> 'resultado', 'modulos_adicionados', v_r -> 'modulos_adicionados',
                       'parametros_gravados', v_r -> 'parametros_gravados', 'admin', v_r -> 'admin'));
  return v_r;
end
$$;

-- 11. Super-admin pelo deploy (conexão de administração; ADR 0031 §5) ------------------------------------------------------
create function plataforma.criar_super_admin(p jsonb)
  returns jsonb
  language plpgsql volatile security invoker
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  c_argon2id constant text := '^\$argon2id\$v=[0-9]+\$m=[0-9]+,t=[0-9]+,p=[0-9]+\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$';
  v_acao text;
  v_email text;
  v_nome text;
  v_hash text;
  v_id uuid;
  v_ativo boolean;
  v_res text;
  v_n integer := 0;
begin
  -- a entrada leva o hash da senha: nada de log de comando nesta transação (só superusuário muda esses parâmetros)
  if current_setting('is_superuser') = 'on' then
    perform set_config('log_min_duration_statement', '-1', true), set_config('log_statement', 'none', true);
  end if;
  -- mensagens sem dado pessoal (nem e-mail nem hash)
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'criar_super_admin: a entrada deve ser um objeto JSON' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_object_keys(p) k where k not in ('acao', 'email', 'nome', 'senha_hash')) then
    raise exception 'criar_super_admin: chave desconhecida (aceita acao, email, nome, senha_hash)' using errcode = '22023';
  end if;
  v_acao := p ->> 'acao';
  if v_acao is null or v_acao not in ('criar', 'redefinir', 'desativar') then
    raise exception 'criar_super_admin: acao deve ser criar, redefinir ou desativar' using errcode = '22023';
  end if;
  v_email := btrim(p ->> 'email');
  if v_email is null or char_length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'criar_super_admin: e-mail inválido' using errcode = '22023';
  end if;
  if v_acao = 'desativar' then
    if p ? 'senha_hash' or p ? 'nome' then
      raise exception 'criar_super_admin: desativar não aceita senha_hash nem nome' using errcode = '22023';
    end if;
  else
    v_hash := p ->> 'senha_hash';
    if v_hash is null or v_hash !~ c_argon2id then
      raise exception 'criar_super_admin: senha_hash deve ser argon2id (formato PHC)' using errcode = '22023';
    end if;
  end if;
  if v_acao = 'criar' then
    v_nome := nullif(btrim(p ->> 'nome'), '');
    if v_nome is null or char_length(v_nome) > 200 then
      raise exception 'criar_super_admin: nome obrigatório (até 200 caracteres)' using errcode = '22023';
    end if;
  elsif v_acao = 'redefinir' and p ? 'nome' then
    raise exception 'criar_super_admin: redefinir não aceita nome' using errcode = '22023';
  end if;

  -- uma mudança de super-admin por vez (a regra do último ativo e o criar idempotente dependem disso)
  perform pg_advisory_xact_lock(hashtext('plataforma.criar_super_admin'));
  select s.id, s.ativo into v_id, v_ativo
    from plataforma.super_admin s
   where lower(s.email) = lower(v_email) and s.deleted_at is null
     for update;

  if v_acao = 'criar' then
    if v_id is not null then
      v_res := 'sem_mudanca';
    else
      insert into plataforma.super_admin (email, nome, senha_hash) values (v_email, v_nome, v_hash) returning id into v_id;
      v_res := 'criado';
    end if;
  elsif v_id is null then
    v_res := 'nao_encontrado';
  elsif v_acao = 'redefinir' then
    update plataforma.super_admin s set senha_hash = v_hash, falhas = 0, bloqueado_ate = null where s.id = v_id;
    v_res := 'redefinido';
  elsif not v_ativo then
    v_res := 'sem_mudanca';
  else
    if not exists (select 1 from plataforma.super_admin s where s.ativo and s.deleted_at is null and s.id <> v_id) then
      raise exception 'criar_super_admin: não dá para desativar o último super-admin ativo' using errcode = '22023';
    end if;
    update plataforma.super_admin s set ativo = false where s.id = v_id;
    v_res := 'desativado';
  end if;

  if v_res in ('redefinido', 'desativado') then
    update plataforma.portal_sessao x set revogada_em = now()
     where x.super_admin_id = v_id and x.revogada_em is null and x.expira_em > now();
    get diagnostics v_n = row_count;
    -- histórico da 0035: nenhuma função lê mais, mas não fica sessão "viva" de quem trocou a senha
    update plataforma.super_admin_sessao x set revogada_em = now() where x.super_admin_id = v_id and x.revogada_em is null;
  end if;
  if v_res in ('criado', 'redefinido', 'desativado') then
    perform plataforma.sa_registrar_auditoria(null, v_id, null, null, null, 'sa.super_admin.' || v_acao,
      jsonb_build_object('resultado', v_res, 'sessoes_revogadas', v_n));
  end if;
  return jsonb_build_object('resultado', v_res, 'super_admin_id', v_id, 'sessoes_revogadas', v_n);
end
$$;
revoke all on function plataforma.criar_super_admin(jsonb) from public;

-- 12. EXECUTE: só o macuxi_portal (regra da 0038); nunca PUBLIC, o macuxi_app nem o macuxi_worker --------------------------
revoke all on function plataforma.sa_tentativa_estado(text) from public, macuxi_app, macuxi_worker;
grant execute on function plataforma.sa_tentativa_estado(text) to macuxi_portal;
revoke all on function plataforma.sa_tentativa_falha(text) from public, macuxi_app, macuxi_worker;
grant execute on function plataforma.sa_tentativa_falha(text) to macuxi_portal;
revoke all on function plataforma.sa_tentativa_sucesso(text) from public, macuxi_app, macuxi_worker;
grant execute on function plataforma.sa_tentativa_sucesso(text) to macuxi_portal;
revoke all on function plataforma.sa_contas_para_login(text) from public, macuxi_app, macuxi_worker;
grant execute on function plataforma.sa_contas_para_login(text) to macuxi_portal;
revoke all on function plataforma.sa_abrir_sessao_portal(jsonb) from public, macuxi_app, macuxi_worker;
grant execute on function plataforma.sa_abrir_sessao_portal(jsonb) to macuxi_portal;
revoke all on function plataforma.sa_escolher_empresa(uuid, uuid) from public, macuxi_app, macuxi_worker;
grant execute on function plataforma.sa_escolher_empresa(uuid, uuid) to macuxi_portal;
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

-- Conferência pelo catálogo: nenhuma plataforma.sa_* nem a criar_super_admin executável pelo macuxi_app, pelo macuxi_worker
-- ou por PUBLIC; exatamente as 12 sa_* públicas executáveis pelo macuxi_portal; a interna e a criar_super_admin, por ninguém.
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
    raise exception '0039: função executável pelo macuxi_app, macuxi_worker ou PUBLIC: %', v_f using errcode = '42501';
  end if;
  select string_agg(p.oid::regprocedure::text, ', ' order by 1) into v_f
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'plataforma' and p.proname in ('sa_registrar_auditoria', 'criar_super_admin')
     and has_function_privilege('macuxi_portal', p.oid, 'execute');
  if v_f is not null then
    raise exception '0039: função interna ou de deploy executável pelo macuxi_portal: %', v_f using errcode = '42501';
  end if;
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'plataforma' and p.proname like 'sa\_%' and has_function_privilege('macuxi_portal', p.oid, 'execute');
  if v_n <> 12 then
    raise exception '0039: esperadas 12 funções sa_* executáveis pelo macuxi_portal, há %', v_n using errcode = '42501';
  end if;
end
$$;

-- =====================================================================================================================
-- T-0095: guarda de ordem do ERP (seção SEPARADA da T-0093, que viaja na 0039 porque ela ainda não está no main e o
-- executor só aceita NNNN_nome; pedido R-20261107-175135-modulo-core; RN-INT-02/04; dicionário: docs/banco/core.md).
-- Aditiva e idempotente (add column if not exists), sem backfill (linhas antigas ficam nulas, sem mexer em updated_at),
-- sem índice novo (o consumidor lê e grava a coluna na MESMA linha que já acha por (tenant_id, external_id)), sem mudar RLS
-- nem grants (as colunas herdam os da tabela). Fora do pull do aparelho (o sync lista as colunas; estas não entram).
--   core.cliente.erp_alterado_em, core.usuario.erp_alterado_em, core.produto.erp_alterado_em  timestamptz(3) null
--     último `alterado_em` do ERP já aplicado à linha; nulo = nunca veio do ERP. Reentrega mais antiga é ignorada.
--   core.usuario.desligado_no_bko_em  timestamptz(3) null
--     a API do BKO grava ao desativar e limpa ao reativar; preenchida, a carga do ERP não reativa (o monitor avisa).
-- Caminho de volta: o down drop column if exists das 4 (perde só a marca de ordem e de desligamento; a próxima carga do
-- ERP aplica tudo de novo e um vendedor desligado no BKO pode voltar ativo: desfaça junto o Core da T-0095).
-- =====================================================================================================================
alter table core.cliente add column if not exists erp_alterado_em timestamptz(3);
alter table core.usuario add column if not exists erp_alterado_em timestamptz(3);
alter table core.produto add column if not exists erp_alterado_em timestamptz(3);
alter table core.usuario add column if not exists desligado_no_bko_em timestamptz(3);
