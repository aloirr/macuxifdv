-- =====================================================================================================================
-- Macuxi FDV — views-modelo do Conector (ERP -> Hub /integracao/v1)
-- Dono: banco-dados. Formato: docs/banco/integracao.md, seção "Views-modelo do Conector". Guia: docs/modulos/integracao/conector.md §3 e §5.
-- Teste sem banco: db/testes/views-modelo-conector.test.ts (confere cada view contra o contrato SCHEMA_REGISTRO).
--
-- O QUE É ESTE ARQUIVO
--   Um MODELO. As tabelas de origem (erp_*) e as colunas delas são fictícias: o técnico do cliente troca pelas tabelas do
--   ERP dele e cria as views no banco do ERP, com o usuário somente leitura do Conector tendo SELECT nelas.
--   Uma view por entidade do Hub, NA ORDEM DE CARGA (ORDEM_CARGA_ENTIDADES em modules/integracao/contracts/entidades.ts).
--   A entrada de PEDIDOS (Macuxi -> ERP) tem modelo próprio: db/conector/entrada-pedido-modelo.sql.
--   Crie só as views das entidades que o tenant liga no Conector (lista "entidades" no BKO).
--   T-0162: no fim, as 2 views do RETORNO do pedido (17 e 18), que NÃO são entidades de carga: o Conector as lê em
--   "pedidos.status" do conector.json (situação, nota e itens faturados de cada pedido gravado pela entrada).
--
-- REGRAS DE TODA VIEW
--   1. O nome de cada coluna é o NOME DO CAMPO no contrato canônico (modules/integracao/contracts/entidades.ts). Assim a
--      consulta do conector.json é "SELECT * FROM vw_macuxi_<entidade> ..." e o mapeamento "campos" fica 1 para 1.
--      Objeto aninhado vira colunas "<objeto>_<campo>" (cliente: endereco_cidade -> "endereco.cidade" no conector.json).
--      Lista vira UMA coluna com texto JSON (transformar: "json"): parcelas_dias, formas_pagamento, contatos, paradas,
--      referencias, oferece_junto, etiquetas.
--   2. external_id = chave INTERNA do ERP (código, id), única por entidade, como TEXTO (CAST ... AS VARCHAR(200)).
--      NUNCA CPF/CNPJ: o external_id aparece em logs e no monitor de erros (docs/modulos/integracao/desenho.md §4).
--      Chave composta (preço, estoque, faixa) separa as partes com ':' (ex.: 'TAB01:SKU123').
--   3. alterado_em = instante da última alteração, em UTC, com precisão de MILISSEGUNDOS, nunca nulo (use COALESCE com a
--      data de inclusão). Se a linha junta várias tabelas (cliente + contatos, prazo + parcelas, produto + referências),
--      use o MAIOR alterado_em entre elas.
--      PREMISSA DO MODELO (a mesma nos dois dialetos, para o mesmo ERP dar o mesmo instante): as colunas de data/hora do
--      ERP (alterado_em, baixado_em, emitida_em) estão na HORA LOCAL do tenant, sem fuso, e a view converte para UTC.
--      O fuso do exemplo é Manaus; troque pelo do tenant NOS DOIS nomes (IANA no Oracle, Windows no SQL Server):
--        Manaus:   'America/Manaus'    = 'SA Western Standard Time'
--        Brasília: 'America/Sao_Paulo' = 'E. South America Standard Time'
--        SQL Server: CAST(x AT TIME ZONE 'SA Western Standard Time' AT TIME ZONE 'UTC' AS DATETIME2(3)) (2016+)
--        Oracle:     CAST(SYS_EXTRACT_UTC(FROM_TZ(CAST(x AS TIMESTAMP), 'America/Manaus')) AS TIMESTAMP(3))
--        PostgreSQL: date_trunc('milliseconds', x AT TIME ZONE 'America/Manaus') (timestamp sem fuso -> timestamptz)
--      Variante "a coluna do ERP JÁ ESTÁ em UTC" (troque em TODAS as views, nos dois dialetos):
--        SQL Server: CAST(x AS DATETIME2(3))      Oracle: CAST(x AS TIMESTAMP(3))
--      rowversion/SCN não servem: converta para um instante, não para número. O Conector lê o DATETIME2/TIMESTAMP como UTC.
--   4. ativo = 1/0 (transformar: "booleano"). Excluir no ERP = devolver a linha com ativo = 0 (o delta só vê o que existe);
--      exclusão física só é percebida na carga completa (RN-INT-06). Registro excluído logicamente no ERP (flag de
--      "deletado", data de exclusão) vira ativo = 0, NÃO some da view.
--   5. Dinheiro em CENTAVOS inteiros: CAST(ROUND(x * 100, 0) AS DECIMAL(19,0)) (igual nos dois bancos). Alternativa:
--      devolver reais e usar transformar: "centavos_de_decimal" no conector.json (mas a coluna continua com o nome *_cents).
--   6. Data civil (vigência, vencimento, emissão) = texto 'AAAA-MM-DD' no fuso do TENANT, sem converter para UTC:
--        SQL Server: CONVERT(CHAR(10), x, 23)        Oracle: TO_CHAR(x, 'YYYY-MM-DD')
--   7. Booleanos (ativo, bloqueado, padrao, principal, cancelada) saem como 1/0 por CASE (igual nos dois bancos).
--   8. Coluna NULA = campo AUSENTE no Hub = o Macuxi não altera o valor que já tem. Para LIMPAR uma lista, devolva '[]'.
--
-- DIALETOS (SQL Server e Oracle, alvos de conector.exemplo.json e conector.oracle.exemplo.json)
--   O corpo ativo das views está em SQL Server (2017+). Cada ponto que diverge traz a forma Oracle (12.2+) comentada,
--   marcada "-- [Oracle]", logo acima da linha do SQL Server, marcada "-- [SQL Server]". O resto é igual nos dois.
--   - SQL Server: CREATE VIEW precisa ser o único comando do lote; no SSMS/sqlcmd, ponha "GO" depois de cada view.
--     SQL Server 2012-2016 não tem STRING_AGG: use STUFF((SELECT ',' + ... FOR XML PATH('')), 1, 1, '').
--   - Oracle: troque CREATE VIEW por CREATE OR REPLACE VIEW, se quiser recriar; 11g não tem JSON_ARRAYAGG (use LISTAGG
--     montando o texto JSON). Nomes até 30 caracteres no 11g/12.1: todos os nomes deste arquivo cabem.
--
-- CONSULTA DO conector.json (por entidade; o Conector exige os 3 parâmetros)
--   SQL Server:
--     SELECT TOP (:limite) * FROM vw_macuxi_<entidade>
--      WHERE alterado_em > :cursor_alterado_em
--         OR (alterado_em = :cursor_alterado_em AND external_id COLLATE Latin1_General_BIN2 > :cursor_external_id)
--      ORDER BY alterado_em, external_id COLLATE Latin1_General_BIN2
--   Oracle (sem :limite o Conector acrescenta OFFSET/FETCH ou ROWNUM, conforme erp.paginacao):
--     SELECT * FROM vw_macuxi_<entidade>
--      WHERE alterado_em > :cursor_alterado_em
--         OR (alterado_em = :cursor_alterado_em AND NLSSORT(external_id, 'NLS_SORT=BINARY') > NLSSORT(:cursor_external_id, 'NLS_SORT=BINARY'))
--      ORDER BY alterado_em, NLSSORT(external_id, 'NLS_SORT=BINARY')
--   Reconciliação: SELECT COUNT(*) AS contagem, NULL AS soma FROM vw_macuxi_<entidade> WHERE ativo = 1
--   (preço, estoque, título, nota e faixa somam o campo de controle: preco_cents, saldo, saldo_cents, total_cents,
--   preco_unidade_cents).
-- =====================================================================================================================


