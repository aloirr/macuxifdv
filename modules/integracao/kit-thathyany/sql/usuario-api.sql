-- =====================================================================================================================
-- Kit da thathyany (T-0174), fase 2: usuário restrito do "ERP via API" na ERP_THATHYANY. A senha chega pela variável $(SENHA),
-- trocada pelo Instalar-Thathyany.ps1 na memória (nunca gravada em arquivo nem em log). Idempotente: rodar de novo troca a senha.
--   macuxi_api: SELECT nas views vw_macuxi_*, EXECUTE nas duas procedures de entrada, SELECT na tabela de entrada e UPDATE só de
--   origem e retorno_enviado (o "ERP via API" marca a origem e o retorno do pedido).
-- Na fase 2 o login do Conector fica desabilitado: os pedidos só entram por esta credencial (RN-INT-13, um destino por empresa).
-- =====================================================================================================================
SET NOCOUNT ON;
GO
USE ERP_THATHYANY;
GO
IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = N'macuxi_api')
    CREATE LOGIN macuxi_api WITH PASSWORD = N'$(SENHA)', CHECK_POLICY = OFF, DEFAULT_DATABASE = ERP_THATHYANY;
ELSE ALTER LOGIN macuxi_api WITH PASSWORD = N'$(SENHA)';
ALTER LOGIN macuxi_api ENABLE;
IF USER_ID(N'macuxi_api') IS NULL CREATE USER macuxi_api FOR LOGIN macuxi_api;
IF EXISTS (SELECT 1 FROM sys.server_principals WHERE name = N'macuxi_conector') ALTER LOGIN macuxi_conector DISABLE;
GO
DECLARE @sql NVARCHAR(MAX) = N'';
SELECT @sql += N'GRANT SELECT ON dbo.' + QUOTENAME(name) + N' TO macuxi_api;' + CHAR(10) FROM sys.views WHERE name LIKE N'vw[_]macuxi[_]%';
SET @sql += N'GRANT EXECUTE ON dbo.sp_macuxi_pedido_inserir TO macuxi_api;
GRANT EXECUTE ON dbo.sp_macuxi_pedido_item_inserir TO macuxi_api;
GRANT SELECT ON dbo.macuxi_pedido_entrada TO macuxi_api;
GRANT UPDATE (origem, retorno_enviado) ON dbo.macuxi_pedido_entrada TO macuxi_api;' + CHAR(10);
EXEC sys.sp_executesql @sql;
GO
