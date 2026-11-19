-- 0088_vendedor_pedido_aprovacao (down) — volta da 0088 (T-0184). APAGA vendedor.pedido_aprovacao com as decisões por motivo
-- e a coluna vendedor.pedido.aprovacao_ciclo; tira 'inadimplencia' de motivos_aprovacao (o pedido fica com os outros motivos)
-- antes de recriar o CHECK pedido_motivos_validos da 0009. Idempotente. Volte antes o código do Vendedor e do Gestor que lê
-- ou grava as aprovações.

drop table if exists vendedor.pedido_aprovacao;
alter table vendedor.pedido drop column if exists aprovacao_ciclo;
alter table vendedor.pedido drop constraint if exists pedido_motivos_validos;
update vendedor.pedido set motivos_aprovacao = array_remove(motivos_aprovacao, 'inadimplencia')
 where 'inadimplencia' = any (motivos_aprovacao);
alter table vendedor.pedido add constraint pedido_motivos_validos
  check (motivos_aprovacao <@ array['desconto', 'credito', 'estoque', 'preco_minimo']::text[]);
