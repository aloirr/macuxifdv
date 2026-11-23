-- =====================================================================================================================
-- Macuxi FDV — MODELO de views do Conector para o ERP Senior (Gestão Empresarial | ERP) (ERP -> Hub /integracao/v1)
-- Status: beta (D9 do desenho: fica "beta" até o primeiro cliente Senior confirmar os itens [C]).
-- Dono: banco-dados. Desenho: docs/desenho/integracao-modelos-erp.md §3.5 (de-para) e §6 (F4b); ADR 0066.
-- Formato e regras de toda view: db/conector/views-modelo.sql (cabeçalho, regras 1 a 8). Dicionário: docs/banco/integracao.md,
-- "Modelos por ERP". Teste sem banco: db/testes/modelos-erp-conector.test.ts (colunas contra SCHEMA_REGISTRO).
-- NADA aqui é aplicado pelo Macuxi: o técnico do cliente (ou o parceiro Senior) revisa e cria as views no banco do ERP, com o
-- usuário somente leitura do Conector tendo SELECT nelas.
--
-- LEGENDA
--   [P] = conhecimento público (modelo de dados do ERP Senior e uso amplo no mercado).
--   [C] = CONFIRMAR com o cliente antes de ligar: muda por versão, parametrização ou campo de usuário (USU_*).
--
-- REGRAS GERAIS DO SENIOR [P]
--   - Tabelas Ennn<ASSUNTO> (E085CLI cliente, E075PRO produto...). Quase tudo é por empresa (CODEMP) e, em parte, por filial
--     (CODFIL). O modelo usa UMA empresa de referência: troque o "CODEMP = 1" de cada view pela empresa do cliente [C].
--   - Produto com derivação (CODDER): a chave do item é produto + derivação; derivação em branco = sem variação [P].
--   - Situação: SITxxx = 'A' ativo, 'I' inativo [P].
--   - Data de alteração varia por tabela [C]: o modelo usa a data fixa CAST('2000-01-01' AS DATETIME2(3)) e a entidade roda
--     SÓ em carga completa na frequência (RN-INT-06 inativa o que sumiu). Onde a tabela tiver data e hora de alteração
--     (DATALT/HORALT, ou um campo USU_), troque pela conversão local -> UTC da regra 3 do views-modelo.sql [C].
--
-- DIALETO
--   Corpo em SQL Server (2017+). Para Oracle, aplique as trocas do cabeçalho "DIALETOS" de db/conector/views-modelo.sql.
--
-- O QUE NÃO TEM VIEW NESTE MODELO
--   SEM VIEW: produto_unidade — conversões de unidade (E015MED/E075UNI) mudam por parametrização. [C]
--   SEM VIEW: tabela_escalonada — preço por faixa de quantidade não é padrão do E081. [C]
--   SEM VIEW: rota — o ERP Senior não guarda roteiro de visita do representante; o roteiro nasce no Macuxi. [C]
--
-- PEDIDO (Macuxi -> ERP): pelo web service de pedidos do ERP (com_senior_g5_co_*), NUNCA por INSERT direto em E120PED/E120IPD
--   (§3.5). Caminho do modelo: a entrada genérica db/conector/entrada-pedido-modelo.sql e um job do parceiro que chama o web
--   service e grava o UUID do Macuxi no campo de usuário E120PED.USU_MXUUID [C]; recusa do web service = situacao 'R' e o
--   motivo na entrada. As 2 views do retorno estão no fim.
-- =====================================================================================================================