-- ---------------------------------------------------------------------------------------------------------------------
-- 1. filial (T-0149, RN-CORE-39, ADR 0040) — unidade de onde saem as entregas (empresa/filial/estabelecimento do ERP).
--     Carga ANTES do cliente, do preço, da faixa e do estoque (eles citam a filial pelo external_id desta view).
--     Dono do dado no Macuxi: Core (core.filial). O Macuxi casa pelo external_id; a filial padrão nasce no Macuxi com o
--     código '0001' e SEM external_id e é "adotada" pela primeira carga com o MESMO código — devolva em "codigo" o código
--     que a filial principal tem no ERP e, se ele não for '0001', ajuste a padrão no BKO antes da 1ª carga. O ERP não
--     define a padrão (quem marca é o admin no BKO).
--     ERP sem filiais (uma empresa só): não crie esta view nem ligue a entidade; tudo fica na filial padrão.
--     T-0159 (migração 0059, cabeçalho do PDF pela filial de faturamento): CNPJ, endereço e telefone da filial. CNPJ e
--     endereço (logradouro, número, bairro, cidade, UF, CEP) são OBRIGATÓRIOS na regra (R-20261110-220007): a carga recusa
--     a filial sem eles e mostra o erro no monitor; complemento e telefone são opcionais.
--     conector.json, "campos": external_id, alterado_em, ativo {booleano}, codigo, nome, cidade, uf, cnpj, logradouro,
--     numero, complemento, bairro, cep, telefone.
-- ---------------------------------------------------------------------------------------------------------------------
CREATE VIEW vw_macuxi_filial AS
SELECT
    CAST(f.id_filial AS VARCHAR(200))                        AS external_id,     -- id interno da filial/estabelecimento (NUNCA o CNPJ)
    -- [Oracle]     CAST(SYS_EXTRACT_UTC(FROM_TZ(CAST(COALESCE(f.dt_alteracao, f.dt_inclusao) AS TIMESTAMP), 'America/Manaus')) AS TIMESTAMP(3)) AS alterado_em,
    -- [SQL Server]
    CAST(COALESCE(f.dt_alteracao, f.dt_inclusao) AT TIME ZONE 'SA Western Standard Time' AT TIME ZONE 'UTC' AS DATETIME2(3)) AS alterado_em,
    CASE WHEN f.ativo = 'S' THEN 1 ELSE 0 END                AS ativo,           -- filial desativada no ERP = 0 (não apague)
    -- [Oracle]     TRIM(f.codigo)                           AS codigo,
    -- [SQL Server] (1 a 20, único no tenant: o código que aparece no app, ex.: '0002')
    LTRIM(RTRIM(f.codigo))                                   AS codigo,
    f.nome                                                   AS nome,            -- 1 a 80 ("Filial Boa Vista")
    f.cidade                                                 AS cidade,          -- até 80
    UPPER(f.uf)                                              AS uf,              -- 2 letras
    -- [Oracle]     REGEXP_REPLACE(f.cnpj, '[^0-9]', '')     AS cnpj,
    -- [SQL Server] (14 dígitos, sem máscara; o CNPJ DESTA filial/estabelecimento, não o da matriz)
    REPLACE(REPLACE(REPLACE(f.cnpj, '.', ''), '/', ''), '-', '') AS cnpj,
    f.logradouro                                             AS logradouro,      -- até 160
    f.numero                                                 AS numero,          -- até 20 ('S/N' vale)
    f.complemento                                            AS complemento,     -- até 80; NULL = sem complemento
    f.bairro                                                 AS bairro,          -- até 80
    -- [Oracle]     REGEXP_REPLACE(f.cep, '[^0-9]', '')      AS cep,
    -- [SQL Server] (8 dígitos, sem máscara)
    REPLACE(REPLACE(f.cep, '-', ''), '.', '')                AS cep,
    f.telefone                                               AS telefone         -- até 30; NULL = sem telefone
FROM erp_filial f;


-- ---------------------------------------------------------------------------------------------------------------------
-- 2. vendedor — cadastro de vendedores/representantes do ERP. Mapeamento: ativo booleano; o resto texto.
-- ---------------------------------------------------------------------------------------------------------------------
CREATE VIEW vw_macuxi_vendedor AS
SELECT
    CAST(v.cod_vendedor AS VARCHAR(200))                     AS external_id,     -- código do vendedor no ERP
    -- [Oracle]     CAST(SYS_EXTRACT_UTC(FROM_TZ(CAST(COALESCE(v.dt_alteracao, v.dt_inclusao) AS TIMESTAMP), 'America/Manaus')) AS TIMESTAMP(3)) AS alterado_em,
    -- [SQL Server]
    CAST(COALESCE(v.dt_alteracao, v.dt_inclusao) AT TIME ZONE 'SA Western Standard Time' AT TIME ZONE 'UTC' AS DATETIME2(3)) AS alterado_em,  -- data/hora de alteração do cadastro
    CASE WHEN v.situacao = 'A' THEN 1 ELSE 0 END             AS ativo,           -- situação ativa/inativa/bloqueada
    v.nome                                                   AS nome,            -- até 120
    v.email                                                  AS email,           -- e-mail corporativo (até 160)
    v.telefone                                               AS telefone,        -- até 30
    -- filial do vendedor (RN-CORE-39): o MESMO external_id da view 1 (a filial carrega antes do vendedor); NULL = o ERP não tem.
    -- [Oracle]     TO_CHAR(v.id_filial)                     AS filial_external_id,
    -- [SQL Server]
    CAST(v.id_filial AS VARCHAR(200))                        AS filial_external_id
FROM erp_vendedor v;


-- ---------------------------------------------------------------------------------------------------------------------
-- 3. catalogo_no — árvore do catálogo (grupo, subgrupo, linha, família...). Mapeamento: nivel e ordem inteiro.
-- ---------------------------------------------------------------------------------------------------------------------
CREATE VIEW vw_macuxi_catalogo_no AS
SELECT
    CAST(g.id_grupo AS VARCHAR(200))                         AS external_id,     -- id do grupo/nó no ERP
    -- [Oracle]     CAST(SYS_EXTRACT_UTC(FROM_TZ(CAST(g.dt_alteracao AS TIMESTAMP), 'America/Manaus')) AS TIMESTAMP(3)) AS alterado_em,
    -- [SQL Server]
    CAST(g.dt_alteracao AT TIME ZONE 'SA Western Standard Time' AT TIME ZONE 'UTC' AS DATETIME2(3)) AS alterado_em,
    CASE WHEN g.inativo = 'S' THEN 0 ELSE 1 END              AS ativo,
    g.codigo                                                 AS codigo,          -- código visível do grupo (até 60)
    g.descricao                                              AS nome,            -- até 120
    CAST(g.id_grupo_pai AS VARCHAR(200))                     AS pai_external_id, -- NULL = raiz
    g.nivel                                                  AS nivel,           -- 1 a 8 (1 = raiz)
    COALESCE(g.ordem, 0)                                     AS ordem            -- ordem de exibição entre irmãos
FROM erp_grupo_produto g;


