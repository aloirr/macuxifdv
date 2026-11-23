-- =====================================================================================================================
-- Macuxi FDV — MODELO de views do Conector para o TOTVS WinThor (ERP -> Hub /integracao/v1)
-- Status: beta (D9 do desenho: fica "beta" até o primeiro cliente WinThor confirmar os itens [C]).
-- Dono: banco-dados. Desenho: docs/desenho/integracao-modelos-erp.md §3.2 (de-para) e §6 (F4b); ADR 0066.
-- Formato e regras de toda view: db/conector/views-modelo.sql (cabeçalho, regras 1 a 8). Dicionário: docs/banco/integracao.md,
-- "Modelos por ERP". Teste sem banco: db/testes/modelos-erp-conector.test.ts (colunas contra SCHEMA_REGISTRO).
-- NADA aqui é aplicado pelo Macuxi: o técnico do cliente revisa e cria as views no schema do WinThor (ou num schema próprio
-- com SELECT nas tabelas PC*), com o usuário somente leitura do Conector tendo SELECT nelas.
--
-- LEGENDA
--   [P] = conhecimento público (documentação TOTVS ou uso amplo no mercado).
--   [C] = CONFIRMAR com o cliente antes de ligar: muda por versão, parametrização ou customização.
--
-- REGRAS GERAIS DO WINTHOR
--   - Banco Oracle, tabelas PC* no schema do WinThor [P]. Códigos são NUMBER (CODCLI, CODPROD, CODUSUR): external_id = TO_CHAR.
--   - Exclusão lógica por DTEXCLUSAO preenchida (cliente, produto) [P]; bloqueio por BLOQUEIO = 'S' [P].
--   - Data de alteração: só alguns cadastros têm (PCCLIENT.DTULTALTER [C]). Sem ela, a view devolve a data fixa
--     TIMESTAMP '2000-01-01 00:00:00' e a entidade roda SÓ em carga completa na frequência (RN-INT-06 inativa o que sumiu).
--     Trigger do cliente gravando a data em tabela própria é a saída para ter delta [C].
--   - As datas do WinThor (DATE) estão na hora local do tenant: a view converte para UTC (regra 3 do views-modelo.sql).
--
-- DIALETO
--   Corpo em Oracle (12.2+), o único banco do WinThor [P]. Não há forma SQL Server.
--
-- O QUE NÃO TEM VIEW NESTE MODELO
--   SEM VIEW: tabela_escalonada — o WinThor trabalha com política de desconto (PCDESCONTO), não com faixa de preço; mapear
--             só depois de confirmar com o cliente. [C]
--   SEM VIEW: cliente_endereco — endereços de entrega extras ficam em PCCLIENTENDENT por versão; o principal já vai no
--             cliente. [C]
--   SEM VIEW: rota — a rota do WinThor (PCROTAEXP) é de entrega, não roteiro de visita do RCA; o roteiro nasce no Macuxi. [C]
--
-- PEDIDO (Macuxi -> ERP): pelas tabelas da força de vendas PCPEDCFV/PCPEDIFV, importadas pela rotina do WinThor; NUNCA direto
--   em PCPEDC/PCPEDI (§3.2). Caminho do modelo: a entrada genérica db/conector/entrada-pedido-modelo.sql nas formas
--   "[Oracle]" (tabela macuxi_pedido_entrada) e um JOB do parceiro que copia cada pedido para PCPEDCFV/PCPEDIFV com
--   NUMPEDRCA = macuxi_pedido_entrada.numero_pedido [C]; a rotina de importação gera o PCPEDC com o mesmo NUMPEDRCA [C].
--   Recusa na importação = o job grava situacao 'R' e o motivo na entrada [C]. As 2 views do retorno estão no fim.
-- =====================================================================================================================


