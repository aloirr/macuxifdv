-- 0001_plataforma (up) — T-0002
-- Schema da plataforma: tenant, licenças de módulo (tenant/perfil/usuário), outbox de eventos,
-- parâmetros e auditoria. RLS por tenant_id em toda tabela (RN-CORE-05), falha fechada.
-- Caminho de volta: 0001_plataforma.down.sql (DROP SCHEMA plataforma CASCADE — apaga os dados).

-- Papel de aplicação: sem SUPERUSER, sem BYPASSRLS, não é dono de nada. O executor de migrações
-- (db/src/papeis.ts) define LOGIN e senha a partir do .env. Papéis são do cluster: o down não os remove.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'macuxi_app') then
    create role macuxi_app nologin nosuperuser nobypassrls nocreatedb nocreaterole noreplication;
  end if;
end
$$;

create schema plataforma;
grant usage on schema plataforma to macuxi_app;

-- Contexto do tenant: a aplicação faz, em cada transação,
--   select set_config('app.tenant_id', '<uuid>', true)   -- equivale a SET LOCAL
-- Sem contexto (ou vazio) => NULL => nenhuma linha passa na política. Valor inválido => erro 22P02.
create function plataforma.tenant_atual() returns uuid
  language sql stable parallel safe
  as $$ select nullif(current_setting('app.tenant_id', true), '')::uuid $$;

-- updated_at é o cursor do sync (pull por (updated_at, id)): toda alteração atualiza.
create function plataforma.definir_updated_at() returns trigger
  language plpgsql
  as $$
begin
  new.updated_at := now();
  return new;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- tenant — EXCEÇÃO à regra 5: não tem tenant_id (o próprio id é o tenant). RLS por id.
