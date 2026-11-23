-- =====================================================================================================================
-- Macuxi FDV — MODELO de views do Conector para o TOTVS Protheus (ERP -> Hub /integracao/v1)
-- Status: beta (D9 do desenho: fica "beta" até o primeiro cliente Protheus confirmar os itens [C]).
-- Dono: banco-dados. Desenho: docs/desenho/integracao-modelos-erp.md §3.1 (de-para) e §6 (F4b); ADR 0066.
-- Formato e regras de toda view: db/conector/views-modelo.sql (cabeçalho, regras 1 a 8). Dicionário: docs/banco/integracao.md,
-- "Modelos por ERP". Teste sem banco: db/testes/modelos-erp-conector.test.ts (colunas contra SCHEMA_REGISTRO).
-- NADA aqui é aplicado pelo Macuxi: o técnico do cliente (ou o parceiro TOTVS) revisa e cria as views no banco do ERP, com o
-- usuário somente leitura do Conector tendo SELECT nelas.
--
-- LEGENDA
--   [P] = conhecimento público (documentação TOTVS ou uso amplo no mercado).
--   [C] = CONFIRMAR com o cliente antes de ligar: muda por release, parametrização ou customização (todo Protheus é customizado).
--
-- REGRAS GERAIS DO PROTHEUS [P]
--   - Tabela = alias + empresa + "0": SA1010 é a SA1 da empresa 01. Troque "010" pelo sufixo da empresa do cliente [C].
--   - D_E_L_E_T_ = '*' é registro excluído (a linha fica no banco). Nos cadastros, o excluído sai com ativo = 0, a não ser que
--     exista a mesma chave viva (o Protheus permite excluir e incluir de novo): aí só a viva sai, para não repetir external_id.
--   - xx_FILIAL vazio = tabela compartilhada; preenchido = exclusiva. Cadastro exclusivo (SB1, SA1...) repete a chave por
--     filial: acrescente "AND xx_FILIAL = '<filial de referência>'" na view [C].
--   - xx_MSBLQL = '1' é bloqueado (vira ativo = 0, ou bloqueado = 1 no cliente).
--   - Campos são CHAR de tamanho fixo (com espaços à direita): toda chave passa por RTRIM.
--   - Data é CHAR(8) 'AAAAMMDD' (vazia = 8 espaços): data civil = CONVERT(CHAR(10), CONVERT(DATE, NULLIF(RTRIM(x), ''), 112), 23).
--   - Data de alteração: S_T_A_M_P_ só existe com o DBAccess configurado para gravá-la [C]. A premissa do modelo é que ela
--     existe e está na hora local do tenant (regra 3 do views-modelo.sql). SEM S_T_A_M_P_: troque cada
--     "COALESCE(x.S_T_A_M_P_, ...)" pela data fixa CAST('2000-01-01' AS DATETIME2(3)) e ligue SÓ a carga completa na
--     frequência (o delta não enxerga mudança sem data; RN-INT-06 inativa o que sumiu).
--
-- DIALETO
--   Corpo em SQL Server (2017+), o banco mais comum do Protheus. Para Oracle ou PostgreSQL, aplique as trocas do cabeçalho
--   "DIALETOS" de db/conector/views-modelo.sql (fuso, data civil, concatenação, listas JSON) e troque CONVERT(DATE, x, 112)
--   por TO_DATE(x, 'YYYYMMDD'). Onde o Protheus pede algo próprio, a forma Oracle vem comentada com "-- [Oracle]".
--
-- O QUE NÃO TEM VIEW NESTE MODELO
--   SEM VIEW: rota — o Protheus padrão não guarda roteiro de visita do vendedor; o roteiro nasce no Macuxi (BKO). [P]
--   SEM VIEW: tabela_escalonada — faixa por quantidade não é padrão (a regra de desconto da DA1 por faixa, DA1_QTDLOT, muda
--             por parametrização); ligar só depois de confirmar com o cliente. [C]
--
-- PEDIDO (Macuxi -> ERP): pela rotina MATA410 (ExecAuto), NUNCA por INSERT direto em SC5/SC6 (§3.1).
--   Caminho do modelo: a entrada genérica db/conector/entrada-pedido-modelo.sql (tabela macuxi_pedido_entrada e as duas
--   procedures, sem mudança) e um JOB do parceiro que lê a entrada, chama a MATA410 e grava o UUID do Macuxi no campo
--   customizado C5_XMXUUID (CHAR 36) [C]; rejeição da MATA410 = macuxi_pedido_entrada.situacao 'R' com o motivo.
--   Alternativa: REST customizado do parceiro (adaptador de API, F4a, modulo-integracao). As 2 views do retorno estão no fim.
-- =====================================================================================================================


-- ---------------------------------------------------------------------------------------------------------------------
-- 1. filial — SYS_COMPANY (12.1.2x, espelho do SIGAMAT) [C]: em release antiga o SIGAMAT é arquivo, não tabela; aí monte a
--    view a partir de uma tabela de-para do cliente. Filtre a empresa do sufixo (M0_CODIGO = '01') [C].
-- ---------------------------------------------------------------------------------------------------------------------
CREATE VIEW vw_macuxi_filial AS
SELECT
    CAST(RTRIM(m.M0_CODFIL) AS VARCHAR(200))                 AS external_id,     -- [C] M0_CODFIL; o mesmo valor de xx_FILIAL
    CAST(COALESCE(m.S_T_A_M_P_, CAST('2000-01-01' AS DATETIME2)) AT TIME ZONE 'SA Western Standard Time' AT TIME ZONE 'UTC' AS DATETIME2(3)) AS alterado_em,
    CASE WHEN m.D_E_L_E_T_ = '*' THEN 0 ELSE 1 END           AS ativo,
    RTRIM(m.M0_CODFIL)                                       AS codigo,          -- [P] código da filial (ex.: '0101')
    RTRIM(m.M0_FILIAL)                                       AS nome,            -- [P]
    RTRIM(m.M0_CIDENT)                                       AS cidade,          -- [P] campos de entrega do SIGAMAT
    UPPER(RTRIM(m.M0_ESTENT))                                AS uf,
    REPLACE(REPLACE(REPLACE(RTRIM(m.M0_CGC), '.', ''), '/', ''), '-', '') AS cnpj,
    RTRIM(m.M0_ENDENT)                                       AS logradouro,      -- [P] logradouro com número no mesmo campo
    CAST(NULL AS VARCHAR(20))                                AS numero,          -- [C] o SIGAMAT não separa o número
    NULLIF(RTRIM(m.M0_COMPENT), '')                          AS complemento,
    RTRIM(m.M0_BAIRENT)                                      AS bairro,
    REPLACE(RTRIM(m.M0_CEPENT), '-', '')                     AS cep,
    NULLIF(RTRIM(m.M0_TEL), '')                              AS telefone
