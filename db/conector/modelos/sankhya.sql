-- =====================================================================================================================
-- Macuxi FDV — MODELO de views do Conector para o Sankhya Om (ERP -> Hub /integracao/v1)
-- Status: beta (D9 do desenho: fica "beta" até o primeiro cliente Sankhya confirmar os itens [C]).
-- Dono: banco-dados. Desenho: docs/desenho/integracao-modelos-erp.md §3.4 (de-para) e §6 (F4b); ADR 0066.
-- Formato e regras de toda view: db/conector/views-modelo.sql (cabeçalho, regras 1 a 8). Dicionário: docs/banco/integracao.md,
-- "Modelos por ERP". Teste sem banco: db/testes/modelos-erp-conector.test.ts (colunas contra SCHEMA_REGISTRO).
-- NADA aqui é aplicado pelo Macuxi: o técnico do cliente (ou o parceiro Sankhya) revisa e cria as views no banco do Sankhya,
-- com o usuário somente leitura do Conector tendo SELECT nelas.
--
-- LEGENDA
--   [P] = conhecimento público (dicionário de dados Sankhya e uso amplo no mercado).
--   [C] = CONFIRMAR com o cliente antes de ligar: muda por versão, parametrização (TOPs, tipos de negociação) ou campo
--         adicional (AD_*).
--
-- QUANDO USAR ESTE MODELO
--   Cliente na nuvem da Sankhya: a API (gateway, CRUDServiceProvider.loadRecords; F4a do modulo-integracao), com contrato
--   [C]. Banco do próprio cliente (Oracle ou SQL Server): o Conector com estas views (§3.4).
--
-- REGRAS GERAIS DO SANKHYA [P]
--   - Chaves numéricas: CODPARC (parceiro), CODPROD, CODVEND, CODEMP (empresa = filial), NUNOTA (documento), NUFIN (financeiro).
--   - Ativo/inativo: ATIVO = 'S'/'N'; flags 'S'/'N' em geral (CLIENTE, TRANSPORTADORA, BLOQUEAR).
--   - Data de alteração: DTALTER (data e hora) na maior parte dos cadastros [P], na hora local: a view converte para UTC.
--   - Tipo de negociação (TGFTPV) e tabela de preço (TGFTAB) são versionados por data (DHALTER, DTVIGOR) [P].
--
-- DIALETO
--   Corpo em SQL Server (2017+). Para Oracle (muito comum no Sankhya), aplique as trocas do cabeçalho "DIALETOS" de
--   db/conector/views-modelo.sql (fuso, data civil, concatenação, listas JSON, TOP -> FETCH FIRST).
--
-- O QUE NÃO TEM VIEW NESTE MODELO
--   SEM VIEW: cliente_endereco — o Sankhya padrão tem um endereço no parceiro (já vai no cliente); entrega extra é
--             complemento (TGFCPL) ou contato, por cliente. [C]
--   SEM VIEW: tabela_escalonada — preço por faixa de quantidade não é padrão (política comercial customizada). [C]
--   SEM VIEW: rota — rota do Sankhya (TGFROT) é de entrega; o roteiro de visita nasce no Macuxi. [C]
--
-- PEDIDO (Macuxi -> ERP): pela API, CACSP.incluirNota com a TOP de pedido do cliente (TIPMOV = 'P') e o UUID no campo adicional
--   AD_MXUUID, consultado antes de criar (RN-INT-19; F4a). Pelo Conector: a entrada genérica
--   db/conector/entrada-pedido-modelo.sql e um job/ação agendada do parceiro que inclui a nota pela API interna [C]. As 2 views do
--   retorno (fim do arquivo) servem ao Conector.
-- =====================================================================================================================


