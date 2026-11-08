-- 0043_integracao_cancelamento_erp (up) — T-0114: cancelamento do pedido devolvido ao ERP (exceção da RN-INT-08 / RN-VEN-31).
-- Pedido R-20261107-235216-modulo-integracao. Dicionário: docs/banco/integracao.md ("Cancelamento para o ERP (0043)").
-- Migração em cima da 0042 (nenhuma anterior muda). ADITIVA: 6 colunas, 4 CHECKs e 1 índice parcial; nenhuma tabela,
-- política ou grant novo (as duas tabelas já têm RLS forçado, isolamento_tenant, manutencao e update ao macuxi_app).
--
-- integracao.conector.aceita_cancelamento (boolean not null default false): o Conector executa no ERP o cancelamento feito no
--   Macuxi. Padrão false = Conector existente continua como antes (o ERP é quem avisa o cancelamento). Ligado pelo BKO.
--
-- integracao.pedido_fila_erp, o cancelamento de um pedido JÁ entregue ao Conector (um por pedido; o consumidor de
-- vendedor.pedido.cancelado@1 grava 'pendente'; o poll GET /pedidos/pendentes passa a 'enviado' e soma a tentativa; o retorno
-- `cancelado` de sempre confirma, 'confirmado'):
--   cancelamento_estado         text null — null (nunca pedido) | 'pendente' | 'enviado' | 'confirmado' (EstadoCancelamento do domain)
--   cancelamento_motivo         text null — 1..500 caracteres, sem só espaços (o domain apara e corta em 500)
--   cancelamento_solicitado_em  timestamptz null — instante do cancelamento no Macuxi (cancelado_em do evento); ordem do poll
--   cancelamento_enviado_em     timestamptz null — última entrega ao Conector (reentrega depois do timeout de envio)
--   cancelamento_tentativas     integer not null default 0 — entregas ao Conector (>= 0)
--   CHECK pedido_fila_erp_cancelamento_coerente: estado nulo <=> solicitado_em nulo; 'enviado' => enviado_em preenchido.
-- Índice pedido_fila_erp_cancelamento_ix (tenant_id, cancelamento_solicitado_em, pedido_uuid) where cancelamento_estado in
--   ('pendente','enviado') and deleted_at is null: a consulta do poll (order by cancelamento_solicitado_em, pedido_uuid
--   limit n for update skip locked). Volume: uma linha por pedido; poucas com cancelamento vivo.
-- Sem backfill: linhas existentes ficam com estado nulo e 0 tentativas (o padrão). LGPD: o motivo é texto livre do vendedor;
--   não entra em log (a API registra só a ação).
-- Caminho de volta: 0043_integracao_cancelamento_erp.down.sql (APAGA as 6 colunas: cancelamentos pendentes somem e o Hub
--   anterior volta a ignorar o evento; a opção do Conector se perde e volta desligada num novo up).

alter table integracao.conector add column aceita_cancelamento boolean not null default false;

alter table integracao.pedido_fila_erp add column cancelamento_estado text;
alter table integracao.pedido_fila_erp add column cancelamento_motivo text;
alter table integracao.pedido_fila_erp add column cancelamento_solicitado_em timestamptz;
alter table integracao.pedido_fila_erp add column cancelamento_enviado_em timestamptz;
alter table integracao.pedido_fila_erp add column cancelamento_tentativas integer not null default 0;
alter table integracao.pedido_fila_erp add constraint pedido_fila_erp_cancelamento_estado_valido
  check (cancelamento_estado is null or cancelamento_estado in ('pendente', 'enviado', 'confirmado'));
alter table integracao.pedido_fila_erp add constraint pedido_fila_erp_cancelamento_motivo_tamanho
  check (cancelamento_motivo is null or (btrim(cancelamento_motivo) <> '' and char_length(cancelamento_motivo) <= 500));
alter table integracao.pedido_fila_erp add constraint pedido_fila_erp_cancelamento_tentativas_validas
  check (cancelamento_tentativas >= 0);
alter table integracao.pedido_fila_erp add constraint pedido_fila_erp_cancelamento_coerente
  check ((cancelamento_estado is null) = (cancelamento_solicitado_em is null)
         and (cancelamento_estado is distinct from 'enviado' or cancelamento_enviado_em is not null));

-- poll dos cancelamentos (GET /pedidos/pendentes do Conector com aceita_cancelamento)
create index pedido_fila_erp_cancelamento_ix on integracao.pedido_fila_erp (tenant_id, cancelamento_solicitado_em, pedido_uuid)
  where cancelamento_estado in ('pendente', 'enviado') and deleted_at is null;
