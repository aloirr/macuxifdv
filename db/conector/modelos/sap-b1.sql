-- =====================================================================================================================
-- Macuxi FDV — MODELO de views do Conector para o SAP Business One (ERP -> Hub /integracao/v1)
-- Status: beta (D9 do desenho: fica "beta" até o primeiro cliente SAP B1 confirmar os itens [C]).
-- Dono: banco-dados. Desenho: docs/desenho/integracao-modelos-erp.md §3.3 (de-para) e §6 (F4b); ADR 0066.
-- Formato e regras de toda view: db/conector/views-modelo.sql (cabeçalho, regras 1 a 8). Dicionário: docs/banco/integracao.md,
-- "Modelos por ERP". Teste sem banco: db/testes/modelos-erp-conector.test.ts (colunas contra SCHEMA_REGISTRO).
-- NADA aqui é aplicado pelo Macuxi: o técnico do cliente (ou o parceiro SAP) revisa e cria as views no banco da empresa (a
-- CompanyDB), com o usuário somente leitura do Conector tendo SELECT nelas.
--
-- LEGENDA
--   [P] = conhecimento público (documentação SAP: tabelas do DI/Service Layer e uso amplo no mercado).
--   [C] = CONFIRMAR com o cliente antes de ligar: muda por versão, localização Brasil, UDF ou parametrização.
--
-- QUANDO USAR ESTE MODELO
--   O meio padrão do SAP B1 é a API (Service Layer; busca pela nuvem, F4a do modulo-integracao). Este modelo é para o cliente
--   que prefere o Conector e roda o B1 em SQL Server [P]. Com SAP HANA, só a API: o Conector não tem driver HANA (§3.3).
--
-- REGRAS GERAIS DO SAP B1 [P]
--   - Chaves: CardCode (parceiro), ItemCode (item), SlpCode (vendedor), DocEntry (documento interno; DocNum é o número visível).
--   - Inativo: frozenFor = 'Y' ou validFor = 'N' (parceiro, item). Cancelado: CANCELED = 'Y' (documentos).
--   - Data de alteração: UpdateDate (data) + UpdateTS (hora HHMMSS, inteiro) [C: UpdateTS existe da 9.x em diante]. Na hora
--     local do servidor: a view converte para UTC (regra 3 do views-modelo.sql). Sem UpdateTS, use só UpdateDate (meia-noite):
--     a janela de sobreposição da coleta cobre o dia.
--   - Hora de documento: DocTime é inteiro HHMM [C].
--
-- DIALETO
--   Corpo em SQL Server (2017+). Não há forma Oracle (o B1 roda em SQL Server ou HANA).
--
-- O QUE NÃO TEM VIEW NESTE MODELO
--   SEM VIEW: tabela_escalonada — os descontos por período e volume (OSPP/SPP1/SPP2) são por parceiro e mudam por
--             parametrização; mapear só depois de confirmar com o cliente. [C]
--   SEM VIEW: transportadora — no B1 Brasil a transportadora é um parceiro (OCRD) marcado por propriedade ou grupo, diferente
--             por cliente. [C]
--   SEM VIEW: rota — o B1 não guarda roteiro de visita do vendedor; o roteiro nasce no Macuxi. [P]
--
-- PEDIDO (Macuxi -> ERP): pela API, POST /Orders (ORDR/RDR1), com o UUID no UDF U_MXUUID e a consulta antes de criar
--   (RN-INT-19; adaptador da F4a). Pelo Conector: a entrada genérica db/conector/entrada-pedido-modelo.sql e um job do parceiro
--   (DI API ou Service Layer) que cria o ORDR com o U_MXUUID [C]. As 2 views do retorno (fim do arquivo) servem ao Conector;
--   na API, o retorno vem pelo DocumentStatus e Cancelled do próprio pedido.
-- =====================================================================================================================


