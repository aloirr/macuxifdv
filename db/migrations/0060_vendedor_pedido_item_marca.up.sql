-- 0060_vendedor_pedido_item_marca (up) — T-0159 (PDF do pedido, proposta 2: coluna "Marca" depois da descrição, nas versões
-- cliente e escritório; R-20261110-215816). Pedido R-20261110-215723-modulo-vendedor. Migração em cima da 0059.
-- Dicionário: docs/banco/vendedor.md ("0060 — marca no item").
-- Migração ADITIVA: 1 coluna NULA e 1 CHECK em vendedor.pedido_item. Sem backfill (o retrato é o que valia no pedido; item
-- anterior fica nulo e o PDF mostra a célula vazia). Nenhum contrato muda de versão; RLS, políticas e grants não mudam.
--
-- vendedor.pedido_item.marca text: retrato de core.produto.marca no RECEBIMENTO (como aplicacao, 0033), gravado pela API do
--   Vendedor e nunca editado. 1..100 sem branco (pedido_item_marca_tamanho); core.produto.marca não tem limite no banco, então
--   a API corta em 100 e grava nulo se vier vazia. Volume: o de pedido_item. Consulta: a leitura dos itens do pedido de hoje
--   (detalhe, PDF e pull, por pedido_id), sem índice novo. Aparelho: ent_pedido_item é JSON (sem DDL).
--
-- Caminho de volta: 0060_vendedor_pedido_item_marca.down.sql (APAGA a coluna: as marcas retratadas nos itens se perdem; o PDF
-- volta a ler a marca do cadastro ou a mostrar vazio — volte antes o Vendedor que grava/lê a coluna).

alter table vendedor.pedido_item add column marca text;
alter table vendedor.pedido_item add constraint pedido_item_marca_tamanho check (marca is null or (btrim(marca) <> '' and char_length(marca) <= 100));