FROM SYS_COMPANY m
WHERE m.M0_CODIGO = '01';                                                        -- [C] empresa do sufixo das tabelas


-- ---------------------------------------------------------------------------------------------------------------------
-- 2. vendedor — SA3 [P].
-- ---------------------------------------------------------------------------------------------------------------------
CREATE VIEW vw_macuxi_vendedor AS
SELECT
    CAST(RTRIM(a3.A3_COD) AS VARCHAR(200))                   AS external_id,     -- [P]
    CAST(COALESCE(a3.S_T_A_M_P_, CAST('2000-01-01' AS DATETIME2)) AT TIME ZONE 'SA Western Standard Time' AT TIME ZONE 'UTC' AS DATETIME2(3)) AS alterado_em,
    CASE WHEN a3.D_E_L_E_T_ = '*' OR a3.A3_MSBLQL = '1' THEN 0 ELSE 1 END AS ativo,
    RTRIM(a3.A3_NOME)                                        AS nome,            -- [P]
    NULLIF(RTRIM(a3.A3_EMAIL), '')                           AS email,           -- [P]
    NULLIF(RTRIM(a3.A3_TEL), '')                             AS telefone,        -- [P]
    CAST(NULLIF(RTRIM(a3.A3_FILIAL), '') AS VARCHAR(200))    AS filial_external_id -- vazio (compartilhada) = não altera
FROM SA3010 a3
WHERE a3.D_E_L_E_T_ = ' '
   OR NOT EXISTS (SELECT 1 FROM SA3010 v WHERE v.A3_FILIAL = a3.A3_FILIAL AND v.A3_COD = a3.A3_COD AND v.D_E_L_E_T_ = ' ');


-- ---------------------------------------------------------------------------------------------------------------------
-- 3. catalogo_no — SBM (grupo de produto) [P], um nível só. Subgrupos (SBM com BM_XPAI, ACU/ACV da categoria) são [C].
-- ---------------------------------------------------------------------------------------------------------------------
CREATE VIEW vw_macuxi_catalogo_no AS
SELECT
    CAST(RTRIM(bm.BM_GRUPO) AS VARCHAR(200))                 AS external_id,     -- [P]
    CAST(COALESCE(bm.S_T_A_M_P_, CAST('2000-01-01' AS DATETIME2)) AT TIME ZONE 'SA Western Standard Time' AT TIME ZONE 'UTC' AS DATETIME2(3)) AS alterado_em,
    CASE WHEN bm.D_E_L_E_T_ = '*' OR bm.BM_MSBLQL = '1' THEN 0 ELSE 1 END AS ativo, -- [C] BM_MSBLQL existe por release
    RTRIM(bm.BM_GRUPO)                                       AS codigo,
    RTRIM(bm.BM_DESC)                                        AS nome,            -- [P]
    CAST(NULL AS VARCHAR(200))                               AS pai_external_id, -- raiz
    1                                                        AS nivel,
    0                                                        AS ordem
FROM SBM010 bm
WHERE bm.D_E_L_E_T_ = ' ';                                                       -- excluído sai na carga completa (RN-INT-06)


-- ---------------------------------------------------------------------------------------------------------------------
-- 4. forma_pagamento — tabela genérica SX5 '24' (formas de pagamento: R$, CH, BOL...) [C]: a tabela genérica e os códigos
--    mudam por parametrização. É a mesma forma que a condição cita em E4_FORMA [C].
-- ---------------------------------------------------------------------------------------------------------------------
CREATE VIEW vw_macuxi_forma_pagamento AS
SELECT
    CAST(RTRIM(x5.X5_CHAVE) AS VARCHAR(200))                 AS external_id,     -- [C]
    CAST(COALESCE(x5.S_T_A_M_P_, CAST('2000-01-01' AS DATETIME2)) AT TIME ZONE 'SA Western Standard Time' AT TIME ZONE 'UTC' AS DATETIME2(3)) AS alterado_em,
    1                                                        AS ativo,
    UPPER(RTRIM(x5.X5_CHAVE))                                AS codigo,
    RTRIM(x5.X5_DESCRI)                                      AS nome,
    0                                                        AS ordem
FROM SX5010 x5
WHERE x5.X5_TABELA = '24'                                                        -- [C] tabela genérica das formas
  AND x5.D_E_L_E_T_ = ' ';


-- ---------------------------------------------------------------------------------------------------------------------
-- 5. prazo_pagamento — SE4 (condição de pagamento) [P]. E4_COND '30,60,90' vale para E4_TIPO = '1' [P]; os outros tipos
--    (2 a 9, A, B) têm outra sintaxe e ficam de fora até o cliente confirmar quais usa [C].
-- ---------------------------------------------------------------------------------------------------------------------
CREATE VIEW vw_macuxi_prazo_pagamento AS
SELECT
    CAST(RTRIM(e4.E4_CODIGO) AS VARCHAR(200))                AS external_id,     -- [P]
    CAST(COALESCE(e4.S_T_A_M_P_, CAST('2000-01-01' AS DATETIME2)) AT TIME ZONE 'SA Western Standard Time' AT TIME ZONE 'UTC' AS DATETIME2(3)) AS alterado_em,
    CASE WHEN e4.D_E_L_E_T_ = '*' OR e4.E4_MSBLQL = '1' THEN 0 ELSE 1 END AS ativo,
    CAST(RTRIM(e4.E4_FORMA) AS VARCHAR(200))                 AS forma_external_id, -- [C] E4_FORMA preenchido = chave da view 4
    UPPER(RTRIM(e4.E4_CODIGO))                               AS codigo,
    NULLIF(RTRIM(e4.E4_DESCRI), '')                          AS descricao,       -- [P]
    '[' + REPLACE(RTRIM(e4.E4_COND), ' ', '') + ']'          AS parcelas_dias,   -- [P] '30,60,90' -> '[30,60,90]'; '0' = à vista
    0                                                        AS ordem
