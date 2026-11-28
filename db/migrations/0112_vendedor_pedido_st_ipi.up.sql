-- 0112_vendedor_pedido_st_ipi (up) — ST e IPI vindos do ERP no pedido e no item (v1.0.44, T-0208, ADR 0077 D5; decisão 63 A,
-- R-20261127-235610-alexandre). O FDV não calcula imposto: só guarda o que o ERP mandou no retorno do pedido. Dicionário:
-- docs/banco/vendedor.md ("0112"). Teste: db/testes/pedido-st-ipi.db.test.ts.
--
-- Migração ADITIVA: 4 colunas bigint nulas, sem default, e 4 CHECKs >= 0. NULL = "não informado" (o ERP não mandou, ou o
-- pedido é anterior à 0112) e é o valor de toda linha existente; 0 só entra quando o ERP manda 0 (ADR 0077 D3). Sem backfill
-- e sem andar o updated_at. Nenhum gatilho, CHECK ou função soma esses campos nem os relaciona com total_cents (o CHECK de
-- totais da 0007 não muda; total NULL com itens preenchidos é válido). RLS, políticas, grants (macuxi_app e macuxi_leitura na
-- tabela) e índices de vendedor.pedido e vendedor.pedido_item não mudam: as colunas herdam os da tabela. Não toca sa_* nem o
-- kit do Conector.
--
-- vendedor.pedido.v_icms_st_cents       bigint null, >= 0 (pedido_v_icms_st_nao_negativo)   total do ICMS-ST do ERP
-- vendedor.pedido.v_ipi_cents           bigint null, >= 0 (pedido_v_ipi_nao_negativo)       total do IPI do ERP
-- vendedor.pedido_item.v_icms_st_cents  bigint null, >= 0 (pedido_item_v_icms_st_nao_negativo)
-- vendedor.pedido_item.v_ipi_cents      bigint null, >= 0 (pedido_item_v_ipi_nao_negativo)
-- Quem grava: o consumidor do Vendedor de integracao.pedido.retorno_erp@1, na mesma transação do status (ADR 0077 D4/D5).
-- Volume: o de hoje (pedidos e itens por tenant). Consultas: as de hoje (pull e detalhe); nenhum índice novo.
--
-- Caminho de volta: 0112_vendedor_pedido_st_ipi.down.sql (apaga os 4 CHECKs e as 4 colunas; os valores voltam no próximo
-- retorno do ERP). Volte antes o código do Vendedor e da Integração que lê ou grava as colunas (senão 42703).

alter table vendedor.pedido add column if not exists v_icms_st_cents bigint;
alter table vendedor.pedido add column if not exists v_ipi_cents bigint;
alter table vendedor.pedido drop constraint if exists pedido_v_icms_st_nao_negativo;
alter table vendedor.pedido add constraint pedido_v_icms_st_nao_negativo check (v_icms_st_cents is null or v_icms_st_cents >= 0);
alter table vendedor.pedido drop constraint if exists pedido_v_ipi_nao_negativo;
alter table vendedor.pedido add constraint pedido_v_ipi_nao_negativo check (v_ipi_cents is null or v_ipi_cents >= 0);

alter table vendedor.pedido_item add column if not exists v_icms_st_cents bigint;
alter table vendedor.pedido_item add column if not exists v_ipi_cents bigint;
alter table vendedor.pedido_item drop constraint if exists pedido_item_v_icms_st_nao_negativo;
alter table vendedor.pedido_item add constraint pedido_item_v_icms_st_nao_negativo
  check (v_icms_st_cents is null or v_icms_st_cents >= 0);
alter table vendedor.pedido_item drop constraint if exists pedido_item_v_ipi_nao_negativo;
alter table vendedor.pedido_item add constraint pedido_item_v_ipi_nao_negativo check (v_ipi_cents is null or v_ipi_cents >= 0);