-- ---------------------------------------------------------------------------------------------------------------------
-- 1. filial — PCFILIAL [P]. A filial '99' (consolidadora) não vende [C].
-- ---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_macuxi_filial AS
SELECT
    TO_CHAR(f.CODIGO)                                        AS external_id,     -- [P]
    CAST(TIMESTAMP '2000-01-01 00:00:00' AS TIMESTAMP(3))    AS alterado_em,     -- sem data de alteração: carga completa
    1                                                        AS ativo,
    TO_CHAR(f.CODIGO)                                        AS codigo,
    NVL(f.FANTASIA, f.RAZAOSOCIAL)                           AS nome,            -- [C] nomes das colunas por versão
    f.CIDADE                                                 AS cidade,
    UPPER(f.UF)                                              AS uf,
    REGEXP_REPLACE(f.CGC, '[^0-9]', '')                      AS cnpj,
    f.ENDERECO                                               AS logradouro,
    CAST(NULL AS VARCHAR2(20))                               AS numero,          -- [C]
    f.BAIRRO                                                 AS bairro,
    REGEXP_REPLACE(f.CEP, '[^0-9]', '')                      AS cep,
    f.TELEFONE                                               AS telefone
FROM PCFILIAL f
WHERE f.CODIGO <> '99';                                                          -- [C]


-- ---------------------------------------------------------------------------------------------------------------------
-- 2. vendedor (RCA) — PCUSUARI [P].
-- ---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_macuxi_vendedor AS
SELECT
    TO_CHAR(u.CODUSUR)                                       AS external_id,     -- [P]
    CAST(TIMESTAMP '2000-01-01 00:00:00' AS TIMESTAMP(3))    AS alterado_em,
    CASE WHEN NVL(u.BLOQUEIO, 'N') = 'S' OR u.DTTERMINO IS NOT NULL THEN 0 ELSE 1 END AS ativo, -- [C] DTTERMINO
    u.NOME                                                   AS nome,            -- [P]
    u.EMAIL                                                  AS email,           -- [C]
    u.TELEFONE1                                              AS telefone,        -- [C]
    TO_CHAR(u.CODFILIAL)                                     AS filial_external_id -- [C]
FROM PCUSUARI u;


-- ---------------------------------------------------------------------------------------------------------------------
-- 3. catalogo_no — departamento (PCDEPTO, nível 1) e seção (PCSECAO, nível 2) [P]. Prefixo D:/S: separa as chaves.
-- ---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_macuxi_catalogo_no AS
SELECT
    'D:' || TO_CHAR(d.CODEPTO)                               AS external_id,     -- [P]
    CAST(TIMESTAMP '2000-01-01 00:00:00' AS TIMESTAMP(3))    AS alterado_em,
    1                                                        AS ativo,
    'D' || TO_CHAR(d.CODEPTO)                                AS codigo,
    d.DESCRICAO                                              AS nome,
    CAST(NULL AS VARCHAR2(200))                              AS pai_external_id,
    1                                                        AS nivel,
    0                                                        AS ordem
FROM PCDEPTO d
UNION ALL
SELECT
    'S:' || TO_CHAR(s.CODSEC), CAST(TIMESTAMP '2000-01-01 00:00:00' AS TIMESTAMP(3)), 1,
    'S' || TO_CHAR(s.CODSEC), s.DESCRICAO, 'D:' || TO_CHAR(s.CODEPTO), 2, 0
FROM PCSECAO s;


-- ---------------------------------------------------------------------------------------------------------------------
-- 4. forma_pagamento — cobrança (PCCOB) [P]: D (dinheiro), BK (boleto), CH... Só as cobranças que o RCA usa [C].
-- ---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_macuxi_forma_pagamento AS
SELECT
    TRIM(c.CODCOB)                                           AS external_id,     -- [P]
    CAST(TIMESTAMP '2000-01-01 00:00:00' AS TIMESTAMP(3))    AS alterado_em,
    1                                                        AS ativo,
    UPPER(TRIM(c.CODCOB))                                    AS codigo,
    c.COBRANCA                                               AS nome,            -- [P] descrição da cobrança
    0                                                        AS ordem
FROM PCCOB c;


