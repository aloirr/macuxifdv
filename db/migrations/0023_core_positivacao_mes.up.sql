-- 0023_core_positivacao_mes (up) — positivação ACUMULADA do mês no Início (opção 3 do dono do produto, 04/11; pendência
-- do PR #84 da T-0073; item "Positivação acumulada do mês no Início" de docs/backlog.md). Dicionário: docs/banco/core.md.
-- Migração ADITIVA: nenhuma coluna existente muda, nenhum dado existente é reescrito (coluna nova nula, sem padrão).
--
-- Problema: core.indicador_diario.clientes_positivados (0021) conta clientes distintos NO DIA; somar os dias conta duas
-- vezes o cliente que comprou em dois dias. O Início com o Vendedor desligado precisa da contagem do MÊS sem repetir cliente
-- (RN-CORE-20: positivação = clientes distintos com pedido que conta para a meta no período; RN-CORE-26: partido em
-- "até ontem" e "hoje", hoje = clientes NOVOS hoje).
--
-- Mudança em core.indicador_diario:
--   clientes_positivados_ids (uuid[], null): QUAIS clientes (core.cliente.id do próprio tenant) o usuário positivou naquele
--     dia civil do tenant, sem repetição; null = não apurado (linhas anteriores à 0023 e consumidor que ainda não grava).
--     O consumidor que alimenta o read-model grava a lista e a contagem do dia juntas: CHECK
--     indicador_diario_clientes_positivados_ids_coerente (lista de 1 dimensão, sem elemento nulo e
--     clientes_positivados = cardinality(lista)). Cancelamento: o consumidor regrava a lista do dia sem o cliente.
--     Sem FK por elemento (array); a API só grava id de cliente do próprio tenant. Volume: dezenas de ids por linha.
--
-- core.positivacao_do_mes(p_usuario_ids uuid[], p_periodo text 'AAAA-MM', p_hoje date default null)
--   returns table (usuario_id, ate_ontem, hoje, mes): uma linha por usuário pedido. Cada cliente conta UMA vez no mês, no
--   PRIMEIRO dia civil em que o usuário o positivou: ate_ontem = clientes com primeiro dia < p_hoje; hoje = clientes com
--   primeiro dia = p_hoje (novos hoje); mes = todos do mês. p_hoje nulo = hoje no fuso do tenant do contexto.
--   null nos três = sem fonte (o usuário não tem nenhuma linha com lista até o fim do mês); usuário com fonte e sem
--   cliente no mês = 0 (mês novo zera). SECURITY INVOKER (RLS de core.indicador_diario vale), search_path fixo, EXECUTE
--   só para o macuxi_app. Índice usado: indicador_diario_uk (tenant_id, usuario_id, data) where deleted_at is null (0006).
--
-- RLS: a tabela já tem enable/force e a política isolamento_tenant (0006). Nenhuma política nova; grants da tabela iguais.
-- O pull de indicador_diario (modules/core/api/sync.ts) lista as colunas: a lista nova só vai ao aparelho se o Core pedir.
-- Caminho de volta: 0023_core_positivacao_mes.down.sql (APAGA a função e as listas de clientes; os números do
-- indicador_diario, inclusive clientes_positivados do dia, ficam).

alter table core.indicador_diario add column clientes_positivados_ids uuid[];
alter table core.indicador_diario add constraint indicador_diario_clientes_positivados_ids_coerente check (
  case
    when clientes_positivados_ids is null then true
    when coalesce(array_ndims(clientes_positivados_ids), 1) <> 1 then false
    else clientes_positivados is not null
      and clientes_positivados = cardinality(clientes_positivados_ids)
      and array_position(clientes_positivados_ids, null) is null
  end
);

create or replace function core.positivacao_do_mes(p_usuario_ids uuid[], p_periodo text, p_hoje date default null)
  returns table (usuario_id uuid, ate_ontem integer, hoje integer, mes integer)
  language sql stable
  set search_path = pg_catalog, core, plataforma, pg_temp
  as $$
    with limites as (
      select to_date(p_periodo || '-01', 'YYYY-MM-DD') as inicio,
             (to_date(p_periodo || '-01', 'YYYY-MM-DD') + interval '1 month')::date as fim,
             coalesce(p_hoje, (select (now() at time zone t.fuso)::date from plataforma.tenant t where t.id = plataforma.tenant_atual())) as dia
    ),
    usuarios as (
      select distinct x.id from unnest(p_usuario_ids) as x(id) where x.id is not null
    ),
    primeira as (
      -- cada cliente UMA vez por usuário no mês, no primeiro dia em que foi positivado
      select d.usuario_id, c.cliente_id, min(d.data) as dia
        from core.indicador_diario d
        cross join limites l
        cross join lateral unnest(d.clientes_positivados_ids) as c(cliente_id)
       where d.tenant_id = plataforma.tenant_atual()
         and d.deleted_at is null
         and d.usuario_id = any(p_usuario_ids)
         and d.data >= l.inicio
         and d.data < l.fim
       group by d.usuario_id, c.cliente_id
    )
    select u.id,
           case when f.apurado then (count(p.cliente_id) filter (where p.dia < l.dia))::integer end,
           case when f.apurado then (count(p.cliente_id) filter (where p.dia = l.dia))::integer end,
           case when f.apurado then count(p.cliente_id)::integer end
      from usuarios u
      cross join limites l
      cross join lateral (
        select exists (
          select 1
            from core.indicador_diario d
           where d.tenant_id = plataforma.tenant_atual()
             and d.deleted_at is null
             and d.usuario_id = u.id
             and d.data < l.fim
             and d.clientes_positivados_ids is not null
        ) as apurado
      ) f
      left join primeira p on p.usuario_id = u.id
     group by u.id, l.dia, f.apurado
     order by u.id
  $$;
revoke all on function core.positivacao_do_mes(uuid[], text, date) from public;
grant execute on function core.positivacao_do_mes(uuid[], text, date) to macuxi_app;