-- ---------------------------------------------------------------------------------------------------------------------
-- 1. filial — empresa (TSIEMP) [P]; endereço por TSIEND/TSIBAI/TSICID/TSIUFS [P].
-- ---------------------------------------------------------------------------------------------------------------------
CREATE VIEW vw_macuxi_filial AS
SELECT
    CAST(e.CODEMP AS VARCHAR(200))                           AS external_id,     -- [P]
    CAST(CAST('2000-01-01' AS DATETIME2) AS DATETIME2(3))    AS alterado_em,     -- [C] sem data: carga completa
    1                                                        AS ativo,
    CAST(e.CODEMP AS VARCHAR(20))                            AS codigo,
    COALESCE(NULLIF(e.NOMEFANTASIA, ''), e.RAZAOSOCIAL)      AS nome,            -- [P]
    cid.NOMECID                                              AS cidade,          -- [P]
    UPPER(uf.UF)                                             AS uf,
    REPLACE(REPLACE(REPLACE(e.CGC, '.', ''), '/', ''), '-', '') AS cnpj,         -- [P]
    en.NOMEEND                                               AS logradouro,      -- [P]
    e.NUMEND                                                 AS numero,
    NULLIF(e.COMPLEMENTO, '')                                AS complemento,
    b.NOMEBAI                                                AS bairro,
    REPLACE(e.CEP, '-', '')                                  AS cep,
    NULLIF(e.TELEFONE, '')                                   AS telefone
FROM TSIEMP e
LEFT JOIN TSIEND en ON en.CODEND = e.CODEND
LEFT JOIN TSIBAI b ON b.CODBAI = e.CODBAI
LEFT JOIN TSICID cid ON cid.CODCID = e.CODCID
LEFT JOIN TSIUFS uf ON uf.CODUF = cid.UF;                                        -- [C] UF da cidade por código


-- ---------------------------------------------------------------------------------------------------------------------
-- 2. vendedor — TGFVEN [P]. CODVEND 0 é "sem vendedor" [P]; só o tipo vendedor (TIPVEND = 'V') [C].
-- ---------------------------------------------------------------------------------------------------------------------
CREATE VIEW vw_macuxi_vendedor AS
SELECT
    CAST(v.CODVEND AS VARCHAR(200))                          AS external_id,     -- [P]
    CAST(COALESCE(v.DTALTER, CAST('2000-01-01' AS DATETIME2)) AT TIME ZONE 'SA Western Standard Time' AT TIME ZONE 'UTC' AS DATETIME2(3)) AS alterado_em,
    CASE WHEN v.ATIVO = 'S' THEN 1 ELSE 0 END                AS ativo,           -- [P]
    v.APELIDO                                                AS nome,            -- [P]
    NULLIF(v.EMAIL, '')                                      AS email,           -- [P]
    CAST(NULLIF(v.CODEMP, 0) AS VARCHAR(200))                AS filial_external_id -- [C]
FROM TGFVEN v
WHERE v.CODVEND > 0 AND v.TIPVEND = 'V';                                         -- [C]


-- ---------------------------------------------------------------------------------------------------------------------
-- 3. catalogo_no — grupos de produto (TGFGRU), em árvore pelo CODGRUPAI e GRAU [P]. Raiz: CODGRUPAI 0 ou -1 [C].
-- ---------------------------------------------------------------------------------------------------------------------
CREATE VIEW vw_macuxi_catalogo_no AS
SELECT
    CAST(g.CODGRUPOPROD AS VARCHAR(200))                     AS external_id,     -- [P]
    CAST(COALESCE(g.DTALTER, CAST('2000-01-01' AS DATETIME2)) AT TIME ZONE 'SA Western Standard Time' AT TIME ZONE 'UTC' AS DATETIME2(3)) AS alterado_em, -- [C]
    CASE WHEN g.ATIVO = 'S' THEN 1 ELSE 0 END                AS ativo,
    CAST(g.CODGRUPOPROD AS VARCHAR(60))                      AS codigo,
    g.DESCRGRUPOPROD                                         AS nome,            -- [P]
    CASE WHEN g.CODGRUPAI > 0 THEN CAST(g.CODGRUPAI AS VARCHAR(200)) END AS pai_external_id, -- [P]
    CASE WHEN g.GRAU BETWEEN 1 AND 8 THEN g.GRAU ELSE 1 END  AS nivel,           -- [C] GRAU 1 = raiz
    0                                                        AS ordem
FROM TGFGRU g
WHERE g.CODGRUPOPROD > 0;