-- ---------------------------------------------------------------------------------------------------------------------
-- 1. filial — OBPL (filiais; só com multifilial ativa) [P]. Sem multifilial: não crie esta view nem ligue a entidade.
-- ---------------------------------------------------------------------------------------------------------------------
CREATE VIEW vw_macuxi_filial AS
SELECT
    CAST(b.BPLId AS VARCHAR(200))                            AS external_id,     -- [P]
    CAST(CAST(COALESCE(b.UpdateDate, '2000-01-01') AS DATETIME2) AT TIME ZONE 'SA Western Standard Time' AT TIME ZONE 'UTC' AS DATETIME2(3)) AS alterado_em, -- [C]
    CASE WHEN b.Disabled = 'Y' THEN 0 ELSE 1 END             AS ativo,           -- [P]
    CAST(b.BPLId AS VARCHAR(20))                             AS codigo,
    b.BPLName                                                AS nome,            -- [P]
    b.City                                                   AS cidade,
    UPPER(b.State)                                           AS uf,
    REPLACE(REPLACE(REPLACE(b.TaxIdNum, '.', ''), '/', ''), '-', '') AS cnpj,    -- [P] CNPJ da filial
    b.Street                                                 AS logradouro,
    b.StreetNo                                               AS numero,
    b.Building                                               AS complemento,     -- [C]
    b.Block                                                  AS bairro,
    REPLACE(b.ZipCode, '-', '')                              AS cep,
    CAST(NULL AS VARCHAR(30))                                AS telefone
FROM OBPL b;


-- ---------------------------------------------------------------------------------------------------------------------
-- 2. vendedor — OSLP [P]. SlpCode -1 é "-Nenhum vendedor-" [P].
-- ---------------------------------------------------------------------------------------------------------------------
CREATE VIEW vw_macuxi_vendedor AS
SELECT
    CAST(s.SlpCode AS VARCHAR(200))                          AS external_id,     -- [P]
    CAST(CAST('2000-01-01' AS DATETIME2) AS DATETIME2(3))    AS alterado_em,     -- [C] OSLP sem data: carga completa
    CASE WHEN s.Active = 'Y' THEN 1 ELSE 0 END               AS ativo,           -- [P]
    s.SlpName                                                AS nome,            -- [P]
    NULLIF(s.Email, '')                                      AS email,           -- [P]
    NULLIF(s.Mobil, '')                                      AS telefone         -- [P]
FROM OSLP s
WHERE s.SlpCode >= 0;


-- ---------------------------------------------------------------------------------------------------------------------
-- 3. catalogo_no — OITB (grupos de itens) [P], um nível só.
-- ---------------------------------------------------------------------------------------------------------------------
CREATE VIEW vw_macuxi_catalogo_no AS
SELECT
    CAST(g.ItmsGrpCod AS VARCHAR(200))                       AS external_id,     -- [P]
    CAST(CAST(COALESCE(g.UpdateDate, g.CreateDate) AS DATETIME2) AT TIME ZONE 'SA Western Standard Time' AT TIME ZONE 'UTC' AS DATETIME2(3)) AS alterado_em,
    1                                                        AS ativo,
    CAST(g.ItmsGrpCod AS VARCHAR(60))                        AS codigo,
    g.ItmsGrpNam                                             AS nome,            -- [P]
    1                                                        AS nivel
FROM OITB g;


-- ---------------------------------------------------------------------------------------------------------------------
-- 4. forma_pagamento — OPYM (formas de pagamento) [P]; a forma do cliente fica em OCRD.PymCode [P].
-- ---------------------------------------------------------------------------------------------------------------------
CREATE VIEW vw_macuxi_forma_pagamento AS
SELECT
    CAST(f.PayMethCod AS VARCHAR(200))                       AS external_id,     -- [P]
    CAST(CAST('2000-01-01' AS DATETIME2) AS DATETIME2(3))    AS alterado_em,     -- [C] sem data: carga completa
    CASE WHEN f.Active = 'Y' THEN 1 ELSE 0 END               AS ativo,
    UPPER(LEFT(f.PayMethCod, 20))                            AS codigo,
    f.Descript                                               AS nome,            -- [P]
    0                                                        AS ordem
FROM OPYM f
WHERE f.Type = 'I';                                                              -- [P] formas de recebimento