-- ---------------------------------------------------------------------------------------------------------------------
-- 4. forma_pagamento (T-0089, RN-VEN-24) — formas de pagamento do ERP (Pix, Dinheiro, Cartão, Boleto...).
--    Carga ANTES do prazo e do cliente. Dono do dado no Macuxi: Vendedor (vendedor.forma_pagamento).
--    conector.json, "campos": external_id, alterado_em, ativo {booleano}, codigo, nome, ordem {inteiro}.
-- ---------------------------------------------------------------------------------------------------------------------
CREATE VIEW vw_macuxi_forma_pagamento AS
SELECT
    CAST(f.id_forma AS VARCHAR(200))                         AS external_id,     -- id interno da forma (ou o próprio código)
    -- [Oracle]     CAST(SYS_EXTRACT_UTC(FROM_TZ(CAST(COALESCE(f.dt_alteracao, f.dt_inclusao) AS TIMESTAMP), 'America/Manaus')) AS TIMESTAMP(3)) AS alterado_em,
    -- [SQL Server]
    CAST(COALESCE(f.dt_alteracao, f.dt_inclusao) AT TIME ZONE 'SA Western Standard Time' AT TIME ZONE 'UTC' AS DATETIME2(3)) AS alterado_em,
    CASE WHEN f.ativo = 'S' THEN 1 ELSE 0 END                AS ativo,           -- forma desativada no ERP = 0 (não apague)
    UPPER(f.codigo)                                          AS codigo,          -- 1 a 20, único no tenant; é o código que o
                                                                                 -- cliente cita em formas_pagamento
    f.descricao                                              AS nome,            -- 1 a 60 ("Boleto bancário")
    COALESCE(f.ordem, 0)                                     AS ordem            -- ordem na tela de pagamento (opcional)
FROM erp_forma_pagamento f;


-- ---------------------------------------------------------------------------------------------------------------------
-- 5. prazo_pagamento (T-0089, RN-VEN-24) — condição/prazo de pagamento de uma forma ("28/56", "30/60/90", "à vista").
--    Carga DEPOIS da forma. O Macuxi CALCULA o prazo médio (média das parcelas, para cima); prazo_medio_dias é informativo
--    e, se divergir, o lote entra com o aviso prazo_medio_divergente no monitor.
--    Parcelas: lista JSON de dias, 1 a 24 itens, de 0 a 365, sem decrescer ('[28,56]'; à vista = '[0]').
--    ERP sem vínculo condição x forma: crie uma tabela de-para (forma, condição) e faça uma linha por par, com
--    external_id = forma:condição e codigo único no tenant ENTRE TODAS AS FORMAS (ex.: 'BOL-2856').
--    conector.json, "campos": external_id, alterado_em, ativo {booleano}, forma_external_id, codigo, descricao,
--    parcelas_dias {json}, prazo_medio_dias {inteiro}, ordem {inteiro}, percentual_ajuste {numero}.
--    percentual_ajuste (v1.0.13, Conector 1.5.0; RN-VEN-43, RN-INT-15): "% Acres.Fin." da condição, −99,99 a +99,99 com 2
--    casas (negativo = desconto); ajusta a tabela de cada produto no Macuxi. Opcional: ausente/NULL = 0; fora da faixa ou
--    com mais de 2 casas = erro de linha. Conector anterior ao 1.5.0 ignora a coluna.
-- ---------------------------------------------------------------------------------------------------------------------
CREATE VIEW vw_macuxi_prazo_pagamento AS
SELECT
    CAST(c.id_condicao AS VARCHAR(200))                      AS external_id,     -- id interno da condição de pagamento
    -- alterado_em: use o maior entre a condição e as parcelas, se as parcelas mudam sem tocar a condição.
    -- [Oracle]     CAST(SYS_EXTRACT_UTC(FROM_TZ(CAST(COALESCE(c.dt_alteracao, c.dt_inclusao) AS TIMESTAMP), 'America/Manaus')) AS TIMESTAMP(3)) AS alterado_em,
    -- [SQL Server]
    CAST(COALESCE(c.dt_alteracao, c.dt_inclusao) AT TIME ZONE 'SA Western Standard Time' AT TIME ZONE 'UTC' AS DATETIME2(3)) AS alterado_em,
    CASE WHEN c.ativo = 'S' THEN 1 ELSE 0 END                AS ativo,
    CAST(c.id_forma AS VARCHAR(200))                         AS forma_external_id, -- o MESMO external_id da view da forma
    UPPER(c.codigo)                                          AS codigo,          -- 1 a 20, único no tenant
    c.descricao                                              AS descricao,       -- até 60; NULL = o Macuxi gera "28/56 dias"
    -- parcelas a partir da tabela de parcelas da condição (uma linha por parcela, com os dias a partir da emissão).
    -- Se o ERP guarda o texto '28/56': [SQL Server] '[' + REPLACE(c.parcelas, '/', ',') + ']'  [Oracle] '[' || REPLACE(c.parcelas, '/', ',') || ']'
    -- [Oracle]     (SELECT '[' || LISTAGG(p.dias, ',') WITHIN GROUP (ORDER BY p.num_parcela) || ']' FROM erp_condicao_parcela p WHERE p.id_condicao = c.id_condicao) AS parcelas_dias,
    -- [SQL Server]
    (SELECT '[' + STRING_AGG(CAST(p.dias AS VARCHAR(10)), ',') WITHIN GROUP (ORDER BY p.num_parcela) + ']'
       FROM erp_condicao_parcela p
      WHERE p.id_condicao = c.id_condicao)                   AS parcelas_dias,
    c.prazo_medio                                            AS prazo_medio_dias, -- opcional (NULL = o Macuxi só calcula)
    COALESCE(c.ordem, 0)                                     AS ordem
    -- percentual_ajuste: ligue só depois do merge da integração (PrazoPagamentoPayload) e com os vendedores na v1.0.13:
    -- , CAST(COALESCE(c.perc_acres_fin, 0) AS DECIMAL(5, 2))  AS percentual_ajuste  -- "% Acres.Fin."; Oracle: NUMBER(5,2)
FROM erp_condicao_pagamento c;


