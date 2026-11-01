-- 0009_vendedor_pedido_completo (down) — T-0029
-- Desfaz a 0009 na ordem inversa. APAGA a linha do tempo dos pedidos (pedido_evento), as condições de pagamento e as
-- condições por cliente, o contador de número e as colunas novas de pedido e pedido_item (número, hash do envio,
-- retratos, nível/motivos/decisão da aprovação e motivo da rejeição: esses valores se perdem). Os pedidos e itens
-- continuam (colunas da 0007). Os níveis e motivos preenchidos pelo up nos pedidos antigos saem junto com as colunas.
-- Pré-condição: 0010+ desfeitas. Depois do down, o receber do Vendedor falha por falta das colunas (como antes).
drop table if exists vendedor.pedido_evento;

alter table vendedor.pedido_item drop column if exists unidade;
alter table vendedor.pedido_item drop column if exists produto_nome;
alter table vendedor.pedido_item drop column if exists produto_sku;

drop index if exists vendedor.pedido_status_ix;
drop index if exists vendedor.pedido_numero_uk;
alter table vendedor.pedido drop constraint if exists pedido_condicao_fk;
alter table vendedor.pedido drop constraint if exists pedido_numero_preenchido;
alter table vendedor.pedido drop constraint if exists pedido_cliente_resumo_objeto;
alter table vendedor.pedido drop constraint if exists pedido_hash_envio_formato;
alter table vendedor.pedido drop constraint if exists pedido_rejeitado_com_motivo;
alter table vendedor.pedido drop constraint if exists pedido_pendente_com_nivel;
alter table vendedor.pedido drop column if exists motivo_rejeicao;
alter table vendedor.pedido drop column if exists decidido_em;
alter table vendedor.pedido drop column if exists decidido_por_id;
alter table vendedor.pedido drop column if exists aprovacao_automatica;
alter table vendedor.pedido drop column if exists motivos_aprovacao;
alter table vendedor.pedido drop column if exists nivel_aprovacao;
alter table vendedor.pedido drop column if exists condicao_pagamento_descricao;
alter table vendedor.pedido drop column if exists condicao_pagamento_id;
alter table vendedor.pedido drop column if exists tabela_preco_id;
alter table vendedor.pedido drop column if exists vendedor_nome;
alter table vendedor.pedido drop column if exists cliente_nome;
alter table vendedor.pedido drop column if exists cliente_resumo;
alter table vendedor.pedido drop column if exists hash_envio;
alter table vendedor.pedido drop column if exists numero;

drop function if exists vendedor.proximo_numero_pedido();
drop table if exists vendedor.numeracao_pedido;
drop table if exists vendedor.cliente_condicao;
drop table if exists vendedor.condicao_pagamento;