-- ---------------------------------------------------------------------------------------------------------------------
-- 4. forma_pagamento — tipo de título (TGFTIT: boleto, cheque, dinheiro...) [C]; é o tipo de título padrão das parcelas do
--    tipo de negociação (TGFPPG.CODTIPTITPAD) [C].
-- ---------------------------------------------------------------------------------------------------------------------
CREATE VIEW vw_macuxi_forma_pagamento AS
SELECT
    CAST(t.CODTIPTIT AS VARCHAR(200))                        AS external_id,     -- [C]
    CAST(CAST('2000-01-01' AS DATETIME2) AS DATETIME2(3))    AS alterado_em,
    CASE WHEN COALESCE(t.ATIVO, 'S') = 'S' THEN 1 ELSE 0 END AS ativo,           -- [C]
    CAST(t.CODTIPTIT AS VARCHAR(20))                         AS codigo,
    t.DESCRTIPTIT                                            AS nome,            -- [C]
    0                                                        AS ordem
FROM TGFTIT t
WHERE t.CODTIPTIT > 0;


-- ---------------------------------------------------------------------------------------------------------------------
-- 5. prazo_pagamento — tipo de negociação (TGFTPV), a versão mais nova por CODTIPVENDA (DHALTER) [P]; parcelas em TGFPPG
--    (PRAZO em dias) [P]. A forma é o tipo de título da 1ª parcela [C]. Só tipos de venda ativos (ATIVO = 'S') [C].
-- ---------------------------------------------------------------------------------------------------------------------
CREATE VIEW vw_macuxi_prazo_pagamento AS
SELECT
    CAST(t.CODTIPVENDA AS VARCHAR(200))                      AS external_id,     -- [P] o código, não a versão
    CAST(t.DHALTER AT TIME ZONE 'SA Western Standard Time' AT TIME ZONE 'UTC' AS DATETIME2(3)) AS alterado_em, -- [P]
    CASE WHEN t.ATIVO = 'S' THEN 1 ELSE 0 END                AS ativo,
    (SELECT TOP (1) CAST(p.CODTIPTITPAD AS VARCHAR(200)) FROM TGFPPG p
      WHERE p.CODTIPVENDA = t.CODTIPVENDA AND p.DHALTER = t.DHALTER ORDER BY p.SEQUENCIA) AS forma_external_id, -- [C]
    CAST(t.CODTIPVENDA AS VARCHAR(20))                       AS codigo,
    t.DESCRTIPVENDA                                          AS descricao,       -- [P]
    COALESCE((SELECT '[' + STRING_AGG(CAST(p.PRAZO AS VARCHAR(10)), ',') WITHIN GROUP (ORDER BY p.SEQUENCIA) + ']'
                FROM TGFPPG p WHERE p.CODTIPVENDA = t.CODTIPVENDA AND p.DHALTER = t.DHALTER), '[0]') AS parcelas_dias, -- [P]
    0                                                        AS ordem
FROM TGFTPV t
WHERE t.DHALTER = (SELECT MAX(x.DHALTER) FROM TGFTPV x WHERE x.CODTIPVENDA = t.CODTIPVENDA)
  AND t.CODTIPVENDA > 0;


-- ---------------------------------------------------------------------------------------------------------------------
-- 6. produto — TGFPRO [P]. Unidade padrão CODVOL [P]; EAN em REFERENCIA (uso comum) ou na TGFBAR [C].
-- ---------------------------------------------------------------------------------------------------------------------
CREATE VIEW vw_macuxi_produto AS
SELECT
    CAST(p.CODPROD AS VARCHAR(200))                          AS external_id,     -- [P]
    CAST(COALESCE(p.DTALTER, CAST('2000-01-01' AS DATETIME2)) AT TIME ZONE 'SA Western Standard Time' AT TIME ZONE 'UTC' AS DATETIME2(3)) AS alterado_em, -- [P]
    CASE WHEN p.ATIVO = 'S' THEN 1 ELSE 0 END                AS ativo,           -- [P]
    CAST(p.CODPROD AS VARCHAR(60))                           AS sku,
    NULLIF(p.REFERENCIA, '')                                 AS ean,             -- [C]
    p.DESCRPROD                                              AS nome,            -- [P]
    NULLIF(p.MARCA, '')                                      AS marca,           -- [P]
    UPPER(LEFT(p.CODVOL, 4))                                 AS unidade,         -- [P]
    CAST(p.CODGRUPOPROD AS VARCHAR(200))                     AS catalogo_no_external_id -- [P]
