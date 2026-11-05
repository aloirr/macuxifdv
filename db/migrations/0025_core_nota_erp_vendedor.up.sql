-- 0025_core_nota_erp_vendedor (up) — T-0080 (positivação do mês com o Vendedor desligado, fonte nas notas do ERP; pedido
-- R-20261105-021312-engenheiro-software; desenho docs/desenho/T-0080.md §2; RN-CORE-27). Dicionário: docs/banco/core.md.
-- Migração ADITIVA e idempotente (if not exists / drop if exists + add): nenhuma coluna existente muda, nenhum dado
-- existente é reescrito (colunas novas nulas, sem padrão, SEM backfill).
--
-- Mudanças em core.nota_erp (atribuição da nota ao vendedor):
--   vendedor_external_id (text, null): chave do vendedor no ERP como veio no NotaPayload (integracao.nota.atualizado@1,
--     contrato sem mudança). O consumidor do Core grava aparado (trim) e vazio vira null: CHECK
--     nota_erp_vendedor_external_id_preenchido (null ou não vazio depois do btrim, até 200 caracteres = EXTERNAL_ID_MAX
--     do contrato). Guarda a chave para completar usuario_id quando o vendedor chegar depois da nota.
--   usuario_id (uuid, null): vendedor da nota (core.usuario do PRÓPRIO tenant): FK composta nota_erp_usuario_fk
--     (tenant_id, usuario_id) -> core.usuario (tenant_id, id). null = nota sem vendedor ou vendedor ainda não recebido do
--     ERP (não é erro: a nota continua servindo ao historico_compra; não conta para a positivação de ninguém).
--   Índices:
--     nota_erp_usuario_mes_ix (tenant_id, usuario_id, ano_mes) where deleted_at is null and usuario_id is not null:
--       positivação do mês no Início (clientes distintos por usuário e mês; RN-CORE-27) e "existe fonte ERP no tenant".
--     nota_erp_vendedor_orfa_ix (tenant_id, vendedor_external_id) where usuario_id is null and deleted_at is null and
--       vendedor_external_id is not null: completar as notas órfãs quando integracao.vendedor.atualizado@1 chega (parcial:
--       fica pequeno, só as notas à espera do vendedor).
--
-- RLS: a tabela já tem enable/force e a política isolamento_tenant (0019); nenhuma política nova, grants iguais (select,
-- insert, update ao macuxi_app). core.indicador_diario e core.positivacao_do_mes NÃO mudam. Fora do pull do app (como na
-- 0019). Linhas anteriores à 0025 ficam com as duas colunas nulas até a próxima carga do ERP.
-- Caminho de volta: 0025_core_nota_erp_vendedor.down.sql (APAGA as duas colunas e os índices: a atribuição das notas ao
-- vendedor se perde e volta na próxima carga completa do ERP; o Início sem o Vendedor volta à fonte core.positivacao_do_mes).

alter table core.nota_erp add column if not exists vendedor_external_id text;
alter table core.nota_erp add column if not exists usuario_id uuid;

alter table core.nota_erp drop constraint if exists nota_erp_vendedor_external_id_preenchido;
alter table core.nota_erp add constraint nota_erp_vendedor_external_id_preenchido
  check (vendedor_external_id is null or (btrim(vendedor_external_id) <> '' and char_length(vendedor_external_id) <= 200));

alter table core.nota_erp drop constraint if exists nota_erp_usuario_fk;
alter table core.nota_erp add constraint nota_erp_usuario_fk
  foreign key (tenant_id, usuario_id) references core.usuario (tenant_id, id);

create index if not exists nota_erp_usuario_mes_ix on core.nota_erp (tenant_id, usuario_id, ano_mes)
  where deleted_at is null and usuario_id is not null;
create index if not exists nota_erp_vendedor_orfa_ix on core.nota_erp (tenant_id, vendedor_external_id)
  where usuario_id is null and deleted_at is null and vendedor_external_id is not null;
