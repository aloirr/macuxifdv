-- =====================================================================================================================
-- Macuxi FDV — kit do piloto (T-0162): esquema da ERP_PILOTO. Roda no banco ERP_PILOTO, quantas vezes precisar (idempotente).
-- Tabelas piloto_* = o "ERP" simulado, alimentado pelas planilhas. As views vw_macuxi_* seguem db/conector/views-modelo.sql
-- (mesmas colunas e regras; aqui os horários já estão em UTC, a variante "coluna do ERP já está em UTC" do modelo).
-- A entrada de pedidos vem de db/conector/entrada-pedido-modelo.sql (02-entrada-pedido.sql, gerado pelo montar-kit).
-- Colunas de controle em toda tabela piloto_*: ativo (S/N), alterado_em (UTC, o carregador atualiza) e linha_hash.
-- =====================================================================================================================
SET NOCOUNT ON;
GO

IF OBJECT_ID('dbo.piloto_filial', 'U') IS NULL
CREATE TABLE dbo.piloto_filial (
    codigo VARCHAR(20) NOT NULL PRIMARY KEY, nome VARCHAR(80) NOT NULL, cidade VARCHAR(80) NOT NULL, uf CHAR(2) NOT NULL,
    cnpj VARCHAR(18) NOT NULL, logradouro VARCHAR(160) NOT NULL, numero VARCHAR(20) NOT NULL, complemento VARCHAR(80) NULL,
    bairro VARCHAR(80) NOT NULL, cep VARCHAR(9) NOT NULL, telefone VARCHAR(30) NULL,
    ativo CHAR(1) NOT NULL DEFAULT 'S' CHECK (ativo IN ('S', 'N')), alterado_em DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(), linha_hash CHAR(64) NULL);

IF OBJECT_ID('dbo.piloto_vendedor', 'U') IS NULL
CREATE TABLE dbo.piloto_vendedor (
    codigo VARCHAR(20) NOT NULL PRIMARY KEY, nome VARCHAR(120) NOT NULL, email VARCHAR(160) NULL, telefone VARCHAR(30) NULL,
    ativo CHAR(1) NOT NULL DEFAULT 'S' CHECK (ativo IN ('S', 'N')), alterado_em DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(), linha_hash CHAR(64) NULL);

IF OBJECT_ID('dbo.piloto_forma_pagamento', 'U') IS NULL
CREATE TABLE dbo.piloto_forma_pagamento (
    codigo VARCHAR(20) NOT NULL PRIMARY KEY, nome VARCHAR(60) NOT NULL, ordem INT NULL,
    ativo CHAR(1) NOT NULL DEFAULT 'S' CHECK (ativo IN ('S', 'N')), alterado_em DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(), linha_hash CHAR(64) NULL);

IF OBJECT_ID('dbo.piloto_prazo_pagamento', 'U') IS NULL
CREATE TABLE dbo.piloto_prazo_pagamento (
    codigo VARCHAR(20) NOT NULL PRIMARY KEY, forma_codigo VARCHAR(20) NOT NULL, descricao VARCHAR(60) NULL,
    parcelas_dias VARCHAR(120) NOT NULL CHECK (parcelas_dias <> '' AND parcelas_dias NOT LIKE '%[^0-9,]%' AND parcelas_dias NOT LIKE '%,,%' AND parcelas_dias NOT LIKE ',%' AND parcelas_dias NOT LIKE '%,'), -- dias separados por vírgula: 30,60,90 (à vista = 0)
    prazo_medio_dias INT NULL, ordem INT NULL,
    ativo CHAR(1) NOT NULL DEFAULT 'S' CHECK (ativo IN ('S', 'N')), alterado_em DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(), linha_hash CHAR(64) NULL);

IF OBJECT_ID('dbo.piloto_produto', 'U') IS NULL
CREATE TABLE dbo.piloto_produto (
    codigo VARCHAR(40) NOT NULL PRIMARY KEY, sku VARCHAR(60) NOT NULL, ean VARCHAR(14) NULL, nome VARCHAR(200) NOT NULL,
    marca VARCHAR(80) NULL, categoria VARCHAR(80) NULL, unidade VARCHAR(6) NOT NULL, embalagem_medida VARCHAR(6) NULL,
    embalagem_quantidade INT NULL, custo DECIMAL(12, 2) NULL, preco_venda DECIMAL(12, 2) NOT NULL, desconto_maximo_pct DECIMAL(5, 2) NULL,
    aplicacao VARCHAR(1000) NULL,
    ativo CHAR(1) NOT NULL DEFAULT 'S' CHECK (ativo IN ('S', 'N')), alterado_em DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(), linha_hash CHAR(64) NULL);

