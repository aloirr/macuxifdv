-- 0019_core_nota_erp_meta_tipo (down) — T-0066 / T-0065
-- Desfaz a 0019 na ordem inversa. APAGA core.nota_erp com os dados (o consumidor de integracao.nota.atualizado@1 reconstrói
-- a partir da reentrega do ERP; core.historico_compra NÃO é tocado) e a coluna core.meta.tipo (metas de faturamento voltam
-- a ser lidas como 'pedido' pelo Core). Idempotente (if exists em tudo).
-- Pré-condição: 0020+ desfeitas.

-- core.meta.tipo
alter table core.meta drop constraint if exists meta_tipo_valido;
alter table core.meta drop column if exists tipo;

-- core.nota_erp (índices, gatilho, política e grants vão junto com a tabela)
drop table if exists core.nota_erp;
