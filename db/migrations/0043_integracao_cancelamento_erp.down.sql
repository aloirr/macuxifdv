-- 0043_integracao_cancelamento_erp (down) — desfaz a 0043 (T-0114) e volta exatamente ao catálogo da 0042.
-- APAGA integracao.conector.aceita_cancelamento e as 5 colunas cancelamento_* de integracao.pedido_fila_erp (com os CHECKs e o
-- índice do poll). Dados NÃO voltam: cancelamentos pendentes ou enviados somem (o ERP passa a ser de novo quem avisa) e a
-- opção do Conector volta desligada num novo up. Desfaça junto o código do Hub da T-0114 (sem as colunas ele dá 500).
-- Idempotente (if exists em tudo). Pré-condição: 0044+ desfeitas.

drop index if exists integracao.pedido_fila_erp_cancelamento_ix;
alter table integracao.pedido_fila_erp drop constraint if exists pedido_fila_erp_cancelamento_coerente;
alter table integracao.pedido_fila_erp drop constraint if exists pedido_fila_erp_cancelamento_tentativas_validas;
alter table integracao.pedido_fila_erp drop constraint if exists pedido_fila_erp_cancelamento_motivo_tamanho;
alter table integracao.pedido_fila_erp drop constraint if exists pedido_fila_erp_cancelamento_estado_valido;
alter table integracao.pedido_fila_erp
  drop column if exists cancelamento_tentativas,
  drop column if exists cancelamento_enviado_em,
  drop column if exists cancelamento_solicitado_em,
  drop column if exists cancelamento_motivo,
  drop column if exists cancelamento_estado;
alter table integracao.conector drop column if exists aceita_cancelamento;