FROM SE4010 e4
WHERE e4.E4_TIPO = '1'                                                           -- [P] só o tipo 1 ("30,60,90")
  AND (e4.D_E_L_E_T_ = ' '
       OR NOT EXISTS (SELECT 1 FROM SE4010 v WHERE v.E4_FILIAL = e4.E4_FILIAL AND v.E4_CODIGO = e4.E4_CODIGO AND v.D_E_L_E_T_ = ' '));


-- ---------------------------------------------------------------------------------------------------------------------
-- 6. produto — SB1 [P]. Só produto acabado/mercadoria (B1_TIPO 'PA'/'ME') [C]. SB1 exclusiva: filtre a filial (cabeçalho).
-- ---------------------------------------------------------------------------------------------------------------------
CREATE VIEW vw_macuxi_produto AS
SELECT
    CAST(RTRIM(b1.B1_COD) AS VARCHAR(200))                   AS external_id,     -- [P]
    CAST(COALESCE(b1.S_T_A_M_P_, CAST('2000-01-01' AS DATETIME2)) AT TIME ZONE 'SA Western Standard Time' AT TIME ZONE 'UTC' AS DATETIME2(3)) AS alterado_em,
    CASE WHEN b1.D_E_L_E_T_ = '*' OR b1.B1_MSBLQL = '1' THEN 0 ELSE 1 END AS ativo,
    RTRIM(b1.B1_COD)                                         AS sku,
    NULLIF(RTRIM(b1.B1_CODBAR), '')                          AS ean,             -- [P]
    RTRIM(b1.B1_DESC)                                        AS nome,            -- [P]
    UPPER(RTRIM(b1.B1_UM))                                   AS unidade,         -- [P] unidade base
    -- 2ª unidade com B1_TIPCONV = 'M' (multiplica) e fator inteiro = embalagem; 'D' (divide) não é embalagem [P]
    CASE WHEN b1.B1_TIPCONV = 'M' AND b1.B1_CONV >= 2 AND b1.B1_CONV = FLOOR(b1.B1_CONV)
         THEN NULLIF(UPPER(RTRIM(b1.B1_SEGUM)), '') END      AS embalagem_medida,
    CASE WHEN b1.B1_TIPCONV = 'M' AND b1.B1_CONV >= 2 AND b1.B1_CONV = FLOOR(b1.B1_CONV) AND RTRIM(b1.B1_SEGUM) <> ''
         THEN CAST(b1.B1_CONV AS INT) END                    AS embalagem_quantidade,
    CAST(NULLIF(RTRIM(b1.B1_GRUPO), '') AS VARCHAR(200))     AS catalogo_no_external_id, -- [P] chave da view 3
    CAST(ROUND(b1.B1_CUSTD * 100, 0) AS DECIMAL(19,0))       AS custo_cents,     -- [C] custo standard; o médio fica na SB2
    CAST(ROUND(b1.B1_PRV1 * 100, 0) AS DECIMAL(19,0))        AS preco_venda_cents -- [P] preço de venda base (a tabela vale mais)
FROM SB1010 b1
WHERE b1.B1_TIPO IN ('PA', 'ME')                                                 -- [C]
  AND (b1.D_E_L_E_T_ = ' '
       OR NOT EXISTS (SELECT 1 FROM SB1010 v WHERE v.B1_FILIAL = b1.B1_FILIAL AND v.B1_COD = b1.B1_COD AND v.D_E_L_E_T_ = ' '));


-- ---------------------------------------------------------------------------------------------------------------------
-- 7. produto_unidade — a 2ª unidade da SB1 (B1_SEGUM + B1_CONV) [P]. Embalagens além da 2ª (SLK, SB5) são [C].
-- ---------------------------------------------------------------------------------------------------------------------
CREATE VIEW vw_macuxi_produto_unidade AS
SELECT
    CONCAT(RTRIM(b1.B1_COD), ':', UPPER(RTRIM(b1.B1_SEGUM))) AS external_id,     -- produto:medida
    CAST(COALESCE(b1.S_T_A_M_P_, CAST('2000-01-01' AS DATETIME2)) AT TIME ZONE 'SA Western Standard Time' AT TIME ZONE 'UTC' AS DATETIME2(3)) AS alterado_em,
    CASE WHEN b1.D_E_L_E_T_ = '*' OR b1.B1_MSBLQL = '1' THEN 0 ELSE 1 END AS ativo,
    CAST(RTRIM(b1.B1_COD) AS VARCHAR(200))                   AS produto_external_id,
    UPPER(RTRIM(b1.B1_SEGUM))                                AS unidade,
    CAST(b1.B1_CONV AS INT)                                  AS fator,           -- [P] B1_TIPCONV = 'M': 1 SEGUM = B1_CONV UM
    CAST(NULL AS VARCHAR(14))                                AS ean,             -- [C] EAN da caixa (DUN-14) fica em campo do cliente
    0                                                        AS padrao
FROM SB1010 b1
WHERE b1.B1_TIPCONV = 'M' AND b1.B1_CONV >= 2 AND b1.B1_CONV = FLOOR(b1.B1_CONV) AND RTRIM(b1.B1_SEGUM) <> ''
  AND b1.B1_TIPO IN ('PA', 'ME')
  AND (b1.D_E_L_E_T_ = ' '
       OR NOT EXISTS (SELECT 1 FROM SB1010 v WHERE v.B1_FILIAL = b1.B1_FILIAL AND v.B1_COD = b1.B1_COD AND v.D_E_L_E_T_ = ' '));