FROM TGFPRO p
WHERE p.USOPROD = 'R';                                                           -- [C] uso "revenda"; ajuste ao cliente


-- ---------------------------------------------------------------------------------------------------------------------
-- 7. produto_unidade — volumes alternativos (TGFVOA) [P]. DIVIDEMULTIPLICA = 'M' com QUANTIDADE inteira = embalagem [C].
-- ---------------------------------------------------------------------------------------------------------------------
CREATE VIEW vw_macuxi_produto_unidade AS
SELECT
    CONCAT(v.CODPROD, ':', UPPER(LEFT(v.CODVOL, 4)))         AS external_id,     -- produto:volume
    CAST(CAST('2000-01-01' AS DATETIME2) AS DATETIME2(3))    AS alterado_em,     -- [C] sem data: carga completa
    CASE WHEN COALESCE(v.ATIVO, 'S') = 'S' THEN 1 ELSE 0 END AS ativo,
    CAST(v.CODPROD AS VARCHAR(200))                          AS produto_external_id,
    UPPER(LEFT(v.CODVOL, 4))                                 AS unidade,         -- [P]
    CAST(v.QUANTIDADE AS INT)                                AS fator,           -- [P]
    NULLIF(v.CODBARRA, '')                                   AS ean,             -- [C]
    0                                                        AS padrao
FROM TGFVOA v
WHERE v.DIVIDEMULTIPLICA = 'M' AND v.QUANTIDADE >= 2 AND v.QUANTIDADE = FLOOR(v.QUANTIDADE); -- [C]


-- ---------------------------------------------------------------------------------------------------------------------
-- 8. preco — TGFTAB (versão da tabela: NUTAB, CODTAB, DTVIGOR) e TGFEXC (preço por produto) [P]. A tabela é o CODTAB; cada
--    NUTAB é uma vigência que começa em DTVIGOR [P]. Nome da tabela em TGFNTA [C]. Preço por local/controle fora [C].
-- ---------------------------------------------------------------------------------------------------------------------
CREATE VIEW vw_macuxi_preco AS
SELECT
    CONCAT(x.NUTAB, ':', x.CODPROD)                          AS external_id,     -- versão:produto
    CAST(COALESCE(t.DTALTER, t.DTVIGOR) AT TIME ZONE 'SA Western Standard Time' AT TIME ZONE 'UTC' AS DATETIME2(3)) AS alterado_em, -- [C]
    CASE WHEN x.VLRVENDA > 0 THEN 1 ELSE 0 END               AS ativo,
    CAST(t.CODTAB AS VARCHAR(200))                           AS tabela_external_id, -- [P] a mesma chave de TGFPAR.CODTAB
    COALESCE((SELECT n.NOMETAB FROM TGFNTA n WHERE n.CODTAB = t.CODTAB), CONCAT('Tabela ', t.CODTAB)) AS tabela_nome, -- [C]
    CONVERT(CHAR(10), t.DTVIGOR, 23)                         AS vigencia_inicio, -- [P]
    CAST(x.CODPROD AS VARCHAR(200))                          AS produto_external_id,
    CAST(ROUND(x.VLRVENDA * 100, 0) AS DECIMAL(19,0))        AS preco_cents,     -- [P]
    CAST(NULLIF(t.CODEMP, 0) AS VARCHAR(200))                AS filial_external_id -- [C] tabela por empresa
FROM TGFEXC x
JOIN TGFTAB t ON t.NUTAB = x.NUTAB
WHERE COALESCE(x.CODLOCAL, 0) = 0 AND COALESCE(x.CONTROLE, ' ') = ' ';           -- [C]