-- ---------------------------------------------------------------------------------------------------------------------
-- 6. produto — cadastro base do produto (Core, ADR-0005). Mapeamento: ativo booleano; embalagem_quantidade inteiro;
--    custo/preço *_cents inteiro; desconto_maximo_pct número; referencias/oferece_junto/etiquetas json.
-- ---------------------------------------------------------------------------------------------------------------------
CREATE VIEW vw_macuxi_produto AS
SELECT
    CAST(p.id_produto AS VARCHAR(200))                       AS external_id,
    -- alterado_em: o maior entre o produto, as referências e as sugestões (oferece junto), se elas mudam sem tocar o produto.
    -- [Oracle]     CAST(SYS_EXTRACT_UTC(FROM_TZ(CAST(p.dt_alteracao AS TIMESTAMP), 'America/Manaus')) AS TIMESTAMP(3)) AS alterado_em,
    -- [SQL Server]
    CAST(p.dt_alteracao AT TIME ZONE 'SA Western Standard Time' AT TIME ZONE 'UTC' AS DATETIME2(3)) AS alterado_em,
    CASE WHEN p.ativo = 'S' THEN 1 ELSE 0 END                AS ativo,
    p.codigo                                                 AS sku,             -- código comercial (até 60)
    p.cod_barras                                             AS ean,             -- 8, 12, 13 ou 14 dígitos; NULL se não tem
    p.descricao                                              AS nome,            -- até 200
    p.marca                                                  AS marca,
    -- código da marca no ERP (ex.: 980), até 30; NULL = sem código. O Catálogo mostra no card (R-20261115-080000-alexandre).
    -- [Oracle]     TO_CHAR(p.id_marca)                      AS marca_codigo,
    -- [SQL Server]
    CAST(p.id_marca AS VARCHAR(30))                          AS marca_codigo,
    p.categoria                                              AS categoria,
    UPPER(p.unidade)                                         AS unidade,         -- sigla da unidade base (RN-CORE-19)
    UPPER(p.unidade_embalagem)                               AS embalagem_medida, -- ex.: 'CX'; vai junto com a quantidade
    p.qtd_embalagem                                          AS embalagem_quantidade, -- 2 a 9999 (CX c/ 12 = 12)
    CAST(p.id_grupo AS VARCHAR(200))                         AS catalogo_no_external_id, -- nó da árvore (view 3)
    CAST(ROUND(p.custo * 100, 0) AS DECIMAL(19,0))           AS custo_cents,
    CAST(ROUND(p.preco_venda * 100, 0) AS DECIMAL(19,0))     AS preco_venda_cents,
    p.desconto_maximo                                        AS desconto_maximo_pct, -- 0 a 100
    p.aplicacao                                              AS aplicacao,       -- texto livre (o Hub corta em 2.000)
    -- referências cruzadas: lista JSON [{"marca_external_id","marca_nome","codigo"}], até 10; a marca é opcional (NULL nos dois
    -- campos da marca = só o código; o mesmo código uma vez por produto). O ERP controla a lista: sem
    -- linha = '[]' = limpa (NULL seria "não altera" e a última referência apagada no ERP nunca sairia do Macuxi).
    -- [Oracle]     COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT('marca_external_id' VALUE TO_CHAR(r.id_marca), 'marca_nome' VALUE r.marca, 'codigo' VALUE r.codigo) RETURNING CLOB) FROM erp_produto_referencia r WHERE r.id_produto = p.id_produto), TO_CLOB('[]')) AS referencias,
    -- [SQL Server]
    COALESCE((SELECT CAST(r.id_marca AS VARCHAR(200)) AS marca_external_id, r.marca AS marca_nome, r.codigo AS codigo
                FROM erp_produto_referencia r
               WHERE r.id_produto = p.id_produto
                 FOR JSON PATH), '[]')                       AS referencias,
    -- oferece junto: lista JSON de external_id de produtos, até 20. Sem linha = '[]' = limpa (como as referências).
    -- O JSON_ARRAYAGG (Oracle) e o STRING_ESCAPE (SQL Server) fazem o escape JSON do texto.
    -- [Oracle]     COALESCE((SELECT JSON_ARRAYAGG(TO_CHAR(o.id_produto_sugerido) ORDER BY o.ordem RETURNING VARCHAR2(4000)) FROM erp_produto_sugestao o WHERE o.id_produto = p.id_produto), '[]') AS oferece_junto,
    -- [SQL Server]
    COALESCE((SELECT '[' + STRING_AGG('"' + STRING_ESCAPE(CAST(o.id_produto_sugerido AS VARCHAR(200)), 'json') + '"', ',')
                       WITHIN GROUP (ORDER BY o.ordem) + ']'
                FROM erp_produto_sugestao o
               WHERE o.id_produto = p.id_produto), '[]')     AS oferece_junto,
    -- etiquetas: lista JSON de textos ('["Promoção","Lançamento"]'); NULL = não altera
    CAST(NULL AS VARCHAR(1))                                 AS etiquetas
FROM erp_produto p;


-- ---------------------------------------------------------------------------------------------------------------------
-- 7. produto_unidade — medidas/embalagens do produto (UN, CX, FD...). Mapeamento: fator inteiro; padrao booleano.
-- ---------------------------------------------------------------------------------------------------------------------
CREATE VIEW vw_macuxi_produto_unidade AS
SELECT
    -- [Oracle]     u.id_produto || ':' || UPPER(u.unidade)  AS external_id,
    -- [SQL Server]
    CONCAT(u.id_produto, ':', UPPER(u.unidade))              AS external_id,     -- produto:medida (ou o id da embalagem)
    -- [Oracle]     CAST(SYS_EXTRACT_UTC(FROM_TZ(CAST(u.dt_alteracao AS TIMESTAMP), 'America/Manaus')) AS TIMESTAMP(3)) AS alterado_em,
    -- [SQL Server]
    CAST(u.dt_alteracao AT TIME ZONE 'SA Western Standard Time' AT TIME ZONE 'UTC' AS DATETIME2(3)) AS alterado_em,
    CASE WHEN u.ativo = 'S' THEN 1 ELSE 0 END                AS ativo,
    CAST(u.id_produto AS VARCHAR(200))                       AS produto_external_id,
    UPPER(u.unidade)                                         AS unidade,         -- sigla de 1 a 4 letras (RN-CORE-19)
    u.fator                                                  AS fator,           -- unidades base em uma embalagem (1 a 9999)
    u.cod_barras                                             AS ean,
    CASE WHEN u.padrao = 'S' THEN 1 ELSE 0 END               AS padrao
FROM erp_produto_unidade u;


-- ---------------------------------------------------------------------------------------------------------------------
-- 8. preco — item de tabela de preço (um registro = um produto numa tabela/filial/vigência). Mapeamento: preco_cents inteiro.
--     T-0149 (RN-CORE-39, ADR 0040): a tabela de preço vale POR FILIAL. filial_external_id = a chave da view 1; NULL = a
--     filial PADRÃO. A chave passa a filial:tabela:produto:início. Quem já integra com UMA filial só pode MANTER a chave
--     antiga (tabela:produto:início) e devolver CAST(NULL AS VARCHAR(200)) em filial_external_id: nada muda no Macuxi.
--     Trocar a chave de quem já integra = a próxima carga completa recria os itens e inativa os da chave antiga.
-- ---------------------------------------------------------------------------------------------------------------------
CREATE VIEW vw_macuxi_preco AS
SELECT
    -- [Oracle]     i.id_filial || ':' || i.id_tabela || ':' || i.id_produto || ':' || TO_CHAR(i.dt_inicio, 'YYYYMMDD') AS external_id,
    -- [SQL Server]
    CONCAT(i.id_filial, ':', i.id_tabela, ':', i.id_produto, ':', CONVERT(CHAR(8), i.dt_inicio, 112)) AS external_id, -- filial:tabela:produto:início
    -- [Oracle]     CAST(SYS_EXTRACT_UTC(FROM_TZ(CAST(i.dt_alteracao AS TIMESTAMP), 'America/Manaus')) AS TIMESTAMP(3)) AS alterado_em,
    -- [SQL Server]
    CAST(i.dt_alteracao AT TIME ZONE 'SA Western Standard Time' AT TIME ZONE 'UTC' AS DATETIME2(3)) AS alterado_em,
    CASE WHEN i.ativo = 'S' THEN 1 ELSE 0 END                AS ativo,
    CAST(i.id_tabela AS VARCHAR(200))                        AS tabela_external_id,
    t.descricao                                              AS tabela_nome,
    -- [Oracle]     TO_CHAR(i.dt_inicio, 'YYYY-MM-DD')       AS vigencia_inicio,
    -- [SQL Server]
    CONVERT(CHAR(10), i.dt_inicio, 23)                       AS vigencia_inicio,
    -- [Oracle]     TO_CHAR(i.dt_fim, 'YYYY-MM-DD')          AS vigencia_fim,
    -- [SQL Server] (NULL = sem fim)
    CONVERT(CHAR(10), i.dt_fim, 23)                          AS vigencia_fim,
    CAST(i.id_produto AS VARCHAR(200))                       AS produto_external_id,
    CAST(ROUND(i.preco * 100, 0) AS DECIMAL(19,0))           AS preco_cents,
    UPPER(i.unidade)                                         AS unidade,         -- NULL = unidade base do produto
    CAST(i.id_filial AS VARCHAR(200))                        AS filial_external_id -- T-0149: NULL = filial padrão
FROM erp_tabela_preco_item i
JOIN erp_tabela_preco t ON t.id_tabela = i.id_tabela;