IF OBJECT_ID('dbo.piloto_cliente', 'U') IS NULL
CREATE TABLE dbo.piloto_cliente (
    codigo VARCHAR(40) NOT NULL PRIMARY KEY, razao_social VARCHAR(160) NOT NULL, nome_fantasia VARCHAR(160) NULL,
    documento VARCHAR(18) NOT NULL, vendedor_codigo VARCHAR(20) NOT NULL, filial_codigo VARCHAR(20) NULL, tabela_preco_codigo VARCHAR(40) NULL,
    logradouro VARCHAR(160) NULL, numero VARCHAR(20) NULL, complemento VARCHAR(80) NULL, bairro VARCHAR(80) NULL,
    cidade VARCHAR(80) NULL, uf CHAR(2) NULL, cep VARCHAR(9) NULL, telefone VARCHAR(30) NULL, email VARCHAR(160) NULL,
    limite_credito DECIMAL(12, 2) NULL, inscricao_estadual VARCHAR(30) NULL, observacao VARCHAR(500) NULL,
    bloqueado CHAR(1) NOT NULL DEFAULT 'N' CHECK (bloqueado IN ('S', 'N')), canal VARCHAR(60) NULL,
    prazo_medio_max_dias INT NULL, formas_pagamento VARCHAR(400) NULL, -- códigos das formas separados por vírgula: PIX,BOLETO
    ativo CHAR(1) NOT NULL DEFAULT 'S' CHECK (ativo IN ('S', 'N')), alterado_em DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(), linha_hash CHAR(64) NULL);

IF OBJECT_ID('dbo.piloto_preco', 'U') IS NULL
CREATE TABLE dbo.piloto_preco (
    filial_codigo VARCHAR(20) NOT NULL, tabela_codigo VARCHAR(40) NOT NULL, produto_codigo VARCHAR(40) NOT NULL,
    vigencia_inicio DATE NOT NULL, vigencia_fim DATE NULL, tabela_nome VARCHAR(80) NOT NULL, preco DECIMAL(12, 2) NOT NULL, unidade VARCHAR(6) NULL,
    ativo CHAR(1) NOT NULL DEFAULT 'S' CHECK (ativo IN ('S', 'N')), alterado_em DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(), linha_hash CHAR(64) NULL,
    PRIMARY KEY (filial_codigo, tabela_codigo, produto_codigo, vigencia_inicio));

IF OBJECT_ID('dbo.piloto_estoque', 'U') IS NULL
CREATE TABLE dbo.piloto_estoque (
    deposito_codigo VARCHAR(20) NOT NULL, produto_codigo VARCHAR(40) NOT NULL, deposito_nome VARCHAR(80) NOT NULL,
    filial_codigo VARCHAR(20) NULL, saldo DECIMAL(14, 3) NOT NULL,
    ativo CHAR(1) NOT NULL DEFAULT 'S' CHECK (ativo IN ('S', 'N')), alterado_em DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(), linha_hash CHAR(64) NULL,
    PRIMARY KEY (deposito_codigo, produto_codigo));

IF OBJECT_ID('dbo.piloto_titulo', 'U') IS NULL
CREATE TABLE dbo.piloto_titulo (
    codigo VARCHAR(40) NOT NULL PRIMARY KEY, cliente_codigo VARCHAR(40) NOT NULL, numero VARCHAR(40) NOT NULL, parcela INT NOT NULL,
    emissao DATE NOT NULL, vencimento DATE NOT NULL, valor DECIMAL(12, 2) NOT NULL, saldo DECIMAL(12, 2) NOT NULL,
    cancelado CHAR(1) NOT NULL DEFAULT 'N' CHECK (cancelado IN ('S', 'N')), baixado_em DATE NULL,
    ativo CHAR(1) NOT NULL DEFAULT 'S' CHECK (ativo IN ('S', 'N')), alterado_em DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(), linha_hash CHAR(64) NULL);
