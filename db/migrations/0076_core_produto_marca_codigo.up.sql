-- 0076_core_produto_marca_codigo (up) — código da marca no ERP no cadastro do produto (decisão do dono do produto,
-- R-20261115-080000-alexandre, item 1): o produto ganha `marca_codigo` opcional (ex.: 980), que o Catálogo mostra no card.
-- O Hub já recebe o campo (produto do Conector, `marca_codigo` até 30, opcional e aditivo no v1; view vw_macuxi_produto em
-- db/conector/views-modelo.sql). Dicionário: docs/banco/core.md ("0076"). Teste: db/testes/produto-marca-codigo.db.test.ts
-- (estático na sessão; banco e up/down no CI).
--
-- Migração ADITIVA: 1 coluna nula em core.produto, sem padrão (não reescreve a tabela), sem CHECK (texto vazio vindo do ERP
-- não derruba o produto; o consumidor do Core grava nulo para vazio), sem índice (só exibição, nunca filtro). RLS, grants e
-- índices de core.produto ficam como estão (a coluna herda o isolamento_tenant da tabela). Nada é apagado nem reescrito.
--
-- Caminho de volta: 0076_core_produto_marca_codigo.down.sql (apaga a coluna; os códigos gravados se perdem e voltam na
-- próxima carga do ERP). Volte antes o Core que lê/grava a coluna (senão 42703).

alter table core.produto add column marca_codigo varchar(30);
