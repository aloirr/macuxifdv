-- =====================================================================================================================
-- Kit do piloto (T-0162): usuários restritos. As senhas chegam pelas variáveis $(SENHA_CONECTOR) e $(SENHA_API), trocadas
-- pelo instalador na memória (nunca gravadas em arquivo nem em log). Variável vazia = não mexe naquele usuário.
-- Idempotente: rodar de novo troca a senha e refaz as permissões.
--   macuxi_conector : SELECT nas views vw_macuxi_*, EXECUTE nas duas procedures de entrada e SELECT na tabela de entrada (numeroErp).
--   macuxi_api      : o mesmo, mais UPDATE de origem e retorno_enviado (o "ERP via API" grava o retorno do pedido).
-- Nenhum dos dois é dono do banco, nem lê as tabelas piloto_* diretamente.
-- =====================================================================================================================
SET NOCOUNT ON;
GO
IF N'$(SENHA_CONECTOR)' <> N''
BEGIN
    IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = N'macuxi_conector')
        CREATE LOGIN macuxi_conector WITH PASSWORD = N'$(SENHA_CONECTOR)', CHECK_POLICY = OFF, DEFAULT_DATABASE = ERP_PILOTO;
    ELSE ALTER LOGIN macuxi_conector WITH PASSWORD = N'$(SENHA_CONECTOR)';
    IF USER_ID(N'macuxi_conector') IS NULL CREATE USER macuxi_conector FOR LOGIN macuxi_conector;
END
IF N'$(SENHA_API)' <> N''
BEGIN
    IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = N'macuxi_api')
        CREATE LOGIN macuxi_api WITH PASSWORD = N'$(SENHA_API)', CHECK_POLICY = OFF, DEFAULT_DATABASE = ERP_PILOTO;
    ELSE ALTER LOGIN macuxi_api WITH PASSWORD = N'$(SENHA_API)';
    IF USER_ID(N'macuxi_api') IS NULL CREATE USER macuxi_api FOR LOGIN macuxi_api;
END
GO
DECLARE @sql NVARCHAR(MAX) = N'';
IF USER_ID(N'macuxi_conector') IS NOT NULL
BEGIN
    SELECT @sql += N'GRANT SELECT ON dbo.' + QUOTENAME(name) + N' TO macuxi_conector;' + CHAR(10) FROM sys.views WHERE name LIKE N'vw[_]macuxi[_]%';
    SET @sql += N'GRANT EXECUTE ON dbo.sp_macuxi_pedido_inserir TO macuxi_conector;
GRANT EXECUTE ON dbo.sp_macuxi_pedido_item_inserir TO macuxi_conector;
GRANT SELECT ON dbo.macuxi_pedido_entrada TO macuxi_conector;' + CHAR(10);
END
IF USER_ID(N'macuxi_api') IS NOT NULL
BEGIN
    -- reinstalação: GRANT não tira o que já foi dado por versões anteriores
    SET @sql += N'REVOKE INSERT ON dbo.macuxi_pedido_entrada FROM macuxi_api; REVOKE INSERT ON dbo.macuxi_pedido_entrada_item FROM macuxi_api; REVOKE UPDATE ON dbo.macuxi_pedido_entrada FROM macuxi_api; REVOKE SELECT ON dbo.vw_piloto_pedidos FROM macuxi_api;' + CHAR(10);
    SELECT @sql += N'GRANT SELECT ON dbo.' + QUOTENAME(name) + N' TO macuxi_api;' + CHAR(10) FROM sys.views WHERE name LIKE N'vw[_]macuxi[_]%';
    SET @sql += N'GRANT EXECUTE ON dbo.sp_macuxi_pedido_inserir TO macuxi_api;
GRANT EXECUTE ON dbo.sp_macuxi_pedido_item_inserir TO macuxi_api;
GRANT SELECT ON dbo.macuxi_pedido_entrada TO macuxi_api;
GRANT UPDATE (origem, retorno_enviado) ON dbo.macuxi_pedido_entrada TO macuxi_api;' + CHAR(10);
END
IF LEN(@sql) > 0 EXEC sys.sp_executesql @sql;
GO