-- ---------------------------------------------------------------------------------------------------------------------
-- 5. prazo_pagamento — plano de pagamento (PCPLPAG) [P]. O WinThor não liga plano a cobrança: o modelo faz uma linha por
--    par cobrança × plano (regra do views-modelo.sql, view 5), restrita às cobranças que vendem a prazo [C].
--    Parcelas: PRAZO1..PRAZO12 do plano [C]; o modelo usa as 3 primeiras e cai para NUMDIAS (prazo médio) [P].
-- ---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_macuxi_prazo_pagamento AS
SELECT
    TRIM(c.CODCOB) || ':' || TO_CHAR(p.CODPLPAG)             AS external_id,     -- cobrança:plano
    CAST(TIMESTAMP '2000-01-01 00:00:00' AS TIMESTAMP(3))    AS alterado_em,
    1                                                        AS ativo,
    TRIM(c.CODCOB)                                           AS forma_external_id,
    UPPER(TRIM(c.CODCOB)) || '-' || TO_CHAR(p.CODPLPAG)      AS codigo,          -- único entre todas as formas (até 20)
    p.DESCRICAO                                              AS descricao,       -- [P]
    CASE WHEN p.PRAZO1 IS NULL THEN '[' || TO_CHAR(NVL(p.NUMDIAS, 0)) || ']'
         ELSE '[' || TO_CHAR(p.PRAZO1)
                  || CASE WHEN NVL(p.PRAZO2, 0) > 0 THEN ',' || TO_CHAR(p.PRAZO2) END
                  || CASE WHEN NVL(p.PRAZO3, 0) > 0 THEN ',' || TO_CHAR(p.PRAZO3) END || ']' END AS parcelas_dias, -- [C]
    p.NUMDIAS                                                AS prazo_medio_dias, -- [P]
    0                                                        AS ordem
FROM PCPLPAG p
CROSS JOIN PCCOB c
WHERE TRIM(c.CODCOB) IN ('BK', 'CH');                                            -- [C] cobranças a prazo do cliente


-- ---------------------------------------------------------------------------------------------------------------------
-- 6. produto — PCPRODUT [P]; marca em PCMARCA [P]; seção (view 3) como nó do catálogo.
-- ---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_macuxi_produto AS
SELECT
    TO_CHAR(p.CODPROD)                                       AS external_id,     -- [P]
    CAST(TIMESTAMP '2000-01-01 00:00:00' AS TIMESTAMP(3))    AS alterado_em,
    CASE WHEN p.DTEXCLUSAO IS NULL THEN 1 ELSE 0 END         AS ativo,           -- [P]
    TO_CHAR(p.CODPROD)                                       AS sku,
    TO_CHAR(p.CODAUXILIAR)                                   AS ean,             -- [P] EAN da unidade
    p.DESCRICAO                                              AS nome,            -- [P]
    (SELECT m.MARCA FROM PCMARCA m WHERE m.CODMARCA = p.CODMARCA) AS marca,      -- [P]
    TO_CHAR(p.CODMARCA)                                      AS marca_codigo,
    UPPER(p.UNIDADE)                                         AS unidade,         -- [P]
    CASE WHEN p.QTUNITCX >= 2 THEN UPPER(NVL(p.UNIDADEMASTER, 'CX')) END AS embalagem_medida, -- [C] UNIDADEMASTER
    CASE WHEN p.QTUNITCX >= 2 THEN p.QTUNITCX END            AS embalagem_quantidade, -- [P] unidades na caixa
    'S:' || TO_CHAR(p.CODSEC)                                AS catalogo_no_external_id
FROM PCPRODUT p;


-- ---------------------------------------------------------------------------------------------------------------------
-- 7. produto_unidade — PCEMBALAGEM (embalagens de venda por filial) [C]. Uma filial de referência evita repetir a chave [C].
-- ---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_macuxi_produto_unidade AS
SELECT
    TO_CHAR(e.CODPROD) || ':' || TO_CHAR(e.CODAUXILIAR)      AS external_id,     -- produto:código da embalagem
    CAST(TIMESTAMP '2000-01-01 00:00:00' AS TIMESTAMP(3))    AS alterado_em,
    1                                                        AS ativo,
    TO_CHAR(e.CODPROD)                                       AS produto_external_id,
    UPPER(e.UNIDADE)                                         AS unidade,         -- [C]
    e.QTUNIT                                                 AS fator,           -- [C] unidades base na embalagem
    TO_CHAR(e.CODAUXILIAR)                                   AS ean,
    0                                                        AS padrao