-- ---------------------------------------------------------------------------------------------------------------------
-- 5. prazo_pagamento — OCTG (condições) e CTG1 (parcelas: InstMonth meses + InstDays dias) [P]. O B1 não liga condição a
--    forma: uma linha por par forma × condição (regra da view 5 do views-modelo.sql), só nas formas a prazo [C].
--    Sem parcelas na CTG1 (InstNum = 0): uma parcela em ExtraMonth*30 + ExtraDays [P].
-- ---------------------------------------------------------------------------------------------------------------------
CREATE VIEW vw_macuxi_prazo_pagamento AS
SELECT
    CONCAT(f.PayMethCod, ':', c.GroupNum)                    AS external_id,     -- forma:condição
    CAST(CAST('2000-01-01' AS DATETIME2) AS DATETIME2(3))    AS alterado_em,
    1                                                        AS ativo,
    CAST(f.PayMethCod AS VARCHAR(200))                       AS forma_external_id,
    LEFT(CONCAT(UPPER(f.PayMethCod), '-', c.GroupNum), 20)   AS codigo,          -- [C] cabe em 20 com códigos curtos
    c.PymntGroup                                             AS descricao,       -- [P]
    COALESCE((SELECT '[' + STRING_AGG(CAST(p.InstMonth * 30 + p.InstDays AS VARCHAR(10)), ',') WITHIN GROUP (ORDER BY p.IntsNo) + ']'
                FROM CTG1 p WHERE p.CTGCode = c.GroupNum),
             '[' + CAST(c.ExtraMonth * 30 + c.ExtraDays AS VARCHAR(10)) + ']') AS parcelas_dias,
    0                                                        AS ordem
FROM OCTG c
CROSS JOIN OPYM f
WHERE f.Type = 'I' AND f.Active = 'Y'
  AND f.PayMethCod IN ('BOLETO');                                                -- [C] formas a prazo do cliente


-- ---------------------------------------------------------------------------------------------------------------------
-- 6. produto — OITM [P]; fabricante em OMRC [P]. Só itens de venda (SellItem = 'Y') [P].
--    Unidade base = unidade de estoque (InvntryUom); embalagem = unidade de venda com NumInSale itens [P]. Grupos de UoM
--    (OUGP/UGP1) são [C].
-- ---------------------------------------------------------------------------------------------------------------------
CREATE VIEW vw_macuxi_produto AS
SELECT
    CAST(i.ItemCode AS VARCHAR(200))                         AS external_id,     -- [P]
    CAST(DATEADD(SECOND, (COALESCE(i.UpdateTS, 0) / 10000) * 3600 + (COALESCE(i.UpdateTS, 0) / 100 % 100) * 60 + COALESCE(i.UpdateTS, 0) % 100,
                 CAST(COALESCE(i.UpdateDate, i.CreateDate) AS DATETIME2))
         AT TIME ZONE 'SA Western Standard Time' AT TIME ZONE 'UTC' AS DATETIME2(3)) AS alterado_em, -- [C] UpdateTS
    CASE WHEN i.frozenFor = 'Y' OR i.validFor = 'N' THEN 0 ELSE 1 END AS ativo,  -- [P]
    i.ItemCode                                               AS sku,
    NULLIF(i.CodeBars, '')                                   AS ean,             -- [P]
    i.ItemName                                               AS nome,            -- [P]
    (SELECT m.FirmName FROM OMRC m WHERE m.FirmCode = i.FirmCode AND i.FirmCode > 0) AS marca, -- [P]
    CASE WHEN i.FirmCode > 0 THEN CAST(i.FirmCode AS VARCHAR(30)) END AS marca_codigo,
    UPPER(LEFT(COALESCE(NULLIF(i.InvntryUom, ''), 'UN'), 4)) AS unidade,         -- [C] sigla até 4 letras
    CASE WHEN i.NumInSale >= 2 AND i.NumInSale = FLOOR(i.NumInSale) THEN UPPER(LEFT(i.SalUnitMsr, 4)) END AS embalagem_medida,
    CASE WHEN i.NumInSale >= 2 AND i.NumInSale = FLOOR(i.NumInSale) THEN CAST(i.NumInSale AS INT) END AS embalagem_quantidade,
    CAST(i.ItmsGrpCod AS VARCHAR(200))                       AS catalogo_no_external_id,
    CAST(ROUND(i.AvgPrice * 100, 0) AS DECIMAL(19,0))        AS custo_cents      -- [P] custo médio
FROM OITM i
WHERE i.SellItem = 'Y';