-- ---------------------------------------------------------------------------------------------------------------------
-- 1. filial — E070FIL [P]. Chave empresa:filial.
-- ---------------------------------------------------------------------------------------------------------------------
CREATE VIEW vw_macuxi_filial AS
SELECT
    CONCAT(f.CODEMP, ':', f.CODFIL)                          AS external_id,     -- [P]
    CAST(CAST('2000-01-01' AS DATETIME2) AS DATETIME2(3))    AS alterado_em,
    1                                                        AS ativo,
    CAST(f.CODFIL AS VARCHAR(20))                            AS codigo,
    f.NOMFIL                                                 AS nome,            -- [P]
    f.CIDFIL                                                 AS cidade,          -- [C]
    UPPER(f.SIGUFS)                                          AS uf,
    RIGHT(REPLICATE('0', 14) + CAST(CAST(f.NUMCGC AS DECIMAL(14, 0)) AS VARCHAR(14)), 14) AS cnpj, -- [C] NUMCGC numérico
    f.ENDFIL                                                 AS logradouro,      -- [C]
    CAST(f.NENFIL AS VARCHAR(20))                            AS numero,          -- [C]
    f.BAIFIL                                                 AS bairro,          -- [C]
    CAST(f.CEPFIL AS VARCHAR(8))                             AS cep,             -- [C]
    NULLIF(f.FONFIL, '')                                     AS telefone         -- [C]
FROM E070FIL f
WHERE f.CODEMP = 1;                                                              -- [C] empresa de referência


-- ---------------------------------------------------------------------------------------------------------------------
-- 2. vendedor (representante) — E090REP [P].
-- ---------------------------------------------------------------------------------------------------------------------
CREATE VIEW vw_macuxi_vendedor AS
SELECT
    CAST(r.CODREP AS VARCHAR(200))                           AS external_id,     -- [P]
    CAST(CAST('2000-01-01' AS DATETIME2) AS DATETIME2(3))    AS alterado_em,
    CASE WHEN r.SITREP = 'A' THEN 1 ELSE 0 END               AS ativo,           -- [P]
    r.NOMREP                                                 AS nome,            -- [P]
    NULLIF(r.INTNET, '')                                     AS email,           -- [C]
    NULLIF(r.FONREP, '')                                     AS telefone         -- [C]
FROM E090REP r;


-- ---------------------------------------------------------------------------------------------------------------------
-- 3. catalogo_no — família de produto (E012FAM) [P], um nível só.
-- ---------------------------------------------------------------------------------------------------------------------
CREATE VIEW vw_macuxi_catalogo_no AS
SELECT
    CAST(RTRIM(f.CODFAM) AS VARCHAR(200))                    AS external_id,     -- [P]
    CAST(CAST('2000-01-01' AS DATETIME2) AS DATETIME2(3))    AS alterado_em,
    1                                                        AS ativo,
    RTRIM(f.CODFAM)                                          AS codigo,
    f.DESFAM                                                 AS nome,            -- [P]
    1                                                        AS nivel,
    0                                                        AS ordem
FROM E012FAM f
WHERE f.CODEMP = 1;                                                              -- [C]


-- ---------------------------------------------------------------------------------------------------------------------
-- 4. forma_pagamento — E066FPG (formas de pagamento) [P].
-- ---------------------------------------------------------------------------------------------------------------------
CREATE VIEW vw_macuxi_forma_pagamento AS
SELECT
    CAST(f.CODFPG AS VARCHAR(200))                           AS external_id,     -- [P]
    CAST(CAST('2000-01-01' AS DATETIME2) AS DATETIME2(3))    AS alterado_em,
    1                                                        AS ativo,
    CAST(f.CODFPG AS VARCHAR(20))                            AS codigo,
    f.DESFPG                                                 AS nome,            -- [P]
    0                                                        AS ordem
FROM E066FPG f
WHERE f.CODEMP = 1;                                                              -- [C]


-- ---------------------------------------------------------------------------------------------------------------------
-- 5. prazo_pagamento — condição de pagamento (E028CPG) [P]; parcelas em E028PAR (dias por parcela) [C]; a forma vem da
--    própria condição (CODFPG) [C].
-- ---------------------------------------------------------------------------------------------------------------------
CREATE VIEW vw_macuxi_prazo_pagamento AS
SELECT
    CAST(RTRIM(c.CODCPG) AS VARCHAR(200))                    AS external_id,     -- [P]
    CAST(CAST('2000-01-01' AS DATETIME2) AS DATETIME2(3))    AS alterado_em,
    CASE WHEN COALESCE(c.SITCPG, 'A') = 'A' THEN 1 ELSE 0 END AS ativo,          -- [C]
    CAST(c.CODFPG AS VARCHAR(200))                           AS forma_external_id, -- [C]
    UPPER(RTRIM(c.CODCPG))                                   AS codigo,
    c.DESCPG                                                 AS descricao,       -- [P]
    COALESCE((SELECT '[' + STRING_AGG(CAST(p.PRZPAR AS VARCHAR(10)), ',') WITHIN GROUP (ORDER BY p.SEQPAR) + ']'
                FROM E028PAR p WHERE p.CODEMP = c.CODEMP AND p.CODCPG = c.CODCPG), '[0]') AS parcelas_dias, -- [C]
    0                                                        AS ordem