FROM PCEMBALAGEM e
WHERE e.CODFILIAL = '1'                                                          -- [C] filial de referência
  AND e.QTUNIT >= 1;


-- ---------------------------------------------------------------------------------------------------------------------
-- 8. preco — PCTABPR por região (NUMREGIAO) [P]; a região é a "tabela" e o cliente chega nela pela praça (PCPRACA) [C].
--    Sem vigência no WinThor: início fixo [P]. Região por filial é [C] (o modelo devolve NULL = filial padrão).
-- ---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_macuxi_preco AS
SELECT
    TO_CHAR(t.NUMREGIAO) || ':' || TO_CHAR(t.CODPROD)        AS external_id,     -- região:produto
    CAST(SYS_EXTRACT_UTC(FROM_TZ(CAST(NVL(t.DTULTALTPVENDA, DATE '2000-01-01') AS TIMESTAMP), 'America/Manaus')) AS TIMESTAMP(3)) AS alterado_em, -- [C]
    CASE WHEN NVL(t.PVENDA, 0) > 0 THEN 1 ELSE 0 END         AS ativo,           -- preço zerado = fora da tabela
    TO_CHAR(t.NUMREGIAO)                                     AS tabela_external_id,
    (SELECT r.REGIAO FROM PCREGIAO r WHERE r.NUMREGIAO = t.NUMREGIAO) AS tabela_nome, -- [P]
    '2000-01-01'                                             AS vigencia_inicio,
    CAST(NULL AS VARCHAR2(10))                               AS vigencia_fim,
    TO_CHAR(t.CODPROD)                                       AS produto_external_id,
    CAST(ROUND(NVL(t.PVENDA, 0) * 100, 0) AS NUMBER(19,0))   AS preco_cents,     -- [P] PVENDA (PVENDA1..7 por plano) [C]
    CAST(NULL AS VARCHAR2(200))                              AS filial_external_id
FROM PCTABPR t;


-- ---------------------------------------------------------------------------------------------------------------------
-- 10. estoque — PCEST por filial [P]: saldo = QTESTGER − QTRESERV − QTBLOQUEADA [P]. O depósito é a filial.
-- ---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_macuxi_estoque AS
SELECT
    TO_CHAR(e.CODFILIAL) || ':' || TO_CHAR(e.CODPROD)        AS external_id,     -- filial:produto
    CAST(TIMESTAMP '2000-01-01 00:00:00' AS TIMESTAMP(3))    AS alterado_em,     -- reserva muda sem data: carga completa
    1                                                        AS ativo,
    TO_CHAR(e.CODFILIAL)                                     AS deposito_external_id,
    'Filial ' || TO_CHAR(e.CODFILIAL)                        AS deposito_nome,
    TO_CHAR(e.CODPROD)                                       AS produto_external_id,
    NVL(e.QTESTGER, 0) - NVL(e.QTRESERV, 0) - NVL(e.QTBLOQUEADA, 0) AS saldo,    -- [P]
    TO_CHAR(e.CODFILIAL)                                     AS filial_external_id
FROM PCEST e;