GO

-- ---------------------------------------------------------------------------------------------------------------------
-- Views (saída ERP -> Macuxi). Colunas = campos do contrato; external_id = chave interna (código), nunca CNPJ/CPF.
-- ---------------------------------------------------------------------------------------------------------------------
CREATE OR ALTER VIEW dbo.vw_macuxi_vendedor AS
SELECT CAST(v.codigo AS VARCHAR(200)) AS external_id, v.alterado_em, CASE WHEN v.ativo = 'S' THEN 1 ELSE 0 END AS ativo,
       v.nome, v.email, v.telefone
FROM dbo.piloto_vendedor v;
GO

CREATE OR ALTER VIEW dbo.vw_macuxi_filial AS
SELECT CAST(f.codigo AS VARCHAR(200)) AS external_id, f.alterado_em, CASE WHEN f.ativo = 'S' THEN 1 ELSE 0 END AS ativo,
       f.codigo, f.nome, f.cidade, UPPER(f.uf) AS uf,
       REPLACE(REPLACE(REPLACE(f.cnpj, '.', ''), '/', ''), '-', '') AS cnpj,
       f.logradouro, f.numero, f.complemento, f.bairro, REPLACE(REPLACE(f.cep, '-', ''), '.', '') AS cep, f.telefone
FROM dbo.piloto_filial f;
GO

CREATE OR ALTER VIEW dbo.vw_macuxi_forma_pagamento AS
SELECT CAST(f.codigo AS VARCHAR(200)) AS external_id, f.alterado_em, CASE WHEN f.ativo = 'S' THEN 1 ELSE 0 END AS ativo,
       UPPER(f.codigo) AS codigo, f.nome, COALESCE(f.ordem, 0) AS ordem
FROM dbo.piloto_forma_pagamento f;
GO

CREATE OR ALTER VIEW dbo.vw_macuxi_prazo_pagamento AS
SELECT CAST(c.codigo AS VARCHAR(200)) AS external_id, c.alterado_em, CASE WHEN c.ativo = 'S' THEN 1 ELSE 0 END AS ativo,
       CAST(c.forma_codigo AS VARCHAR(200)) AS forma_external_id, UPPER(c.codigo) AS codigo, c.descricao,
       '[' + c.parcelas_dias + ']' AS parcelas_dias, c.prazo_medio_dias, COALESCE(c.ordem, 0) AS ordem
FROM dbo.piloto_prazo_pagamento c;
GO

CREATE OR ALTER VIEW dbo.vw_macuxi_produto AS
SELECT CAST(p.codigo AS VARCHAR(200)) AS external_id, p.alterado_em, CASE WHEN p.ativo = 'S' THEN 1 ELSE 0 END AS ativo,
       p.sku, p.ean, p.nome, p.marca, p.categoria, UPPER(p.unidade) AS unidade, UPPER(p.embalagem_medida) AS embalagem_medida,
       p.embalagem_quantidade, CAST(NULL AS VARCHAR(200)) AS catalogo_no_external_id,
       CAST(ROUND(p.custo * 100, 0) AS DECIMAL(19, 0)) AS custo_cents,
       CAST(ROUND(p.preco_venda * 100, 0) AS DECIMAL(19, 0)) AS preco_venda_cents,
       p.desconto_maximo_pct, p.aplicacao, '[]' AS referencias, '[]' AS oferece_junto, CAST(NULL AS VARCHAR(1)) AS etiquetas
FROM dbo.piloto_produto p;
GO

