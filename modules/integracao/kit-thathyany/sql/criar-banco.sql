-- =====================================================================================================================
-- Macuxi FDV — kit da thathyany (T-0174): banco local ERP_THATHYANY para o SQL Server Express. GERADO por kit-thathyany/scripts/gerar.ts: não edite.
-- Roda quantas vezes precisar (idempotente). Cria o banco, as tabelas tha_* (as colunas são os campos do contrato canônico),
-- as views vw_macuxi_* que o Conector lê (mesmos nomes e colunas de db/conector/views-modelo.sql; os horários já estão em UTC, a variante
-- "coluna do ERP já está em UTC" do modelo), a entrada de pedidos (db/conector/entrada-pedido-modelo.sql) e as views do retorno do pedido.
-- Os usuários restritos vêm em sql/usuario-conector.sql e sql/usuario-api.sql (senha pedida na hora). Sem segredo e sem dado pessoal aqui.
-- =====================================================================================================================
SET NOCOUNT ON;
GO
IF DB_ID(N'ERP_THATHYANY') IS NULL CREATE DATABASE ERP_THATHYANY;
GO
USE ERP_THATHYANY;
GO
IF OBJECT_ID('dbo.tha_filial', 'U') IS NULL
CREATE TABLE dbo.tha_filial (
    external_id VARCHAR(200) NOT NULL,
    codigo NVARCHAR(20) NOT NULL,
    nome NVARCHAR(80) NOT NULL,
    alterado_em DATETIME2(3) NOT NULL,
    ativo TINYINT NOT NULL CONSTRAINT df_tha_filial_ativo DEFAULT 1,
    cidade NVARCHAR(80) NOT NULL,
    uf NVARCHAR(2) NOT NULL,
    cnpj NVARCHAR(18) NOT NULL,
    logradouro NVARCHAR(160) NOT NULL,
    numero NVARCHAR(20) NOT NULL,
    complemento NVARCHAR(80) NULL,
    bairro NVARCHAR(80) NOT NULL,
    cep NVARCHAR(9) NOT NULL,
    telefone NVARCHAR(30) NULL,
    linha_hash CHAR(64) NULL,
    CONSTRAINT pk_tha_filial PRIMARY KEY (external_id));
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_tha_filial_alterado' AND object_id = OBJECT_ID('dbo.tha_filial'))
CREATE INDEX ix_tha_filial_alterado ON dbo.tha_filial (alterado_em, external_id);
GO
IF OBJECT_ID('dbo.tha_vendedor', 'U') IS NULL
CREATE TABLE dbo.tha_vendedor (
    external_id VARCHAR(200) NOT NULL,
    nome NVARCHAR(120) NOT NULL,
    alterado_em DATETIME2(3) NOT NULL,
    ativo TINYINT NOT NULL CONSTRAINT df_tha_vendedor_ativo DEFAULT 1,
    email NVARCHAR(160) NULL,
    telefone NVARCHAR(30) NULL,
    filial_external_id NVARCHAR(200) NULL,
    linha_hash CHAR(64) NULL,
    CONSTRAINT pk_tha_vendedor PRIMARY KEY (external_id));
GO
IF COL_LENGTH('dbo.tha_vendedor', 'filial_external_id') IS NULL ALTER TABLE dbo.tha_vendedor ADD filial_external_id NVARCHAR(200) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_tha_vendedor_alterado' AND object_id = OBJECT_ID('dbo.tha_vendedor'))
CREATE INDEX ix_tha_vendedor_alterado ON dbo.tha_vendedor (alterado_em, external_id);
GO
IF OBJECT_ID('dbo.tha_catalogo_no', 'U') IS NULL
CREATE TABLE dbo.tha_catalogo_no (
    external_id VARCHAR(200) NOT NULL,
    codigo NVARCHAR(60) NOT NULL,
    nome NVARCHAR(120) NOT NULL,
    nivel INT NOT NULL,
    alterado_em DATETIME2(3) NOT NULL,
    ativo TINYINT NOT NULL CONSTRAINT df_tha_catalogo_no_ativo DEFAULT 1,
    pai_external_id NVARCHAR(200) NULL,
    ordem INT NULL,
    linha_hash CHAR(64) NULL,
    CONSTRAINT pk_tha_catalogo_no PRIMARY KEY (external_id));
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_tha_catalogo_no_alterado' AND object_id = OBJECT_ID('dbo.tha_catalogo_no'))
CREATE INDEX ix_tha_catalogo_no_alterado ON dbo.tha_catalogo_no (alterado_em, external_id);
GO
IF OBJECT_ID('dbo.tha_forma_pagamento', 'U') IS NULL
CREATE TABLE dbo.tha_forma_pagamento (
    external_id VARCHAR(200) NOT NULL,
    codigo NVARCHAR(20) NOT NULL,
    nome NVARCHAR(60) NOT NULL,
    alterado_em DATETIME2(3) NOT NULL,
    ativo TINYINT NOT NULL CONSTRAINT df_tha_forma_pagamento_ativo DEFAULT 1,
    ordem INT NULL,
    linha_hash CHAR(64) NULL,
    CONSTRAINT pk_tha_forma_pagamento PRIMARY KEY (external_id));
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_tha_forma_pagamento_alterado' AND object_id = OBJECT_ID('dbo.tha_forma_pagamento'))
CREATE INDEX ix_tha_forma_pagamento_alterado ON dbo.tha_forma_pagamento (alterado_em, external_id);
GO
IF OBJECT_ID('dbo.tha_prazo_pagamento', 'U') IS NULL
CREATE TABLE dbo.tha_prazo_pagamento (
    external_id VARCHAR(200) NOT NULL,
    forma_external_id NVARCHAR(200) NOT NULL,
    codigo NVARCHAR(20) NOT NULL,
    parcelas_dias NVARCHAR(MAX) NOT NULL,
    alterado_em DATETIME2(3) NOT NULL,
    ativo TINYINT NOT NULL CONSTRAINT df_tha_prazo_pagamento_ativo DEFAULT 1,
    descricao NVARCHAR(60) NULL,
    prazo_medio_dias INT NULL,
    percentual_ajuste DECIMAL(18, 6) NULL,
    ordem INT NULL,
    linha_hash CHAR(64) NULL,
    CONSTRAINT pk_tha_prazo_pagamento PRIMARY KEY (external_id));
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_tha_prazo_pagamento_alterado' AND object_id = OBJECT_ID('dbo.tha_prazo_pagamento'))
CREATE INDEX ix_tha_prazo_pagamento_alterado ON dbo.tha_prazo_pagamento (alterado_em, external_id);
GO
IF OBJECT_ID('dbo.tha_produto', 'U') IS NULL
CREATE TABLE dbo.tha_produto (
    external_id VARCHAR(200) NOT NULL,
    sku NVARCHAR(60) NOT NULL,
    nome NVARCHAR(200) NOT NULL,
    unidade NVARCHAR(10) NOT NULL,
    alterado_em DATETIME2(3) NOT NULL,
    ativo TINYINT NOT NULL CONSTRAINT df_tha_produto_ativo DEFAULT 1,
    ean NVARCHAR(200) NULL,
    marca NVARCHAR(80) NULL,
    marca_codigo NVARCHAR(30) NULL,
    categoria NVARCHAR(80) NULL,
    embalagem_medida NVARCHAR(10) NULL,
    embalagem_quantidade INT NULL,
    catalogo_no_external_id NVARCHAR(200) NULL,
    custo_cents DECIMAL(19, 0) NULL,
    preco_venda_cents DECIMAL(19, 0) NULL,
    desconto_maximo_pct DECIMAL(18, 6) NULL,
    aplicacao NVARCHAR(MAX) NULL,
    referencia_1 NVARCHAR(30) NULL,
    marca_referencia_codigo_1 NVARCHAR(200) NULL,
    marca_referencia_1 NVARCHAR(120) NULL,
    referencia_2 NVARCHAR(30) NULL,
    marca_referencia_codigo_2 NVARCHAR(200) NULL,
    marca_referencia_2 NVARCHAR(120) NULL,
    referencia_3 NVARCHAR(30) NULL,
    marca_referencia_codigo_3 NVARCHAR(200) NULL,
    marca_referencia_3 NVARCHAR(120) NULL,
    oferece_junto NVARCHAR(MAX) NULL,
    etiquetas NVARCHAR(MAX) NULL,
    linha_hash CHAR(64) NULL,
    CONSTRAINT pk_tha_produto PRIMARY KEY (external_id));