-- ---------------------------------------------------------------------------------------------------------------------
-- 8. preco — DA0 (cabeçalho, vigência) e DA1 (itens) [P]. DA0_DATATE vazia = sem fim. DA1_ATIVO = '1' ativo [P].
--    Tabela por filial: DA0 exclusiva (DA0_FILIAL) [C]; compartilhada = filial_external_id NULL (filial padrão).
-- ---------------------------------------------------------------------------------------------------------------------
CREATE VIEW vw_macuxi_preco AS
SELECT
    CONCAT(RTRIM(da1.DA1_FILIAL), ':', RTRIM(da1.DA1_CODTAB), ':', RTRIM(da1.DA1_CODPRO), ':', RTRIM(da1.DA1_ITEM)) AS external_id,
    CAST(COALESCE(da1.S_T_A_M_P_, CAST('2000-01-01' AS DATETIME2)) AT TIME ZONE 'SA Western Standard Time' AT TIME ZONE 'UTC' AS DATETIME2(3)) AS alterado_em,
    CASE WHEN da1.D_E_L_E_T_ = '*' OR da1.DA1_ATIVO <> '1' OR da0.DA0_ATIVO <> '1' THEN 0 ELSE 1 END AS ativo,
    CAST(RTRIM(da1.DA1_CODTAB) AS VARCHAR(200))              AS tabela_external_id, -- [P] a mesma chave de SA1.A1_TABELA
    RTRIM(da0.DA0_DESCRI)                                    AS tabela_nome,
    -- [Oracle]     TO_CHAR(TO_DATE(COALESCE(NULLIF(TRIM(da1.DA1_DATVIG), ''), TRIM(da0.DA0_DATDE)), 'YYYYMMDD'), 'YYYY-MM-DD') AS vigencia_inicio,
    -- [SQL Server] início do item (DA1_DATVIG) ou da tabela (DA0_DATDE) [P]
    CONVERT(CHAR(10), CONVERT(DATE, COALESCE(NULLIF(RTRIM(da1.DA1_DATVIG), ''), RTRIM(da0.DA0_DATDE)), 112), 23) AS vigencia_inicio,
    CONVERT(CHAR(10), CONVERT(DATE, NULLIF(RTRIM(da0.DA0_DATATE), ''), 112), 23) AS vigencia_fim,
    CAST(RTRIM(da1.DA1_CODPRO) AS VARCHAR(200))              AS produto_external_id,
    CAST(ROUND(da1.DA1_PRCVEN * 100, 0) AS DECIMAL(19,0))    AS preco_cents,     -- [P]
    CAST(NULL AS VARCHAR(4))                                 AS unidade,         -- preço na unidade base (B1_UM)
    CAST(NULLIF(RTRIM(da1.DA1_FILIAL), '') AS VARCHAR(200))  AS filial_external_id
FROM DA1010 da1
JOIN DA0010 da0 ON da0.DA0_FILIAL = da1.DA1_FILIAL AND da0.DA0_CODTAB = da1.DA1_CODTAB AND da0.D_E_L_E_T_ = ' '
WHERE da1.D_E_L_E_T_ = ' '
   OR NOT EXISTS (SELECT 1 FROM DA1010 v WHERE v.DA1_FILIAL = da1.DA1_FILIAL AND v.DA1_CODTAB = da1.DA1_CODTAB
                                          AND v.DA1_ITEM = da1.DA1_ITEM AND v.D_E_L_E_T_ = ' ');


-- ---------------------------------------------------------------------------------------------------------------------
-- 10. estoque — SB2 por filial e armazém (B2_LOCAL) [P]. Saldo = B2_QATU − B2_RESERVA − B2_QEMP [P]. Nome do armazém na NNR [C].
--     Quais armazéns vendem (ex.: só o '01') é [C]: filtre B2_LOCAL.
-- ---------------------------------------------------------------------------------------------------------------------
CREATE VIEW vw_macuxi_estoque AS
SELECT
    CONCAT(RTRIM(b2.B2_FILIAL), ':', RTRIM(b2.B2_LOCAL), ':', RTRIM(b2.B2_COD)) AS external_id, -- filial:armazém:produto
    CAST(COALESCE(b2.S_T_A_M_P_, CAST('2000-01-01' AS DATETIME2)) AT TIME ZONE 'SA Western Standard Time' AT TIME ZONE 'UTC' AS DATETIME2(3)) AS alterado_em,
    1                                                        AS ativo,
    CONCAT(RTRIM(b2.B2_FILIAL), ':', RTRIM(b2.B2_LOCAL))     AS deposito_external_id,
    (SELECT MAX(RTRIM(nr.NNR_DESCRI)) FROM NNR010 nr
      WHERE nr.NNR_CODIGO = b2.B2_LOCAL AND nr.D_E_L_E_T_ = ' ') AS deposito_nome, -- [C] NNR (12.1.x)
    CAST(RTRIM(b2.B2_COD) AS VARCHAR(200))                   AS produto_external_id,
    b2.B2_QATU - b2.B2_RESERVA - b2.B2_QEMP                  AS saldo,           -- [P]
    CAST(NULLIF(RTRIM(b2.B2_FILIAL), '') AS VARCHAR(200))    AS filial_external_id
FROM SB2010 b2
WHERE b2.D_E_L_E_T_ = ' ';


