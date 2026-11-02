-- 0018_medidas (down) — T-0063
-- Desfaz a 0018 na ordem inversa. APAGA o cadastro de medidas de todos os tenants (inclusive as criadas/editadas pelo BKO),
-- a embalagem dos produtos (embalagem_medida, embalagem_quantidade) e, nos itens de pedido, medida, quantidade_embalagem e
-- quantidade_unidades (unidade, fator e quantidade_base da 0009/0013 continuam com o mesmo dado). A normalização
-- upper(btrim()) de core.produto.unidade / core.produto_unidade.unidade NÃO é desfeita (era a forma esperada).
-- Depois do down, tenant novo não recebe mais a lista de medidas. Idempotente (if exists em tudo).
-- Pré-condição: 0019+ desfeitas.

-- vendedor.pedido_item
alter table vendedor.pedido_item drop constraint if exists pedido_item_quantidade_unidades_coerente;
alter table vendedor.pedido_item drop constraint if exists pedido_item_embalagem_coerente;
alter table vendedor.pedido_item drop constraint if exists pedido_item_quantidade_embalagem_positiva;
alter table vendedor.pedido_item drop constraint if exists pedido_item_medida_formato;
drop trigger if exists pedido_item_medida on vendedor.pedido_item;
drop function if exists vendedor.pedido_item_medida();
alter table vendedor.pedido_item drop column if exists quantidade_unidades;
alter table vendedor.pedido_item drop column if exists quantidade_embalagem;
alter table vendedor.pedido_item drop column if exists medida;

-- core.produto_unidade e core.produto
drop index if exists core.produto_unidade_medida_ix;
alter table core.produto_unidade drop constraint if exists produto_unidade_medida_fk;
drop index if exists core.produto_embalagem_medida_ix;
drop index if exists core.produto_medida_ix;
alter table core.produto drop constraint if exists produto_embalagem_diferente;
alter table core.produto drop constraint if exists produto_embalagem_quantidade_minima;
alter table core.produto drop constraint if exists produto_embalagem_completa;
alter table core.produto drop constraint if exists produto_embalagem_medida_fk;
alter table core.produto drop constraint if exists produto_medida_fk;
alter table core.produto drop column if exists embalagem_quantidade;
alter table core.produto drop column if exists embalagem_medida;

-- semeadura e core.medida
drop trigger if exists tenant_semear_medidas on plataforma.tenant;
drop function if exists core.semear_tenant_medidas();
drop function if exists core.semear_medidas(uuid);
drop table if exists core.medida;
drop function if exists core.medida_em_uso();