GO
IF COL_LENGTH('dbo.tha_produto', 'marca_codigo') IS NULL ALTER TABLE dbo.tha_produto ADD marca_codigo NVARCHAR(30) NULL;
GO
IF COL_LENGTH('dbo.tha_produto', 'referencia_1') IS NULL ALTER TABLE dbo.tha_produto ADD referencia_1 NVARCHAR(30) NULL;
GO
IF COL_LENGTH('dbo.tha_produto', 'marca_referencia_codigo_1') IS NULL ALTER TABLE dbo.tha_produto ADD marca_referencia_codigo_1 NVARCHAR(200) NULL;
GO
IF COL_LENGTH('dbo.tha_produto', 'marca_referencia_1') IS NULL ALTER TABLE dbo.tha_produto ADD marca_referencia_1 NVARCHAR(120) NULL;
GO
IF COL_LENGTH('dbo.tha_produto', 'referencia_2') IS NULL ALTER TABLE dbo.tha_produto ADD referencia_2 NVARCHAR(30) NULL;
GO
IF COL_LENGTH('dbo.tha_produto', 'marca_referencia_codigo_2') IS NULL ALTER TABLE dbo.tha_produto ADD marca_referencia_codigo_2 NVARCHAR(200) NULL;
GO
IF COL_LENGTH('dbo.tha_produto', 'marca_referencia_2') IS NULL ALTER TABLE dbo.tha_produto ADD marca_referencia_2 NVARCHAR(120) NULL;
GO
IF COL_LENGTH('dbo.tha_produto', 'referencia_3') IS NULL ALTER TABLE dbo.tha_produto ADD referencia_3 NVARCHAR(30) NULL;
GO
IF COL_LENGTH('dbo.tha_produto', 'marca_referencia_codigo_3') IS NULL ALTER TABLE dbo.tha_produto ADD marca_referencia_codigo_3 NVARCHAR(200) NULL;
GO
IF COL_LENGTH('dbo.tha_produto', 'marca_referencia_3') IS NULL ALTER TABLE dbo.tha_produto ADD marca_referencia_3 NVARCHAR(120) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_tha_produto_alterado' AND object_id = OBJECT_ID('dbo.tha_produto'))
CREATE INDEX ix_tha_produto_alterado ON dbo.tha_produto (alterado_em, external_id);
GO
IF OBJECT_ID('dbo.tha_produto_unidade', 'U') IS NULL
CREATE TABLE dbo.tha_produto_unidade (
    external_id VARCHAR(200) NOT NULL,
    produto_external_id NVARCHAR(200) NOT NULL,
    unidade NVARCHAR(200) NOT NULL,
    fator INT NOT NULL,
    alterado_em DATETIME2(3) NOT NULL,
    ativo TINYINT NOT NULL CONSTRAINT df_tha_produto_unidade_ativo DEFAULT 1,
    ean NVARCHAR(200) NULL,
    padrao TINYINT NULL,
    linha_hash CHAR(64) NULL,
    CONSTRAINT pk_tha_produto_unidade PRIMARY KEY (external_id));
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_tha_produto_unidade_alterado' AND object_id = OBJECT_ID('dbo.tha_produto_unidade'))
CREATE INDEX ix_tha_produto_unidade_alterado ON dbo.tha_produto_unidade (alterado_em, external_id);
GO
IF OBJECT_ID('dbo.tha_preco', 'U') IS NULL
CREATE TABLE dbo.tha_preco (
    external_id VARCHAR(200) NOT NULL,
    tabela_external_id NVARCHAR(200) NOT NULL,
    tabela_nome NVARCHAR(120) NOT NULL,
    vigencia_inicio DATE NOT NULL,
    produto_external_id NVARCHAR(200) NOT NULL,
    preco_cents DECIMAL(19, 0) NOT NULL,
    alterado_em DATETIME2(3) NOT NULL,
    ativo TINYINT NOT NULL CONSTRAINT df_tha_preco_ativo DEFAULT 1,
    vigencia_fim DATE NULL,
    unidade NVARCHAR(6) NULL,
    filial_external_id NVARCHAR(200) NULL,
    linha_hash CHAR(64) NULL,
    CONSTRAINT pk_tha_preco PRIMARY KEY (external_id));
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_tha_preco_alterado' AND object_id = OBJECT_ID('dbo.tha_preco'))
CREATE INDEX ix_tha_preco_alterado ON dbo.tha_preco (alterado_em, external_id);
GO
IF OBJECT_ID('dbo.tha_tabela_escalonada', 'U') IS NULL
CREATE TABLE dbo.tha_tabela_escalonada (
    external_id VARCHAR(200) NOT NULL,
    produto_external_id NVARCHAR(200) NOT NULL,
    quantidade_minima INT NOT NULL,
    preco_unidade_cents DECIMAL(19, 0) NOT NULL,
    vigencia_inicio DATE NOT NULL,
    alterado_em DATETIME2(3) NOT NULL,
    ativo TINYINT NOT NULL CONSTRAINT df_tha_tabela_escalonada_ativo DEFAULT 1,
    medida NVARCHAR(200) NULL,
    vigencia_fim DATE NULL,
    tabela_external_id NVARCHAR(200) NULL,
    filial_external_id NVARCHAR(200) NULL,
    linha_hash CHAR(64) NULL,
    CONSTRAINT pk_tha_tabela_escalonada PRIMARY KEY (external_id));
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_tha_tabela_escalonada_alterado' AND object_id = OBJECT_ID('dbo.tha_tabela_escalonada'))
CREATE INDEX ix_tha_tabela_escalonada_alterado ON dbo.tha_tabela_escalonada (alterado_em, external_id);
GO
IF OBJECT_ID('dbo.tha_estoque', 'U') IS NULL
CREATE TABLE dbo.tha_estoque (
    external_id VARCHAR(200) NOT NULL,
    deposito_external_id NVARCHAR(200) NOT NULL,
    produto_external_id NVARCHAR(200) NOT NULL,
    saldo DECIMAL(18, 6) NOT NULL,
    alterado_em DATETIME2(3) NOT NULL,
    ativo TINYINT NOT NULL CONSTRAINT df_tha_estoque_ativo DEFAULT 1,
    deposito_nome NVARCHAR(120) NULL,
    filial_external_id NVARCHAR(200) NULL,
    linha_hash CHAR(64) NULL,
    CONSTRAINT pk_tha_estoque PRIMARY KEY (external_id));
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_tha_estoque_alterado' AND object_id = OBJECT_ID('dbo.tha_estoque'))
CREATE INDEX ix_tha_estoque_alterado ON dbo.tha_estoque (alterado_em, external_id);
GO
IF OBJECT_ID('dbo.tha_cliente', 'U') IS NULL
CREATE TABLE dbo.tha_cliente (
    external_id VARCHAR(200) NOT NULL,
    razao_social NVARCHAR(160) NOT NULL,
    alterado_em DATETIME2(3) NOT NULL,
    ativo TINYINT NOT NULL CONSTRAINT df_tha_cliente_ativo DEFAULT 1,
    nome_fantasia NVARCHAR(160) NULL,
    documento NVARCHAR(18) NULL,
    vendedor_external_id NVARCHAR(200) NULL,
    endereco_logradouro NVARCHAR(160) NULL,
    endereco_numero NVARCHAR(20) NULL,
    endereco_complemento NVARCHAR(80) NULL,
    endereco_bairro NVARCHAR(80) NULL,
    endereco_cidade NVARCHAR(80) NULL,
    endereco_uf NVARCHAR(2) NULL,
    endereco_cep NVARCHAR(9) NULL,
    latitude DECIMAL(18, 6) NULL,
    longitude DECIMAL(18, 6) NULL,
    telefone NVARCHAR(30) NULL,
    email NVARCHAR(160) NULL,
    limite_credito_cents DECIMAL(19, 0) NULL,
    inscricao_estadual NVARCHAR(20) NULL,
    observacao NVARCHAR(1000) NULL,
    bloqueado TINYINT NULL,
    canal NVARCHAR(60) NULL,
    prazo_medio_max_dias INT NULL,
    formas_pagamento NVARCHAR(MAX) NULL,
    tabela_preco_external_id NVARCHAR(200) NULL,
    filial_external_id NVARCHAR(200) NULL,
    contatos NVARCHAR(MAX) NULL,
    linha_hash CHAR(64) NULL,
    CONSTRAINT pk_tha_cliente PRIMARY KEY (external_id));
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_tha_cliente_alterado' AND object_id = OBJECT_ID('dbo.tha_cliente'))
CREATE INDEX ix_tha_cliente_alterado ON dbo.tha_cliente (alterado_em, external_id);
GO
IF OBJECT_ID('dbo.tha_cliente_endereco', 'U') IS NULL
CREATE TABLE dbo.tha_cliente_endereco (
    external_id VARCHAR(200) NOT NULL,
    cliente_external_id NVARCHAR(200) NOT NULL,
    logradouro NVARCHAR(160) NOT NULL,
    cidade NVARCHAR(80) NOT NULL,
    uf NVARCHAR(2) NOT NULL,
    alterado_em DATETIME2(3) NOT NULL,
    ativo TINYINT NOT NULL CONSTRAINT df_tha_cliente_endereco_ativo DEFAULT 1,
    tipo NVARCHAR(40) NULL,
    descricao NVARCHAR(80) NULL,
    numero NVARCHAR(20) NULL,
    complemento NVARCHAR(80) NULL,
    bairro NVARCHAR(80) NULL,
    cep NVARCHAR(9) NULL,
    latitude DECIMAL(18, 6) NULL,
    longitude DECIMAL(18, 6) NULL,
    principal TINYINT NULL,
    linha_hash CHAR(64) NULL,
    CONSTRAINT pk_tha_cliente_endereco PRIMARY KEY (external_id));
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_tha_cliente_endereco_alterado' AND object_id = OBJECT_ID('dbo.tha_cliente_endereco'))
CREATE INDEX ix_tha_cliente_endereco_alterado ON dbo.tha_cliente_endereco (alterado_em, external_id);
GO
IF OBJECT_ID('dbo.tha_transportadora', 'U') IS NULL
CREATE TABLE dbo.tha_transportadora (
    external_id VARCHAR(200) NOT NULL,
    nome NVARCHAR(120) NOT NULL,
    alterado_em DATETIME2(3) NOT NULL,
    ativo TINYINT NOT NULL CONSTRAINT df_tha_transportadora_ativo DEFAULT 1,
    documento NVARCHAR(200) NULL,
    inscricao_estadual NVARCHAR(20) NULL,
    telefone NVARCHAR(30) NULL,
    linha_hash CHAR(64) NULL,
    CONSTRAINT pk_tha_transportadora PRIMARY KEY (external_id));
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_tha_transportadora_alterado' AND object_id = OBJECT_ID('dbo.tha_transportadora'))
CREATE INDEX ix_tha_transportadora_alterado ON dbo.tha_transportadora (alterado_em, external_id);
GO
IF OBJECT_ID('dbo.tha_rota', 'U') IS NULL
CREATE TABLE dbo.tha_rota (
    external_id VARCHAR(200) NOT NULL,
    nome NVARCHAR(120) NOT NULL,
    vendedor_external_id NVARCHAR(200) NOT NULL,
    alterado_em DATETIME2(3) NOT NULL,
    ativo TINYINT NOT NULL CONSTRAINT df_tha_rota_ativo DEFAULT 1,
    dia_semana INT NULL,
    paradas NVARCHAR(MAX) NULL,
    linha_hash CHAR(64) NULL,
    CONSTRAINT pk_tha_rota PRIMARY KEY (external_id));
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_tha_rota_alterado' AND object_id = OBJECT_ID('dbo.tha_rota'))
CREATE INDEX ix_tha_rota_alterado ON dbo.tha_rota (alterado_em, external_id);
GO
IF OBJECT_ID('dbo.tha_titulo', 'U') IS NULL
CREATE TABLE dbo.tha_titulo (
    external_id VARCHAR(200) NOT NULL,
    cliente_external_id NVARCHAR(200) NOT NULL,
    numero NVARCHAR(40) NOT NULL,
    vencimento DATE NOT NULL,
    valor_cents DECIMAL(19, 0) NOT NULL,
    saldo_cents DECIMAL(19, 0) NOT NULL,
    situacao NVARCHAR(40) NOT NULL,
    alterado_em DATETIME2(3) NOT NULL,
    ativo TINYINT NOT NULL CONSTRAINT df_tha_titulo_ativo DEFAULT 1,
    parcela INT NULL,
    emissao DATE NULL,
    baixado_em DATETIME2(3) NULL,
    nf_numero NVARCHAR(40) NULL,
    nf_serie NVARCHAR(10) NULL,
    forma_pagamento_codigo NVARCHAR(20) NULL,
    linha_hash CHAR(64) NULL,
    CONSTRAINT pk_tha_titulo PRIMARY KEY (external_id));
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_tha_titulo_alterado' AND object_id = OBJECT_ID('dbo.tha_titulo'))
CREATE INDEX ix_tha_titulo_alterado ON dbo.tha_titulo (alterado_em, external_id);
GO
IF OBJECT_ID('dbo.tha_nota', 'U') IS NULL
CREATE TABLE dbo.tha_nota (
    external_id VARCHAR(200) NOT NULL,
    cliente_external_id NVARCHAR(200) NOT NULL,
    tipo NVARCHAR(40) NOT NULL,
    numero NVARCHAR(40) NOT NULL,
    emitida_em DATETIME2(3) NOT NULL,
    total_cents DECIMAL(19, 0) NOT NULL,
    alterado_em DATETIME2(3) NOT NULL,
    ativo TINYINT NOT NULL CONSTRAINT df_tha_nota_ativo DEFAULT 1,
    vendedor_external_id NVARCHAR(200) NULL,
    serie NVARCHAR(10) NULL,
    quantidade_itens INT NULL,
    pedido_uuid NVARCHAR(200) NULL,
    cancelada TINYINT NULL,
    forma_pagamento_codigo NVARCHAR(20) NULL,
    nf_origem_numero NVARCHAR(40) NULL,
    nf_origem_serie NVARCHAR(10) NULL,
    linha_hash CHAR(64) NULL,
    CONSTRAINT pk_tha_nota PRIMARY KEY (external_id));
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_tha_nota_alterado' AND object_id = OBJECT_ID('dbo.tha_nota'))
CREATE INDEX ix_tha_nota_alterado ON dbo.tha_nota (alterado_em, external_id);
GO
-- ----- views que o Conector lê (uma por entidade, na ordem de carga) -----
CREATE OR ALTER VIEW dbo.vw_macuxi_filial AS
SELECT external_id, alterado_em, ativo, codigo, nome, cidade, uf, cnpj, logradouro, numero, complemento, bairro, cep, telefone
FROM dbo.tha_filial;
GO
CREATE OR ALTER VIEW dbo.vw_macuxi_vendedor AS
SELECT external_id, alterado_em, ativo, nome, email, telefone, filial_external_id
FROM dbo.tha_vendedor;
GO
CREATE OR ALTER VIEW dbo.vw_macuxi_catalogo_no AS
SELECT external_id, alterado_em, ativo, codigo, nome, pai_external_id, nivel, ordem
FROM dbo.tha_catalogo_no;
GO
CREATE OR ALTER VIEW dbo.vw_macuxi_forma_pagamento AS
SELECT external_id, alterado_em, ativo, codigo, nome, ordem
FROM dbo.tha_forma_pagamento;
GO
CREATE OR ALTER VIEW dbo.vw_macuxi_prazo_pagamento AS
SELECT external_id, forma_external_id, codigo, parcelas_dias, alterado_em, ativo, descricao, prazo_medio_dias, percentual_ajuste, ordem
FROM dbo.tha_prazo_pagamento;
GO
CREATE OR ALTER VIEW dbo.vw_macuxi_produto AS
SELECT external_id, alterado_em, ativo, sku, ean, nome, marca, marca_codigo, categoria, unidade, embalagem_medida, embalagem_quantidade, catalogo_no_external_id, custo_cents, preco_venda_cents, desconto_maximo_pct, aplicacao, CASE WHEN referencia_1 IS NULL AND referencia_2 IS NULL AND referencia_3 IS NULL THEN NULL ELSE (SELECT r.marca_external_id, r.marca_nome, r.codigo FROM (VALUES (marca_referencia_codigo_1, marca_referencia_1, referencia_1), (marca_referencia_codigo_2, marca_referencia_2, referencia_2), (marca_referencia_codigo_3, marca_referencia_3, referencia_3)) AS r(marca_external_id, marca_nome, codigo) WHERE r.codigo IS NOT NULL FOR JSON PATH) END AS referencias, oferece_junto, etiquetas
FROM dbo.tha_produto;
GO
CREATE OR ALTER VIEW dbo.vw_macuxi_produto_unidade AS
SELECT external_id, alterado_em, ativo, produto_external_id, unidade, fator, ean, padrao
FROM dbo.tha_produto_unidade;
GO
CREATE OR ALTER VIEW dbo.vw_macuxi_preco AS
SELECT external_id, alterado_em, ativo, tabela_external_id, tabela_nome, CONVERT(CHAR(10), vigencia_inicio, 23) AS vigencia_inicio, CONVERT(CHAR(10), vigencia_fim, 23) AS vigencia_fim, produto_external_id, preco_cents, unidade, filial_external_id
FROM dbo.tha_preco;
GO
CREATE OR ALTER VIEW dbo.vw_macuxi_tabela_escalonada AS
SELECT external_id, alterado_em, ativo, produto_external_id, medida, quantidade_minima, preco_unidade_cents, CONVERT(CHAR(10), vigencia_inicio, 23) AS vigencia_inicio, CONVERT(CHAR(10), vigencia_fim, 23) AS vigencia_fim, tabela_external_id, filial_external_id
FROM dbo.tha_tabela_escalonada;
GO
CREATE OR ALTER VIEW dbo.vw_macuxi_estoque AS
SELECT external_id, alterado_em, ativo, deposito_external_id, deposito_nome, produto_external_id, saldo, filial_external_id
FROM dbo.tha_estoque;
GO
CREATE OR ALTER VIEW dbo.vw_macuxi_cliente AS
SELECT external_id, alterado_em, ativo, razao_social, nome_fantasia, documento, vendedor_external_id, endereco_logradouro, endereco_numero, endereco_complemento, endereco_bairro, endereco_cidade, endereco_uf, endereco_cep, latitude, longitude, telefone, email, limite_credito_cents, inscricao_estadual, observacao, bloqueado, contatos, prazo_medio_max_dias, formas_pagamento, tabela_preco_external_id, canal, filial_external_id
FROM dbo.tha_cliente;
GO
CREATE OR ALTER VIEW dbo.vw_macuxi_cliente_endereco AS
SELECT external_id, alterado_em, ativo, cliente_external_id, tipo, descricao, logradouro, numero, complemento, bairro, cidade, uf, cep, latitude, longitude, principal
FROM dbo.tha_cliente_endereco;
GO
CREATE OR ALTER VIEW dbo.vw_macuxi_transportadora AS
SELECT external_id, alterado_em, ativo, nome, documento, inscricao_estadual, telefone
FROM dbo.tha_transportadora;
GO
CREATE OR ALTER VIEW dbo.vw_macuxi_rota AS
SELECT external_id, alterado_em, ativo, nome, vendedor_external_id, dia_semana, paradas
FROM dbo.tha_rota;
GO
CREATE OR ALTER VIEW dbo.vw_macuxi_titulo AS
SELECT external_id, alterado_em, ativo, cliente_external_id, numero, parcela, CONVERT(CHAR(10), emissao, 23) AS emissao, CONVERT(CHAR(10), vencimento, 23) AS vencimento, valor_cents, saldo_cents, situacao, baixado_em
FROM dbo.tha_titulo;
GO
CREATE OR ALTER VIEW dbo.vw_macuxi_nota AS
SELECT external_id, alterado_em, ativo, cliente_external_id, vendedor_external_id, tipo, numero, serie, emitida_em, total_cents, quantidade_itens, pedido_uuid, cancelada
FROM dbo.tha_nota;
GO
-- ----- entrada de pedidos (Macuxi -> ERP): db/conector/entrada-pedido-modelo.sql -----
-- =====================================================================================================================
-- Macuxi FDV — MODELO da entrada de pedidos no ERP (Macuxi -> Conector -> ERP)
-- Dono: banco-dados. Par de db/conector/views-modelo.sql (as views são a saída ERP -> Macuxi). Guia:
-- docs/modulos/integracao/conector.md; dicionário: docs/banco/integracao.md ("Entrada de pedidos do Conector").
--
-- O QUE É ESTE ARQUIVO
--   Um MODELO para o ERP que NÃO tem API/procedure própria de pedido: uma tabela de entrada (cabeçalho e itens) e as duas
--   procedures que o conector.exemplo.json chama em "pedidos.gravacao" (EXEC dbo.sp_macuxi_pedido_inserir ... e
--   EXEC dbo.sp_macuxi_pedido_item_inserir ...). O técnico do cliente adapta nomes e tipos e liga a tabela à rotina de
--   importação do ERP. O usuário do Conector tem EXECUTE nas duas procedures e SELECT na tabela (consulta numeroErp) e
--   NADA além disso no ERP (docs/seguranca/termo-dado-erp.md).
--   Corpo em SQL Server (2017+); o Oracle (12.2+) vem comentado com "-- [Oracle]" onde diverge.
--
-- REGRAS
--   1. pedido_uuid (UUID do Macuxi) é ÚNICO: o Conector repete a gravação depois de queda (escrita idempotente); a procedure
--      não duplica (IF NOT EXISTS) e a consulta numeroErp devolve o número já gravado.
--   2. Dinheiro em CENTAVOS inteiros (DECIMAL(19,0)); a importação do ERP divide por 100.
--   3. Instantes (criado_em, aprovado_em) chegam em UTC; converta para a hora local do ERP na importação, se for o caso.
--   4. T-0149 (RN-CORE-39, ADR 0040; Conector 1.4.0): FILIAL do pedido = a filial do cliente no Macuxi no recebimento.
--      filial_codigo = código da filial no Macuxi (o mesmo da coluna codigo da vw_macuxi_filial); filial_external_id = a
--      chave dela no ERP (external_id da vw_macuxi_filial; NULO quando a filial não veio do ERP). Os DOIS NULOS = filial
--      PADRÃO do ERP (pedido da filial padrão ou de Conector anterior ao 1.4.0). Pedido de filial NÃO padrão só sai do
--      Hub para Conector 1.4.0+ (o 1.3.x gravaria na padrão sem avisar).
--      Na importação: use filial_external_id quando houver; senão o filial_codigo; os dois nulos = a filial padrão.
--   5. T-0149 (Conector 1.4.0; R-20261110-104924): FRETE (RN-VEN-16), ENDEREÇO DE ENTREGA (RN-VEN-17) e PAGAMENTO (RN-VEN-24)
--      no cabeçalho, todos NULOS quando o pedido não os traz (pedido antigo ou Conector anterior ao 1.4.0; o ERP usa o
--      cadastro do cliente). Parâmetros com padrão NULL: o EXEC de um Conector antigo continua válido.
--      - frete_modalidade CIF|FOB. Transportadora só no FOB: frete_transportadora_tipo 'cadastrada' = use
--        frete_transportadora_external_id (chave da vw_macuxi_transportadora; frete_transportadora_id é o UUID do Macuxi, para
--        rastreio); 'digitada' = só nome/CNPJ/telefone (sem id nem external_id: cadastre ou use como texto no ERP).
--      - entrega_origem erp|editado. entrega_external_id preenchido = endereço do cadastro do ERP (vw_macuxi_cliente_endereco);
--        NULO = a importação usa os campos de texto (logradouro..cep; o 'editado' vem só em texto).
--        entrega_principal 1 = é o endereço principal do cliente.
--      - pagamento_forma_* / pagamento_prazo_*: código no Macuxi e chave no ERP (use o external_id quando houver);
--        pagamento_parcelas_dias = dias das parcelas separados por vírgula ('30,60,90'); pagamento_prazo_medio_dias inteiro.
--      - pagamento_percentual_ajuste (v1.0.14, Conector 1.5.0; RN-INT-15): % do prazo no pedido, SÓ INFORMATIVO. Preço e
--        total dos itens e do pedido JÁ VÊM AJUSTADOS: a importação NÃO reaplica o "% Acres.Fin." (dupla aplicação).
-- =====================================================================================================================