create table plataforma.tenant (
  id          uuid primary key default gen_random_uuid(),
  codigo      text not null,
  nome        text not null,
  documento   text,
  fuso        text not null default 'America/Sao_Paulo',
  plano       text not null default 'piloto',
  status      text not null default 'ativo',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  external_id text,
  constraint tenant_codigo_formato check (codigo ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
  constraint tenant_status_valido check (status in ('ativo', 'suspenso', 'encerrado'))
);
create unique index tenant_codigo_uk on plataforma.tenant (lower(codigo));
create trigger tenant_updated_at before update on plataforma.tenant
  for each row execute function plataforma.definir_updated_at();
alter table plataforma.tenant enable row level security;
alter table plataforma.tenant force row level security;
create policy isolamento_tenant on plataforma.tenant for all to macuxi_app
  using (id = plataforma.tenant_atual())
  with check (id = plataforma.tenant_atual());
grant select on plataforma.tenant to macuxi_app;

-- Login (código da empresa + e-mail + senha): resolve o tenant ANTES de haver contexto.
-- SECURITY DEFINER: roda como o dono (migrador, que ignora RLS) e devolve só o necessário.
create function plataforma.tenant_por_codigo(p_codigo text)
  returns table (id uuid, nome text, fuso text, status text)
  language sql stable security definer
  set search_path = pg_catalog, plataforma
  as $$
    select t.id, t.nome, t.fuso, t.status
      from plataforma.tenant t
     where lower(t.codigo) = lower(p_codigo) and t.deleted_at is null
  $$;
revoke all on function plataforma.tenant_por_codigo(text) from public;
grant execute on function plataforma.tenant_por_codigo(text) to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- tenant_modulo — módulos contratados/ativos do tenant (RN-CORE-01/02). Core sempre ativo.
create table plataforma.tenant_modulo (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references plataforma.tenant (id),
  modulo         text not null,
  ativo          boolean not null default true,
  plano          text,
  licencas       integer,
  parametros     jsonb not null default '{}'::jsonb,
  ativado_em     timestamptz,
  desativado_em  timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  external_id    text,
  constraint tenant_modulo_modulo_formato check (modulo ~ '^[a-z][a-z0-9-]*$'),
  constraint tenant_modulo_core_sempre_ativo check (modulo <> 'core' or ativo),
  constraint tenant_modulo_licencas_positivas check (licencas is null or licencas >= 0)
);
create unique index tenant_modulo_uk on plataforma.tenant_modulo (tenant_id, modulo) where deleted_at is null;
create index tenant_modulo_sync_ix on plataforma.tenant_modulo (tenant_id, updated_at, id);
create trigger tenant_modulo_updated_at before update on plataforma.tenant_modulo
  for each row execute function plataforma.definir_updated_at();
alter table plataforma.tenant_modulo enable row level security;
alter table plataforma.tenant_modulo force row level security;
create policy isolamento_tenant on plataforma.tenant_modulo for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert, update, delete on plataforma.tenant_modulo to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- perfil_modulo — quais módulos cada perfil do tenant usa (RN-CORE-01).
create table plataforma.perfil_modulo (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references plataforma.tenant (id),
  perfil      text not null,
  modulo      text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  external_id text,
  constraint perfil_modulo_perfil_valido
    check (perfil in ('admin', 'analista', 'assistente', 'supervisor', 'gerente', 'vendedor', 'promotor')),
  constraint perfil_modulo_modulo_formato check (modulo ~ '^[a-z][a-z0-9-]*$')
);
create unique index perfil_modulo_uk on plataforma.perfil_modulo (tenant_id, perfil, modulo) where deleted_at is null;
create index perfil_modulo_sync_ix on plataforma.perfil_modulo (tenant_id, updated_at, id);
create trigger perfil_modulo_updated_at before update on plataforma.perfil_modulo
  for each row execute function plataforma.definir_updated_at();
alter table plataforma.perfil_modulo enable row level security;
alter table plataforma.perfil_modulo force row level security;
create policy isolamento_tenant on plataforma.perfil_modulo for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert, update, delete on plataforma.perfil_modulo to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- usuario_modulo — exceção por usuário. Sprint 0: só REMOVE módulo (esclarecimento RN-CORE-01).
-- A FK composta (tenant_id, usuario_id) -> core.usuario é criada na 0002_core.
create table plataforma.usuario_modulo (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references plataforma.tenant (id),
  usuario_id  uuid not null,
  modulo      text not null,
  efeito      text not null default 'remover',
  motivo      text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  external_id text,
  constraint usuario_modulo_efeito_valido check (efeito in ('remover')),
  constraint usuario_modulo_modulo_formato check (modulo ~ '^[a-z][a-z0-9-]*$')
);
create unique index usuario_modulo_uk on plataforma.usuario_modulo (tenant_id, usuario_id, modulo) where deleted_at is null;
create index usuario_modulo_sync_ix on plataforma.usuario_modulo (tenant_id, updated_at, id);
create trigger usuario_modulo_updated_at before update on plataforma.usuario_modulo
  for each row execute function plataforma.definir_updated_at();
alter table plataforma.usuario_modulo enable row level security;
alter table plataforma.usuario_modulo force row level security;
create policy isolamento_tenant on plataforma.usuario_modulo for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert, update, delete on plataforma.usuario_modulo to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- evento — outbox de eventos de domínio, gravado na mesma transação do fato (doc 04).
-- Nome no formato <modulo>.<entidade>.<fato>@vN, sem o "v" (ex.: core.usuario.modulos_alterados@1).
create table plataforma.evento (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references plataforma.tenant (id),
  nome         text not null,
  modulo       text not null,
  agregado_id  uuid,
  payload      jsonb not null default '{}'::jsonb,
  ocorrido_em  timestamptz not null default now(),
  publicado_em timestamptz,
  tentativas   integer not null default 0,
  ultimo_erro  text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  external_id  text,
  constraint evento_nome_formato check (nome ~ '^[a-z][a-z0-9-]*\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*@[1-9][0-9]*$'),
  constraint evento_modulo_do_nome check (split_part(nome, '.', 1) = modulo)
);
create index evento_pendente_ix on plataforma.evento (ocorrido_em) where publicado_em is null;
create index evento_tenant_ix on plataforma.evento (tenant_id, ocorrido_em, id);
create trigger evento_updated_at before update on plataforma.evento
  for each row execute function plataforma.definir_updated_at();
alter table plataforma.evento enable row level security;
alter table plataforma.evento force row level security;
create policy isolamento_tenant on plataforma.evento for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert, update, delete on plataforma.evento to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- parametro — parâmetros do tenant por módulo (tabela "Parâmetros do tenant", doc 03).
create table plataforma.parametro (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references plataforma.tenant (id),
  modulo      text not null,
  chave       text not null,
  valor       jsonb not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  external_id text,
  constraint parametro_modulo_formato check (modulo ~ '^[a-z][a-z0-9-]*$'),
  constraint parametro_chave_formato check (chave ~ '^[a-z][a-z0-9_.]*$')
);
create unique index parametro_uk on plataforma.parametro (tenant_id, modulo, chave) where deleted_at is null;
create index parametro_sync_ix on plataforma.parametro (tenant_id, updated_at, id);
create trigger parametro_updated_at before update on plataforma.parametro
  for each row execute function plataforma.definir_updated_at();
alter table plataforma.parametro enable row level security;
alter table plataforma.parametro force row level security;
create policy isolamento_tenant on plataforma.parametro for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert, update, delete on plataforma.parametro to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- auditoria — RN-AUD-01 (quem, quando, antes/depois). Só inserção para a aplicação.
create table plataforma.auditoria (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references plataforma.tenant (id),
  usuario_id   uuid,
  modulo       text not null,
  acao         text not null,
  entidade     text not null,
  entidade_id  uuid,
  antes        jsonb,
  depois       jsonb,
  request_id   text,
  ocorrido_em  timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  external_id  text,
  constraint auditoria_modulo_formato check (modulo ~ '^[a-z][a-z0-9-]*$')
);
create index auditoria_tenant_ix on plataforma.auditoria (tenant_id, ocorrido_em, id);
create index auditoria_entidade_ix on plataforma.auditoria (tenant_id, entidade, entidade_id);
alter table plataforma.auditoria enable row level security;
alter table plataforma.auditoria force row level security;
create policy isolamento_tenant on plataforma.auditoria for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert on plataforma.auditoria to macuxi_app;
