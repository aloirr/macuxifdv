-- 0099_plataforma_resumo_outbox_vivos (down) — desfaz a 0099 (v1.0.30) e volta exatamente ao catálogo e às ACLs da 0098:
-- plataforma.resumo_outbox com o corpo da 0024 (o evento apagado volta a contar como pendente ou parado no /v1/saude) e o
-- macuxi_worker sem SELECT no deleted_at de plataforma.evento. Nenhum dado muda. Idempotente.
-- Pré-condição: o despachante (apps/api/src/despachante.ts) sem ler deleted_at da outbox (senão 42501).

revoke select (deleted_at) on plataforma.evento from macuxi_worker;

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
       and e.nome = any (coalesce(p_nomes, '{}'::text[]))
  $$;
