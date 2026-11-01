-- 0011_plataforma_outbox_retencao (up) — T-0032 (spec R-20261101-013336-banco-dados, "0009" renumerada para 0011; item 13
-- da revisão do banco da T-0025): a carga inicial do Hub gera ~100 a 200 mil eventos por tenant na outbox
-- (integracao.<entidade>.atualizado@1), e plataforma.evento / evento_consumo não tinham retenção.
-- 1. Índice dos eventos publicados por tenant (varredura do expurgo sem ler os pendentes).
-- 2. plataforma.expurgar_outbox(p_agora, p_limite): apaga, por tenant, os eventos PUBLICADOS há mais de N dias e os
--    consumos deles (evento_consumo, mesma transação). N = parâmetro do tenant plataforma/'outbox.retencao_dias' (número de
--    dias; sem linha = 30; limitado a 7..365). Evento pendente (publicado_em nulo) nunca sai. SECURITY DEFINER (todos os
--    tenants), só macuxi_worker; agendamento do engenheiro-software (mesmo worker do despacho, ADR 0007).
-- 3. plataforma.tenant_modulo.parametros ganha o comentário de LEGADO (R-20261031-165647: a fonte única dos parâmetros do
--    tenant é plataforma.parametro; a coluna não é lida nem gravada desde a T-0016).
-- Caminho de volta: 0011_plataforma_outbox_retencao.down.sql (remove índice, função e comentário; nada de dado se perde —
-- o que o expurgo já apagou não volta).

create index evento_publicado_ix on plataforma.evento (tenant_id, publicado_em) where publicado_em is not null;

create function plataforma.expurgar_outbox(p_agora timestamptz default now(), p_limite integer default 10000)
  returns table (item text, quantidade bigint)
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma
  as $$
#variable_conflict use_column
declare
  t record;
  dias integer;
  ids uuid[];
  n bigint;
  n_evento bigint := 0;
  n_consumo bigint := 0;
begin
  if p_agora is null or p_limite is null or p_limite < 1 then
    raise exception 'expurgar_outbox: p_agora obrigatório e p_limite >= 1';
  end if;
  for t in select x.id from plataforma.tenant x order by x.id loop
    select case when jsonb_typeof(p.valor) = 'number' then greatest(7, least(365, floor((p.valor #>> '{}')::numeric)::integer)) end
      into dias
      from plataforma.parametro p
     where p.tenant_id = t.id and p.modulo = 'plataforma' and p.chave = 'outbox.retencao_dias' and p.deleted_at is null;
    dias := coalesce(dias, 30);
    select array_agg(e.id) into ids
      from (select x.id from plataforma.evento x
             where x.tenant_id = t.id and x.publicado_em is not null and x.publicado_em < p_agora - make_interval(days => dias)
             order by x.publicado_em limit p_limite) e;
    continue when ids is null;
    delete from plataforma.evento_consumo c where c.tenant_id = t.id and c.evento_id = any (ids);
    get diagnostics n = row_count;
    n_consumo := n_consumo + n;
    delete from plataforma.evento e where e.tenant_id = t.id and e.id = any (ids);
    get diagnostics n = row_count;
    n_evento := n_evento + n;
  end loop;
  item := 'evento'; quantidade := n_evento; return next;
  item := 'evento_consumo'; quantidade := n_consumo; return next;
end
$$;
revoke all on function plataforma.expurgar_outbox(timestamptz, integer) from public;
grant execute on function plataforma.expurgar_outbox(timestamptz, integer) to macuxi_worker;

comment on column plataforma.tenant_modulo.parametros is 'LEGADO (sem uso desde a T-0016): os parâmetros do tenant ficam em plataforma.parametro.';
