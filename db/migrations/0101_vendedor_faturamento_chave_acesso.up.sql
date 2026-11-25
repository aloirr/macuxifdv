-- 0101_vendedor_faturamento_chave_acesso (up) — chave de acesso da NF no faturamento do pedido (v1.0.34; R-20261124-184958,
-- D3 da jornada AM2808). O ERP passa a mandar chave_acesso (44 dígitos, opcional) no NotaRetorno do
-- POST /integracao/v1/pedidos/{uuid}/retorno; o FDV grava em vendedor.pedido_faturamento.nota_chave_acesso. Aditiva: coluna
-- nula, sem default, sem backfill (linhas antigas ficam nulas); os grants do macuxi_app (select, insert na tabela) cobrem a
-- coluna nova. A nota de devolução (vendedor.pedido_devolucao) fica fora.
-- Dicionário: docs/banco/vendedor.md. Teste: db/testes/faturamento-chave-acesso.db.test.ts.
-- macuxi_leitura (0078, regra 8): coluna com "chave" no nome fica fora do SELECT dele, então a tabela passa de SELECT na
-- tabela para SELECT por coluna (todas as da 0013, sem a nova), como o conferir-rls.sql exige.
-- Volta: 0101_vendedor_faturamento_chave_acesso.down.sql (apaga a coluna e a chave gravada; leitura volta ao SELECT na tabela).

alter table vendedor.pedido_faturamento add column if not exists nota_chave_acesso text;

alter table vendedor.pedido_faturamento drop constraint if exists pedido_faturamento_chave_acesso_formato;
alter table vendedor.pedido_faturamento
  add constraint pedido_faturamento_chave_acesso_formato
  check (nota_chave_acesso is null or nota_chave_acesso ~ '^[0-9]{44}$');

revoke select on vendedor.pedido_faturamento from macuxi_leitura;
grant select (id, tenant_id, pedido_id, evento_id, parcial, numero_erp, nota_numero, nota_serie, nota_emitida_em,
              nota_total_cents, itens, faturado_em, created_at, updated_at, deleted_at, external_id)
  on vendedor.pedido_faturamento to macuxi_leitura;