FROM E028CPG c
WHERE c.CODEMP = 1;                                                              -- [C]


-- ---------------------------------------------------------------------------------------------------------------------
-- 6. produto — E075PRO com a derivação E075DER [P]. Chave produto[:derivação] (derivação em branco = só o produto).
-- ---------------------------------------------------------------------------------------------------------------------
CREATE VIEW vw_macuxi_produto AS
SELECT
    CONCAT(RTRIM(p.CODPRO), CASE WHEN RTRIM(d.CODDER) <> '' THEN ':' + RTRIM(d.CODDER) ELSE '' END) AS external_id, -- [P]
    CAST(CAST('2000-01-01' AS DATETIME2) AS DATETIME2(3))    AS alterado_em,
    CASE WHEN p.SITPRO = 'A' AND d.SITDER = 'A' THEN 1 ELSE 0 END AS ativo,      -- [P]
    CONCAT(RTRIM(p.CODPRO), CASE WHEN RTRIM(d.CODDER) <> '' THEN '-' + RTRIM(d.CODDER) ELSE '' END) AS sku,
    NULLIF(RTRIM(d.CODBAR), '')                              AS ean,             -- [C]
    CONCAT(p.DESPRO, CASE WHEN RTRIM(d.CODDER) <> '' THEN ' ' + RTRIM(d.DESDER) ELSE '' END) AS nome, -- [P]
    UPPER(LEFT(RTRIM(p.UNIMED), 4))                          AS unidade,         -- [P]
    CAST(NULLIF(RTRIM(p.CODFAM), '') AS VARCHAR(200))        AS catalogo_no_external_id -- [P]
FROM E075PRO p
JOIN E075DER d ON d.CODEMP = p.CODEMP AND d.CODPRO = p.CODPRO
WHERE p.CODEMP = 1;                                                              -- [C]


-- ---------------------------------------------------------------------------------------------------------------------
-- 8. preco — E081TAB (tabela) e E081ITE (item, com início DATINI) [C]. Preço base PREBAS [C].
-- ---------------------------------------------------------------------------------------------------------------------
CREATE VIEW vw_macuxi_preco AS
SELECT
    CONCAT(RTRIM(i.CODTPR), ':', RTRIM(i.CODPRO), ':', RTRIM(i.CODDER), ':', CONVERT(CHAR(8), i.DATINI, 112)) AS external_id,
    CAST(CAST('2000-01-01' AS DATETIME2) AS DATETIME2(3))    AS alterado_em,
    CASE WHEN i.PREBAS > 0 THEN 1 ELSE 0 END                 AS ativo,
    CAST(RTRIM(i.CODTPR) AS VARCHAR(200))                    AS tabela_external_id, -- [C] a mesma chave de E085HCL.CODTPR
    t.DESTPR                                                 AS tabela_nome,     -- [C]
    CONVERT(CHAR(10), i.DATINI, 23)                          AS vigencia_inicio, -- [C]
    CONVERT(CHAR(10), NULLIF(i.DATFIM, '1900-12-31'), 23)    AS vigencia_fim,    -- [C] data "vazia" do Senior
    CONCAT(RTRIM(i.CODPRO), CASE WHEN RTRIM(i.CODDER) <> '' THEN ':' + RTRIM(i.CODDER) ELSE '' END) AS produto_external_id,
    CAST(ROUND(i.PREBAS * 100, 0) AS DECIMAL(19,0))          AS preco_cents      -- [C]
FROM E081ITE i
JOIN E081TAB t ON t.CODEMP = i.CODEMP AND t.CODTPR = i.CODTPR
WHERE i.CODEMP = 1;                                                              -- [C]


