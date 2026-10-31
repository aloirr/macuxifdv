-- 0002_core (up) — T-0002
-- Schema do módulo Core: usuario, equipe (árvore), produto (cadastro base, ADR-0005), cliente, carteira.
-- RLS por tenant_id em toda tabela (RN-CORE-05). FKs entre tabelas do tenant são COMPOSTAS
-- (tenant_id, x_id) -> (tenant_id, id): o banco impede referência a linha de outro tenant.
-- Caminho de volta: 0002_core.down.sql (DROP SCHEMA core CASCADE — apaga os dados).

create schema core;
grant usage on schema core to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- equipe — árvore (equipe_pai_id). O gerente é responsável pelo nó de cima e vê as equipes
-- abaixo; o supervisor é responsável pela equipe (RN-CORE-04).
create table core.equipe (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references plataforma.tenant (id),
  nome            text not null,
  equipe_pai_id   uuid,
  responsavel_id  uuid,
  ativo           boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  external_id     text,
  constraint equipe_tenant_id_uk unique (tenant_id, id),
  constraint equipe_pai_fk foreign key (tenant_id, equipe_pai_id) references core.equipe (tenant_id, id),
  constraint equipe_pai_diferente check (equipe_pai_id is null or equipe_pai_id <> id)
);
create index equipe_sync_ix on core.equipe (tenant_id, updated_at, id);
create index equipe_pai_ix on core.equipe (tenant_id, equipe_pai_id);
create unique index equipe_external_uk on core.equipe (tenant_id, external_id) where external_id is not null and deleted_at is null;
create trigger equipe_updated_at before update on core.equipe
  for each row execute function plataforma.definir_updated_at();