-- ---------------------------------------------------------------------------------------------------------------------
-- 11. cliente — PCCLIENT [P]. Endereço de entrega (…ENT) como principal [P]. CGCENT só em "documento".
-- ---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_macuxi_cliente AS
SELECT
    TO_CHAR(c.CODCLI)                                        AS external_id,     -- [P] nunca o CGCENT
    CAST(SYS_EXTRACT_UTC(FROM_TZ(CAST(NVL(c.DTULTALTER, NVL(c.DTCADASTRO, DATE '2000-01-01')) AS TIMESTAMP), 'America/Manaus')) AS TIMESTAMP(3)) AS alterado_em, -- [C]
    CASE WHEN c.DTEXCLUSAO IS NULL THEN 1 ELSE 0 END         AS ativo,           -- [P]
    c.CLIENTE                                                AS razao_social,    -- [P]
    c.FANTASIA                                               AS nome_fantasia,
    REGEXP_REPLACE(c.CGCENT, '[^0-9]', '')                   AS documento,       -- [P]
    TO_CHAR(c.CODUSUR1)                                      AS vendedor_external_id, -- [P] RCA principal
    c.ENDERENT                                               AS endereco_logradouro, -- [P]
    c.NUMEROENT                                              AS endereco_numero, -- [C]
    c.BAIRROENT                                              AS endereco_bairro, -- [P]
    c.MUNICENT                                               AS endereco_cidade, -- [P]
    UPPER(c.ESTENT)                                          AS endereco_uf,     -- [P]
    REGEXP_REPLACE(c.CEPENT, '[^0-9]', '')                   AS endereco_cep,
    c.TELENT                                                 AS telefone,
    c.EMAIL                                                  AS email,           -- [C]
    CAST(ROUND(NVL(c.LIMCRED, 0) * 100, 0) AS NUMBER(19,0))  AS limite_credito_cents, -- [P]
    c.IEENT                                                  AS inscricao_estadual, -- [C]
    CASE WHEN NVL(c.BLOQUEIO, 'N') = 'S' THEN 1 ELSE 0 END   AS bloqueado,       -- [P]
    CAST(NULL AS VARCHAR2(60))                               AS canal,           -- [C] ramo de atividade (CODATV1) se usar
    CAST(NULL AS NUMBER(5))                                  AS prazo_medio_max_dias, -- o WinThor não controla: vale o BKO
    CAST(NULL AS VARCHAR2(1))                                AS formas_pagamento,     -- [C] cobrança do cliente (CODCOB)
    (SELECT TO_CHAR(pr.NUMREGIAO) FROM PCPRACA pr WHERE pr.CODPRACA = c.CODPRACA) AS tabela_preco_external_id, -- [C] região
    TO_CHAR(c.CODFILIALNF)                                   AS filial_external_id -- [C] filial de faturamento do cliente
FROM PCCLIENT c;


-- ---------------------------------------------------------------------------------------------------------------------
-- 13. transportadora — fornecedor do tipo transportadora em PCFORNEC [C] (o filtro muda por versão).
-- ---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_macuxi_transportadora AS
SELECT
    TO_CHAR(f.CODFORNEC)                                     AS external_id,     -- [C]
    CAST(TIMESTAMP '2000-01-01 00:00:00' AS TIMESTAMP(3))    AS alterado_em,
    CASE WHEN NVL(f.BLOQUEIO, 'N') = 'S' THEN 0 ELSE 1 END   AS ativo,
    f.FORNECEDOR                                             AS nome,
    REGEXP_REPLACE(f.CGC, '[^0-9]', '')                      AS documento,
    f.IE                                                     AS inscricao_estadual,
    f.TELFAB                                                 AS telefone
FROM PCFORNEC f
WHERE f.TIPOFORNEC = 'T';                                                        -- [C]


