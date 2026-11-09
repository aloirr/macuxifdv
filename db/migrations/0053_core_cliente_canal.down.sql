-- 0053_core_cliente_canal (down) — desfaz a 0053 (T-0115) e volta ao catálogo da 0052. APAGA os canais gravados (voltam com a
-- próxima carga do ERP se a 0053 for reaplicada). Volte antes o Core que lê/grava core.cliente.canal (pull, consumidor do ERP e
-- core.cadastro_resumo@1), senão eles dão 42703. Idempotente. Pré-condição: 0054+ desfeitas.

drop index if exists core.cliente_canal_ix;
alter table core.cliente drop constraint if exists cliente_canal_tamanho;
alter table core.cliente drop column if exists canal;