-- ---------------------------------------------------------------------------------------------------------------------
-- 7. produto_unidade — a unidade de venda do OITM (SalUnitMsr × NumInSale) [P].
-- ---------------------------------------------------------------------------------------------------------------------
CREATE VIEW vw_macuxi_produto_unidade AS
SELECT
    CONCAT(i.ItemCode, ':', UPPER(LEFT(i.SalUnitMsr, 4)))    AS external_id,     -- item:medida
    CAST(CAST(COALESCE(i.UpdateDate, i.CreateDate) AS DATETIME2) AT TIME ZONE 'SA Western Standard Time' AT TIME ZONE 'UTC' AS DATETIME2(3)) AS alterado_em,
    CASE WHEN i.frozenFor = 'Y' OR i.validFor = 'N' THEN 0 ELSE 1 END AS ativo,
    CAST(i.ItemCode AS VARCHAR(200))                         AS produto_external_id,
    UPPER(LEFT(i.SalUnitMsr, 4))                             AS unidade,         -- [C] sigla até 4 letras
    CAST(i.NumInSale AS INT)                                 AS fator,           -- [P]
    CAST(NULL AS VARCHAR(14))                                AS ean,             -- [C] código de barras por UoM (OBCD)
    1                                                        AS padrao           -- a unidade de venda é a padrão do pedido
FROM OITM i
WHERE i.SellItem = 'Y' AND i.NumInSale >= 2 AND i.NumInSale = FLOOR(i.NumInSale) AND COALESCE(i.SalUnitMsr, '') <> '';


-- ---------------------------------------------------------------------------------------------------------------------
-- 8. preco — ITM1 (preço do item por lista) e OPLN (listas) [P]. Sem vigência na lista: início fixo [P]. ITM1 não tem data
--    própria: usa a do item [C].
-- ---------------------------------------------------------------------------------------------------------------------
CREATE VIEW vw_macuxi_preco AS
SELECT
    CONCAT(p.PriceList, ':', p.ItemCode)                     AS external_id,     -- lista:item
    CAST(CAST(COALESCE(i.UpdateDate, i.CreateDate) AS DATETIME2) AT TIME ZONE 'SA Western Standard Time' AT TIME ZONE 'UTC' AS DATETIME2(3)) AS alterado_em, -- [C]
    CASE WHEN p.Price > 0 AND l.ValidFor = 'Y' THEN 1 ELSE 0 END AS ativo,      -- [C] ValidFor da lista
    CAST(p.PriceList AS VARCHAR(200))                        AS tabela_external_id, -- [P] a mesma chave de OCRD.ListNum
    l.ListName                                               AS tabela_nome,     -- [P]
    '2000-01-01'                                             AS vigencia_inicio,
    CAST(i.ItemCode AS VARCHAR(200))                         AS produto_external_id,
    CAST(ROUND(p.Price * 100, 0) AS DECIMAL(19,0))           AS preco_cents,     -- [P] moeda local (Currency) [C]
    CAST(NULL AS VARCHAR(4))                                 AS unidade          -- [C] preço por UoM (ITM9) fora do modelo
FROM ITM1 p
JOIN OPLN l ON l.ListNum = p.PriceList
JOIN OITM i ON i.ItemCode = p.ItemCode AND i.SellItem = 'Y';


-- ---------------------------------------------------------------------------------------------------------------------
-- 10. estoque — OITW (item × depósito) e OWHS (depósitos, com a filial em BPLid) [P]. Saldo = OnHand − IsCommited [P].
-- ---------------------------------------------------------------------------------------------------------------------
CREATE VIEW vw_macuxi_estoque AS
SELECT
    CONCAT(w.WhsCode, ':', w.ItemCode)                       AS external_id,     -- depósito:item
    CAST(CAST('2000-01-01' AS DATETIME2) AS DATETIME2(3))    AS alterado_em,     -- [C] saldo muda sem data: carga completa
    1                                                        AS ativo,
    CAST(w.WhsCode AS VARCHAR(200))                          AS deposito_external_id,
    h.WhsName                                                AS deposito_nome,   -- [P]
    CAST(w.ItemCode AS VARCHAR(200))                         AS produto_external_id,
    w.OnHand - w.IsCommited                                  AS saldo,           -- [P]
    CAST(h.BPLid AS VARCHAR(200))                            AS filial_external_id -- [P] NULL sem multifilial
FROM OITW w
JOIN OWHS h ON h.WhsCode = w.WhsCode
WHERE h.Inactive = 'N';                                                          -- [C]


