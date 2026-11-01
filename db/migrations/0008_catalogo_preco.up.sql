-- 0008_catalogo_preco (up) — T-0029 (fatia vertical do pedido), desenho docs/desenho/T-0029.md §10; pedido
-- R-20261101-042135-engenheiro-software. ADR 0005 (preço é do Catálogo; cadastro base do produto é do Core) e ADR 0012
-- (o Vendedor lê o preço pela consulta catalogo.precos_cliente@1, nunca pela tabela).
-- Regras: RN-CAT-06 (produto fora da tabela do cliente = sem preço; nunca cai numa tabela padrão), RN-CORE-05 (RLS).
-- Tabelas: tabela_preco, tabela_preco_item (preço por produto e vigência) e cliente_tabela_preco (uma tabela viva por
-- cliente). Toda tabela: campos comuns, RLS forçado com isolamento_tenant, gatilho de updated_at, índice de sync
-- (tenant_id, updated_at, id) e external_id único por tenant.
-- FRONTEIRA: nenhuma FK para o schema core (produto_id e cliente_id são validados pela API do Catálogo e pelos
-- contratos do Core). FKs só dentro do schema, compostas por tenant; tenant_id -> plataforma.tenant como em todo schema.
-- Vigência: [vigencia_inicio, vigencia_fim) em UTC; nulo = desde sempre / sem fim. Sobreposição de vigências do mesmo
-- produto na mesma tabela NÃO é barrada pelo banco (só o início repetido): a consulta usa a de maior início <= data.
-- Caminho de volta: 0008_catalogo_preco.down.sql (DROP SCHEMA catalogo CASCADE — apaga tabelas e preços).

create schema catalogo;
grant usage on schema catalogo to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- tabela_preco — tabelas de preço do tenant (ex.: Varejo, Atacado). Pull escopo tenant. Volume baixo (dezenas).
create table catalogo.tabela_preco (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references plataforma.tenant (id),
  codigo       text not null,
  nome         text not null,
  ativo        boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  external_id  text,
  constraint tabela_preco_tenant_id_uk unique (tenant_id, id),
  constraint tabela_preco_codigo_preenchido check (btrim(codigo) <> ''),
  constraint tabela_preco_nome_preenchido check (btrim(nome) <> '')
);
create unique index tabela_preco_codigo_uk on catalogo.tabela_preco (tenant_id, codigo) where deleted_at is null;
create index tabela_preco_sync_ix on catalogo.tabela_preco (tenant_id, updated_at, id);
create unique index tabela_preco_external_uk on catalogo.tabela_preco (tenant_id, external_id) where external_id is not null and deleted_at is null;
create trigger tabela_preco_updated_at before update on catalogo.tabela_preco
  for each row execute function plataforma.definir_updated_at();
alter table catalogo.tabela_preco enable row level security;
alter table catalogo.tabela_preco force row level security;
create policy isolamento_tenant on catalogo.tabela_preco for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert, update, delete on catalogo.tabela_preco to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- tabela_preco_item — preço do produto na tabela, por vigência [inicio, fim). Pull escopo tenant. Volume médio
-- (produtos x tabelas x vigências: dezenas de milhares). Consulta principal (catalogo.precos_cliente@1): tabela do
-- cliente + produto_id = any(...) + vigência que contém a data -> índice tabela_preco_item_vigencia_uk.
create table catalogo.tabela_preco_item (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references plataforma.tenant (id),
  tabela_preco_id  uuid not null,
  produto_id       uuid not null,
  preco_cents      bigint not null,
  vigencia_inicio  timestamptz,
  vigencia_fim     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  external_id      text,
  constraint tabela_preco_item_tabela_fk foreign key (tenant_id, tabela_preco_id) references catalogo.tabela_preco (tenant_id, id),
  constraint tabela_preco_item_preco_positivo check (preco_cents > 0),
  constraint tabela_preco_item_vigencia_valida check (vigencia_inicio is null or vigencia_fim is null or vigencia_fim > vigencia_inicio)
);
create unique index tabela_preco_item_vigencia_uk on catalogo.tabela_preco_item (tenant_id, tabela_preco_id, produto_id, vigencia_inicio) nulls not distinct where deleted_at is null;
create index tabela_preco_item_sync_ix on catalogo.tabela_preco_item (tenant_id, updated_at, id);
create unique index tabela_preco_item_external_uk on catalogo.tabela_preco_item (tenant_id, external_id) where external_id is not null and deleted_at is null;
create trigger tabela_preco_item_updated_at before update on catalogo.tabela_preco_item
  for each row execute function plataforma.definir_updated_at();
alter table catalogo.tabela_preco_item enable row level security;
alter table catalogo.tabela_preco_item force row level security;
create policy isolamento_tenant on catalogo.tabela_preco_item for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert, update, delete on catalogo.tabela_preco_item to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- cliente_tabela_preco — a tabela de preço do cliente (uma viva por cliente; sem linha = cliente sem tabela, todo
-- produto sem preço, RN-CAT-06). Pull escopo carteira. Volume = nº de clientes.
create table catalogo.cliente_tabela_preco (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references plataforma.tenant (id),
  cliente_id       uuid not null,
  tabela_preco_id  uuid not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  external_id      text,
  constraint cliente_tabela_preco_tabela_fk foreign key (tenant_id, tabela_preco_id) references catalogo.tabela_preco (tenant_id, id)
);
create unique index cliente_tabela_preco_cliente_uk on catalogo.cliente_tabela_preco (tenant_id, cliente_id) where deleted_at is null;
create index cliente_tabela_preco_tabela_ix on catalogo.cliente_tabela_preco (tenant_id, tabela_preco_id);
create index cliente_tabela_preco_sync_ix on catalogo.cliente_tabela_preco (tenant_id, updated_at, id);
create unique index cliente_tabela_preco_external_uk on catalogo.cliente_tabela_preco (tenant_id, external_id) where external_id is not null and deleted_at is null;
create trigger cliente_tabela_preco_updated_at before update on catalogo.cliente_tabela_preco
  for each row execute function plataforma.definir_updated_at();
alter table catalogo.cliente_tabela_preco enable row level security;
alter table catalogo.cliente_tabela_preco force row level security;
create policy isolamento_tenant on catalogo.cliente_tabela_preco for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert, update, delete on catalogo.cliente_tabela_preco to macuxi_app;