-- ---------------------------------------------------------------------------------------------------------------------
-- 10. estoque — TGFEST por empresa, local e produto, somando os controles (lote) [P]. Saldo = ESTOQUE − RESERVADO [P].
--     Só o estoque próprio (TIPO = 'P', CODPARC = 0) [P]. Nome do local em TGFLOC [P].
-- ---------------------------------------------------------------------------------------------------------------------
CREATE VIEW vw_macuxi_estoque AS
SELECT
    CONCAT(s.CODEMP, ':', s.CODLOCAL, ':', s.CODPROD)        AS external_id,     -- empresa:local:produto
    CAST(CAST('2000-01-01' AS DATETIME2) AS DATETIME2(3))    AS alterado_em,     -- saldo sem data: carga completa
    1                                                        AS ativo,
    CONCAT(s.CODEMP, ':', s.CODLOCAL)                        AS deposito_external_id,
    MAX(l.DESCRLOCAL)                                        AS deposito_nome,   -- [P]
    CAST(s.CODPROD AS VARCHAR(200))                          AS produto_external_id,
    SUM(s.ESTOQUE - s.RESERVADO)                             AS saldo,           -- [P]
    CAST(s.CODEMP AS VARCHAR(200))                           AS filial_external_id
FROM TGFEST s
LEFT JOIN TGFLOC l ON l.CODLOCAL = s.CODLOCAL
WHERE s.TIPO = 'P' AND s.CODPARC = 0
GROUP BY s.CODEMP, s.CODLOCAL, s.CODPROD;


-- ---------------------------------------------------------------------------------------------------------------------
-- 11. cliente — parceiro (TGFPAR) com CLIENTE = 'S' [P]. CGC_CPF só em "documento". Tabela de preço do parceiro em CODTAB [C].
-- ---------------------------------------------------------------------------------------------------------------------
CREATE VIEW vw_macuxi_cliente AS
SELECT
    CAST(p.CODPARC AS VARCHAR(200))                          AS external_id,     -- [P] nunca o CGC_CPF
    CAST(COALESCE(p.DTALTER, CAST('2000-01-01' AS DATETIME2)) AT TIME ZONE 'SA Western Standard Time' AT TIME ZONE 'UTC' AS DATETIME2(3)) AS alterado_em, -- [P]
    CASE WHEN p.ATIVO = 'S' THEN 1 ELSE 0 END                AS ativo,           -- [P]
    COALESCE(NULLIF(p.RAZAOSOCIAL, ''), p.NOMEPARC)          AS razao_social,    -- [P]
    p.NOMEPARC                                               AS nome_fantasia,
    NULLIF(p.CGC_CPF, '')                                    AS documento,       -- [P]
    CASE WHEN p.CODVEND > 0 THEN CAST(p.CODVEND AS VARCHAR(200)) END AS vendedor_external_id, -- [P]
    en.NOMEEND                                               AS endereco_logradouro,
    p.NUMEND                                                 AS endereco_numero,
    NULLIF(p.COMPLEMENTO, '')                                AS endereco_complemento,
    b.NOMEBAI                                                AS endereco_bairro,
    cid.NOMECID                                              AS endereco_cidade,
    UPPER(uf.UF)                                             AS endereco_uf,
    REPLACE(p.CEP, '-', '')                                  AS endereco_cep,
    NULLIF(p.TELEFONE, '')                                   AS telefone,
    NULLIF(p.EMAIL, '')                                      AS email,
    CAST(ROUND(COALESCE(p.LIMCRED, 0) * 100, 0) AS DECIMAL(19,0)) AS limite_credito_cents, -- [P]
    NULLIF(p.IDENTINSCESTAD, '')                             AS inscricao_estadual, -- [P]
    CASE WHEN p.BLOQUEAR = 'S' THEN 1 ELSE 0 END             AS bloqueado,       -- [P]
    CAST(NULL AS VARCHAR(60))                                AS canal,           -- [C] perfil do parceiro (TGFPPA) se usar
    CAST(NULL AS INT)                                        AS prazo_medio_max_dias,
    CAST(NULL AS VARCHAR(1))                                 AS formas_pagamento,
    CASE WHEN p.CODTAB > 0 THEN CAST(p.CODTAB AS VARCHAR(200)) END AS tabela_preco_external_id, -- [C]
    CAST(NULL AS VARCHAR(200))                               AS filial_external_id