-- ---------------------------------------------------------------------------------------------------------------------
-- Cabeçalho
-- ---------------------------------------------------------------------------------------------------------------------
IF OBJECT_ID('dbo.macuxi_pedido_entrada', 'U') IS NULL
CREATE TABLE dbo.macuxi_pedido_entrada (
    numero_pedido         INT IDENTITY(1, 1) PRIMARY KEY,   -- [Oracle] NUMBER GENERATED ALWAYS AS IDENTITY
    pedido_uuid           UNIQUEIDENTIFIER NOT NULL UNIQUE,  -- [Oracle] VARCHAR2(36) NOT NULL UNIQUE
    cliente               VARCHAR(200) NOT NULL,             -- cliente_external_id (vw_macuxi_cliente.external_id)
    vendedor              VARCHAR(200) NOT NULL,             -- vendedor_external_id
    condicao              VARCHAR(200) NULL,                 -- condicao_pagamento_erp (de-para do Hub)
    criado_em             DATETIME2(3) NOT NULL,             -- UTC
    aprovado_em           DATETIME2(3) NOT NULL,             -- UTC
    observacao            VARCHAR(1000) NULL,
    desconto_total_cents  DECIMAL(19, 0) NOT NULL,
    total_cents           DECIMAL(19, 0) NOT NULL,
    filial_codigo         VARCHAR(20) NULL,                  -- T-0149: NULO (com filial_external_id) = filial padrão do ERP
    filial_external_id    VARCHAR(200) NULL,                 -- T-0149: chave da filial no ERP; NULO = usar filial_codigo
    -- T-0149 (Conector 1.4.0; regra 5): frete, entrega e pagamento. Todos NULOS = pedido sem o dado (o ERP usa o cadastro)
    frete_modalidade                  VARCHAR(3) NULL,       -- CIF | FOB
    frete_transportadora_tipo         VARCHAR(10) NULL,      -- cadastrada | digitada (só no FOB)
    frete_transportadora_id           VARCHAR(36) NULL,      -- UUID do Macuxi (cadastrada)
    frete_transportadora_external_id  VARCHAR(200) NULL,     -- chave no ERP (cadastrada)
    frete_transportadora_nome         VARCHAR(120) NULL,
    frete_transportadora_cnpj         VARCHAR(14) NULL,      -- só dígitos
    frete_transportadora_telefone     VARCHAR(30) NULL,
    entrega_origem                    VARCHAR(7) NULL,       -- erp | editado
    entrega_external_id               VARCHAR(200) NULL,     -- NULO = a importação usa os campos de texto abaixo
    entrega_logradouro                VARCHAR(160) NULL,
    entrega_numero                    VARCHAR(20) NULL,
    entrega_complemento               VARCHAR(80) NULL,
    entrega_bairro                    VARCHAR(80) NULL,
    entrega_cidade                    VARCHAR(80) NULL,
    entrega_uf                        VARCHAR(2) NULL,
    entrega_cep                       VARCHAR(9) NULL,
    entrega_principal                 BIT NULL,              -- [Oracle] NUMBER(1) NULL; 1 = endereço principal do cliente
    pagamento_forma_codigo            VARCHAR(20) NULL,
    pagamento_forma_external_id       VARCHAR(200) NULL,
    pagamento_prazo_codigo            VARCHAR(20) NULL,
    pagamento_prazo_external_id       VARCHAR(200) NULL,
    pagamento_parcelas_dias           VARCHAR(120) NULL,     -- '30,60,90'
    pagamento_prazo_medio_dias        INT NULL,              -- [Oracle] NUMBER(5) NULL
    pagamento_percentual_ajuste       DECIMAL(5, 2) NULL,    -- [Oracle] NUMBER(5,2) NULL; informativo, não reaplicar
    situacao              CHAR(1) NOT NULL DEFAULT 'I',      -- I integrado, R rejeitado, P faturado parcial, F faturado, C cancelado
    motivo                VARCHAR(300) NULL,                 -- motivo da rejeição/cancelamento (vai ao Macuxi)
    recebido_em           DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME() -- [Oracle] TIMESTAMP(3) DEFAULT SYS_EXTRACT_UTC(SYSTIMESTAMP)
);

