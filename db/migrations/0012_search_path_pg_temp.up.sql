-- 0012_search_path_pg_temp (up) — T-0042 (pedido do gerente; revisão SECURITY DEFINER da 0010/0011, R-20261101-172531)
-- Endurecimento: as funções SECURITY DEFINER passam a listar pg_temp POR ÚLTIMO no search_path. Sem pg_temp explícito,
-- o Postgres procura o schema temporário da sessão ANTES dos listados; um papel com TEMP poderia criar ali um objeto
-- (tabela/visão/função) com o mesmo nome de um usado sem qualificação e fazê-lo rodar com os privilégios do dono
-- (migrador). O corpo das funções e os GRANTs não mudam (ALTER FUNCTION ... SET só troca a configuração da função).
-- Funções: plataforma.tenant_por_codigo (0001), integracao.autenticar_chave e integracao.expurgar_retencao (0010),
-- plataforma.expurgar_outbox (0011).
-- Caminho de volta: 0012_search_path_pg_temp.down.sql (volta ao search_path anterior de cada uma; nenhum dado envolvido).

alter function plataforma.tenant_por_codigo(text) set search_path = pg_catalog, plataforma, pg_temp;
alter function integracao.autenticar_chave(text) set search_path = pg_catalog, integracao, pg_temp;
alter function integracao.expurgar_retencao(timestamptz, integer) set search_path = pg_catalog, integracao, pg_temp;
alter function plataforma.expurgar_outbox(timestamptz, integer) set search_path = pg_catalog, plataforma, pg_temp;
