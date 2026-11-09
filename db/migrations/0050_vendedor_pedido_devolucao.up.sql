-- 0050_vendedor_pedido_devolucao (up) — RN-VEN-37: a devolução do pedido, nota a nota (T-0054).
-- Pedidos R-20261102-132023-modulo-vendedor (item 4) e R-20261102-190604-modulo-vendedor. Dicionário: docs/banco/vendedor.md
-- ("pedido_devolucao (0050)"). Migração em cima da 0049 (nenhuma anterior muda). ADITIVA: 1 tabela nova no schema vendedor;
-- nenhuma coluna, política ou grant de tabela existente muda.
--
-- Consumidor: integracao.nota.atualizado@1 (modules/vendedor/api/retorno-erp.ts, criarConsumidorNotaDevolucao), só com nota
-- tipo = devolucao e pedido_uuid. Upsert pelo external_id da nota (a chave do ERP): linha viva por (tenant_id, external_id);
-- nota cancelada, inativada, sem pedido ou que deixou de ser devolução sai da soma por soft delete (update deleted_at), e a mesma
-- nota pode voltar depois numa linha nova (o único é parcial, where deleted_at is null). O devolvido do pedido é a SOMA das
-- linhas vivas (decisão do banco-dados, opção dada no R-20261102-190604): sem coluna de resumo em vendedor.pedido, para não ter
-- duas verdades; a leitura é por pedido_id (índice pedido_devolucao_pedido_ix) e o volume é baixo (devolução é rara, 1..2 por
-- pedido). A devolução não muda o status do pedido.
--   pedido_id    uuid not null, FK composta (tenant_id, pedido_id) -> vendedor.pedido (tenant_id, id)
--   external_id  text not null (a nota do ERP; não vazio), único parcial (tenant_id, external_id) where deleted_at is null
--   nota_numero  text not null · nota_serie text · emitida_em timestamptz not null · total_cents bigint not null (>= 0)
-- Só o servidor usa (fora do sync: db/src/excecoes.ts TABELAS_FORA_DO_SYNC, sem o índice (tenant_id, updated_at, id)); o
-- aparelho recebe o devolvido pelo resumo do pedido. RLS forçado, isolamento_tenant, manutencao (0031) e select/insert/update ao
-- macuxi_app (sem delete: o soft delete é por update). Sem dado pessoal (número, série, data e valor da nota).
-- Caminho de volta: 0050_vendedor_pedido_devolucao.down.sql (apaga a tabela e as devoluções gravadas; volte antes o Vendedor
-- para DEVOLUCAO_LIGADA = false, senão o consumidor da nota e o detalhe do pedido dão 500).

create table vendedor.pedido_devolucao (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references plataforma.tenant (id),
  pedido_id    uuid not null,
  nota_numero  text not null,
  nota_serie   text,
  emitida_em   timestamptz not null,
  total_cents  bigint not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  external_id  text not null,
  constraint pedido_devolucao_pedido_fk foreign key (tenant_id, pedido_id) references vendedor.pedido (tenant_id, id),
  constraint pedido_devolucao_total_nao_negativo check (total_cents >= 0),
  constraint pedido_devolucao_external_id_preenchido check (btrim(external_id) <> '')
);
create unique index pedido_devolucao_external_uk on vendedor.pedido_devolucao (tenant_id, external_id) where deleted_at is null;
create index pedido_devolucao_pedido_ix on vendedor.pedido_devolucao (tenant_id, pedido_id);
create trigger pedido_devolucao_updated_at before update on vendedor.pedido_devolucao
  for each row execute function plataforma.definir_updated_at();
alter table vendedor.pedido_devolucao enable row level security;
alter table vendedor.pedido_devolucao force row level security;
create policy isolamento_tenant on vendedor.pedido_devolucao for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
create policy manutencao on vendedor.pedido_devolucao for all to macuxi_manutencao using (true) with check (true);
grant select, insert, update on vendedor.pedido_devolucao to macuxi_app;
