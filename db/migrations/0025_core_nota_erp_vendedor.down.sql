-- 0025_core_nota_erp_vendedor (down) — T-0080
-- Desfaz a 0025 na ordem inversa. APAGA os dois índices e as colunas core.nota_erp.vendedor_external_id e usuario_id (a
-- atribuição das notas ao vendedor se perde e volta na próxima carga completa do ERP depois de reaplicar a 0025; as notas,
-- o historico_compra e o core.indicador_diario ficam). O Início com o Vendedor desligado volta à fonte
-- core.positivacao_do_mes (0023). Idempotente (if exists em tudo).
-- Pré-condição: 0026+ desfeitas.

drop index if exists core.nota_erp_vendedor_orfa_ix;
drop index if exists core.nota_erp_usuario_mes_ix;
alter table core.nota_erp drop constraint if exists nota_erp_usuario_fk;
alter table core.nota_erp drop constraint if exists nota_erp_vendedor_external_id_preenchido;
alter table core.nota_erp drop column if exists usuario_id;
alter table core.nota_erp drop column if exists vendedor_external_id;
