-- 0021_core_recado_do_dia (up) — T-0073 (boas-vindas / Início; desenho docs/desenho/T-0073.md §3.4; pedido
-- R-20261103-184906-engenheiro-software). Dicionário: docs/banco/core.md.
-- Migração ADITIVA: nenhuma coluna existente muda, nenhum dado existente é reescrito (colunas novas nulas, sem padrão).
--
-- Mudanças em core.notificacao:
--   recado_do_dia (date): dia CIVIL do tenant (fuso de plataforma.tenant, calculado pela API) em que o recado vale como
--     "recado do dia" no Início do destinatário; null = não marcado. Só recado (tipo = 'recado'): CHECK
--     notificacao_recado_do_dia_so_recado.
--   recado_do_dia_por (uuid): quem marcou (supervisor/gerente; a permissão e o escopo da equipe são da API do Core).
--     Preenchido junto com recado_do_dia (CHECK notificacao_recado_do_dia_par) e do PRÓPRIO tenant (FK composta
--     notificacao_recado_do_dia_por_fk -> core.usuario (tenant_id, id)).
--   notificacao_recado_do_dia_uk: único parcial (tenant_id, usuario_id, recado_do_dia) vivo — um recado do dia por pessoa
--     por dia (a API desmarca o anterior na mesma transação antes de marcar o novo).
--   notificacao_envio_ix: (tenant_id, envio_id) where envio_id is not null — marcar/desmarcar todas as cópias de um envio
--     (o único notificacao_envio_uk começa por usuario_id e não serve a essa busca).
--
-- Mudança em core.indicador_diario (pedido R-20261103-235827-gerente-projetos; desenho T-0073 §1.1 — fallback da
-- positivação do Início com o Vendedor desligado):
--   clientes_positivados (integer, null): clientes DISTINTOS com pedido que conta para a meta (RN-CORE-21) do usuário
--     naquele dia civil do tenant; null = não apurado (linhas anteriores à 0021 e consumidor que ainda não conta). Sem
--     backfill e sem padrão. CHECK indicador_diario_clientes_positivados_nao_negativo (null ou >= 0).
--
-- RLS: as duas tabelas já têm enable/force e a política isolamento_tenant (0006). Nenhuma política nova; grants iguais (o
-- macuxi_app já tem select, insert, update nas duas). O pull de notificacao (índices de sync da 0006) leva as colunas novas.
-- Caminho de volta: 0021_core_recado_do_dia.down.sql (APAGA as marcações de recado do dia, os recados continuam; e APAGA
-- a contagem clientes_positivados, os demais números do indicador_diario continuam).

alter table core.notificacao add column recado_do_dia date;
alter table core.notificacao add column recado_do_dia_por uuid;
alter table core.notificacao add constraint notificacao_recado_do_dia_so_recado check (recado_do_dia is null or tipo = 'recado');
alter table core.notificacao add constraint notificacao_recado_do_dia_par check ((recado_do_dia is null) = (recado_do_dia_por is null));
alter table core.notificacao add constraint notificacao_recado_do_dia_por_fk foreign key (tenant_id, recado_do_dia_por) references core.usuario (tenant_id, id);
-- um recado do dia por pessoa por dia
create unique index notificacao_recado_do_dia_uk on core.notificacao (tenant_id, usuario_id, recado_do_dia)
  where recado_do_dia is not null and deleted_at is null;
-- marcar por envio
create index notificacao_envio_ix on core.notificacao (tenant_id, envio_id) where envio_id is not null;

-- positivação no read-model diário (fallback do Início sem o Vendedor)
alter table core.indicador_diario add column clientes_positivados integer;
alter table core.indicador_diario add constraint indicador_diario_clientes_positivados_nao_negativo check (clientes_positivados is null or clientes_positivados >= 0);
