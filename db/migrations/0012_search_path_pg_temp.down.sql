-- 0012_search_path_pg_temp (down) — T-0042
-- Volta o search_path das 4 funções SECURITY DEFINER ao das migrações de origem (0001, 0010, 0011), sem pg_temp.
-- Nenhum dado é tocado. Pré-condição: 0013+ desfeitas.
alter function plataforma.expurgar_outbox(timestamptz, integer) set search_path = pg_catalog, plataforma;
alter function integracao.expurgar_retencao(timestamptz, integer) set search_path = pg_catalog, integracao;
alter function integracao.autenticar_chave(text) set search_path = pg_catalog, integracao;
alter function plataforma.tenant_por_codigo(text) set search_path = pg_catalog, plataforma;
