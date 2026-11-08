-- 0048_integracao_cancelamento_recusado (up) — T-0114: o ERP recusa o cancelamento pedido pelo Hub (aviso no monitor).
-- Pedido R-20261108-095741-modulo-integracao (reservado como 0048 em R-20261108-102949). Dicionário: docs/banco/integracao.md
-- ("Cancelamento recusado pelo ERP (0048)"). Migração em cima da 0047 (nenhuma anterior muda). ADITIVA, só em
-- integracao.pedido_fila_erp: 2 colunas, 1 CHECK novo, 2 CHECKs da 0043 trocados e 1 índice parcial; nenhuma tabela, política ou
-- grant novo (RLS forçado, isolamento_tenant, manutencao e update ao macuxi_app herdados da 0010/0031).
--
-- O Conector devolve o retorno `cancelamento_recusado` (com motivo) para um cancelamento já 'enviado'; o Hub (retornoPedido em
-- modules/integracao/api/rotas-pedidos.ts) grava a recusa na própria linha da fila e o monitor (bko-monitor.ts) alerta:
--   cancelamento_recusado_em    timestamptz null — instante informado pelo ERP/Conector (`ocorrido_em` do retorno)
--   cancelamento_recusa_motivo  text null — 1..300 caracteres, sem só espaços (CHECK pedido_fila_erp_cancelamento_recusa_motivo_tamanho).
--                               Texto do ERP mascarado pelo Conector; não entra em log (a API registra só o pedido_uuid).
--   CHECK pedido_fila_erp_cancelamento_estado_valido: + 'recusado' (nulo | pendente | enviado | confirmado | recusado).
--   CHECK pedido_fila_erp_cancelamento_coerente: as 2 regras da 0043 (estado nulo <=> solicitado_em nulo; 'enviado' =>
--     enviado_em) e mais: 'recusado' => recusado_em e recusa_motivo preenchidos; os dois andam juntos (ambos nulos ou ambos
--     preenchidos); preenchidos só em 'recusado' ou 'confirmado'. O 'confirmado' guarda a recusa anterior porque o retorno
--     `cancelado` posterior (o ERP cancelou por conta própria) só troca o estado e não limpa as colunas (código e teste de banco
--     do Hub já escritos assim; o alerta some porque o monitor filtra 'recusado').
-- Índice pedido_fila_erp_cancelamento_recusado_ix (tenant_id, cancelamento_recusado_em desc) where cancelamento_estado =
--   'recusado' and deleted_at is null: a consulta do monitor (where tenant_id = $1 and cancelamento_estado = 'recusado' and
--   estado <> 'cancelado' order by cancelamento_recusado_em desc limit 1000). Volume: poucas linhas, uma por pedido.
-- Sem backfill: nenhuma linha antiga tem recusa (colunas nulas satisfazem os CHECKs novos). integracao.pedido_retorno e o evento
--   integracao.pedido.retorno_erp@1 NÃO mudam (a recusa não entra nessa trilha).
-- Caminho de volta: 0048_integracao_cancelamento_recusado.down.sql (linhas 'recusado' voltam a 'enviado'; a recusa se perde).

alter table integracao.pedido_fila_erp add column cancelamento_recusado_em timestamptz;
alter table integracao.pedido_fila_erp add column cancelamento_recusa_motivo text;

alter table integracao.pedido_fila_erp drop constraint pedido_fila_erp_cancelamento_estado_valido;
alter table integracao.pedido_fila_erp add constraint pedido_fila_erp_cancelamento_estado_valido
  check (cancelamento_estado is null or cancelamento_estado in ('pendente', 'enviado', 'confirmado', 'recusado'));
alter table integracao.pedido_fila_erp add constraint pedido_fila_erp_cancelamento_recusa_motivo_tamanho
  check (cancelamento_recusa_motivo is null or (btrim(cancelamento_recusa_motivo) <> '' and char_length(cancelamento_recusa_motivo) <= 300));
alter table integracao.pedido_fila_erp drop constraint pedido_fila_erp_cancelamento_coerente;
alter table integracao.pedido_fila_erp add constraint pedido_fila_erp_cancelamento_coerente
  check ((cancelamento_estado is null) = (cancelamento_solicitado_em is null)
         and (cancelamento_estado is distinct from 'enviado' or cancelamento_enviado_em is not null)
         and (cancelamento_recusado_em is null) = (cancelamento_recusa_motivo is null)
         and (cancelamento_estado is distinct from 'recusado' or cancelamento_recusado_em is not null)
         and (cancelamento_recusado_em is null or (cancelamento_estado is not null and cancelamento_estado in ('recusado', 'confirmado'))));

-- alerta do monitor do BKO (recusas ainda sem desfecho)
create index pedido_fila_erp_cancelamento_recusado_ix on integracao.pedido_fila_erp (tenant_id, cancelamento_recusado_em desc)
  where cancelamento_estado = 'recusado' and deleted_at is null;