-- ---------------------------------------------------------------------------------------------------------------------
-- 10. estoque — E210EST por depósito (CODDEP) [P]. Saldo = QTDEST − QTDRES [P]. Depósito em E205DEP [C].
-- ---------------------------------------------------------------------------------------------------------------------
CREATE VIEW vw_macuxi_estoque AS
SELECT
    CONCAT(RTRIM(s.CODDEP), ':', RTRIM(s.CODPRO), CASE WHEN RTRIM(s.CODDER) <> '' THEN ':' + RTRIM(s.CODDER) ELSE '' END) AS external_id,
    CAST(CAST('2000-01-01' AS DATETIME2) AS DATETIME2(3))    AS alterado_em,
    1                                                        AS ativo,
    CAST(RTRIM(s.CODDEP) AS VARCHAR(200))                    AS deposito_external_id,
    (SELECT MAX(dp.DESDEP) FROM E205DEP dp WHERE dp.CODEMP = s.CODEMP AND dp.CODDEP = s.CODDEP) AS deposito_nome, -- [C]
    CONCAT(RTRIM(s.CODPRO), CASE WHEN RTRIM(s.CODDER) <> '' THEN ':' + RTRIM(s.CODDER) ELSE '' END) AS produto_external_id,
    s.QTDEST - s.QTDRES                                      AS saldo            -- [P]
FROM E210EST s
WHERE s.CODEMP = 1;                                                              -- [C]


-- ---------------------------------------------------------------------------------------------------------------------
-- 11. cliente — E085CLI (cadastro geral) + E085HCL (dados por empresa e filial: representante, tabela, limite) [P; campos da
--     E085HCL C]. CGCCPF só em "documento". Filial de referência da E085HCL: CODFIL = 1 [C].
-- ---------------------------------------------------------------------------------------------------------------------
CREATE VIEW vw_macuxi_cliente AS
SELECT
    CAST(c.CODCLI AS VARCHAR(200))                           AS external_id,     -- [P] nunca o CGCCPF
    CAST(CAST('2000-01-01' AS DATETIME2) AS DATETIME2(3))    AS alterado_em,
    CASE WHEN c.SITCLI = 'A' THEN 1 ELSE 0 END               AS ativo,           -- [P]
    c.NOMCLI                                                 AS razao_social,    -- [P]
    NULLIF(c.APECLI, '')                                     AS nome_fantasia,   -- [P]
    CAST(CAST(c.CGCCPF AS DECIMAL(14, 0)) AS VARCHAR(14))    AS documento,       -- [P] numérico no Senior
    CAST(h.CODREP AS VARCHAR(200))                           AS vendedor_external_id, -- [C]
    c.ENDCLI                                                 AS endereco_logradouro, -- [P]
    CAST(c.NENCLI AS VARCHAR(20))                            AS endereco_numero, -- [C]
    NULLIF(c.CPLEND, '')                                     AS endereco_complemento, -- [C]
    c.BAICLI                                                 AS endereco_bairro, -- [C]
    c.CIDCLI                                                 AS endereco_cidade, -- [P]
    UPPER(c.SIGUFS)                                          AS endereco_uf,     -- [P]
    CAST(c.CEPCLI AS VARCHAR(8))                             AS endereco_cep,    -- [C]
    NULLIF(c.FONCLI, '')                                     AS telefone,        -- [C]
    NULLIF(c.INTNET, '')                                     AS email,           -- [C]
    CAST(ROUND(COALESCE(h.LIMAPR, 0) * 100, 0) AS DECIMAL(19,0)) AS limite_credito_cents, -- [C]
    NULLIF(c.INSEST, '')                                     AS inscricao_estadual, -- [P]
    0                                                        AS bloqueado,       -- [C] bloqueio financeiro por empresa
    CAST(NULL AS VARCHAR(60))                                AS canal,
    CAST(NULL AS INT)                                        AS prazo_medio_max_dias,
    CAST(NULL AS VARCHAR(1))                                 AS formas_pagamento,
    CAST(NULLIF(RTRIM(h.CODTPR), '') AS VARCHAR(200))        AS tabela_preco_external_id, -- [C]
    CONCAT(h.CODEMP, ':', h.CODFIL)                          AS filial_external_id -- a chave da view 1
