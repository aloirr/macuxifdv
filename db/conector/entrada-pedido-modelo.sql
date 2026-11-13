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
-- =====================================================================================================================


-- ---------------------------------------------------------------------------------------------------------------------
-- Cabeçalho
-- ---------------------------------------------------------------------------------------------------------------------
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
    situacao              CHAR(1) NOT NULL DEFAULT 'I',      -- I integrado, R rejeitado, P faturado parcial, F faturado, C cancelado
    motivo                VARCHAR(300) NULL,                 -- motivo da rejeição/cancelamento (vai ao Macuxi)
    recebido_em           DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME() -- [Oracle] TIMESTAMP(3) DEFAULT SYS_EXTRACT_UTC(SYSTIMESTAMP)
);

-- ---------------------------------------------------------------------------------------------------------------------
-- Itens
-- ---------------------------------------------------------------------------------------------------------------------
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
--          NUMBER DEFAULT NULL) IS BEGIN INSERT INTO macuxi_pedido_entrada (...) SELECT ... FROM dual WHERE NOT
--          EXISTS (SELECT 1 FROM macuxi_pedido_entrada WHERE pedido_uuid = p_pedido_uuid); END; — e no conector.oracle.json
--          "BEGIN sp_macuxi_pedido_inserir(:pedido_uuid, ..., :filial_codigo, :filial_external_id, :frete_modalidade, ...); END;"
--          (ou o INSERT ... SELECT direto na tabela, como faz o conector.oracle.exemplo.json).
-- ---------------------------------------------------------------------------------------------------------------------
CREATE PROCEDURE dbo.sp_macuxi_pedido_inserir
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
    @pagamento_parcelas_dias VARCHAR(120) = NULL, @pagamento_prazo_medio_dias INT = NULL
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
             pagamento_parcelas_dias, pagamento_prazo_medio_dias)
        VALUES
            (@pedido_uuid, @cliente, @vendedor, @condicao, @criado_em, @aprovado_em, @observacao, @desconto_total_cents, @total_cents,
             @filial_codigo, @filial_external_id,
             @frete_modalidade, @frete_transportadora_tipo, @frete_transportadora_id, @frete_transportadora_external_id,
             @frete_transportadora_nome, @frete_transportadora_cnpj, @frete_transportadora_telefone,
             @entrega_origem, @entrega_external_id, @entrega_logradouro, @entrega_numero, @entrega_complemento, @entrega_bairro,
             @entrega_cidade, @entrega_uf, @entrega_cep, @entrega_principal,
             @pagamento_forma_codigo, @pagamento_forma_external_id, @pagamento_prazo_codigo, @pagamento_prazo_external_id,
             @pagamento_parcelas_dias, @pagamento_prazo_medio_dias);
END;
GO

CREATE PROCEDURE dbo.sp_macuxi_pedido_item_inserir
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