-- ---------------------------------------------------------------------------------------------------------------------
-- 11. cliente — SA1 [P]. external_id = A1_COD:A1_LOJA (a loja é um estabelecimento do mesmo cliente). O CNPJ (A1_CGC) vai só
--     em "documento". Forma por cliente: o Protheus não controla (NULL = vale o BKO) [P].
-- ---------------------------------------------------------------------------------------------------------------------
CREATE VIEW vw_macuxi_cliente AS
SELECT
    CONCAT(RTRIM(a1.A1_COD), ':', RTRIM(a1.A1_LOJA))         AS external_id,     -- [P] código:loja, nunca o A1_CGC
    CAST(COALESCE(a1.S_T_A_M_P_, CAST('2000-01-01' AS DATETIME2)) AT TIME ZONE 'SA Western Standard Time' AT TIME ZONE 'UTC' AS DATETIME2(3)) AS alterado_em,
    CASE WHEN a1.D_E_L_E_T_ = '*' THEN 0 ELSE 1 END          AS ativo,
    RTRIM(a1.A1_NOME)                                        AS razao_social,    -- [P]
    NULLIF(RTRIM(a1.A1_NREDUZ), '')                          AS nome_fantasia,   -- [P]
    NULLIF(RTRIM(a1.A1_CGC), '')                             AS documento,       -- [P] CNPJ/CPF, só dígitos
    CAST(NULLIF(RTRIM(a1.A1_VEND), '') AS VARCHAR(200))      AS vendedor_external_id, -- [P] carteira (view 2)
    RTRIM(a1.A1_END)                                         AS endereco_logradouro, -- [P] com o número no mesmo campo
    CAST(NULL AS VARCHAR(20))                                AS endereco_numero,
    NULLIF(RTRIM(a1.A1_COMPLEM), '')                         AS endereco_complemento, -- [C] por release
    NULLIF(RTRIM(a1.A1_BAIRRO), '')                          AS endereco_bairro,
    RTRIM(a1.A1_MUN)                                         AS endereco_cidade, -- [P]
    UPPER(RTRIM(a1.A1_EST))                                  AS endereco_uf,     -- [P]
    NULLIF(RTRIM(a1.A1_CEP), '')                             AS endereco_cep,
    NULLIF(RTRIM(a1.A1_TEL), '')                             AS telefone,
    NULLIF(RTRIM(a1.A1_EMAIL), '')                           AS email,
    CAST(ROUND(a1.A1_LC * 100, 0) AS DECIMAL(19,0))          AS limite_credito_cents, -- [P] limite de crédito
    NULLIF(RTRIM(a1.A1_INSCR), '')                           AS inscricao_estadual,
    CASE WHEN a1.A1_MSBLQL = '1' THEN 1 ELSE 0 END           AS bloqueado,       -- [P]; risco (A1_RISCO 'E') é [C]
    CAST(NULL AS VARCHAR(60))                                AS canal,           -- [C] segmento (A1_SATIV1) se o cliente usar
    CAST(NULL AS INT)                                        AS prazo_medio_max_dias, -- o Protheus não controla: vale o BKO
    CAST(NULL AS VARCHAR(1))                                 AS formas_pagamento,     -- idem
    CAST(NULLIF(RTRIM(a1.A1_TABELA), '') AS VARCHAR(200))    AS tabela_preco_external_id, -- [P] DA0_CODTAB; vazio = não altera
    CAST(NULL AS VARCHAR(200))                               AS filial_external_id    -- SA1 costuma ser compartilhada [C]
FROM SA1010 a1
WHERE a1.D_E_L_E_T_ = ' '
   OR NOT EXISTS (SELECT 1 FROM SA1010 v WHERE v.A1_FILIAL = a1.A1_FILIAL AND v.A1_COD = a1.A1_COD
                                          AND v.A1_LOJA = a1.A1_LOJA AND v.D_E_L_E_T_ = ' ');
-- condição do cliente (A1_COND) não entra no cadastro: o prazo é escolhido no pedido (RN-VEN-24); restrinja no BKO se preciso.


-- ---------------------------------------------------------------------------------------------------------------------
-- 12. cliente_endereco — endereço de ENTREGA da própria SA1 (A1_ENDENT, A1_BAIRROE, A1_MUNE, A1_ESTE, A1_CEPE) [P], um por
--     cliente. Vários endereços de entrega por cliente são customização (tabela do cliente) [C].
-- ---------------------------------------------------------------------------------------------------------------------
CREATE VIEW vw_macuxi_cliente_endereco AS
SELECT
    CONCAT(RTRIM(a1.A1_COD), ':', RTRIM(a1.A1_LOJA), ':E')   AS external_id,     -- código:loja:E
    CAST(COALESCE(a1.S_T_A_M_P_, CAST('2000-01-01' AS DATETIME2)) AT TIME ZONE 'SA Western Standard Time' AT TIME ZONE 'UTC' AS DATETIME2(3)) AS alterado_em,
    CASE WHEN a1.D_E_L_E_T_ = '*' THEN 0 ELSE 1 END          AS ativo,           -- entrega apagada sai na carga completa
    CONCAT(RTRIM(a1.A1_COD), ':', RTRIM(a1.A1_LOJA))         AS cliente_external_id,
    'entrega'                                                AS tipo,
    RTRIM(a1.A1_ENDENT)                                      AS logradouro,
    CASE WHEN RTRIM(a1.A1_MUNE) = '' THEN RTRIM(a1.A1_MUN) ELSE RTRIM(a1.A1_MUNE) END AS cidade,
    UPPER(CASE WHEN RTRIM(a1.A1_ESTE) = '' THEN RTRIM(a1.A1_EST) ELSE RTRIM(a1.A1_ESTE) END) AS uf,
    NULLIF(RTRIM(a1.A1_BAIRROE), '')                         AS bairro,
    NULLIF(RTRIM(a1.A1_CEPE), '')                            AS cep,
    0                                                        AS principal
FROM SA1010 a1
WHERE RTRIM(a1.A1_ENDENT) <> ''
  AND (a1.D_E_L_E_T_ = ' '
   OR NOT EXISTS (SELECT 1 FROM SA1010 v WHERE v.A1_FILIAL = a1.A1_FILIAL AND v.A1_COD = a1.A1_COD
                                          AND v.A1_LOJA = a1.A1_LOJA AND v.D_E_L_E_T_ = ' '));


-- ---------------------------------------------------------------------------------------------------------------------
-- 13. transportadora — SA4 [P].
-- ---------------------------------------------------------------------------------------------------------------------
CREATE VIEW vw_macuxi_transportadora AS
SELECT
    CAST(RTRIM(a4.A4_COD) AS VARCHAR(200))                   AS external_id,     -- [P]
    CAST(COALESCE(a4.S_T_A_M_P_, CAST('2000-01-01' AS DATETIME2)) AT TIME ZONE 'SA Western Standard Time' AT TIME ZONE 'UTC' AS DATETIME2(3)) AS alterado_em,
    CASE WHEN a4.D_E_L_E_T_ = '*' OR a4.A4_MSBLQL = '1' THEN 0 ELSE 1 END AS ativo,
    RTRIM(a4.A4_NOME)                                        AS nome,            -- [P]
    NULLIF(REPLACE(REPLACE(REPLACE(RTRIM(a4.A4_CGC), '.', ''), '/', ''), '-', ''), '') AS documento,
    NULLIF(RTRIM(a4.A4_INSEST), '')                          AS inscricao_estadual, -- [C]
    NULLIF(RTRIM(a4.A4_TEL), '')                             AS telefone
