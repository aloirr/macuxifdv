-- 0053_core_cliente_canal (up) — T-0115 (RN-PES-05): canal do cliente, vindo do ERP, usado no público da Pesquisa.
-- Pedido R-20261109-010010-modulo-core. Dicionário: docs/banco/core.md ("0053 — canal do cliente"). Migração em cima da 0052.
-- ADITIVA, só core.cliente: 1 coluna nula (sem backfill: nulo = sem canal), 1 CHECK (1..60 caracteres) e 1 índice parcial para
-- o filtro por canal da Pesquisa. RLS, políticas, grants (select/insert/update do macuxi_app) e o índice de sync não mudam; a
-- coluna entra no pull de cliente pelo Core (o updated_at já anda pelo gatilho quando o canal muda).
-- Caminho de volta: 0053_core_cliente_canal.down.sql (apaga a coluna e os canais gravados).

alter table core.cliente add column canal text;
alter table core.cliente add constraint cliente_canal_tamanho check (canal is null or char_length(canal) between 1 and 60);
create index cliente_canal_ix on core.cliente (tenant_id, canal) where deleted_at is null and canal is not null;
