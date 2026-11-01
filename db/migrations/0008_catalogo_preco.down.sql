-- 0008_catalogo_preco (down) — T-0029
-- Desfaz a 0008. APAGA as tabelas de preço, os preços e a tabela de cada cliente (schema catalogo inteiro).
-- Pré-condição: 0009+ desfeitas. Sem o schema, a consulta catalogo.precos_cliente@1 falha (como antes da 0008) e o
-- Vendedor recusa todo pedido por falta de preço.
drop schema if exists catalogo cascade;
