-- 0101_vendedor_faturamento_chave_acesso (down) — desfaz a 0101: tira o check e a coluna nota_chave_acesso de
-- vendedor.pedido_faturamento (a chave gravada se perde; o resto da linha fica) e devolve ao macuxi_leitura o SELECT na
-- tabela da 0078 (sem o SELECT por coluna). Idempotente.
-- Pré-condição: a API (retorno do ERP, pull e detalhe do pedido) sem ler nem gravar nota_chave_acesso (senão 42703).

alter table vendedor.pedido_faturamento drop constraint if exists pedido_faturamento_chave_acesso_formato;
alter table vendedor.pedido_faturamento drop column if exists nota_chave_acesso;

revoke select (id, tenant_id, pedido_id, evento_id, parcial, numero_erp, nota_numero, nota_serie, nota_emitida_em,
               nota_total_cents, itens, faturado_em, created_at, updated_at, deleted_at, external_id)
  on vendedor.pedido_faturamento from macuxi_leitura;
grant select on vendedor.pedido_faturamento to macuxi_leitura;