FROM E085CLI c
LEFT JOIN E085HCL h ON h.CODCLI = c.CODCLI AND h.CODEMP = 1 AND h.CODFIL = 1;    -- [C]


-- ---------------------------------------------------------------------------------------------------------------------
-- 12. cliente_endereco — endereços de entrega (E085ENT) [C].
-- ---------------------------------------------------------------------------------------------------------------------
CREATE VIEW vw_macuxi_cliente_endereco AS
SELECT
    CONCAT(e.CODCLI, ':', e.SEQENT)                          AS external_id,     -- cliente:sequência
    CAST(CAST('2000-01-01' AS DATETIME2) AS DATETIME2(3))    AS alterado_em,
    CASE WHEN COALESCE(e.SITENT, 'A') = 'A' THEN 1 ELSE 0 END AS ativo,          -- [C]
    CAST(e.CODCLI AS VARCHAR(200))                           AS cliente_external_id,
    'entrega'                                                AS tipo,
    e.ENDENT                                                 AS logradouro,      -- [C]
    CAST(e.NENENT AS VARCHAR(20))                            AS numero,
    e.BAIENT                                                 AS bairro,
    e.CIDENT                                                 AS cidade,
    UPPER(e.ESTENT)                                          AS uf,
    CAST(e.CEPENT AS VARCHAR(8))                             AS cep,
    0                                                        AS principal
FROM E085ENT e;


-- ---------------------------------------------------------------------------------------------------------------------
-- 13. transportadora — E073TRA [P].
-- ---------------------------------------------------------------------------------------------------------------------
CREATE VIEW vw_macuxi_transportadora AS
SELECT
    CAST(t.CODTRA AS VARCHAR(200))                           AS external_id,     -- [P]
    CAST(CAST('2000-01-01' AS DATETIME2) AS DATETIME2(3))    AS alterado_em,
    CASE WHEN COALESCE(t.SITTRA, 'A') = 'A' THEN 1 ELSE 0 END AS ativo,          -- [C]
    t.NOMTRA                                                 AS nome,            -- [P]
    CAST(CAST(t.CGCCPF AS DECIMAL(14, 0)) AS VARCHAR(14))    AS documento,
    NULLIF(t.INSEST, '')                                     AS inscricao_estadual,
    NULLIF(t.FONTRA, '')                                     AS telefone         -- [C]
FROM E073TRA t;


-- ---------------------------------------------------------------------------------------------------------------------
-- 15. titulo — E301TCR (contas a receber) [P]. Chave empresa:filial:título:tipo. Situação SITTIT: 'AB' aberto, 'LQ'
--     liquidado, 'CA'/'CE' cancelado [C]. Saldo = VLRABE [P].
-- ---------------------------------------------------------------------------------------------------------------------
CREATE VIEW vw_macuxi_titulo AS
SELECT
    CONCAT(t.CODEMP, ':', t.CODFIL, ':', RTRIM(t.NUMTIT), ':', RTRIM(t.CODTPT)) AS external_id, -- [P]
    CAST(CAST('2000-01-01' AS DATETIME2) AS DATETIME2(3))    AS alterado_em,
    1                                                        AS ativo,
    CAST(t.CODCLI AS VARCHAR(200))                           AS cliente_external_id,
    RTRIM(t.NUMTIT)                                          AS numero,          -- [P]
    CONVERT(CHAR(10), t.DATEMI, 23)                          AS emissao,
    CONVERT(CHAR(10), t.VCTPRO, 23)                          AS vencimento,      -- [P] vencimento prorrogado
    CAST(ROUND(t.VLRORI * 100, 0) AS DECIMAL(19,0))          AS valor_cents,     -- [C]
    CAST(ROUND(t.VLRABE * 100, 0) AS DECIMAL(19,0))          AS saldo_cents,     -- [P]
    CASE WHEN t.SITTIT IN ('CA', 'CE') THEN 'cancelado'
         WHEN t.VLRABE = 0 THEN 'baixado'
         ELSE 'aberto' END                                   AS situacao,        -- [C]
    CASE WHEN t.NUMNFV > 0 THEN CAST(t.NUMNFV AS VARCHAR(40)) END AS nf_numero,  -- [C]
    CAST(NULLIF(RTRIM(t.CODSNF), '') AS VARCHAR(10))         AS nf_serie         -- [C]