FROM TGFPAR p
LEFT JOIN TSIEND en ON en.CODEND = p.CODEND
LEFT JOIN TSIBAI b ON b.CODBAI = p.CODBAI
LEFT JOIN TSICID cid ON cid.CODCID = p.CODCID
LEFT JOIN TSIUFS uf ON uf.CODUF = cid.UF
WHERE p.CLIENTE = 'S' AND p.CODPARC > 0;


-- ---------------------------------------------------------------------------------------------------------------------
-- 13. transportadora — parceiro com TRANSPORTADORA = 'S' [P].
-- ---------------------------------------------------------------------------------------------------------------------
CREATE VIEW vw_macuxi_transportadora AS
SELECT
    CAST(p.CODPARC AS VARCHAR(200))                          AS external_id,     -- [P]
    CAST(COALESCE(p.DTALTER, CAST('2000-01-01' AS DATETIME2)) AT TIME ZONE 'SA Western Standard Time' AT TIME ZONE 'UTC' AS DATETIME2(3)) AS alterado_em,
    CASE WHEN p.ATIVO = 'S' THEN 1 ELSE 0 END                AS ativo,
    COALESCE(NULLIF(p.RAZAOSOCIAL, ''), p.NOMEPARC)          AS nome,
    NULLIF(REPLACE(REPLACE(REPLACE(p.CGC_CPF, '.', ''), '/', ''), '-', ''), '') AS documento,
    NULLIF(p.IDENTINSCESTAD, '')                             AS inscricao_estadual,
    NULLIF(p.TELEFONE, '')                                   AS telefone
FROM TGFPAR p
WHERE p.TRANSPORTADORA = 'S' AND p.CODPARC > 0;


-- ---------------------------------------------------------------------------------------------------------------------
-- 15. titulo — financeiro a receber (TGFFIN, RECDESP = 1) [P]; sem provisão (PROVISAO = 'N') [P]. Baixa em DHBAIXA [P].
-- ---------------------------------------------------------------------------------------------------------------------
CREATE VIEW vw_macuxi_titulo AS
SELECT
    CAST(f.NUFIN AS VARCHAR(200))                            AS external_id,     -- [P]
    CAST(COALESCE(f.DTALTER, f.DHBAIXA, CAST(f.DTNEG AS DATETIME2)) AT TIME ZONE 'SA Western Standard Time' AT TIME ZONE 'UTC' AS DATETIME2(3)) AS alterado_em, -- [C]
    1                                                        AS ativo,
    CAST(f.CODPARC AS VARCHAR(200))                          AS cliente_external_id,
    CAST(COALESCE(NULLIF(f.NUMNOTA, 0), f.NUFIN) AS VARCHAR(40)) AS numero,      -- [P]
    f.DESDOBRAMENTO                                          AS parcela,         -- [C] numérico na maioria das bases
    CONVERT(CHAR(10), f.DTNEG, 23)                           AS emissao,
    CONVERT(CHAR(10), f.DTVENC, 23)                          AS vencimento,      -- [P]
    CAST(ROUND(f.VLRDESDOB * 100, 0) AS DECIMAL(19,0))       AS valor_cents,     -- [P]
    CASE WHEN f.DHBAIXA IS NULL THEN CAST(ROUND(f.VLRDESDOB * 100, 0) AS DECIMAL(19,0))
         ELSE CAST(0 AS DECIMAL(19,0)) END                   AS saldo_cents,     -- [C] baixa parcial gera novo desdobramento
    CASE WHEN f.DHBAIXA IS NULL THEN 'aberto' ELSE 'baixado' END AS situacao,
    CAST(f.DHBAIXA AT TIME ZONE 'SA Western Standard Time' AT TIME ZONE 'UTC' AS DATETIME2(3)) AS baixado_em, -- [P]
    CASE WHEN f.NUMNOTA > 0 THEN CAST(f.NUMNOTA AS VARCHAR(40)) END AS nf_numero,
    CAST(NULL AS VARCHAR(10))                                AS nf_serie,        -- [C] série pelo NUNOTA (TGFCAB.SERIENOTA)
    (SELECT t.DESCRTIPTIT FROM TGFTIT t WHERE t.CODTIPTIT = f.CODTIPTIT) AS forma_pagamento -- [C]
