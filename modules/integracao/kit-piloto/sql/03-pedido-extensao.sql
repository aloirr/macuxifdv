-- =====================================================================================================================
-- Kit do piloto (T-0162): complementos da entrada de pedidos (depois de 02-entrada-pedido.sql). Idempotente.
--   origem          : qual empresa teste mandou o pedido ('Piloto Conector' é o padrão da procedure do Conector; o "ERP via API" grava 'Piloto API').
--   situacao_em     : quando a situação mudou (vira ocorrido_em do status).
--   nota_*          : nota fiscal que o dono do piloto digita (UPDATE) para simular o faturamento.
--   retorno_enviado : última situação já devolvida ao Hub pelo "ERP via API" (o Conector acompanha o status por conta própria).
-- =====================================================================================================================
SET NOCOUNT ON;
GO
IF COL_LENGTH('dbo.macuxi_pedido_entrada', 'origem') IS NULL
    ALTER TABLE dbo.macuxi_pedido_entrada ADD origem VARCHAR(40) NOT NULL CONSTRAINT df_pedido_entrada_origem DEFAULT 'Piloto Conector';
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
       CASE WHEN p.situacao = 'R' THEN COALESCE(NULLIF(LTRIM(RTRIM(p.motivo)), ''), 'Rejeitado na ERP_PILOTO.') ELSE p.motivo END AS motivo,
       p.nota_numero, p.nota_serie, p.nota_emitida_em, p.nota_total_cents, p.situacao_em AS ocorrido_em
FROM dbo.macuxi_pedido_entrada p;
GO

CREATE OR ALTER VIEW dbo.vw_macuxi_pedido_nota_item AS
SELECT i.pedido_uuid, i.nota_numero, i.nota_serie, i.sequencia, i.quantidade, i.valor_cents, i.produto_codigo
FROM dbo.macuxi_pedido_nota_item i;
GO

-- Conferência do dono do piloto: todos os pedidos que chegaram, com a empresa teste de origem.
CREATE OR ALTER VIEW dbo.vw_piloto_pedidos AS
SELECT p.numero_pedido, p.origem, p.pedido_uuid, p.cliente, p.vendedor, CAST(p.total_cents / 100.0 AS DECIMAL(14, 2)) AS total,
       p.situacao, p.motivo, p.recebido_em, p.situacao_em
FROM dbo.macuxi_pedido_entrada p;
GO