-- ---------------------------------------------------------------------------------------------------------------------
-- Itens
-- ---------------------------------------------------------------------------------------------------------------------
IF OBJECT_ID('dbo.macuxi_pedido_entrada_item', 'U') IS NULL
CREATE TABLE dbo.macuxi_pedido_entrada_item (
    pedido_uuid           UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.macuxi_pedido_entrada (pedido_uuid),
    sequencia             INT NOT NULL,                      -- 1..n, na ordem do pedido
    produto               VARCHAR(200) NOT NULL,             -- produto_external_id
    quantidade            DECIMAL(14, 3) NOT NULL,           -- na unidade base
    preco_unitario_cents  DECIMAL(19, 0) NOT NULL,
    desconto_cents        DECIMAL(19, 0) NOT NULL,
    total_cents           DECIMAL(19, 0) NOT NULL,
    PRIMARY KEY (pedido_uuid, sequencia)
);
GO

-- ---------------------------------------------------------------------------------------------------------------------
-- Procedures chamadas pelo conector.exemplo.json ("pedidos.gravacao.cabecalho" e "itens"). Idempotentes.
-- [Oracle] CREATE OR REPLACE PROCEDURE sp_macuxi_pedido_inserir(p_pedido_uuid IN VARCHAR2, ..., p_filial_codigo IN VARCHAR2,
--          p_filial_external_id IN VARCHAR2, p_frete_modalidade IN VARCHAR2 DEFAULT NULL, ..., p_pagamento_prazo_medio_dias IN
--          NUMBER DEFAULT NULL, p_pagamento_percentual_ajuste IN NUMBER DEFAULT NULL) IS BEGIN INSERT INTO macuxi_pedido_entrada (...) SELECT ... FROM dual WHERE NOT
--          EXISTS (SELECT 1 FROM macuxi_pedido_entrada WHERE pedido_uuid = p_pedido_uuid); END; — e no conector.oracle.json
--          "BEGIN sp_macuxi_pedido_inserir(:pedido_uuid, ..., :filial_codigo, :filial_external_id, :frete_modalidade, ...); END;"
--          (ou o INSERT ... SELECT direto na tabela, como faz o conector.oracle.exemplo.json).
-- ---------------------------------------------------------------------------------------------------------------------
CREATE OR ALTER PROCEDURE dbo.sp_macuxi_pedido_inserir
    @pedido_uuid UNIQUEIDENTIFIER, @cliente VARCHAR(200), @vendedor VARCHAR(200), @condicao VARCHAR(200),
    @criado_em DATETIME2(3), @aprovado_em DATETIME2(3), @observacao VARCHAR(1000),
    @desconto_total_cents DECIMAL(19, 0), @total_cents DECIMAL(19, 0),
    @filial_codigo VARCHAR(20) = NULL, @filial_external_id VARCHAR(200) = NULL,  -- T-0149 (Conector 1.4.0); padrão NULL = filial padrão
    -- T-0149 (Conector 1.4.0; regra 5): frete, entrega e pagamento; padrão NULL = o EXEC de Conector antigo continua válido
    @frete_modalidade VARCHAR(3) = NULL, @frete_transportadora_tipo VARCHAR(10) = NULL, @frete_transportadora_id VARCHAR(36) = NULL,
    @frete_transportadora_external_id VARCHAR(200) = NULL, @frete_transportadora_nome VARCHAR(120) = NULL,
    @frete_transportadora_cnpj VARCHAR(14) = NULL, @frete_transportadora_telefone VARCHAR(30) = NULL,
    @entrega_origem VARCHAR(7) = NULL, @entrega_external_id VARCHAR(200) = NULL, @entrega_logradouro VARCHAR(160) = NULL,
    @entrega_numero VARCHAR(20) = NULL, @entrega_complemento VARCHAR(80) = NULL, @entrega_bairro VARCHAR(80) = NULL,
    @entrega_cidade VARCHAR(80) = NULL, @entrega_uf VARCHAR(2) = NULL, @entrega_cep VARCHAR(9) = NULL, @entrega_principal BIT = NULL,
    @pagamento_forma_codigo VARCHAR(20) = NULL, @pagamento_forma_external_id VARCHAR(200) = NULL,
    @pagamento_prazo_codigo VARCHAR(20) = NULL, @pagamento_prazo_external_id VARCHAR(200) = NULL,
    @pagamento_parcelas_dias VARCHAR(120) = NULL, @pagamento_prazo_medio_dias INT = NULL,
    @pagamento_percentual_ajuste DECIMAL(5, 2) = NULL  -- v1.0.14 (Conector 1.5.0); informativo
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM dbo.macuxi_pedido_entrada WHERE pedido_uuid = @pedido_uuid)
        INSERT INTO dbo.macuxi_pedido_entrada
            (pedido_uuid, cliente, vendedor, condicao, criado_em, aprovado_em, observacao, desconto_total_cents, total_cents,
             filial_codigo, filial_external_id,
             frete_modalidade, frete_transportadora_tipo, frete_transportadora_id, frete_transportadora_external_id,
             frete_transportadora_nome, frete_transportadora_cnpj, frete_transportadora_telefone,
             entrega_origem, entrega_external_id, entrega_logradouro, entrega_numero, entrega_complemento, entrega_bairro,
             entrega_cidade, entrega_uf, entrega_cep, entrega_principal,
             pagamento_forma_codigo, pagamento_forma_external_id, pagamento_prazo_codigo, pagamento_prazo_external_id,
             pagamento_parcelas_dias, pagamento_prazo_medio_dias, pagamento_percentual_ajuste)
        VALUES
            (@pedido_uuid, @cliente, @vendedor, @condicao, @criado_em, @aprovado_em, @observacao, @desconto_total_cents, @total_cents,
             @filial_codigo, @filial_external_id,
             @frete_modalidade, @frete_transportadora_tipo, @frete_transportadora_id, @frete_transportadora_external_id,
             @frete_transportadora_nome, @frete_transportadora_cnpj, @frete_transportadora_telefone,
             @entrega_origem, @entrega_external_id, @entrega_logradouro, @entrega_numero, @entrega_complemento, @entrega_bairro,
             @entrega_cidade, @entrega_uf, @entrega_cep, @entrega_principal,
             @pagamento_forma_codigo, @pagamento_forma_external_id, @pagamento_prazo_codigo, @pagamento_prazo_external_id,
             @pagamento_parcelas_dias, @pagamento_prazo_medio_dias, @pagamento_percentual_ajuste);
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_macuxi_pedido_item_inserir
    @pedido_uuid UNIQUEIDENTIFIER, @sequencia INT, @produto VARCHAR(200), @quantidade DECIMAL(14, 3),
    @preco_unitario_cents DECIMAL(19, 0), @desconto_cents DECIMAL(19, 0), @total_cents DECIMAL(19, 0)
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM dbo.macuxi_pedido_entrada_item WHERE pedido_uuid = @pedido_uuid AND sequencia = @sequencia)
        INSERT INTO dbo.macuxi_pedido_entrada_item (pedido_uuid, sequencia, produto, quantidade, preco_unitario_cents, desconto_cents, total_cents)
        VALUES (@pedido_uuid, @sequencia, @produto, @quantidade, @preco_unitario_cents, @desconto_cents, @total_cents);