FROM SA4010 a4
WHERE a4.D_E_L_E_T_ = ' '
   OR NOT EXISTS (SELECT 1 FROM SA4010 v WHERE v.A4_FILIAL = a4.A4_FILIAL AND v.A4_COD = a4.A4_COD AND v.D_E_L_E_T_ = ' ');


-- ---------------------------------------------------------------------------------------------------------------------
-- 15. titulo — SE1 (contas a receber) [P]. Chave prefixo:número:parcela:tipo (com a filial). Fora: abatimentos e adiantamentos
--     (E1_TIPO 'AB-', 'RA', 'NCC') [C]. E1_PARCELA é letra ou número conforme MV_1DUP [C]: só o número vira "parcela".
-- ---------------------------------------------------------------------------------------------------------------------
CREATE VIEW vw_macuxi_titulo AS
SELECT
    CONCAT(RTRIM(e1.E1_FILIAL), ':', RTRIM(e1.E1_PREFIXO), ':', RTRIM(e1.E1_NUM), ':', RTRIM(e1.E1_PARCELA), ':', RTRIM(e1.E1_TIPO)) AS external_id,
    CAST(COALESCE(e1.S_T_A_M_P_, CAST('2000-01-01' AS DATETIME2)) AT TIME ZONE 'SA Western Standard Time' AT TIME ZONE 'UTC' AS DATETIME2(3)) AS alterado_em,
    1                                                        AS ativo,           -- excluído vai em "situacao" = cancelado
    CONCAT(RTRIM(e1.E1_CLIENTE), ':', RTRIM(e1.E1_LOJA))     AS cliente_external_id, -- a chave da view 11
    CONCAT(RTRIM(e1.E1_PREFIXO), RTRIM(e1.E1_NUM))           AS numero,
    -- [Oracle]     CASE WHEN REGEXP_LIKE(TRIM(e1.E1_PARCELA), '^[0-9]+$') THEN TO_NUMBER(TRIM(e1.E1_PARCELA)) END AS parcela,
    -- [SQL Server]
    TRY_CAST(NULLIF(RTRIM(e1.E1_PARCELA), '') AS INT)        AS parcela,
    CONVERT(CHAR(10), CONVERT(DATE, NULLIF(RTRIM(e1.E1_EMISSAO), ''), 112), 23) AS emissao,
    CONVERT(CHAR(10), CONVERT(DATE, RTRIM(e1.E1_VENCREA), 112), 23) AS vencimento, -- [P] vencimento real
    CAST(ROUND(e1.E1_VALOR * 100, 0) AS DECIMAL(19,0))       AS valor_cents,
    CAST(ROUND(e1.E1_SALDO * 100, 0) AS DECIMAL(19,0))       AS saldo_cents,
    CASE WHEN e1.D_E_L_E_T_ = '*' THEN 'cancelado'
         WHEN e1.E1_SALDO = 0 THEN 'baixado'
         ELSE 'aberto' END                                   AS situacao,
    -- E1_BAIXA é só data (sem hora): meia-noite local convertida para UTC [P]
    CAST(CAST(CONVERT(DATE, NULLIF(RTRIM(e1.E1_BAIXA), ''), 112) AS DATETIME2) AT TIME ZONE 'SA Western Standard Time' AT TIME ZONE 'UTC' AS DATETIME2(3)) AS baixado_em,
    CASE WHEN RTRIM(e1.E1_TIPO) = 'NF' THEN CAST(RTRIM(e1.E1_NUM) AS VARCHAR(40)) END AS nf_numero, -- [P] título da NF
    CASE WHEN RTRIM(e1.E1_TIPO) = 'NF' THEN CAST(RTRIM(e1.E1_PREFIXO) AS VARCHAR(10)) END AS nf_serie, -- [C] prefixo = série
    CAST(NULL AS VARCHAR(120))                               AS forma_pagamento  -- [C] E1_TIPO (BOL, CH...) se o cliente quiser
FROM SE1010 e1
WHERE RTRIM(e1.E1_TIPO) NOT IN ('AB-', 'RA', 'NCC')                              -- [C]
  AND (e1.D_E_L_E_T_ = ' '
       OR NOT EXISTS (SELECT 1 FROM SE1010 v WHERE v.E1_FILIAL = e1.E1_FILIAL AND v.E1_PREFIXO = e1.E1_PREFIXO AND v.E1_NUM = e1.E1_NUM
                                              AND v.E1_PARCELA = e1.E1_PARCELA AND v.E1_TIPO = e1.E1_TIPO AND v.D_E_L_E_T_ = ' '));