FROM TGFFIN f
WHERE f.RECDESP = 1 AND f.PROVISAO = 'N';                                        -- [P]


-- ---------------------------------------------------------------------------------------------------------------------
-- 16. nota — TGFCAB por TIPMOV: 'V' venda, 'D' devolução [P]; só confirmada (STATUSNOTA = 'L') [P]. Nota cancelada sai da
--     TGFCAB (vai para a TGFCAN) [C]: some da view e a carga completa inativa. pedido_uuid pela origem (TGFVAR) [P] com o
--     AD_MXUUID do pedido [C].
-- ---------------------------------------------------------------------------------------------------------------------
CREATE VIEW vw_macuxi_nota AS
SELECT
    CAST(c.NUNOTA AS VARCHAR(200))                           AS external_id,     -- [P]
    CAST(COALESCE(c.DTALTER, CAST(c.DTNEG AS DATETIME2)) AT TIME ZONE 'SA Western Standard Time' AT TIME ZONE 'UTC' AS DATETIME2(3)) AS alterado_em,
    1                                                        AS ativo,
    CAST(c.CODPARC AS VARCHAR(200))                          AS cliente_external_id,
    CASE WHEN c.CODVEND > 0 THEN CAST(c.CODVEND AS VARCHAR(200)) END AS vendedor_external_id,
    CASE WHEN c.TIPMOV = 'D' THEN 'devolucao' ELSE 'faturamento' END AS tipo,   -- [P]
    CAST(c.NUMNOTA AS VARCHAR(40))                           AS numero,          -- [P]
    NULLIF(c.SERIENOTA, '')                                  AS serie,
    CAST(COALESCE(c.DTFATUR, CAST(c.DTNEG AS DATETIME2)) AT TIME ZONE 'SA Western Standard Time' AT TIME ZONE 'UTC' AS DATETIME2(3)) AS emitida_em, -- [C]
    CAST(ROUND(c.VLRNOTA * 100, 0) AS DECIMAL(19,0))         AS total_cents,     -- [P]
    (SELECT COUNT(*) FROM TGFITE i WHERE i.NUNOTA = c.NUNOTA) AS quantidade_itens,
    (SELECT MAX(o.AD_MXUUID) FROM TGFVAR v JOIN TGFCAB o ON o.NUNOTA = v.NUNOTAORIG AND o.TIPMOV = 'P'
      WHERE v.NUNOTA = c.NUNOTA)                             AS pedido_uuid,     -- [C] AD_MXUUID
    0                                                        AS cancelada
FROM TGFCAB c
WHERE c.TIPMOV IN ('V', 'D') AND c.STATUSNOTA = 'L';


-- ---------------------------------------------------------------------------------------------------------------------
-- 17. pedido_status (RETORNO, RN-INT-08; só no caminho pelo Conector) — situação da entrada ('R' do job) e do pedido
--     (TGFCAB TIPMOV 'P') achado pelo AD_MXUUID [C]; notas pela TGFVAR [P]. Pedido sem saldo a faturar (PENDENTE = 'N') = F [C].
-- ---------------------------------------------------------------------------------------------------------------------
CREATE VIEW vw_macuxi_pedido_status AS
SELECT
    LOWER(CAST(e.pedido_uuid AS VARCHAR(36)))                AS pedido_uuid,
    CASE WHEN e.situacao = 'R' THEN 'R' ELSE 'I' END         AS situacao,        -- [C] pedido excluído some da TGFCAB
    CAST(COALESCE(o.NUNOTA, e.numero_pedido) AS VARCHAR(40)) AS numero_pedido,   -- [P] NUNOTA do pedido
    CASE WHEN e.situacao = 'R' THEN COALESCE(NULLIF(LTRIM(RTRIM(e.motivo)), ''), 'Recusado no ERP')
         ELSE NULLIF(LTRIM(RTRIM(e.motivo)), '') END         AS motivo,
    CAST(NULL AS VARCHAR(40))                                AS nota_numero,
    CAST(NULL AS VARCHAR(10))                                AS nota_serie,
    CAST(NULL AS DATETIME2(3))                               AS nota_emitida_em,
    CAST(NULL AS DECIMAL(19,0))                              AS nota_total_cents,
    e.recebido_em                                            AS ocorrido_em      -- já em UTC