END;
GO

-- Consulta "numeroErp" do conector.exemplo.json:
--   SELECT numero_pedido AS numero_erp FROM dbo.macuxi_pedido_entrada WHERE pedido_uuid = :pedido_uuid

-- ----- retorno do pedido (ERP -> Macuxi): situação, nota e itens faturados -----
-- =====================================================================================================================
-- Kit da thathyany (T-0174): complementos da entrada de pedidos (depois de 02-entrada-pedido.sql). Idempotente.
--   origem          : qual empresa mandou o pedido ('Thathyany Conector' é o padrão da procedure do Conector; o "ERP via API" grava 'Thathyany API').
--   situacao_em     : quando a situação mudou (vira ocorrido_em do status).
--   nota_*          : nota fiscal que o dono do produto digita (UPDATE) para simular o faturamento.
--   retorno_enviado : última situação já devolvida ao Hub pelo "ERP via API" (o Conector acompanha o status por conta própria).
-- =====================================================================================================================
SET NOCOUNT ON;
GO
IF COL_LENGTH('dbo.macuxi_pedido_entrada', 'origem') IS NULL
    ALTER TABLE dbo.macuxi_pedido_entrada ADD origem VARCHAR(40) NOT NULL CONSTRAINT df_pedido_entrada_origem DEFAULT 'Thathyany Conector';