-- ---------------------------------------------------------------------------------------------------------------------
-- 16. nota — saída SF2 (F2_TIPO 'N') e devolução SF1 com F1_TIPO = 'D' [P]. pedido_uuid pelo SD2 -> SC5.C5_XMXUUID [C].
--     A nota excluída (cancelada) fica com D_E_L_E_T_ = '*' [P].
-- ---------------------------------------------------------------------------------------------------------------------
CREATE VIEW vw_macuxi_nota AS
SELECT
    CONCAT('S:', RTRIM(f2.F2_FILIAL), ':', RTRIM(f2.F2_SERIE), ':', RTRIM(f2.F2_DOC), ':', RTRIM(f2.F2_CLIENTE), ':', RTRIM(f2.F2_LOJA)) AS external_id,
    CAST(COALESCE(f2.S_T_A_M_P_, CAST('2000-01-01' AS DATETIME2)) AT TIME ZONE 'SA Western Standard Time' AT TIME ZONE 'UTC' AS DATETIME2(3)) AS alterado_em,
    1                                                        AS ativo,           -- cancelamento vai em "cancelada"
    CONCAT(RTRIM(f2.F2_CLIENTE), ':', RTRIM(f2.F2_LOJA))     AS cliente_external_id,
    CAST(NULLIF(RTRIM(f2.F2_VEND1), '') AS VARCHAR(200))     AS vendedor_external_id, -- [P]
    'faturamento'                                            AS tipo,
    RTRIM(f2.F2_DOC)                                         AS numero,
    NULLIF(RTRIM(f2.F2_SERIE), '')                           AS serie,
    -- emissão: data (F2_EMISSAO) + hora (F2_HORA 'HH:MM') [C], hora local -> UTC
    CAST(CAST(CONCAT(CONVERT(CHAR(10), CONVERT(DATE, f2.F2_EMISSAO, 112), 23), ' ', COALESCE(NULLIF(RTRIM(f2.F2_HORA), ''), '00:00')) AS DATETIME2)
         AT TIME ZONE 'SA Western Standard Time' AT TIME ZONE 'UTC' AS DATETIME2(3)) AS emitida_em,
    CAST(ROUND(f2.F2_VALBRUT * 100, 0) AS DECIMAL(19,0))     AS total_cents,     -- [P]
    (SELECT COUNT(*) FROM SD2010 d2 WHERE d2.D2_FILIAL = f2.F2_FILIAL AND d2.D2_DOC = f2.F2_DOC AND d2.D2_SERIE = f2.F2_SERIE
        AND d2.D2_CLIENTE = f2.F2_CLIENTE AND d2.D2_LOJA = f2.F2_LOJA AND d2.D_E_L_E_T_ = ' ') AS quantidade_itens,
    (SELECT MAX(RTRIM(c5.C5_XMXUUID)) FROM SD2010 d2
       JOIN SC5010 c5 ON c5.C5_FILIAL = d2.D2_FILIAL AND c5.C5_NUM = d2.D2_PEDIDO AND c5.D_E_L_E_T_ = ' '
      WHERE d2.D2_FILIAL = f2.F2_FILIAL AND d2.D2_DOC = f2.F2_DOC AND d2.D2_SERIE = f2.F2_SERIE
        AND d2.D2_CLIENTE = f2.F2_CLIENTE AND d2.D2_LOJA = f2.F2_LOJA AND RTRIM(c5.C5_XMXUUID) <> '') AS pedido_uuid, -- [C]
    CASE WHEN f2.D_E_L_E_T_ = '*' THEN 1 ELSE 0 END          AS cancelada,
    CAST(NULL AS VARCHAR(120))                               AS forma_pagamento,
    CAST(NULL AS VARCHAR(40))                                AS nf_origem_numero,
    CAST(NULL AS VARCHAR(10))                                AS nf_origem_serie
FROM SF2010 f2
WHERE f2.F2_TIPO = 'N'                                                           -- [P] nota normal de venda
UNION ALL
SELECT
    CONCAT('E:', RTRIM(f1.F1_FILIAL), ':', RTRIM(f1.F1_SERIE), ':', RTRIM(f1.F1_DOC), ':', RTRIM(f1.F1_FORNECE), ':', RTRIM(f1.F1_LOJA)),
    CAST(COALESCE(f1.S_T_A_M_P_, CAST('2000-01-01' AS DATETIME2)) AT TIME ZONE 'SA Western Standard Time' AT TIME ZONE 'UTC' AS DATETIME2(3)),
    1,
    CONCAT(RTRIM(f1.F1_FORNECE), ':', RTRIM(f1.F1_LOJA)),    -- [P] na devolução, F1_FORNECE/F1_LOJA é o cliente (SA1)
    CAST(NULL AS VARCHAR(200)),
    'devolucao',
    RTRIM(f1.F1_DOC),
    NULLIF(RTRIM(f1.F1_SERIE), ''),
    CAST(CAST(CONVERT(DATE, f1.F1_EMISSAO, 112) AS DATETIME2) AT TIME ZONE 'SA Western Standard Time' AT TIME ZONE 'UTC' AS DATETIME2(3)),
    CAST(ROUND(f1.F1_VALBRUT * 100, 0) AS DECIMAL(19,0)),
    CAST(NULL AS INT),
    CAST(NULL AS VARCHAR(36)),
    CASE WHEN f1.D_E_L_E_T_ = '*' THEN 1 ELSE 0 END,
    CAST(NULL AS VARCHAR(120)),
    (SELECT MAX(CAST(RTRIM(d1.D1_NFORI) AS VARCHAR(40))) FROM SD1010 d1      -- [P] D1_NFORI/D1_SERIORI = NF de origem
      WHERE d1.D1_FILIAL = f1.F1_FILIAL AND d1.D1_DOC = f1.F1_DOC AND d1.D1_SERIE = f1.F1_SERIE
        AND d1.D1_FORNECE = f1.F1_FORNECE AND d1.D1_LOJA = f1.F1_LOJA AND d1.D_E_L_E_T_ = ' '),
    (SELECT MAX(CAST(RTRIM(d1.D1_SERIORI) AS VARCHAR(10))) FROM SD1010 d1
      WHERE d1.D1_FILIAL = f1.F1_FILIAL AND d1.D1_DOC = f1.F1_DOC AND d1.D1_SERIE = f1.F1_SERIE
        AND d1.D1_FORNECE = f1.F1_FORNECE AND d1.D1_LOJA = f1.F1_LOJA AND d1.D_E_L_E_T_ = ' ')
FROM SF1010 f1
WHERE f1.F1_TIPO = 'D';                                                          -- [P] devolução de venda