FROM dbo.macuxi_pedido_entrada e
LEFT JOIN TGFCAB o ON o.TIPMOV = 'P' AND LOWER(o.AD_MXUUID) = LOWER(CAST(e.pedido_uuid AS VARCHAR(36)))
UNION ALL
SELECT
    LOWER(o.AD_MXUUID),
    CASE WHEN o.PENDENTE = 'N' THEN 'F' ELSE 'P' END,
    CAST(o.NUNOTA AS VARCHAR(40)),
    CAST(NULL AS VARCHAR(300)),
    CAST(n.NUMNOTA AS VARCHAR(40)),
    CAST(NULLIF(n.SERIENOTA, '') AS VARCHAR(10)),
    CAST(COALESCE(n.DTFATUR, CAST(n.DTNEG AS DATETIME2)) AT TIME ZONE 'SA Western Standard Time' AT TIME ZONE 'UTC' AS DATETIME2(3)),
    CAST(ROUND(n.VLRNOTA * 100, 0) AS DECIMAL(19,0)),
    CAST(COALESCE(n.DTFATUR, CAST(n.DTNEG AS DATETIME2)) AT TIME ZONE 'SA Western Standard Time' AT TIME ZONE 'UTC' AS DATETIME2(3))
FROM TGFCAB o
JOIN (SELECT DISTINCT NUNOTA, NUNOTAORIG FROM TGFVAR) v ON v.NUNOTAORIG = o.NUNOTA
JOIN TGFCAB n ON n.NUNOTA = v.NUNOTA AND n.TIPMOV = 'V' AND n.STATUSNOTA = 'L'
WHERE o.TIPMOV = 'P' AND o.AD_MXUUID IS NOT NULL;


-- ---------------------------------------------------------------------------------------------------------------------
-- 18. pedido_nota_item (RETORNO) — itens da nota (TGFITE) ligados ao item do pedido pela TGFVAR (SEQUENCIAORIG) [P].
--     sequencia = SEQUENCIA do item no pedido, que o job grava igual à do Macuxi [C]. Quantidade na unidade padrão (QTDNEG) [P].
-- ---------------------------------------------------------------------------------------------------------------------
CREATE VIEW vw_macuxi_pedido_nota_item AS
SELECT
    LOWER(o.AD_MXUUID)                                       AS pedido_uuid,
    CAST(n.NUMNOTA AS VARCHAR(40))                           AS nota_numero,
    CAST(NULLIF(n.SERIENOTA, '') AS VARCHAR(10))             AS nota_serie,
    v.SEQUENCIAORIG                                          AS sequencia,       -- [C]
    CAST(i.QTDNEG AS INT)                                    AS quantidade,      -- [P]
    CAST(ROUND(i.VLRTOT * 100, 0) AS DECIMAL(19,0))          AS valor_cents,     -- [P]
    CAST(i.CODPROD AS VARCHAR(200))                          AS produto_codigo
FROM TGFVAR v
JOIN TGFCAB o ON o.NUNOTA = v.NUNOTAORIG AND o.TIPMOV = 'P'
JOIN TGFCAB n ON n.NUNOTA = v.NUNOTA AND n.TIPMOV = 'V' AND n.STATUSNOTA = 'L'
JOIN TGFITE i ON i.NUNOTA = v.NUNOTA AND i.SEQUENCIA = v.SEQUENCIA
WHERE o.AD_MXUUID IS NOT NULL;