-- ---------------------------------------------------------------------------------------------------------------------
-- 11. cliente — OCRD com CardType = 'C' [P]; endereço de cobrança padrão (CRD1 'B' = BillToDef) [P]; CNPJ e IE na CRD7
--     (TaxId0 = CNPJ, TaxId4 = CPF, TaxId1 = IE, endereço vazio) [C: localização Brasil].
-- ---------------------------------------------------------------------------------------------------------------------
CREATE VIEW vw_macuxi_cliente AS
SELECT
    CAST(c.CardCode AS VARCHAR(200))                         AS external_id,     -- [P] nunca o CNPJ
    CAST(DATEADD(SECOND, (COALESCE(c.UpdateTS, 0) / 10000) * 3600 + (COALESCE(c.UpdateTS, 0) / 100 % 100) * 60 + COALESCE(c.UpdateTS, 0) % 100,
                 CAST(COALESCE(c.UpdateDate, c.CreateDate) AS DATETIME2))
         AT TIME ZONE 'SA Western Standard Time' AT TIME ZONE 'UTC' AS DATETIME2(3)) AS alterado_em, -- [C] UpdateTS
    CASE WHEN c.validFor = 'N' THEN 0 ELSE 1 END             AS ativo,
    c.CardName                                               AS razao_social,    -- [P]
    NULLIF(c.AliasName, '')                                  AS nome_fantasia,   -- [C] nome fantasia na localização Brasil
    (SELECT TOP (1) COALESCE(NULLIF(t.TaxId0, ''), t.TaxId4) FROM CRD7 t
      WHERE t.CardCode = c.CardCode AND t.Address = '')      AS documento,       -- [C]
    CASE WHEN c.SlpCode >= 0 THEN CAST(c.SlpCode AS VARCHAR(200)) END AS vendedor_external_id, -- [P]
    e.Street                                                 AS endereco_logradouro, -- [P]
    e.StreetNo                                               AS endereco_numero,
    NULLIF(e.Building, '')                                   AS endereco_complemento,
    e.Block                                                  AS endereco_bairro,
    e.City                                                   AS endereco_cidade,
    UPPER(e.State)                                           AS endereco_uf,
    REPLACE(e.ZipCode, '-', '')                              AS endereco_cep,
    NULLIF(c.Phone1, '')                                     AS telefone,        -- [P]
    NULLIF(c.E_Mail, '')                                     AS email,           -- [P]
    CAST(ROUND(c.CreditLine * 100, 0) AS DECIMAL(19,0))      AS limite_credito_cents, -- [P]
    (SELECT TOP (1) NULLIF(t.TaxId1, '') FROM CRD7 t
      WHERE t.CardCode = c.CardCode AND t.Address = '')      AS inscricao_estadual, -- [C]
    CASE WHEN c.frozenFor = 'Y' THEN 1 ELSE 0 END            AS bloqueado,       -- [P]
    CAST(NULL AS VARCHAR(60))                                AS canal,           -- [C] grupo do parceiro (OCRG) se usar
    CAST(NULL AS INT)                                        AS prazo_medio_max_dias,
    CASE WHEN NULLIF(c.PymCode, '') IS NULL THEN CAST(NULL AS VARCHAR(1))
         ELSE '["' + STRING_ESCAPE(UPPER(LEFT(c.PymCode, 20)), 'json') + '"]' END AS formas_pagamento, -- [C] só a forma padrão
    CAST(c.ListNum AS VARCHAR(200))                          AS tabela_preco_external_id, -- [P] lista de preço
    CAST(NULL AS VARCHAR(200))                               AS filial_external_id -- [C] parceiro × filial (CRD8)
FROM OCRD c
LEFT JOIN CRD1 e ON e.CardCode = c.CardCode AND e.AdresType = 'B' AND e.Address = c.BillToDef
WHERE c.CardType = 'C';


