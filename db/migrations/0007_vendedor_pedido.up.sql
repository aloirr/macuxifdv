-- 0007_vendedor_pedido (up) — T-0018 (D-2: pull de pedido e pedido_item), desenho T-0016 §4.5 e §7; pedidos
-- R-20261031-110346-modulo-vendedor (vendedor.pedido para a rota de cancelar) e R-20261031-152927-engenheiro-software.
-- Schema do módulo Vendedor, mínimo para o pull da Sprint 1 (o push de pedido entra na Sprint 4).
-- status = lista fechada do contrato do Vendedor (ORDER_STATUSES em modules/vendedor/contracts, RN-VEN-30),
-- conferida em db/testes/estatico.test.ts.
-- FRONTEIRA: nenhuma FK para core.* (cliente_id, vendedor_id, autor_id, produto_id, visita_id, rota_parada_id são
-- validados pela API do Vendedor via contratos/serviços do Core). FKs só dentro do schema (pedido_item -> pedido),
-- compostas por tenant. tenant_id -> plataforma.tenant como em todo schema.
-- Caminho de volta: 0007_vendedor_pedido.down.sql (DROP SCHEMA vendedor CASCADE — apaga os pedidos).

create schema vendedor;
grant usage on schema vendedor to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- pedido — id = UUID gerado no aparelho. vendedor_id = dono do pedido (RN-CORE-21: pedido em nome conta para o
-- vendedor); autor_id = quem digitou (vendedor ou gestor em nome, RN-VEN-35). Pull por usuários visíveis
-- (vendedor_id), janela: criado >= hoje − 90 ou status não final. Volume alto: ~20 pedidos/vendedor/dia.
create table vendedor.pedido (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references plataforma.tenant (id),
  cliente_id             uuid not null,
  vendedor_id            uuid not null,
  autor_id               uuid not null,
  status                 text not null default 'draft',
  condicao_pagamento     text,
  desconto_pct           numeric(5, 2) not null default 0,
  total_tabela_cents     bigint not null default 0,
  total_cents            bigint not null default 0,
  observacao             text,
  visita_id              uuid,
  rota_parada_id         uuid,
  criado_no_aparelho_em  timestamptz,
  recebido_em            timestamptz,
  numero_erp             text,
  motivo_cancelamento    text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  deleted_at             timestamptz,
  external_id            text,
  constraint pedido_tenant_id_uk unique (tenant_id, id),
  constraint pedido_status_valido check (status in ('draft', 'queued', 'received', 'pending_approval', 'approved', 'sent_to_erp', 'integrated', 'invoiced_partial', 'invoiced', 'rejected', 'cancelled')),
  constraint pedido_desconto_faixa check (desconto_pct between 0 and 100),
  constraint pedido_totais_nao_negativos check (total_tabela_cents >= 0 and total_cents >= 0)
);
create index pedido_sync_ix on vendedor.pedido (tenant_id, updated_at, id);
create index pedido_vendedor_sync_ix on vendedor.pedido (tenant_id, vendedor_id, updated_at, id);
create index pedido_cliente_ix on vendedor.pedido (tenant_id, cliente_id, created_at desc);
create index pedido_visita_ix on vendedor.pedido (tenant_id, visita_id) where visita_id is not null;
create unique index pedido_external_uk on vendedor.pedido (tenant_id, external_id) where external_id is not null and deleted_at is null;
create trigger pedido_updated_at before update on vendedor.pedido
  for each row execute function plataforma.definir_updated_at();
alter table vendedor.pedido enable row level security;
alter table vendedor.pedido force row level security;
create policy isolamento_tenant on vendedor.pedido for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert, update, delete on vendedor.pedido to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- pedido_item — itens do pedido; sequencia única por pedido (desenho T-0011 §3). Pull com o escopo do pedido (join).
create table vendedor.pedido_item (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references plataforma.tenant (id),
  pedido_id             uuid not null,
  sequencia             integer not null,
  produto_id            uuid not null,
  quantidade            integer not null,
  preco_tabela_cents    bigint not null,
  preco_unitario_cents  bigint not null,
  desconto_pct          numeric(5, 2) not null default 0,
  total_cents           bigint not null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz,
  external_id           text,
  constraint pedido_item_sequencia_uk unique (tenant_id, pedido_id, sequencia),
  constraint pedido_item_pedido_fk foreign key (tenant_id, pedido_id) references vendedor.pedido (tenant_id, id),
  constraint pedido_item_sequencia_positiva check (sequencia >= 1),
  constraint pedido_item_quantidade_positiva check (quantidade > 0),
  constraint pedido_item_precos_nao_negativos check (preco_tabela_cents >= 0 and preco_unitario_cents >= 0 and total_cents >= 0),
  constraint pedido_item_desconto_faixa check (desconto_pct between 0 and 100)
);
create index pedido_item_sync_ix on vendedor.pedido_item (tenant_id, updated_at, id);
create unique index pedido_item_external_uk on vendedor.pedido_item (tenant_id, external_id) where external_id is not null and deleted_at is null;
create trigger pedido_item_updated_at before update on vendedor.pedido_item
  for each row execute function plataforma.definir_updated_at();
alter table vendedor.pedido_item enable row level security;
alter table vendedor.pedido_item force row level security;
create policy isolamento_tenant on vendedor.pedido_item for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert, update, delete on vendedor.pedido_item to macuxi_app;