FROM E301TCR t
WHERE t.CODEMP = 1;                                                              -- [C]


-- ---------------------------------------------------------------------------------------------------------------------
-- 16. nota — saída E140NFV [P]. Situação SITNFV: '2' emitida, '3' cancelada [C]. Devolução pela nota de entrada (E440NFC)
--     fica fora até o cliente confirmar [C]. pedido_uuid pelo E140IPV.NUMPED -> E120PED.USU_MXUUID [C].
-- ---------------------------------------------------------------------------------------------------------------------
CREATE VIEW vw_macuxi_nota AS
SELECT
    CONCAT(n.CODEMP, ':', n.CODFIL, ':', RTRIM(n.CODSNF), ':', n.NUMNFV) AS external_id, -- [P]
    CAST(CAST('2000-01-01' AS DATETIME2) AS DATETIME2(3))    AS alterado_em,
    1                                                        AS ativo,
    CAST(n.CODCLI AS VARCHAR(200))                           AS cliente_external_id,
    CASE WHEN n.CODREP > 0 THEN CAST(n.CODREP AS VARCHAR(200)) END AS vendedor_external_id,
    'faturamento'                                            AS tipo,
    CAST(n.NUMNFV AS VARCHAR(40))                            AS numero,          -- [P]
    NULLIF(RTRIM(n.CODSNF), '')                              AS serie,           -- [P]
    -- emissão: data + hora em minutos desde a meia-noite (HOREMI) [C], hora local -> UTC
    CAST(DATEADD(MINUTE, COALESCE(n.HOREMI, 0), CAST(n.DATEMI AS DATETIME2))
         AT TIME ZONE 'SA Western Standard Time' AT TIME ZONE 'UTC' AS DATETIME2(3)) AS emitida_em,
    CAST(ROUND(n.VLRLIQ * 100, 0) AS DECIMAL(19,0))          AS total_cents,     -- [C]
    (SELECT COUNT(*) FROM E140IPV i WHERE i.CODEMP = n.CODEMP AND i.CODFIL = n.CODFIL AND i.CODSNF = n.CODSNF
        AND i.NUMNFV = n.NUMNFV)                             AS quantidade_itens,
    (SELECT MAX(p.USU_MXUUID) FROM E140IPV i
       JOIN E120PED p ON p.CODEMP = i.CODEMP AND p.CODFIL = i.FILPED AND p.NUMPED = i.NUMPED
      WHERE i.CODEMP = n.CODEMP AND i.CODFIL = n.CODFIL AND i.CODSNF = n.CODSNF AND i.NUMNFV = n.NUMNFV) AS pedido_uuid, -- [C]
    CASE WHEN n.SITNFV = '3' THEN 1 ELSE 0 END               AS cancelada        -- [C]
FROM E140NFV n
WHERE n.CODEMP = 1;                                                              -- [C]


-- ---------------------------------------------------------------------------------------------------------------------
-- 17. pedido_status (RETORNO, RN-INT-08) — situação da entrada ('R' do job) e do E120PED achado pelo USU_MXUUID [C]
--     (SITPED '5' cancelado [C]); notas pelo E140IPV. Pedido fechado (SITPED '4') = F [C].
-- ---------------------------------------------------------------------------------------------------------------------
CREATE VIEW vw_macuxi_pedido_status AS
SELECT
    LOWER(CAST(e.pedido_uuid AS VARCHAR(36)))                AS pedido_uuid,
    CASE WHEN e.situacao = 'R' THEN 'R' WHEN p.SITPED = '5' THEN 'C' ELSE 'I' END AS situacao, -- [C]
    CAST(COALESCE(p.NUMPED, e.numero_pedido) AS VARCHAR(40)) AS numero_pedido,   -- [P] NUMPED
    CASE WHEN e.situacao = 'R' THEN COALESCE(NULLIF(LTRIM(RTRIM(e.motivo)), ''), 'Recusado no ERP')
         ELSE NULLIF(LTRIM(RTRIM(e.motivo)), '') END         AS motivo,
    CAST(NULL AS VARCHAR(40))                                AS nota_numero,
    CAST(NULL AS VARCHAR(10))                                AS nota_serie,
    CAST(NULL AS DATETIME2(3))                               AS nota_emitida_em,
    CAST(NULL AS DECIMAL(19,0))                              AS nota_total_cents,
    e.recebido_em                                            AS ocorrido_em      -- já em UTC