-- ---------------------------------------------------------------------------------------------------------------------
-- 15. titulo — PCPREST (contas a receber) [P]. Chave filial:duplicata:prestação. Saldo = VALOR − VPAGO [C].
-- ---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_macuxi_titulo AS
SELECT
    TO_CHAR(t.CODFILIAL) || ':' || TO_CHAR(t.DUPLIC) || ':' || TO_CHAR(t.PREST) AS external_id,
    CAST(SYS_EXTRACT_UTC(FROM_TZ(CAST(NVL(t.DTPAG, t.DTEMISSAO) AS TIMESTAMP), 'America/Manaus')) AS TIMESTAMP(3)) AS alterado_em, -- [C]
    1                                                        AS ativo,
    TO_CHAR(t.CODCLI)                                        AS cliente_external_id, -- [P]
    TO_CHAR(t.DUPLIC)                                        AS numero,          -- [P]
    CASE WHEN REGEXP_LIKE(TRIM(t.PREST), '^[0-9]+$') THEN TO_NUMBER(TRIM(t.PREST)) END AS parcela,
    TO_CHAR(t.DTEMISSAO, 'YYYY-MM-DD')                       AS emissao,
    TO_CHAR(t.DTVENC, 'YYYY-MM-DD')                          AS vencimento,      -- [P]
    CAST(ROUND(t.VALOR * 100, 0) AS NUMBER(19,0))            AS valor_cents,     -- [P]
    CAST(ROUND(GREATEST(t.VALOR - NVL(t.VPAGO, 0), 0) * 100, 0) AS NUMBER(19,0)) AS saldo_cents, -- [C]
    CASE WHEN t.DTCANCEL IS NOT NULL THEN 'cancelado'        -- [C] DTCANCEL
         WHEN t.DTPAG IS NOT NULL THEN 'baixado'
         ELSE 'aberto' END                                   AS situacao,
    CAST(SYS_EXTRACT_UTC(FROM_TZ(CAST(t.DTPAG AS TIMESTAMP), 'America/Manaus')) AS TIMESTAMP(3)) AS baixado_em, -- [P]
    CAST(NULL AS VARCHAR2(40))                               AS nf_numero,       -- [C] NUMTRANSVENDA -> PCNFSAID.NUMNOTA
    CAST(NULL AS VARCHAR2(10))                               AS nf_serie,
    (SELECT cb.COBRANCA FROM PCCOB cb WHERE cb.CODCOB = t.CODCOB) AS forma_pagamento -- [P]
FROM PCPREST t;


-- ---------------------------------------------------------------------------------------------------------------------
-- 16. nota — saída PCNFSAID [P]. Devolução (PCNFENT, tipo de descarga de devolução) é [C] e fica fora até o cliente confirmar.
--     pedido_uuid: PCNFSAID.NUMPED -> PCPEDC.NUMPEDRCA -> macuxi_pedido_entrada.numero_pedido [C].
-- ---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_macuxi_nota AS
SELECT
    TO_CHAR(n.NUMTRANSVENDA)                                 AS external_id,     -- [P] transação de venda (única)
    CAST(SYS_EXTRACT_UTC(FROM_TZ(CAST(NVL(n.DTCANCEL, n.DTSAIDA) AS TIMESTAMP), 'America/Manaus')) AS TIMESTAMP(3)) AS alterado_em,
    1                                                        AS ativo,
    TO_CHAR(n.CODCLI)                                        AS cliente_external_id,
    TO_CHAR(n.CODUSUR)                                       AS vendedor_external_id,
    'faturamento'                                            AS tipo,
    TO_CHAR(n.NUMNOTA)                                       AS numero,          -- [P]
    TO_CHAR(n.SERIE)                                         AS serie,
    CAST(SYS_EXTRACT_UTC(FROM_TZ(CAST(n.DTSAIDA AS TIMESTAMP), 'America/Manaus')) AS TIMESTAMP(3)) AS emitida_em, -- [C] só data
    CAST(ROUND(n.VLTOTAL * 100, 0) AS NUMBER(19,0))          AS total_cents,     -- [P]
    (SELECT e.pedido_uuid FROM PCPEDC pc JOIN macuxi_pedido_entrada e ON e.numero_pedido = pc.NUMPEDRCA
      WHERE pc.NUMPED = n.NUMPED)                            AS pedido_uuid,     -- [C]
    CASE WHEN n.DTCANCEL IS NOT NULL THEN 1 ELSE 0 END       AS cancelada,
    (SELECT cb.COBRANCA FROM PCCOB cb WHERE cb.CODCOB = n.CODCOB) AS forma_pagamento
FROM PCNFSAID n
WHERE n.ESPECIE = 'NF';                                                          -- [C]