alter table core.equipe enable row level security;
alter table core.equipe force row level security;
create policy isolamento_tenant on core.equipe for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert, update, delete on core.equipe to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- usuario — e-mail único POR TENANT (esclarecimento Q3); login = código da empresa + e-mail + senha.
-- senha_hash só em argon2id (formato PHC). Perfis do doc 03 §2.
create table core.usuario (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references plataforma.tenant (id),
  nome             text not null,
  nome_curto       text,
  email            text not null,
  perfil           text not null,
  equipe_id        uuid,
  senha_hash       text,
  ativo            boolean not null default true,
  bloqueado_em     timestamptz,
  ultimo_login_em  timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  external_id      text,
  constraint usuario_tenant_id_uk unique (tenant_id, id),
  constraint usuario_equipe_fk foreign key (tenant_id, equipe_id) references core.equipe (tenant_id, id),
  constraint usuario_perfil_valido
    check (perfil in ('admin', 'analista', 'assistente', 'supervisor', 'gerente', 'vendedor', 'promotor')),
  constraint usuario_email_formato check (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  constraint usuario_senha_argon2id check (senha_hash is null or senha_hash like '$argon2id$%')
);
create unique index usuario_email_uk on core.usuario (tenant_id, lower(email)) where deleted_at is null;
create index usuario_sync_ix on core.usuario (tenant_id, updated_at, id);
create index usuario_equipe_ix on core.usuario (tenant_id, equipe_id);
create unique index usuario_external_uk on core.usuario (tenant_id, external_id) where external_id is not null and deleted_at is null;
create trigger usuario_updated_at before update on core.usuario
  for each row execute function plataforma.definir_updated_at();
alter table core.usuario enable row level security;
alter table core.usuario force row level security;
create policy isolamento_tenant on core.usuario for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert, update, delete on core.usuario to macuxi_app;

alter table core.equipe
  add constraint equipe_responsavel_fk foreign key (tenant_id, responsavel_id) references core.usuario (tenant_id, id);

alter table plataforma.usuario_modulo
  add constraint usuario_modulo_usuario_fk foreign key (tenant_id, usuario_id) references core.usuario (tenant_id, id);

-- ---------------------------------------------------------------------------------------------
-- produto — cadastro base (ADR-0005). Preço, estoque, conteúdo, mídia e busca ficam no Catálogo.
create table core.produto (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references plataforma.tenant (id),
  sku         text not null,
  ean         text,
  nome        text not null,
  marca       text,
  categoria   text,
  unidade     text not null default 'UN',
  ativo       boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  external_id text,
  constraint produto_tenant_id_uk unique (tenant_id, id),
  constraint produto_ean_formato check (ean is null or ean ~ '^[0-9]{8,14}$')
);
create unique index produto_sku_uk on core.produto (tenant_id, sku) where deleted_at is null;
create index produto_sync_ix on core.produto (tenant_id, updated_at, id);
create index produto_ean_ix on core.produto (tenant_id, ean) where ean is not null;
create unique index produto_external_uk on core.produto (tenant_id, external_id) where external_id is not null and deleted_at is null;
create trigger produto_updated_at before update on core.produto
  for each row execute function plataforma.definir_updated_at();
alter table core.produto enable row level security;
alter table core.produto force row level security;
create policy isolamento_tenant on core.produto for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert, update, delete on core.produto to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- cliente — PDV/cliente B2B. Coordenada opcional (RN-CORE-10: 1º check-in sugere ao BKO).
create table core.cliente (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references plataforma.tenant (id),
  documento      text,
  razao_social   text not null,
  nome_fantasia  text,
  segmento       text,
  telefone       text,
  email          text,
  logradouro     text,
  numero         text,
  bairro         text,
  cidade         text,
  uf             text,
  cep            text,
  latitude       numeric(9, 6),
  longitude      numeric(9, 6),
  ativo          boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  external_id    text,
  constraint cliente_tenant_id_uk unique (tenant_id, id),
  constraint cliente_documento_digitos check (documento is null or documento ~ '^([0-9]{11}|[0-9]{14})$'),
  constraint cliente_uf_formato check (uf is null or uf ~ '^[A-Z]{2}$'),
  constraint cliente_latitude_faixa check (latitude is null or latitude between -90 and 90),
  constraint cliente_longitude_faixa check (longitude is null or longitude between -180 and 180)
);
create unique index cliente_documento_uk on core.cliente (tenant_id, documento) where documento is not null and deleted_at is null;
create index cliente_sync_ix on core.cliente (tenant_id, updated_at, id);
create unique index cliente_external_uk on core.cliente (tenant_id, external_id) where external_id is not null and deleted_at is null;
create trigger cliente_updated_at before update on core.cliente
  for each row execute function plataforma.definir_updated_at();
alter table core.cliente enable row level security;
alter table core.cliente force row level security;
create policy isolamento_tenant on core.cliente for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert, update, delete on core.cliente to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- carteira — vínculo cliente x usuário com papel (vendedor | promotor). Base do escopo RN-CORE-04.
create table core.carteira (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references plataforma.tenant (id),
  cliente_id  uuid not null,
  usuario_id  uuid not null,
  papel       text not null,
  inicio      date,
  fim         date,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  external_id text,
  constraint carteira_cliente_fk foreign key (tenant_id, cliente_id) references core.cliente (tenant_id, id),
  constraint carteira_usuario_fk foreign key (tenant_id, usuario_id) references core.usuario (tenant_id, id),
  constraint carteira_papel_valido check (papel in ('vendedor', 'promotor')),
  constraint carteira_periodo_valido check (fim is null or inicio is null or fim >= inicio)
);
create unique index carteira_uk on core.carteira (tenant_id, cliente_id, usuario_id, papel) where deleted_at is null;
create index carteira_sync_ix on core.carteira (tenant_id, updated_at, id);
create index carteira_usuario_ix on core.carteira (tenant_id, usuario_id) where deleted_at is null;
create index carteira_cliente_ix on core.carteira (tenant_id, cliente_id);
create trigger carteira_updated_at before update on core.carteira
  for each row execute function plataforma.definir_updated_at();
alter table core.carteira enable row level security;
alter table core.carteira force row level security;
create policy isolamento_tenant on core.carteira for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert, update, delete on core.carteira to macuxi_app;