IF COL_LENGTH('dbo.macuxi_pedido_entrada', 'situacao_em') IS NULL
    ALTER TABLE dbo.macuxi_pedido_entrada ADD situacao_em DATETIME2(3) NOT NULL CONSTRAINT df_pedido_entrada_situacao_em DEFAULT SYSUTCDATETIME();
IF COL_LENGTH('dbo.macuxi_pedido_entrada', 'nota_numero') IS NULL
    ALTER TABLE dbo.macuxi_pedido_entrada ADD nota_numero VARCHAR(40) NULL, nota_serie VARCHAR(10) NULL, nota_emitida_em DATETIME2(3) NULL, nota_total_cents DECIMAL(19, 0) NULL;
IF COL_LENGTH('dbo.macuxi_pedido_entrada', 'retorno_enviado') IS NULL
    ALTER TABLE dbo.macuxi_pedido_entrada ADD retorno_enviado CHAR(1) NULL;
GO

IF OBJECT_ID('dbo.macuxi_pedido_nota_item', 'U') IS NULL
CREATE TABLE dbo.macuxi_pedido_nota_item (
    pedido_uuid UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.macuxi_pedido_entrada (pedido_uuid), nota_numero VARCHAR(40) NOT NULL,
    nota_serie VARCHAR(10) NULL, sequencia INT NOT NULL CHECK (sequencia > 0),
    quantidade DECIMAL(14, 3) NOT NULL CHECK (quantidade > 0 AND quantidade = ROUND(quantidade, 0)),
    valor_cents DECIMAL(19, 0) NOT NULL CHECK (valor_cents >= 0), produto_codigo VARCHAR(200) NOT NULL,
    CONSTRAINT pk_macuxi_pedido_nota_item PRIMARY KEY (pedido_uuid, nota_numero, sequencia));