-- ---------------------------------------------------------------------------------------------------------------------
-- 17. pedido_status (RETORNO, RN-INT-08) — a situação vem da entrada (macuxi_pedido_entrada: 'R' quando a MATA410 recusa) e
--     do SC5 achado pelo C5_XMXUUID [C]; as notas, do SD2 -> SF2. Mesmas regras da view 17 do views-modelo.sql: faturado
--     (P/F) só sai com nota; rejeitado sempre com motivo. Pedido todo entregue (C6_QTDENT >= C6_QTDVEN em todos os itens) = F.
-- ---------------------------------------------------------------------------------------------------------------------
CREATE VIEW vw_macuxi_pedido_status AS
SELECT
    LOWER(CAST(e.pedido_uuid AS VARCHAR(36)))                AS pedido_uuid,
    CASE WHEN e.situacao = 'R' THEN 'R' WHEN c5.D_E_L_E_T_ = '*' THEN 'C' ELSE 'I' END AS situacao,
    CAST(COALESCE(RTRIM(c5.C5_NUM), CAST(e.numero_pedido AS VARCHAR(40))) AS VARCHAR(40)) AS numero_pedido, -- [P] C5_NUM
    CASE WHEN e.situacao = 'R' THEN COALESCE(NULLIF(LTRIM(RTRIM(e.motivo)), ''), 'Recusado no ERP')
         ELSE NULLIF(LTRIM(RTRIM(e.motivo)), '') END         AS motivo,
    CAST(NULL AS VARCHAR(40))                                AS nota_numero,
    CAST(NULL AS VARCHAR(10))                                AS nota_serie,
    CAST(NULL AS DATETIME2(3))                               AS nota_emitida_em,
    CAST(NULL AS DECIMAL(19,0))                              AS nota_total_cents,
    CASE WHEN c5.D_E_L_E_T_ = '*' AND c5.S_T_A_M_P_ IS NOT NULL
         THEN CAST(c5.S_T_A_M_P_ AT TIME ZONE 'SA Western Standard Time' AT TIME ZONE 'UTC' AS DATETIME2(3))
         ELSE e.recebido_em END                              AS ocorrido_em      -- recebido_em já está em UTC
FROM dbo.macuxi_pedido_entrada e
LEFT JOIN SC5010 c5 ON RTRIM(c5.C5_XMXUUID) = LOWER(CAST(e.pedido_uuid AS VARCHAR(36)))
UNION ALL
SELECT
    RTRIM(c5.C5_XMXUUID),
    CASE WHEN NOT EXISTS (SELECT 1 FROM SC6010 c6 WHERE c6.C6_FILIAL = c5.C5_FILIAL AND c6.C6_NUM = c5.C5_NUM
                                                  AND c6.D_E_L_E_T_ = ' ' AND c6.C6_QTDENT < c6.C6_QTDVEN)
         THEN 'F' ELSE 'P' END,
    CAST(RTRIM(c5.C5_NUM) AS VARCHAR(40)),
    CAST(NULL AS VARCHAR(300)),
    CAST(RTRIM(f2.F2_DOC) AS VARCHAR(40)),
    CAST(RTRIM(f2.F2_SERIE) AS VARCHAR(10)),
    CAST(CAST(CONCAT(CONVERT(CHAR(10), CONVERT(DATE, f2.F2_EMISSAO, 112), 23), ' ', COALESCE(NULLIF(RTRIM(f2.F2_HORA), ''), '00:00')) AS DATETIME2)
         AT TIME ZONE 'SA Western Standard Time' AT TIME ZONE 'UTC' AS DATETIME2(3)),
    CAST(ROUND(f2.F2_VALBRUT * 100, 0) AS DECIMAL(19,0)),
    CAST(CAST(CONCAT(CONVERT(CHAR(10), CONVERT(DATE, f2.F2_EMISSAO, 112), 23), ' ', COALESCE(NULLIF(RTRIM(f2.F2_HORA), ''), '00:00')) AS DATETIME2)
         AT TIME ZONE 'SA Western Standard Time' AT TIME ZONE 'UTC' AS DATETIME2(3))
FROM SC5010 c5
JOIN (SELECT DISTINCT D2_FILIAL, D2_PEDIDO, D2_DOC, D2_SERIE, D2_CLIENTE, D2_LOJA FROM SD2010 WHERE D_E_L_E_T_ = ' ') d2
  ON d2.D2_FILIAL = c5.C5_FILIAL AND d2.D2_PEDIDO = c5.C5_NUM
JOIN SF2010 f2 ON f2.F2_FILIAL = d2.D2_FILIAL AND f2.F2_DOC = d2.D2_DOC AND f2.F2_SERIE = d2.D2_SERIE
              AND f2.F2_CLIENTE = d2.D2_CLIENTE AND f2.F2_LOJA = d2.D2_LOJA AND f2.D_E_L_E_T_ = ' '
WHERE RTRIM(c5.C5_XMXUUID) <> '' AND c5.D_E_L_E_T_ = ' ';


-- ---------------------------------------------------------------------------------------------------------------------
-- 18. pedido_nota_item (RETORNO) — itens faturados (SD2) de cada nota do pedido. sequencia = item do pedido (D2_ITEMPV, '01'..)
--     convertido para número [C]: o job da MATA410 grava C6_ITEM a partir da sequência do Macuxi (até 99; acima disso o
--     Protheus usa letras e o cliente cria um campo C6_XMXSEQ) [C]. Quantidade na unidade base (D2_QUANT, UM) [P].
-- ---------------------------------------------------------------------------------------------------------------------
CREATE VIEW vw_macuxi_pedido_nota_item AS
SELECT
    RTRIM(c5.C5_XMXUUID)                                     AS pedido_uuid,
    CAST(RTRIM(d2.D2_DOC) AS VARCHAR(40))                    AS nota_numero,
    CAST(RTRIM(d2.D2_SERIE) AS VARCHAR(10))                  AS nota_serie,
    TRY_CAST(d2.D2_ITEMPV AS INT)                            AS sequencia,       -- [C]
    CAST(d2.D2_QUANT AS INT)                                 AS quantidade,
    CAST(ROUND(d2.D2_TOTAL * 100, 0) AS DECIMAL(19,0))       AS valor_cents,
    CAST(RTRIM(d2.D2_COD) AS VARCHAR(200))                   AS produto_codigo   -- a chave da view 6
FROM SD2010 d2
JOIN SC5010 c5 ON c5.C5_FILIAL = d2.D2_FILIAL AND c5.C5_NUM = d2.D2_PEDIDO AND c5.D_E_L_E_T_ = ' '
WHERE d2.D_E_L_E_T_ = ' ' AND RTRIM(c5.C5_XMXUUID) <> '';