CREATE OR ALTER VIEW dbo.vw_macuxi_cliente AS
SELECT CAST(c.codigo AS VARCHAR(200)) AS external_id, c.alterado_em, CASE WHEN c.ativo = 'S' THEN 1 ELSE 0 END AS ativo,
       c.razao_social, c.nome_fantasia, c.documento, CAST(c.vendedor_codigo AS VARCHAR(200)) AS vendedor_external_id,
       CAST(c.tabela_preco_codigo AS VARCHAR(200)) AS tabela_preco_external_id, CAST(c.filial_codigo AS VARCHAR(200)) AS filial_external_id,
       c.logradouro AS endereco_logradouro, c.numero AS endereco_numero, c.complemento AS endereco_complemento,
       c.bairro AS endereco_bairro, c.cidade AS endereco_cidade, UPPER(c.uf) AS endereco_uf, c.cep AS endereco_cep,
       CAST(NULL AS DECIMAL(9, 6)) AS latitude, CAST(NULL AS DECIMAL(9, 6)) AS longitude, c.telefone, c.email,
       CAST(ROUND(c.limite_credito * 100, 0) AS DECIMAL(19, 0)) AS limite_credito_cents, c.inscricao_estadual, c.observacao,
       CASE WHEN c.bloqueado = 'S' THEN 1 ELSE 0 END AS bloqueado, NULLIF(LTRIM(RTRIM(c.canal)), '') AS canal,
       CAST(NULL AS VARCHAR(1)) AS contatos, COALESCE(c.prazo_medio_max_dias, 365) AS prazo_medio_max_dias,
       COALESCE((SELECT '[' + STRING_AGG('"' + STRING_ESCAPE(x.codigo, 'json') + '"', ',') WITHIN GROUP (ORDER BY x.codigo) + ']'
                   FROM (SELECT DISTINCT UPPER(LTRIM(RTRIM(s.value))) AS codigo FROM STRING_SPLIT(c.formas_pagamento, ',') s
                          WHERE LTRIM(RTRIM(s.value)) <> '') x), '[]') AS formas_pagamento
FROM dbo.piloto_cliente c;
GO

CREATE OR ALTER VIEW dbo.vw_macuxi_preco AS
SELECT CONCAT(i.filial_codigo, ':', i.tabela_codigo, ':', i.produto_codigo, ':', CONVERT(CHAR(8), i.vigencia_inicio, 112)) AS external_id,
       i.alterado_em, CASE WHEN i.ativo = 'S' THEN 1 ELSE 0 END AS ativo,
       CAST(i.tabela_codigo AS VARCHAR(200)) AS tabela_external_id, i.tabela_nome,
       CONVERT(CHAR(10), i.vigencia_inicio, 23) AS vigencia_inicio, CONVERT(CHAR(10), i.vigencia_fim, 23) AS vigencia_fim,
       CAST(i.produto_codigo AS VARCHAR(200)) AS produto_external_id, CAST(ROUND(i.preco * 100, 0) AS DECIMAL(19, 0)) AS preco_cents,
       UPPER(i.unidade) AS unidade, CAST(i.filial_codigo AS VARCHAR(200)) AS filial_external_id
FROM dbo.piloto_preco i;
GO

CREATE OR ALTER VIEW dbo.vw_macuxi_estoque AS
SELECT CONCAT(s.deposito_codigo, ':', s.produto_codigo) AS external_id, s.alterado_em, CASE WHEN s.ativo = 'S' THEN 1 ELSE 0 END AS ativo,
       CAST(s.deposito_codigo AS VARCHAR(200)) AS deposito_external_id, s.deposito_nome,
       CAST(s.produto_codigo AS VARCHAR(200)) AS produto_external_id, s.saldo, CAST(s.filial_codigo AS VARCHAR(200)) AS filial_external_id
FROM dbo.piloto_estoque s;
GO

CREATE OR ALTER VIEW dbo.vw_macuxi_titulo AS
SELECT CAST(t.codigo AS VARCHAR(200)) AS external_id, t.alterado_em, CASE WHEN t.ativo = 'S' THEN 1 ELSE 0 END AS ativo,
       CAST(t.cliente_codigo AS VARCHAR(200)) AS cliente_external_id, t.numero, t.parcela,
       CONVERT(CHAR(10), t.emissao, 23) AS emissao, CONVERT(CHAR(10), t.vencimento, 23) AS vencimento,
       CAST(ROUND(t.valor * 100, 0) AS DECIMAL(19, 0)) AS valor_cents, CAST(ROUND(t.saldo * 100, 0) AS DECIMAL(19, 0)) AS saldo_cents,
       CASE WHEN t.cancelado = 'S' THEN 'cancelado' WHEN t.saldo = 0 THEN 'baixado' ELSE 'aberto' END AS situacao,
       CAST(CAST(t.baixado_em AS DATETIME2(3)) AT TIME ZONE 'SA Western Standard Time' AT TIME ZONE 'UTC' AS DATETIME2(3)) AS baixado_em
FROM dbo.piloto_titulo t;
GO