GO

-- Gatilho: o UPDATE de situacao/nota no SSMS atualiza situacao_em (e a data da nota) sozinho.
CREATE OR ALTER TRIGGER dbo.tr_pedido_entrada_situacao ON dbo.macuxi_pedido_entrada AFTER UPDATE AS
BEGIN
    SET NOCOUNT ON;
    IF NOT (UPDATE(situacao) OR UPDATE(nota_numero)) RETURN;
    UPDATE p SET situacao_em = SYSUTCDATETIME(),
                 nota_emitida_em = CASE WHEN i.nota_numero IS NOT NULL AND i.nota_emitida_em IS NULL THEN SYSUTCDATETIME() ELSE i.nota_emitida_em END
      FROM dbo.macuxi_pedido_entrada p
      JOIN inserted i ON i.pedido_uuid = p.pedido_uuid
      JOIN deleted d ON d.pedido_uuid = i.pedido_uuid
     WHERE i.situacao <> d.situacao OR ISNULL(i.nota_numero, '') <> ISNULL(d.nota_numero, '');
END;
GO

-- Status que o Conector consulta (conector.json, pedidos.status). situacao: I integrado, R rejeitado, P faturado parcial, F faturado, C cancelado.
-- Faturado só com nota ('I' enquanto o dono não digita a nota); rejeitado sempre com motivo; 'f' digitado vira 'F'.
CREATE OR ALTER VIEW dbo.vw_macuxi_pedido_status AS
SELECT p.pedido_uuid,
       CASE WHEN p.situacao IN ('P', 'F') AND p.nota_numero IS NULL THEN 'I' ELSE UPPER(p.situacao) END AS situacao,
       p.numero_pedido,
       CASE WHEN p.situacao = 'R' THEN COALESCE(NULLIF(LTRIM(RTRIM(p.motivo)), ''), 'Rejeitado na ERP_THATHYANY.') ELSE p.motivo END AS motivo,
       p.nota_numero, p.nota_serie, p.nota_emitida_em, p.nota_total_cents, p.situacao_em AS ocorrido_em
FROM dbo.macuxi_pedido_entrada p;
GO

CREATE OR ALTER VIEW dbo.vw_macuxi_pedido_nota_item AS
SELECT i.pedido_uuid, i.nota_numero, i.nota_serie, i.sequencia, i.quantidade, i.valor_cents, i.produto_codigo
FROM dbo.macuxi_pedido_nota_item i;
GO

-- Conferência do teste: todos os pedidos que chegaram, com a empresa de origem.
CREATE OR ALTER VIEW dbo.vw_thathyany_pedidos AS
SELECT p.numero_pedido, p.origem, p.pedido_uuid, p.cliente, p.vendedor, CAST(p.total_cents / 100.0 AS DECIMAL(14, 2)) AS total,
       p.situacao, p.motivo, p.recebido_em, p.situacao_em
FROM dbo.macuxi_pedido_entrada p;
GO