-- ---------------------------------------------------------------------------------------------------------------------
-- 9. tabela_escalonada (T-0089, RN-VEN-23, RN-VEN-15) — faixas de preço por quantidade ("a partir de 10 FD, R$ x a
--     unidade"). Carga DEPOIS do produto e do preço. Dono do dado no Macuxi: Catálogo (catalogo.tabela_escalonada).
--     preco_unidade_cents é SEMPRE o preço da UNIDADE BASE (não existe preço de caixa); a quantidade mínima é contada na
--     medida da faixa. Vigência fechada nas duas pontas, em data civil do fuso do tenant.
--     conector.json, "campos": external_id, alterado_em, ativo {booleano}, produto_external_id, medida,
--     quantidade_minima {inteiro}, preco_unidade_cents {inteiro}, vigencia_inicio {data_civil}, vigencia_fim {data_civil},
--     tabela_external_id, filial_external_id.
-- ---------------------------------------------------------------------------------------------------------------------
CREATE VIEW vw_macuxi_tabela_escalonada AS
SELECT
    -- id da faixa no ERP. Sem id próprio, monte tabela:produto:medida:quantidade:início:
    -- [Oracle]     COALESCE(f.id_tabela, '*') || ':' || f.id_produto || ':' || COALESCE(UPPER(f.unidade), '') || ':' || f.qtd_minima || ':' || TO_CHAR(f.dt_inicio, 'YYYYMMDD') AS external_id,
    -- [SQL Server] CONCAT(COALESCE(CAST(f.id_tabela AS VARCHAR(50)), '*'), ':', f.id_produto, ':', UPPER(f.unidade), ':', f.qtd_minima, ':', CONVERT(CHAR(8), f.dt_inicio, 112)) AS external_id,
    CAST(f.id_faixa AS VARCHAR(200))                         AS external_id,
    -- [Oracle]     CAST(SYS_EXTRACT_UTC(FROM_TZ(CAST(COALESCE(f.dt_alteracao, f.dt_inclusao) AS TIMESTAMP), 'America/Manaus')) AS TIMESTAMP(3)) AS alterado_em,
    -- [SQL Server]
    CAST(COALESCE(f.dt_alteracao, f.dt_inclusao) AT TIME ZONE 'SA Western Standard Time' AT TIME ZONE 'UTC' AS DATETIME2(3)) AS alterado_em,
    -- faixa excluída (logicamente) ou suspensa no ERP = 0; vigência vencida NÃO precisa inativar (o Macuxi filtra pela data)
    CASE WHEN f.excluido = 'S' THEN 0 ELSE 1 END             AS ativo,
    CAST(f.id_produto AS VARCHAR(200))                       AS produto_external_id,
    NULLIF(LTRIM(RTRIM(UPPER(f.unidade))), '')               AS medida,          -- sigla 1 a 4 letras; NULL = unidade base
    f.qtd_minima                                             AS quantidade_minima, -- inteiro > 0, na medida da faixa
    -- reais -> centavos; se o ERP guarda o preço da embalagem, divida pelo fator: ROUND(f.preco / u.fator * 100, 0)
    CAST(ROUND(f.preco_unitario * 100, 0) AS DECIMAL(19,0))  AS preco_unidade_cents, -- > 0
    -- [Oracle]     TO_CHAR(COALESCE(f.dt_inicio, f.dt_inclusao), 'YYYY-MM-DD') AS vigencia_inicio,
    -- [SQL Server] (obrigatória: sem início no ERP, use a data de inclusão)
    CONVERT(CHAR(10), COALESCE(f.dt_inicio, f.dt_inclusao), 23) AS vigencia_inicio,
    -- [Oracle]     TO_CHAR(f.dt_fim, 'YYYY-MM-DD')          AS vigencia_fim,
    -- [SQL Server] (NULL = sem fim; fim >= início)
    CONVERT(CHAR(10), f.dt_fim, 23)                          AS vigencia_fim,
    CAST(f.id_tabela AS VARCHAR(200))                        AS tabela_external_id, -- NULL = vale para todas as tabelas
    -- T-0149 (RN-CORE-39): faixa só de uma filial (chave da view 1). NULL = vale para TODAS as filiais; na mesma faixa, a
    -- da filial vence a geral. Igual nos dois dialetos.
    CAST(f.id_filial AS VARCHAR(200))                        AS filial_external_id
FROM erp_preco_faixa f;


-- ---------------------------------------------------------------------------------------------------------------------
-- 10. estoque — saldo por depósito e produto (reservas são do Macuxi). Mapeamento: saldo número.
--     T-0149 (RN-CORE-39): o depósito pertence a uma filial (o estoque da filial = soma dos depósitos dela).
--     filial_external_id = a chave da view 1; NULL em depósito NOVO = filial padrão; em depósito já conhecido = não altera.
-- ---------------------------------------------------------------------------------------------------------------------
CREATE VIEW vw_macuxi_estoque AS
SELECT
    -- [Oracle]     s.id_deposito || ':' || s.id_produto     AS external_id,
    -- [SQL Server]
    CONCAT(s.id_deposito, ':', s.id_produto)                 AS external_id,     -- depósito:produto
    -- [Oracle]     CAST(SYS_EXTRACT_UTC(FROM_TZ(CAST(s.dt_movimento AS TIMESTAMP), 'America/Manaus')) AS TIMESTAMP(3)) AS alterado_em,
    -- [SQL Server]
    CAST(s.dt_movimento AT TIME ZONE 'SA Western Standard Time' AT TIME ZONE 'UTC' AS DATETIME2(3)) AS alterado_em,     -- último movimento do saldo
    1                                                        AS ativo,
    CAST(s.id_deposito AS VARCHAR(200))                      AS deposito_external_id,
    d.descricao                                              AS deposito_nome,
    CAST(s.id_produto AS VARCHAR(200))                       AS produto_external_id,
    s.saldo_disponivel                                       AS saldo,          -- pode ser fracionário
    CAST(d.id_filial AS VARCHAR(200))                        AS filial_external_id -- T-0149: filial do depósito
FROM erp_estoque_saldo s
JOIN erp_deposito d ON d.id_deposito = s.id_deposito;


-- ---------------------------------------------------------------------------------------------------------------------
-- 11. cliente — cadastro do cliente (Core). Carga DEPOIS do vendedor e das formas de pagamento.
--    Mapeamento: endereco_* -> "endereco.<campo>"; latitude/longitude número; limite_credito_cents inteiro;
--    bloqueado/ativo booleano; contatos json; prazo_medio_max_dias inteiro; formas_pagamento json.
--    CPF/CNPJ só no campo "documento" (dado pessoal quando CPF): NUNCA no external_id.
--    Campos da T-0089 (RN-VEN-25):
--      prazo_medio_max_dias — teto do prazo médio que o cliente aceita (0 a 365). O ERP controla o teto: sem teto no ERP
--        = 365, que na v1 equivale a "sem teto" (cada parcela vai até 365 dias, então o prazo médio nunca passa de 365 e
--        nenhum prazo é barrado, RN-VEN-25; o BKO mostra "365 dias"). NULL seria "não altera": o Conector omite nulos e o
--        teto antigo ficaria no Macuxi. Se o ERP NÃO controla o teto, devolva CAST(NULL AS INT): vale o do BKO.
--      formas_pagamento — CÓDIGOS das formas permitidas (os mesmos da coluna codigo da view 4), até 20, sem repetir,
--        como texto JSON ('["PIX","BOLETO"]'). '[]' = limpa (todas as formas ativas). Se o ERP não controla formas por
--        cliente, devolva CAST(NULL AS VARCHAR(1)): o Macuxi mantém o que foi definido no BKO. Mais de 20 formas
--        recusa a linha inteira do cliente: restrinja no ERP (ou filtre na view) antes.
--    Campo da T-0149 (filial do cliente, RN-CORE-39): filial_external_id — a chave da view 1; NULL = não altera.
--    Campo da T-0120 (vínculo cliente -> tabela de preço; R-20261108-230146):
--      tabela_preco_external_id — a MESMA chave da coluna tabela_external_id da view 8 (preco). NULL = NÃO ALTERA (o
--        Conector omite nulos): o cliente que usa a tabela padrão do ERP sai NULL e fica com o vínculo que já tinha no
--        Macuxi. Para DESVINCULAR, o ERP devolve o id da tabela padrão (troque a coluna por
--        COALESCE(c.id_tabela_preco, <id da tabela padrão>) se o ERP permite tirar a tabela de um cliente). A comparação
--        da chave segue binária (COLLATE Latin1_General_BIN2 / NLS_SORT=BINARY), como as demais external_id.
-- ---------------------------------------------------------------------------------------------------------------------
CREATE VIEW vw_macuxi_cliente AS
SELECT
    CAST(c.id_cliente AS VARCHAR(200))                       AS external_id,     -- código interno do cliente, NUNCA o CNPJ/CPF
    -- alterado_em: o maior entre o cliente, os contatos e as formas permitidas.
    -- [Oracle]     CAST(SYS_EXTRACT_UTC(FROM_TZ(CAST(COALESCE(c.dt_alteracao, c.dt_inclusao) AS TIMESTAMP), 'America/Manaus')) AS TIMESTAMP(3)) AS alterado_em,
    -- [SQL Server]
    CAST(COALESCE(c.dt_alteracao, c.dt_inclusao) AT TIME ZONE 'SA Western Standard Time' AT TIME ZONE 'UTC' AS DATETIME2(3)) AS alterado_em,
    CASE WHEN c.ativo = 'S' THEN 1 ELSE 0 END                AS ativo,
    c.razao_social                                           AS razao_social,    -- até 160
    c.nome_fantasia                                          AS nome_fantasia,
    c.cnpj_cpf                                               AS documento,       -- só dígitos ou formatado (até 18)
    CAST(c.id_vendedor AS VARCHAR(200))                      AS vendedor_external_id, -- carteira (view 2)
    -- T-0120: igual nos dois dialetos. NULL = não altera (tabela padrão do ERP); a chave é a tabela_external_id da view 8.
    CAST(c.id_tabela_preco AS VARCHAR(200))                  AS tabela_preco_external_id,
    -- T-0149 (RN-CORE-39): filial que atende o cliente (a MESMA chave da coluna external_id da view 1). NULL = NÃO ALTERA
    -- (o Conector omite nulos: o cliente fica na filial que já tem no Macuxi; cliente novo cai na filial padrão). ERP sem
    -- filial no cliente: CAST(NULL AS VARCHAR(200)). Igual nos dois dialetos.
    CAST(c.id_filial AS VARCHAR(200))                        AS filial_external_id,
    c.logradouro                                             AS endereco_logradouro,
    c.numero                                                 AS endereco_numero,
    c.complemento                                            AS endereco_complemento,
    c.bairro                                                 AS endereco_bairro,
    c.cidade                                                 AS endereco_cidade,
    UPPER(c.uf)                                              AS endereco_uf,
    c.cep                                                    AS endereco_cep,
    c.latitude                                               AS latitude,
    c.longitude                                              AS longitude,
    c.telefone                                               AS telefone,
    c.email                                                  AS email,
    CAST(ROUND(c.limite_credito * 100, 0) AS DECIMAL(19,0))  AS limite_credito_cents,
    c.inscricao_estadual                                     AS inscricao_estadual, -- 'ISENTO' vale (RN-CORE-16)
    c.observacao                                             AS observacao,
    CASE WHEN c.bloqueado = 'S' THEN 1 ELSE 0 END            AS bloqueado,       -- bloqueio financeiro/comercial
    -- T-0115 (RN-PES-05): canal do cliente (até 60), código ou nome do ERP; o Hub traduz pelo de-para `canal` do BKO.
    -- NULL ou em branco = limpa o canal. ERP sem canal: CAST(NULL AS VARCHAR(60)).
    -- [Oracle]     TRIM(c.canal) AS canal,
    -- [SQL Server]
    NULLIF(LTRIM(RTRIM(c.canal)), '')                        AS canal,
    -- contatos: lista JSON [{"nome","cargo","telefone","email"}], até 20
    -- [Oracle]     (SELECT JSON_ARRAYAGG(JSON_OBJECT('nome' VALUE ct.nome, 'cargo' VALUE ct.cargo, 'telefone' VALUE ct.telefone, 'email' VALUE ct.email) RETURNING CLOB) FROM erp_cliente_contato ct WHERE ct.id_cliente = c.id_cliente) AS contatos,
    -- [SQL Server]
    (SELECT ct.nome AS nome, ct.cargo AS cargo, ct.telefone AS telefone, ct.email AS email
       FROM erp_cliente_contato ct
      WHERE ct.id_cliente = c.id_cliente
        FOR JSON PATH)                                       AS contatos,
    -- T-0089: dias, 0 a 365; 365 = sem teto na v1 (igual nos dois dialetos). ERP que não controla o teto: CAST(NULL AS INT).
    COALESCE(c.prazo_medio_maximo, 365)                      AS prazo_medio_max_dias,
    -- T-0089: códigos das formas permitidas ao cliente (tabela cliente x forma do ERP). Sem linha = '[]' = todas.
    -- DISTINCT: o contrato recusa código repetido. O escape JSON fica no JSON_ARRAYAGG (Oracle) e no STRING_ESCAPE (SQL Server).
    -- [Oracle]     COALESCE((SELECT JSON_ARRAYAGG(x.codigo ORDER BY x.codigo RETURNING VARCHAR2(4000)) FROM (SELECT DISTINCT UPPER(f.codigo) AS codigo FROM erp_cliente_forma cf JOIN erp_forma_pagamento f ON f.id_forma = cf.id_forma WHERE cf.id_cliente = c.id_cliente) x), '[]') AS formas_pagamento,
    -- [SQL Server]
    COALESCE((SELECT '[' + STRING_AGG('"' + STRING_ESCAPE(x.codigo, 'json') + '"', ',') WITHIN GROUP (ORDER BY x.codigo) + ']'
                FROM (SELECT DISTINCT UPPER(f.codigo) AS codigo
                        FROM erp_cliente_forma cf
                        JOIN erp_forma_pagamento f ON f.id_forma = cf.id_forma
                       WHERE cf.id_cliente = c.id_cliente) x), '[]') AS formas_pagamento
FROM erp_cliente c;


-- ---------------------------------------------------------------------------------------------------------------------
-- 12. cliente_endereco — endereços de entrega/cobrança do cliente. Mapeamento: latitude/longitude número; principal booleano.
-- ---------------------------------------------------------------------------------------------------------------------
CREATE VIEW vw_macuxi_cliente_endereco AS
SELECT
    CAST(e.id_endereco AS VARCHAR(200))                      AS external_id,
    -- [Oracle]     CAST(SYS_EXTRACT_UTC(FROM_TZ(CAST(e.dt_alteracao AS TIMESTAMP), 'America/Manaus')) AS TIMESTAMP(3)) AS alterado_em,
    -- [SQL Server]
    CAST(e.dt_alteracao AT TIME ZONE 'SA Western Standard Time' AT TIME ZONE 'UTC' AS DATETIME2(3)) AS alterado_em,
    CASE WHEN e.ativo = 'S' THEN 1 ELSE 0 END                AS ativo,
    CAST(e.id_cliente AS VARCHAR(200))                       AS cliente_external_id,
    CASE e.tipo WHEN 'C' THEN 'cobranca' WHEN 'P' THEN 'principal' ELSE 'entrega' END AS tipo, -- principal|entrega|cobranca
    e.descricao                                              AS descricao,       -- "Depósito", "Loja 2"
    e.logradouro                                             AS logradouro,
    e.numero                                                 AS numero,
    e.complemento                                            AS complemento,
    e.bairro                                                 AS bairro,
    e.cidade                                                 AS cidade,
    UPPER(e.uf)                                              AS uf,
    e.cep                                                    AS cep,
    e.latitude                                               AS latitude,
    e.longitude                                              AS longitude,
    CASE WHEN e.principal = 'S' THEN 1 ELSE 0 END            AS principal
FROM erp_cliente_endereco e;


-- ---------------------------------------------------------------------------------------------------------------------
-- 13. transportadora — cadastro de transportadoras (frete FOB). O CNPJ vai em "documento", nunca no external_id.
-- ---------------------------------------------------------------------------------------------------------------------
CREATE VIEW vw_macuxi_transportadora AS
SELECT
    CAST(t.cod_transportadora AS VARCHAR(200))               AS external_id,
    -- [Oracle]     CAST(SYS_EXTRACT_UTC(FROM_TZ(CAST(t.dt_alteracao AS TIMESTAMP), 'America/Manaus')) AS TIMESTAMP(3)) AS alterado_em,
    -- [SQL Server]
    CAST(t.dt_alteracao AT TIME ZONE 'SA Western Standard Time' AT TIME ZONE 'UTC' AS DATETIME2(3)) AS alterado_em,
    CASE WHEN t.ativo = 'S' THEN 1 ELSE 0 END                AS ativo,
    t.razao_social                                           AS nome,            -- até 120
    -- [Oracle]     REGEXP_REPLACE(t.cnpj, '[^0-9]', '')     AS documento,
    -- [SQL Server] (14 dígitos, sem máscara)
    REPLACE(REPLACE(REPLACE(t.cnpj, '.', ''), '/', ''), '-', '') AS documento,
    t.inscricao_estadual                                     AS inscricao_estadual,
    t.telefone                                               AS telefone
FROM erp_transportadora t;


-- ---------------------------------------------------------------------------------------------------------------------
-- 14. rota — roteiro de visitas do vendedor. Mapeamento: dia_semana inteiro; paradas json [{"ordem","cliente_external_id"}].
-- ---------------------------------------------------------------------------------------------------------------------
CREATE VIEW vw_macuxi_rota AS
SELECT
    CAST(r.id_rota AS VARCHAR(200))                          AS external_id,
    -- alterado_em: o maior entre a rota e as paradas.
    -- [Oracle]     CAST(SYS_EXTRACT_UTC(FROM_TZ(CAST(r.dt_alteracao AS TIMESTAMP), 'America/Manaus')) AS TIMESTAMP(3)) AS alterado_em,
    -- [SQL Server]
    CAST(r.dt_alteracao AT TIME ZONE 'SA Western Standard Time' AT TIME ZONE 'UTC' AS DATETIME2(3)) AS alterado_em,
    CASE WHEN r.ativo = 'S' THEN 1 ELSE 0 END                AS ativo,
    r.descricao                                              AS nome,
    CAST(r.id_vendedor AS VARCHAR(200))                      AS vendedor_external_id,
    r.dia_semana                                             AS dia_semana,      -- 0 = domingo ... 6 = sábado; NULL = sem dia
    -- [Oracle]     (SELECT JSON_ARRAYAGG(JSON_OBJECT('ordem' VALUE rp.sequencia, 'cliente_external_id' VALUE TO_CHAR(rp.id_cliente)) ORDER BY rp.sequencia RETURNING CLOB) FROM erp_rota_parada rp WHERE rp.id_rota = r.id_rota) AS paradas,
    -- [SQL Server]
    (SELECT rp.sequencia AS ordem, CAST(rp.id_cliente AS VARCHAR(200)) AS cliente_external_id
       FROM erp_rota_parada rp
      WHERE rp.id_rota = r.id_rota
      ORDER BY rp.sequencia
        FOR JSON PATH)                                       AS paradas
FROM erp_rota r;


-- ---------------------------------------------------------------------------------------------------------------------
-- 15. titulo — títulos a receber (financeiro). Mapeamento: parcela inteiro; *_cents inteiro; emissao/vencimento
--     data_civil; baixado_em data_hora_utc; situacao = aberto|baixado|cancelado.
-- ---------------------------------------------------------------------------------------------------------------------
CREATE VIEW vw_macuxi_titulo AS
SELECT
    CAST(t.id_titulo AS VARCHAR(200))                        AS external_id,
    -- [Oracle]     CAST(SYS_EXTRACT_UTC(FROM_TZ(CAST(t.dt_alteracao AS TIMESTAMP), 'America/Manaus')) AS TIMESTAMP(3)) AS alterado_em,
    -- [SQL Server]
    CAST(t.dt_alteracao AT TIME ZONE 'SA Western Standard Time' AT TIME ZONE 'UTC' AS DATETIME2(3)) AS alterado_em,
    1                                                        AS ativo,           -- título cancelado vai em "situacao"
    CAST(t.id_cliente AS VARCHAR(200))                       AS cliente_external_id,
    t.numero_documento                                       AS numero,
    t.parcela                                                AS parcela,
    -- [Oracle]     TO_CHAR(t.dt_emissao, 'YYYY-MM-DD')      AS emissao,
    -- [SQL Server]
    CONVERT(CHAR(10), t.dt_emissao, 23)                      AS emissao,
    -- [Oracle]     TO_CHAR(t.dt_vencimento, 'YYYY-MM-DD')   AS vencimento,
    -- [SQL Server]
    CONVERT(CHAR(10), t.dt_vencimento, 23)                   AS vencimento,
    CAST(ROUND(t.valor * 100, 0) AS DECIMAL(19,0))           AS valor_cents,
    CAST(ROUND(t.saldo * 100, 0) AS DECIMAL(19,0))           AS saldo_cents,
    CASE WHEN t.cancelado = 'S' THEN 'cancelado'
         WHEN t.saldo = 0 THEN 'baixado'
         ELSE 'aberto' END                                   AS situacao,
    -- [Oracle]     CAST(SYS_EXTRACT_UTC(FROM_TZ(CAST(t.dt_baixa AS TIMESTAMP), 'America/Manaus')) AS TIMESTAMP(3)) AS baixado_em,
    -- [SQL Server]
    CAST(t.dt_baixa AT TIME ZONE 'SA Western Standard Time' AT TIME ZONE 'UTC' AS DATETIME2(3)) AS baixado_em
FROM erp_titulo_receber t;


-- ---------------------------------------------------------------------------------------------------------------------
-- 16. nota — notas fiscais de faturamento e devolução (histórico). Mapeamento: emitida_em data_hora_utc; total_cents
--     inteiro; quantidade_itens inteiro; cancelada booleano; pedido_uuid = UUID do pedido do Macuxi gravado no ERP.
-- ---------------------------------------------------------------------------------------------------------------------
CREATE VIEW vw_macuxi_nota AS
SELECT
    CAST(n.id_nota AS VARCHAR(200))                          AS external_id,     -- id interno (não a chave de acesso)
    -- [Oracle]     CAST(SYS_EXTRACT_UTC(FROM_TZ(CAST(n.dt_alteracao AS TIMESTAMP), 'America/Manaus')) AS TIMESTAMP(3)) AS alterado_em,
    -- [SQL Server]
    CAST(n.dt_alteracao AT TIME ZONE 'SA Western Standard Time' AT TIME ZONE 'UTC' AS DATETIME2(3)) AS alterado_em,
    1                                                        AS ativo,           -- cancelamento vai em "cancelada"
    CAST(n.id_cliente AS VARCHAR(200))                       AS cliente_external_id,
    CAST(n.id_vendedor AS VARCHAR(200))                      AS vendedor_external_id,
    CASE WHEN n.tipo_operacao = 'D' THEN 'devolucao' ELSE 'faturamento' END AS tipo,
    n.numero                                                 AS numero,
    n.serie                                                  AS serie,
    -- [Oracle]     CAST(SYS_EXTRACT_UTC(FROM_TZ(CAST(n.dt_emissao AS TIMESTAMP), 'America/Manaus')) AS TIMESTAMP(3)) AS emitida_em,
    -- [SQL Server]
    CAST(n.dt_emissao AT TIME ZONE 'SA Western Standard Time' AT TIME ZONE 'UTC' AS DATETIME2(3)) AS emitida_em,
    CAST(ROUND(n.valor_total * 100, 0) AS DECIMAL(19,0))     AS total_cents,
    n.qtd_itens                                              AS quantidade_itens,
    n.pedido_macuxi_uuid                                     AS pedido_uuid,     -- NULL se a nota não veio do Macuxi
    CASE WHEN n.cancelada = 'S' THEN 1 ELSE 0 END            AS cancelada
FROM erp_nota_fiscal n;


-- ---------------------------------------------------------------------------------------------------------------------
-- 17. pedido_status (T-0162; RN-INT-08) — RETORNO do pedido, não é entidade de carga. O Conector consulta por pedido em
--     "pedidos.status.consulta" do conector.json (WHERE pedido_uuid = :pedido_uuid ORDER BY ocorrido_em) e traduz
--     situacao pelo "mapaStatus" (exemplo: I integrado, R rejeitado_erp, P faturado_parcial, F faturado_total, C cancelado).
--     Uma linha por FATO: a situação do pedido (1º SELECT) e uma linha por nota de faturamento (2º SELECT).
--     REGRAS (o Hub recusa o retorno fora delas, contrato RetornoErp):
--       - faturado (P/F) só sai COM nota: o pedido faturado aparece no 1º SELECT como I (já informado; o Conector não
--         repete o mesmo fato) e cada nota sai no 2º. Só a nota mais nova pode ser F; as anteriores o Conector manda como P.
--       - rejeitado (R) sai sempre com motivo (até 300; sem dado pessoal): sem motivo no ERP, um texto fixo.
--       - numero_pedido = número do pedido no ERP (vai como numero_erp); ocorrido_em e nota_emitida_em em UTC (regra 3).
--     ERP que usa a entrada-modelo sem pedido próprio: a view lê a própria macuxi_pedido_entrada (situacao, motivo) com as
--     colunas de nota que a rotina de faturamento grava (exemplo pronto: modules/integracao/kit-piloto/sql/03).
--     Índices no ERP: erp_pedido(pedido_macuxi_uuid) e erp_nota_fiscal(pedido_macuxi_uuid) (consulta por pedido, a cada ciclo).
-- ---------------------------------------------------------------------------------------------------------------------
CREATE VIEW vw_macuxi_pedido_status AS
SELECT
    p.pedido_macuxi_uuid                                     AS pedido_uuid,     -- UUID do Macuxi gravado pela entrada
    CASE p.situacao WHEN 'R' THEN 'R' WHEN 'C' THEN 'C' ELSE 'I' END AS situacao, -- código do ERP traduzido pelo mapaStatus
    CAST(p.numero AS VARCHAR(40))                            AS numero_pedido,   -- número do pedido no ERP (até 40)
    CASE WHEN p.situacao = 'R' THEN COALESCE(NULLIF(LTRIM(RTRIM(p.motivo)), ''), 'Recusado no ERP')
         ELSE NULLIF(LTRIM(RTRIM(p.motivo)), '') END         AS motivo,
    CAST(NULL AS VARCHAR(40))                                AS nota_numero,
    CAST(NULL AS VARCHAR(10))                                AS nota_serie,
    CAST(NULL AS DATETIME2(3))                               AS nota_emitida_em,
    CAST(NULL AS DECIMAL(19,0))                              AS nota_total_cents,
    -- [Oracle]     CAST(SYS_EXTRACT_UTC(FROM_TZ(CAST(COALESCE(p.dt_situacao, p.dt_inclusao) AS TIMESTAMP), 'America/Manaus')) AS TIMESTAMP(3)) AS ocorrido_em
    -- [SQL Server]
    CAST(COALESCE(p.dt_situacao, p.dt_inclusao) AT TIME ZONE 'SA Western Standard Time' AT TIME ZONE 'UTC' AS DATETIME2(3)) AS ocorrido_em
FROM erp_pedido p
WHERE p.pedido_macuxi_uuid IS NOT NULL
UNION ALL
SELECT
    n.pedido_macuxi_uuid,
    CASE WHEN p.situacao = 'F' THEN 'F' ELSE 'P' END,                            -- pedido fechado = F; ainda com saldo = P
    CAST(p.numero AS VARCHAR(40)),
    CAST(NULL AS VARCHAR(300)),
    CAST(n.numero AS VARCHAR(40)),
    CAST(n.serie AS VARCHAR(10)),
    -- [Oracle]     CAST(SYS_EXTRACT_UTC(FROM_TZ(CAST(n.dt_emissao AS TIMESTAMP), 'America/Manaus')) AS TIMESTAMP(3)) (2 vezes)
    CAST(n.dt_emissao AT TIME ZONE 'SA Western Standard Time' AT TIME ZONE 'UTC' AS DATETIME2(3)),
    CAST(ROUND(n.valor_total * 100, 0) AS DECIMAL(19,0)),
    CAST(n.dt_emissao AT TIME ZONE 'SA Western Standard Time' AT TIME ZONE 'UTC' AS DATETIME2(3))
FROM erp_nota_fiscal n
JOIN erp_pedido p ON p.pedido_macuxi_uuid = n.pedido_macuxi_uuid
WHERE n.tipo_operacao <> 'D'                                                     -- devolução não é faturamento do pedido
  AND n.cancelada = 'N';


-- ---------------------------------------------------------------------------------------------------------------------
-- 18. pedido_nota_item (T-0162; RN-INT-08) — itens faturados em CADA nota do pedido, não é entidade de carga. O Conector
--     consulta em "pedidos.status.consultaItensNota" (WHERE pedido_uuid = :pedido_uuid AND nota_numero = :nota_numero e a
--     série) e manda como itens_faturados. Colunas OBRIGATÓRIAS: sequencia (a do item no pedido do Macuxi, gravada pela
--     entrada; inteiro > 0), quantidade (inteiro > 0, na unidade base), valor_cents (centavos >= 0) e produto_codigo (a
--     MESMA chave da vw_macuxi_produto.external_id). Linha fora disso = o retorno vai SEM itens_faturados e o monitor avisa.
--     Linhas da mesma sequência na mesma nota SOMAM (o ERP pode partir o item em lotes): não repita a mesma linha.
-- ---------------------------------------------------------------------------------------------------------------------
CREATE VIEW vw_macuxi_pedido_nota_item AS
SELECT
    n.pedido_macuxi_uuid                                     AS pedido_uuid,
    CAST(n.numero AS VARCHAR(40))                            AS nota_numero,
    CAST(n.serie AS VARCHAR(10))                             AS nota_serie,
    i.seq_pedido_macuxi                                      AS sequencia,       -- sequência do item no pedido do Macuxi
    i.qtd_unidade_base                                       AS quantidade,      -- inteiro > 0, na unidade base
    CAST(ROUND(i.valor_total * 100, 0) AS DECIMAL(19,0))     AS valor_cents,
    CAST(i.id_produto AS VARCHAR(200))                       AS produto_codigo   -- external_id do produto (view 6)
FROM erp_nota_item i
JOIN erp_nota_fiscal n ON n.id_nota = i.id_nota
WHERE n.pedido_macuxi_uuid IS NOT NULL
  AND n.tipo_operacao <> 'D'
  AND n.cancelada = 'N';
