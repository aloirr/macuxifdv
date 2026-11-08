-- 0048_integracao_cancelamento_recusado (down) — desfaz a 0048 (T-0114) e volta exatamente ao catálogo da 0047.
-- Linhas com cancelamento 'recusado' voltam a 'enviado' (o estado de onde a recusa saiu; enviado_em garantido pelo CHECK da 0043)
-- e APAGA cancelamento_recusado_em e cancelamento_recusa_motivo (a recusa e o motivo se perdem; o alerta do monitor some).
-- 'confirmado' com recusa anterior fica 'confirmado'. Desfaça junto o código do Hub que grava a recusa (sem as colunas, o
-- retorno `cancelamento_recusado` e o monitor dão 500). Idempotente (if exists em tudo). Pré-condição: 0049+ desfeitas.

drop index if exists integracao.pedido_fila_erp_cancelamento_recusado_ix;
alter table integracao.pedido_fila_erp drop constraint if exists pedido_fila_erp_cancelamento_coerente;
alter table integracao.pedido_fila_erp drop constraint if exists pedido_fila_erp_cancelamento_recusa_motivo_tamanho;
alter table integracao.pedido_fila_erp drop constraint if exists pedido_fila_erp_cancelamento_estado_valido;

update integracao.pedido_fila_erp
   set cancelamento_estado = 'enviado', cancelamento_enviado_em = coalesce(cancelamento_enviado_em, cancelamento_solicitado_em)
 where cancelamento_estado = 'recusado';

alter table integracao.pedido_fila_erp
  drop column if exists cancelamento_recusa_motivo,
  drop column if exists cancelamento_recusado_em;

-- os 2 CHECKs como a 0043 os criou
alter table integracao.pedido_fila_erp add constraint pedido_fila_erp_cancelamento_estado_valido
  check (cancelamento_estado is null or cancelamento_estado in ('pendente', 'enviado', 'confirmado'));
alter table integracao.pedido_fila_erp add constraint pedido_fila_erp_cancelamento_coerente
  check ((cancelamento_estado is null) = (cancelamento_solicitado_em is null)
         and (cancelamento_estado is distinct from 'enviado' or cancelamento_enviado_em is not null));