-- ---------------------------------------------------------------------------------------------------------------------
-- 17. pedido_status (RETORNO, RN-INT-08) — situação da entrada ('R' do job) e do PCPEDC achado pelo NUMPEDRCA [C]
--     (POSICAO 'C' cancelado [P]); notas pelo PCNFSAID.NUMPED. Faturado (P/F) só com nota; POSICAO 'F' = F [P].
-- ---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_macuxi_pedido_status AS
SELECT
    e.pedido_uuid                                            AS pedido_uuid,
    CASE WHEN e.situacao = 'R' THEN 'R' WHEN pc.POSICAO = 'C' THEN 'C' ELSE 'I' END AS situacao,
    TO_CHAR(NVL(pc.NUMPED, e.numero_pedido))                 AS numero_pedido,   -- [P] NUMPED do WinThor
    CASE WHEN e.situacao = 'R' THEN NVL(TRIM(e.motivo), 'Recusado no ERP') ELSE TRIM(e.motivo) END AS motivo,
    CAST(NULL AS VARCHAR2(40))                               AS nota_numero,
    CAST(NULL AS VARCHAR2(10))                               AS nota_serie,
    CAST(NULL AS TIMESTAMP(3))                               AS nota_emitida_em,
    CAST(NULL AS NUMBER(19,0))                               AS nota_total_cents,
    e.recebido_em                                            AS ocorrido_em      -- já em UTC
FROM macuxi_pedido_entrada e
LEFT JOIN PCPEDC pc ON pc.NUMPEDRCA = e.numero_pedido                            -- [C]
UNION ALL
SELECT
    e.pedido_uuid,
    CASE WHEN pc.POSICAO = 'F' THEN 'F' ELSE 'P' END,
    TO_CHAR(pc.NUMPED),
    CAST(NULL AS VARCHAR2(300)),
    TO_CHAR(n.NUMNOTA),
    TO_CHAR(n.SERIE),
    CAST(SYS_EXTRACT_UTC(FROM_TZ(CAST(n.DTSAIDA AS TIMESTAMP), 'America/Manaus')) AS TIMESTAMP(3)),
    CAST(ROUND(n.VLTOTAL * 100, 0) AS NUMBER(19,0)),
    CAST(SYS_EXTRACT_UTC(FROM_TZ(CAST(n.DTSAIDA AS TIMESTAMP), 'America/Manaus')) AS TIMESTAMP(3))
FROM PCNFSAID n
JOIN PCPEDC pc ON pc.NUMPED = n.NUMPED
JOIN macuxi_pedido_entrada e ON e.numero_pedido = pc.NUMPEDRCA
WHERE n.DTCANCEL IS NULL;


-- ---------------------------------------------------------------------------------------------------------------------
-- 18. pedido_nota_item (RETORNO) — itens da nota em PCMOV pela transação [P]; sequencia = NUMSEQ do item do pedido, que o
--     job grava igual à sequência do Macuxi no PCPEDIFV [C].
-- ---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_macuxi_pedido_nota_item AS
SELECT
    e.pedido_uuid                                            AS pedido_uuid,
    TO_CHAR(n.NUMNOTA)                                       AS nota_numero,
    TO_CHAR(n.SERIE)                                         AS nota_serie,
    m.NUMSEQ                                                 AS sequencia,       -- [C]
    CAST(m.QT AS NUMBER(10))                                 AS quantidade,      -- [P] na unidade de venda do produto
    CAST(ROUND(m.QT * m.PUNIT * 100, 0) AS NUMBER(19,0))     AS valor_cents,     -- [P]
    TO_CHAR(m.CODPROD)                                       AS produto_codigo
FROM PCMOV m
JOIN PCNFSAID n ON n.NUMTRANSVENDA = m.NUMTRANSVENDA
JOIN PCPEDC pc ON pc.NUMPED = n.NUMPED
JOIN macuxi_pedido_entrada e ON e.numero_pedido = pc.NUMPEDRCA
WHERE n.DTCANCEL IS NULL;
