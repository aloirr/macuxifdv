-- 0076_core_produto_marca_codigo (down) — desfaz a 0076: apaga core.produto.marca_codigo (os códigos gravados se perdem e
-- voltam na próxima carga do ERP). Volte antes o Core que lê/grava a coluna (senão 42703). Idempotente. Pré-condição: 0077+
-- desfeitas.

alter table core.produto drop column if exists marca_codigo;