-- ---------------------------------------------------------------------------------------------------------------------
-- 12. cliente_endereco — CRD1 (endereços do parceiro: 'S' entrega, 'B' cobrança) [P]. principal = o padrão de entrega.
-- ---------------------------------------------------------------------------------------------------------------------
CREATE VIEW vw_macuxi_cliente_endereco AS
SELECT
    CONCAT(e.CardCode, ':', e.AdresType, ':', e.Address)     AS external_id,     -- parceiro:tipo:nome do endereço
    CAST(CAST(COALESCE(c.UpdateDate, c.CreateDate) AS DATETIME2) AT TIME ZONE 'SA Western Standard Time' AT TIME ZONE 'UTC' AS DATETIME2(3)) AS alterado_em,
    1                                                        AS ativo,           -- endereço apagado sai na carga completa
    CAST(e.CardCode AS VARCHAR(200))                         AS cliente_external_id,
    CASE e.AdresType WHEN 'B' THEN 'cobranca' ELSE 'entrega' END AS tipo,       -- [P]
    e.Address                                                AS descricao,       -- [P] nome do endereço
    e.Street                                                 AS logradouro,
    e.StreetNo                                               AS numero,
    NULLIF(e.Building, '')                                   AS complemento,
    e.Block                                                  AS bairro,
    e.City                                                   AS cidade,
    UPPER(e.State)                                           AS uf,
    REPLACE(e.ZipCode, '-', '')                              AS cep,
    CASE WHEN e.AdresType = 'S' AND e.Address = c.ShipToDef THEN 1 ELSE 0 END AS principal
FROM CRD1 e
JOIN OCRD c ON c.CardCode = e.CardCode AND c.CardType = 'C'
WHERE COALESCE(e.Street, '') <> '' AND COALESCE(e.City, '') <> '';


-- ---------------------------------------------------------------------------------------------------------------------
-- 15. titulo — parcelas das notas de saída (INV6 sobre OINV) [P]. Chave DocEntry:parcela. Numero = Serial (número da NF na
--     localização Brasil) [C] ou DocNum.
-- ---------------------------------------------------------------------------------------------------------------------
CREATE VIEW vw_macuxi_titulo AS
SELECT
    CONCAT(n.DocEntry, ':', p.InstlmntID)                    AS external_id,     -- [P]
    CAST(CAST(COALESCE(n.UpdateDate, n.CreateDate) AS DATETIME2) AT TIME ZONE 'SA Western Standard Time' AT TIME ZONE 'UTC' AS DATETIME2(3)) AS alterado_em, -- [C]
    1                                                        AS ativo,
    CAST(n.CardCode AS VARCHAR(200))                         AS cliente_external_id,
    CAST(COALESCE(NULLIF(n.Serial, 0), n.DocNum) AS VARCHAR(40)) AS numero,      -- [C]
    p.InstlmntID                                             AS parcela,         -- [P]
    CONVERT(CHAR(10), n.DocDate, 23)                         AS emissao,
    CONVERT(CHAR(10), p.DueDate, 23)                         AS vencimento,      -- [P]
    CAST(ROUND(p.InsTotal * 100, 0) AS DECIMAL(19,0))        AS valor_cents,     -- [P]
    CAST(ROUND((p.InsTotal - p.PaidToDate) * 100, 0) AS DECIMAL(19,0)) AS saldo_cents, -- [P]
    CASE WHEN n.CANCELED <> 'N' THEN 'cancelado'
         WHEN p.Status = 'C' THEN 'baixado'
         ELSE 'aberto' END                                   AS situacao,        -- [P]
    CAST(NULL AS DATETIME2(3))                               AS baixado_em,      -- [C] data da baixa no ORCT/RCT2
    CASE WHEN n.Serial > 0 THEN CAST(n.Serial AS VARCHAR(40)) END AS nf_numero,  -- [C]
    CAST(NULLIF(n.SeriesStr, '') AS VARCHAR(10))             AS nf_serie,        -- [C]
    (SELECT f.Descript FROM OPYM f WHERE f.PayMethCod = n.PeyMethod) AS forma_pagamento -- [P]
FROM INV6 p
JOIN OINV n ON n.DocEntry = p.DocEntry;


