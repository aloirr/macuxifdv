-- 0099_plataforma_resumo_outbox_vivos (up) — v1.0.30, saúde da outbox depois da limpeza da AM2808
-- (scripts/producao/limpar-cadastros-rotina.sql marcou 95 eventos não publicados com deleted_at). Dicionário:
-- docs/banco/plataforma.md (seção evento). Prova: db/testes/resumo-outbox-vivos.db.test.ts.
-- Migração ADITIVA: nenhuma tabela, coluna ou política muda.
--
-- 1. plataforma.resumo_outbox(text[], integer): mesma assinatura, mesmo retorno, SECURITY DEFINER, search_path e EXECUTE
--    (só macuxi_app) da 0024, que não foi revista depois; create or replace mantém dono e ACL. Única mudança: o evento
--    apagado (deleted_at preenchido) sai de pendentes, parados e mais_antigo_s. Sem isso o /v1/saude contava os eventos
--    apagados como parados e o alerta OUTBOX_PARADA não saía mais.
-- 2. grant select (deleted_at) on plataforma.evento to macuxi_worker: o worker só tinha SELECT por coluna (0003) sem o
--    deleted_at; o despachante (apps/api/src/despachante.ts) passa a filtrar deleted_at is null no despacho e no
--    reprocessarParados, e o filtro exige o SELECT da coluna (senão 42501).
--
-- Caminho de volta: 0099_plataforma_resumo_outbox_vivos.down.sql (volta o corpo da 0024 e revoga o SELECT do deleted_at;
-- pré-condição: o despachante sem ler deleted_at, senão 42501).

create or replace function plataforma.resumo_outbox(p_nomes text[], p_max_tentativas integer)
  returns table (pendentes integer, parados integer, mais_antigo_s double precision)
  language sql stable security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
    select (count(*) filter (where e.tentativas < p_max_tentativas))::integer,
           (count(*) filter (where e.tentativas >= p_max_tentativas))::integer,
           extract(epoch from now() - min(e.ocorrido_em) filter (where e.tentativas < p_max_tentativas))::double precision
      from plataforma.evento e
     where e.publicado_em is null
       and e.deleted_at is null
       and e.nome = any (coalesce(p_nomes, '{}'::text[]))
  $$;

grant select (deleted_at) on plataforma.evento to macuxi_worker;
