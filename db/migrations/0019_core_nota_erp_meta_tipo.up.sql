-- 0019_core_nota_erp_meta_tipo (up) — T-0066 (core.nota_erp, pedido R-20261102-132945-modulo-core) e T-0065 (core.meta.tipo,
-- pedido R-20261103-005803-modulo-core; decisão do gerente: entra nesta mesma 0019). Dicionário: docs/banco/core.md.
-- Migração ADITIVA: nenhuma coluna existente muda, nenhum dado existente é reescrito.
--
-- Mudanças:
--   core.nota_erp (nova): uma linha por nota do ERP (faturamento ou devolução) recebida em integracao.nota.atualizado@1.
--     Serve ao consumidor do Core para recalcular core.historico_compra (cliente x ano_mes) de forma idempotente: a
--     reentrega e a nota alterada/cancelada regravam a MESMA linha (único vivo nota_erp_external_uk (tenant_id,
--     external_id)) e o resumo do mês é a soma das notas vivas e não canceladas. external_id (chave da nota no ERP) é
--     OBRIGATÓRIO aqui (nota_erp_external_id_preenchido). cliente_id com FK composta (tenant_id, cliente_id) ->
--     core.cliente (tenant_id, id). pedido_uuid: retrato do pedido do Vendedor SEM FK (fronteira entre schemas de módulo,
--     ADR 0005/0012). ano_mes AAAA-MM calculado pelo consumidor no fuso do tenant a partir de emitida_em (o banco só
--     confere o formato). Fora do pull do app (só o resumo historico_compra vai ao aparelho): sem índice de sync,
--     listada em TABELAS_FORA_DO_SYNC (db/src/excecoes.ts). Sem DELETE para o macuxi_app (soft delete por deleted_at).
--     Volume: ~30 notas/ano por cliente.
--   core.meta.tipo (nova): 'pedido' | 'faturamento' (RN-CORE-21: o realizado depende do tipo da meta). NOT NULL com padrão
--     'pedido': as metas que já existem ficam 'pedido' (o comportamento de hoje); default constante = sem reescrita da
--     tabela. CHECK meta_tipo_valido. O único meta_uk (tenant_id, usuario_id, periodo, indicador) NÃO muda: uma meta por
--     usuário, período e indicador; o tipo é atributo dela.
-- Caminho de volta: 0019_core_nota_erp_meta_tipo.down.sql (APAGA core.nota_erp com os dados — o consumidor reconstrói a
-- partir da reentrega do ERP — e a coluna core.meta.tipo; metas de faturamento voltam a ser lidas como 'pedido').

-- =============================================================================================
-- core.nota_erp
-- =============================================================================================
create table core.nota_erp (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references plataforma.tenant (id),
  cliente_id        uuid not null,
  tipo              text not null,
  numero            text not null,
  serie             text,
  emitida_em        timestamptz not null,
  ano_mes           text not null,
  total_cents       bigint not null,
  quantidade_itens  integer not null default 0,
  pedido_uuid       uuid,
  cancelada         boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  external_id       text,
  constraint nota_erp_tenant_id_uk unique (tenant_id, id),
  constraint nota_erp_cliente_fk foreign key (tenant_id, cliente_id) references core.cliente (tenant_id, id),
  constraint nota_erp_tipo_valido check (tipo in ('faturamento', 'devolucao')),
  constraint nota_erp_numero_preenchido check (btrim(numero) <> ''),
  constraint nota_erp_ano_mes_formato check (ano_mes ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  constraint nota_erp_total_nao_negativo check (total_cents >= 0),
  constraint nota_erp_itens_nao_negativos check (quantidade_itens >= 0),
  constraint nota_erp_external_id_preenchido check (nullif(btrim(external_id), '') is not null)
);
create unique index nota_erp_external_uk on core.nota_erp (tenant_id, external_id) where deleted_at is null;
create index nota_erp_cliente_mes_ix on core.nota_erp (tenant_id, cliente_id, ano_mes);
create index nota_erp_mes_ix on core.nota_erp (tenant_id, ano_mes);
create trigger nota_erp_updated_at before update on core.nota_erp
  for each row execute function plataforma.definir_updated_at();
alter table core.nota_erp enable row level security;
alter table core.nota_erp force row level security;
create policy isolamento_tenant on core.nota_erp for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
-- sem DELETE: a nota sai por soft delete (deleted_at) ou fica cancelada = true
grant select, insert, update on core.nota_erp to macuxi_app;

-- =============================================================================================
-- core.meta.tipo (RN-CORE-21)
-- =============================================================================================
alter table core.meta add column tipo text not null default 'pedido';
alter table core.meta add constraint meta_tipo_valido check (tipo in ('pedido', 'faturamento'));
