-- 0020_pedido_ajuste_valor_produto_relacao (down) — T-0071
-- Desfaz a 0020 na ordem inversa. APAGA catalogo.produto_relacao com os dados (origem: base demo; depois Hub/BKO, que
-- reenviam) e as colunas de ajuste em R$ do pedido e do item com os dados delas. O pedido NÃO perde valor: o % equivalente
-- fica em desconto_pct/acrescimo_pct, o preço final do item em preco_unitario_cents e o total em total_cents — só se perde
-- o modo digitado (ajuste_em) e o R$ exato. Idempotente (if exists em tudo).
-- Pré-condição: 0021+ desfeitas.

-- catalogo.produto_relacao (índices, gatilho, política e grants vão junto com a tabela)
drop table if exists catalogo.produto_relacao;

-- vendedor.pedido_item
alter table vendedor.pedido_item drop constraint if exists pedido_item_ajuste_em_valido;
alter table vendedor.pedido_item drop constraint if exists pedido_item_ajuste_unitario_coerente;
alter table vendedor.pedido_item drop constraint if exists pedido_item_desconto_unitario_ate_tabela;
alter table vendedor.pedido_item drop constraint if exists pedido_item_ajuste_sentido_coerente;
alter table vendedor.pedido_item drop constraint if exists pedido_item_ajuste_valor_exclusivo;
alter table vendedor.pedido_item drop constraint if exists pedido_item_ajuste_valor_nao_negativo;
alter table vendedor.pedido_item drop column if exists ajuste_em;
alter table vendedor.pedido_item drop column if exists acrescimo_unitario_cents;
alter table vendedor.pedido_item drop column if exists desconto_unitario_cents;

-- vendedor.pedido
drop index if exists vendedor.pedido_orcamento_aberto_ix;
alter table vendedor.pedido drop constraint if exists pedido_ajuste_em_valido;
alter table vendedor.pedido drop constraint if exists pedido_ajuste_sentido_coerente;
alter table vendedor.pedido drop constraint if exists pedido_ajuste_valor_exclusivo;
alter table vendedor.pedido drop constraint if exists pedido_ajuste_valor_nao_negativo;
alter table vendedor.pedido drop column if exists ajuste_em;
alter table vendedor.pedido drop column if exists acrescimo_valor_cents;
alter table vendedor.pedido drop column if exists desconto_valor_cents;