FROM dbo.macuxi_pedido_entrada e
LEFT JOIN E120PED p ON LOWER(p.USU_MXUUID) = LOWER(CAST(e.pedido_uuid AS VARCHAR(36)))
UNION ALL
SELECT
    LOWER(p.USU_MXUUID),
    CASE WHEN p.SITPED = '4' THEN 'F' ELSE 'P' END,
    CAST(p.NUMPED AS VARCHAR(40)),
    CAST(NULL AS VARCHAR(300)),
    CAST(n.NUMNFV AS VARCHAR(40)),
    CAST(NULLIF(RTRIM(n.CODSNF), '') AS VARCHAR(10)),
    CAST(DATEADD(MINUTE, COALESCE(n.HOREMI, 0), CAST(n.DATEMI AS DATETIME2)) AT TIME ZONE 'SA Western Standard Time' AT TIME ZONE 'UTC' AS DATETIME2(3)),
    CAST(ROUND(n.VLRLIQ * 100, 0) AS DECIMAL(19,0)),
    CAST(DATEADD(MINUTE, COALESCE(n.HOREMI, 0), CAST(n.DATEMI AS DATETIME2)) AT TIME ZONE 'SA Western Standard Time' AT TIME ZONE 'UTC' AS DATETIME2(3))
FROM E120PED p
JOIN (SELECT DISTINCT CODEMP, CODFIL, CODSNF, NUMNFV, FILPED, NUMPED FROM E140IPV) i
  ON i.CODEMP = p.CODEMP AND i.FILPED = p.CODFIL AND i.NUMPED = p.NUMPED
JOIN E140NFV n ON n.CODEMP = i.CODEMP AND n.CODFIL = i.CODFIL AND n.CODSNF = i.CODSNF AND n.NUMNFV = i.NUMNFV
WHERE p.USU_MXUUID IS NOT NULL AND n.SITNFV <> '3';


-- ---------------------------------------------------------------------------------------------------------------------
-- 18. pedido_nota_item (RETORNO) — itens da nota (E140IPV) com a sequência do item do pedido (SEQIPD) [C], que o job grava
--     igual à do Macuxi. Quantidade faturada QTDFAT, valor VLRLIQ [C].
-- ---------------------------------------------------------------------------------------------------------------------
CREATE VIEW vw_macuxi_pedido_nota_item AS
SELECT
    LOWER(p.USU_MXUUID)                                      AS pedido_uuid,
    CAST(i.NUMNFV AS VARCHAR(40))                            AS nota_numero,
    CAST(NULLIF(RTRIM(i.CODSNF), '') AS VARCHAR(10))         AS nota_serie,
    i.SEQIPD                                                 AS sequencia,       -- [C]
    CAST(i.QTDFAT AS INT)                                    AS quantidade,      -- [C]
    CAST(ROUND(i.VLRLIQ * 100, 0) AS DECIMAL(19,0))          AS valor_cents,     -- [C]
    CONCAT(RTRIM(i.CODPRO), CASE WHEN RTRIM(i.CODDER) <> '' THEN ':' + RTRIM(i.CODDER) ELSE '' END) AS produto_codigo
FROM E140IPV i
JOIN E120PED p ON p.CODEMP = i.CODEMP AND p.CODFIL = i.FILPED AND p.NUMPED = i.NUMPED
JOIN E140NFV n ON n.CODEMP = i.CODEMP AND n.CODFIL = i.CODFIL AND n.CODSNF = i.CODSNF AND n.NUMNFV = i.NUMNFV
WHERE p.USU_MXUUID IS NOT NULL AND n.SITNFV <> '3';