-- ---------------------------------------------------------------------------------------------------------------------
-- 16. nota — faturamento (OINV) e devolução (ORIN, nota de crédito) [P]. pedido_uuid pelo pedido de origem (INV1.BaseType =
--     17, ORDR) com o UDF U_MXUUID [C].
-- ---------------------------------------------------------------------------------------------------------------------
CREATE VIEW vw_macuxi_nota AS
SELECT
    CONCAT('NS:', n.DocEntry)                                AS external_id,     -- [P]
    CAST(CAST(COALESCE(n.UpdateDate, n.CreateDate) AS DATETIME2) AT TIME ZONE 'SA Western Standard Time' AT TIME ZONE 'UTC' AS DATETIME2(3)) AS alterado_em,
    1                                                        AS ativo,
    CAST(n.CardCode AS VARCHAR(200))                         AS cliente_external_id,
    CASE WHEN n.SlpCode >= 0 THEN CAST(n.SlpCode AS VARCHAR(200)) END AS vendedor_external_id,
    'faturamento'                                            AS tipo,
    CAST(COALESCE(NULLIF(n.Serial, 0), n.DocNum) AS VARCHAR(40)) AS numero,      -- [C]
    NULLIF(n.SeriesStr, '')                                  AS serie,           -- [C]
    CAST(DATEADD(MINUTE, (COALESCE(n.DocTime, 0) / 100) * 60 + COALESCE(n.DocTime, 0) % 100, CAST(n.DocDate AS DATETIME2))
         AT TIME ZONE 'SA Western Standard Time' AT TIME ZONE 'UTC' AS DATETIME2(3)) AS emitida_em, -- [C] DocTime
    CAST(ROUND(n.DocTotal * 100, 0) AS DECIMAL(19,0))        AS total_cents,     -- [P]
    (SELECT COUNT(*) FROM INV1 l WHERE l.DocEntry = n.DocEntry) AS quantidade_itens,
    (SELECT MAX(o.U_MXUUID) FROM INV1 l JOIN ORDR o ON o.DocEntry = l.BaseEntry
      WHERE l.DocEntry = n.DocEntry AND l.BaseType = 17)     AS pedido_uuid,     -- [C] UDF U_MXUUID
    CASE WHEN n.CANCELED <> 'N' THEN 1 ELSE 0 END            AS cancelada,
    (SELECT f.Descript FROM OPYM f WHERE f.PayMethCod = n.PeyMethod) AS forma_pagamento
FROM OINV n
WHERE n.CANCELED <> 'C'                                                          -- [P] 'C' é o documento de estorno
UNION ALL
SELECT
    CONCAT('NC:', r.DocEntry),
    CAST(CAST(COALESCE(r.UpdateDate, r.CreateDate) AS DATETIME2) AT TIME ZONE 'SA Western Standard Time' AT TIME ZONE 'UTC' AS DATETIME2(3)),
    1,
    CAST(r.CardCode AS VARCHAR(200)),
    CASE WHEN r.SlpCode >= 0 THEN CAST(r.SlpCode AS VARCHAR(200)) END,
    'devolucao',
    CAST(COALESCE(NULLIF(r.Serial, 0), r.DocNum) AS VARCHAR(40)),
    NULLIF(r.SeriesStr, ''),
    CAST(DATEADD(MINUTE, (COALESCE(r.DocTime, 0) / 100) * 60 + COALESCE(r.DocTime, 0) % 100, CAST(r.DocDate AS DATETIME2))
         AT TIME ZONE 'SA Western Standard Time' AT TIME ZONE 'UTC' AS DATETIME2(3)),
    CAST(ROUND(r.DocTotal * 100, 0) AS DECIMAL(19,0)),
    (SELECT COUNT(*) FROM RIN1 l WHERE l.DocEntry = r.DocEntry),
    CAST(NULL AS VARCHAR(36)),
    CASE WHEN r.CANCELED <> 'N' THEN 1 ELSE 0 END,
    CAST(NULL AS VARCHAR(120))
FROM ORIN r
WHERE r.CANCELED <> 'C';


