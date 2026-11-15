-- =====================================================================================================================
-- Kit da thathyany (T-0174), fase 1: usuário restrito do Conector na ERP_THATHYANY. A senha chega pela variável $(SENHA),
-- trocada pelo Instalar-Thathyany.ps1 na memória (nunca gravada em arquivo nem em log). Idempotente: rodar de novo troca a senha.
--   macuxi_conector: SELECT nas views vw_macuxi_*, EXECUTE nas duas procedures de entrada e SELECT na tabela de entrada (numeroErp).
-- Não é dono do banco e não lê as tabelas tha_* diretamente.
-- =====================================================================================================================
SET NOCOUNT ON;
GO
USE ERP_THATHYANY;
GO
IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = N'macuxi_conector')
    CREATE LOGIN macuxi_conector WITH PASSWORD = N'$(SENHA)', CHECK_POLICY = OFF, DEFAULT_DATABASE = ERP_THATHYANY;
ELSE ALTER LOGIN macuxi_conector WITH PASSWORD = N'$(SENHA)';
ALTER LOGIN macuxi_conector ENABLE;
IF USER_ID(N'macuxi_conector') IS NULL CREATE USER macuxi_conector FOR LOGIN macuxi_conector;
GO
DECLARE @sql NVARCHAR(MAX) = N'';
SELECT @sql += N'GRANT SELECT ON dbo.' + QUOTENAME(name) + N' TO macuxi_conector;' + CHAR(10) FROM sys.views WHERE name LIKE N'vw[_]macuxi[_]%';
SET @sql += N'GRANT EXECUTE ON dbo.sp_macuxi_pedido_inserir TO macuxi_conector;
GRANT EXECUTE ON dbo.sp_macuxi_pedido_item_inserir TO macuxi_conector;
GRANT SELECT ON dbo.macuxi_pedido_entrada TO macuxi_conector;' + CHAR(10);
EXEC sys.sp_executesql @sql;
GO