-- ---------------------------------------------------------------------------------------------------------------------
-- 17. pedido_status (RETORNO, RN-INT-08; só no caminho pelo Conector) — situação da entrada ('R' do job) e do ORDR achado
--     pelo U_MXUUID [C] (CANCELED = 'Y' = C [P]); notas pelas linhas do OINV com BaseType 17. Pedido fechado sem
--     cancelamento (DocStatus = 'C') = F [P].
-- ---------------------------------------------------------------------------------------------------------------------
CREATE VIEW vw_macuxi_pedido_status AS
SELECT
    LOWER(CAST(e.pedido_uuid AS VARCHAR(36)))                AS pedido_uuid,
    CASE WHEN e.situacao = 'R' THEN 'R' WHEN o.CANCELED = 'Y' THEN 'C' ELSE 'I' END AS situacao,
    CAST(COALESCE(o.DocNum, e.numero_pedido) AS VARCHAR(40)) AS numero_pedido,   -- [P] DocNum do pedido
    CASE WHEN e.situacao = 'R' THEN COALESCE(NULLIF(LTRIM(RTRIM(e.motivo)), ''), 'Recusado no ERP')
         ELSE NULLIF(LTRIM(RTRIM(e.motivo)), '') END         AS motivo,
    CAST(NULL AS VARCHAR(40))                                AS nota_numero,
    CAST(NULL AS VARCHAR(10))                                AS nota_serie,
    CAST(NULL AS DATETIME2(3))                               AS nota_emitida_em,
    CAST(NULL AS DECIMAL(19,0))                              AS nota_total_cents,
    e.recebido_em                                            AS ocorrido_em      -- já em UTC
FROM dbo.macuxi_pedido_entrada e
LEFT JOIN ORDR o ON LOWER(o.U_MXUUID) = LOWER(CAST(e.pedido_uuid AS VARCHAR(36)))
UNION ALL
SELECT
    LOWER(o.U_MXUUID),
    CASE WHEN o.DocStatus = 'C' AND o.CANCELED = 'N' THEN 'F' ELSE 'P' END,
    CAST(o.DocNum AS VARCHAR(40)),
    CAST(NULL AS VARCHAR(300)),
    CAST(COALESCE(NULLIF(n.Serial, 0), n.DocNum) AS VARCHAR(40)),
    CAST(NULLIF(n.SeriesStr, '') AS VARCHAR(10)),
    CAST(DATEADD(MINUTE, (COALESCE(n.DocTime, 0) / 100) * 60 + COALESCE(n.DocTime, 0) % 100, CAST(n.DocDate AS DATETIME2))
         AT TIME ZONE 'SA Western Standard Time' AT TIME ZONE 'UTC' AS DATETIME2(3)),
    CAST(ROUND(n.DocTotal * 100, 0) AS DECIMAL(19,0)),
    CAST(DATEADD(MINUTE, (COALESCE(n.DocTime, 0) / 100) * 60 + COALESCE(n.DocTime, 0) % 100, CAST(n.DocDate AS DATETIME2))
         AT TIME ZONE 'SA Western Standard Time' AT TIME ZONE 'UTC' AS DATETIME2(3))
FROM ORDR o
JOIN (SELECT DISTINCT DocEntry, BaseEntry FROM INV1 WHERE BaseType = 17) l ON l.BaseEntry = o.DocEntry
JOIN OINV n ON n.DocEntry = l.DocEntry AND n.CANCELED = 'N'
WHERE o.U_MXUUID IS NOT NULL;


-- ---------------------------------------------------------------------------------------------------------------------
-- 18. pedido_nota_item (RETORNO) — linhas do OINV ligadas ao pedido (BaseType 17) [P]. sequencia = BaseLine + 1: o job cria
--     as linhas do ORDR na ordem do Macuxi (LineNum 0 = sequência 1) [C]. Quantidade na unidade de estoque (InvQty) [C].
-- ---------------------------------------------------------------------------------------------------------------------
CREATE VIEW vw_macuxi_pedido_nota_item AS
SELECT
    LOWER(o.U_MXUUID)                                        AS pedido_uuid,
    CAST(COALESCE(NULLIF(n.Serial, 0), n.DocNum) AS VARCHAR(40)) AS nota_numero,
    CAST(NULLIF(n.SeriesStr, '') AS VARCHAR(10))             AS nota_serie,
    l.BaseLine + 1                                           AS sequencia,       -- [C]
    CAST(l.InvQty AS INT)                                    AS quantidade,      -- [C]
    CAST(ROUND(l.LineTotal * 100, 0) AS DECIMAL(19,0))       AS valor_cents,     -- [P]
    CAST(l.ItemCode AS VARCHAR(200))                         AS produto_codigo
FROM INV1 l
JOIN OINV n ON n.DocEntry = l.DocEntry AND n.CANCELED = 'N'
JOIN ORDR o ON o.DocEntry = l.BaseEntry AND l.BaseType = 17
WHERE o.U_MXUUID IS NOT NULL;
