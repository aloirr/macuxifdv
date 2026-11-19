-- 0089_core_rastreamento (up) — T-0156 (rastreamento contínuo no expediente, v1.0.15). ADR 0061; desenho
-- docs/desenho/tracking.md §5.1, §5.4, §8 e §11 (item 1); retenção aprovada em R-20261116-110200-alexandre
-- (docs/desenho/T-0156-legal-finalidade.md §5). Migração em cima da 0088 (P-6, 0088_vendedor_pedido_aprovacao); o número segue a ordem de merge. Dicionário:
-- docs/banco/core.md ("0089"). Teste: db/testes/rastreamento.db.test.ts (estático sempre; banco e up/down com o Postgres local).
--
-- Migração ADITIVA: 2 tabelas novas no Core (core.ponto_trajeto e core.ausencia_usuario), 1 índice novo em
-- core.deslocamento_dia (0066), deslocamento_dia_expurgo_ix, e 1 função de expurgo. Nenhuma tabela, coluna, política ou grant
-- que já existe muda. Nenhum contrato muda de versão. O rastreamento é interno (ordem do dono do produto, 19/11/2026 05h46):
-- o vendedor não vê nada e não há termo, aceite nem pausa.
--
-- Tabelas (dono: Core; todas com os campos comuns, RLS ligado e FORÇADO, isolamento_tenant ao macuxi_app e manutencao (0031)):
-- 1. core.ponto_trajeto — ponto do trajeto capturado no aparelho (só de envio; nunca volta ao aparelho):
--      usuario_id    uuid not null          FK composta core.usuario
--      aparelho_id   uuid null              FK composta core.dispositivo (o da sessão; nulo sem dispositivo registrado)
--      capturado_em  timestamptz not null   instante da captura (UTC)
--      latitude      numeric(9,6) not null  -90..90 (6 casas, desenho §3.1)
--      longitude     numeric(9,6) not null  -180..180
--      precisao_m    integer null           metros arredondados, >= 0
--      velocidade_ms numeric(6,2) null      m/s, >= 0 (nula se o aparelho não der)
--    id = UUID do aparelho (push idempotente: insert ... on conflict (id) do nothing). Índices (tenant_id, usuario_id,
--    capturado_em) (pontos de um dia e recálculo do resumo, §5.2 e §5.3) e (capturado_em) (o expurgo varre todos os tenants
--    pelo mais antigo). Sem índice de sync (TABELAS_FORA_DO_SYNC) e sem external_id único (ponto não vem do ERP).
--    macuxi_app: select e insert (sem update e sem delete: o ponto não muda; quem apaga é o expurgo, por DELETE FÍSICO —
--    exceção consciente ao deleted_at, ADR 0061 item 5). Volume: ~150 por usuário por dia útil; ~1,4 milhão num tenant grande
--    em 90 dias; sem partição na v1 (reavaliar acima de 10 milhões, ADR 0061).
-- 2. core.ausencia_usuario — férias, folga ou afastamento (§4.2), sem motivo (minimização):
--      usuario_id uuid not null (FK composta core.usuario) · de date not null · ate date not null (dias no fuso do tenant)
--    CHECK de <= ate. Cadastro do BKO (admin ou supervisor da equipe; a permissão core.ausencia.cadastrar é da API).
--    Pull ao aparelho do próprio usuário: índices de sync (tenant_id, updated_at, id) e (tenant_id, usuario_id, updated_at, id).
--    Cancelar = deleted_at. macuxi_app: select, insert e update (sem delete). Volume: poucas por usuário por ano.
--
-- macuxi_leitura (0078, ADR 0055): NENHUM grant e NENHUMA política leitura nas 2 tabelas (ADR 0061 item 7: trajeto e
-- ausência são dado pessoal do trabalhador, e a saída da consulta vai para o log do Actions). Declaradas em
-- TABELAS_SEM_LEITURA (db/src/excecoes.ts), lidas pelo conferir-rls.sql e pelos testes. macuxi_worker: nenhum grant de
-- tabela, só o EXECUTE da função abaixo. macuxi_portal: nada.
--
-- core.deslocamento_dia (0066): + índice deslocamento_dia_expurgo_ix (data), para o expurgo dos resumos de mais de 5 anos.
--
-- Função core.expurgar_rastreamento(p_agora timestamptz default now(), p_limite integer default 10000)
--   returns table (tenant_id uuid, pontos integer, resumos integer)
--   SECURITY DEFINER (dono = migrador, que enxerga os tenants pela política manutencao), search_path fixo com pg_temp por
--   último, EXECUTE só ao macuxi_worker (job diário do worker, desenho §5.4). Apaga DE FATO (DELETE físico), em lote de até
--   p_limite linhas por tabela por chamada, do mais antigo para o mais novo, pulando linha travada (skip locked):
--   - core.ponto_trajeto com capturado_em < p_agora - 90 dias;
--   - core.deslocamento_dia com data < (dia UTC de p_agora) - 5 anos (o resumo vale 5 anos).
--   Devolve uma linha por tenant com algo apagado (só o tenant e as contagens, sem usuário nem coordenada: desenho §5.4);
--   nenhuma linha = nada a apagar. O worker chama de novo enquanto alguma contagem for igual a p_limite.
--   p_agora nulo ou p_limite fora de 1..50000 = 22023. O macuxi_worker ganha USAGE no schema core só para chamar a função
--   (como no integracao, 0010); continua sem grant de tabela no core.
--
-- Caminho de volta: 0089_core_rastreamento.down.sql (APAGA as 2 tabelas com tudo o que tiverem — pontos e ausências —, a
-- função e o índice novo de deslocamento_dia; os resumos ficam). Volte antes o código do Core e do
-- worker que lê, grava ou chama a função (senão 42P01 ou 42883).

-- =============================================================================================
-- core.ponto_trajeto — pontos do trajeto (desenho §3.1 e §5.1)
-- =============================================================================================
create table core.ponto_trajeto (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references plataforma.tenant (id),
  usuario_id     uuid not null,
  aparelho_id    uuid,
  capturado_em   timestamptz not null,
  latitude       numeric(9,6) not null,
  longitude      numeric(9,6) not null,
  precisao_m     integer,
  velocidade_ms  numeric(6,2),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  external_id    text,
  constraint ponto_trajeto_tenant_id_uk unique (tenant_id, id),
  constraint ponto_trajeto_usuario_fk foreign key (tenant_id, usuario_id) references core.usuario (tenant_id, id),
  constraint ponto_trajeto_aparelho_fk foreign key (tenant_id, aparelho_id) references core.dispositivo (tenant_id, id),
  constraint ponto_trajeto_latitude_faixa check (latitude between -90 and 90),
  constraint ponto_trajeto_longitude_faixa check (longitude between -180 and 180),
  constraint ponto_trajeto_precisao_nao_negativa check (precisao_m is null or precisao_m >= 0),
  constraint ponto_trajeto_velocidade_nao_negativa check (velocidade_ms is null or velocidade_ms >= 0)
);
create index ponto_trajeto_usuario_capturado_ix on core.ponto_trajeto (tenant_id, usuario_id, capturado_em);
create index ponto_trajeto_expurgo_ix on core.ponto_trajeto (capturado_em);
create index ponto_trajeto_aparelho_ix on core.ponto_trajeto (tenant_id, aparelho_id) where aparelho_id is not null;
create trigger ponto_trajeto_updated_at before update on core.ponto_trajeto
  for each row execute function plataforma.definir_updated_at();
alter table core.ponto_trajeto enable row level security;
alter table core.ponto_trajeto force row level security;
create policy isolamento_tenant on core.ponto_trajeto for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
create policy manutencao on core.ponto_trajeto for all to macuxi_manutencao using (true) with check (true);
grant select, insert on core.ponto_trajeto to macuxi_app;

-- =============================================================================================
-- core.ausencia_usuario — férias, folga e afastamento (desenho §4.2)
-- =============================================================================================
create table core.ausencia_usuario (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references plataforma.tenant (id),
  usuario_id   uuid not null,
  de           date not null,
  ate          date not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  external_id  text,
  constraint ausencia_usuario_tenant_id_uk unique (tenant_id, id),
  constraint ausencia_usuario_usuario_fk foreign key (tenant_id, usuario_id) references core.usuario (tenant_id, id),
  constraint ausencia_usuario_periodo check (de <= ate)
);
create index ausencia_usuario_sync_ix on core.ausencia_usuario (tenant_id, updated_at, id);
create index ausencia_usuario_usuario_sync_ix on core.ausencia_usuario (tenant_id, usuario_id, updated_at, id);
create unique index ausencia_usuario_external_uk on core.ausencia_usuario (tenant_id, external_id) where external_id is not null and deleted_at is null;
create trigger ausencia_usuario_updated_at before update on core.ausencia_usuario
  for each row execute function plataforma.definir_updated_at();
alter table core.ausencia_usuario enable row level security;
alter table core.ausencia_usuario force row level security;
create policy isolamento_tenant on core.ausencia_usuario for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
create policy manutencao on core.ausencia_usuario for all to macuxi_manutencao using (true) with check (true);
grant select, insert, update on core.ausencia_usuario to macuxi_app;

-- =============================================================================================
-- core.deslocamento_dia (0066) — índice do expurgo dos resumos (5 anos)
-- =============================================================================================
create index deslocamento_dia_expurgo_ix on core.deslocamento_dia (data);

-- =============================================================================================
-- Expurgo (LGPD; retenção de R-20261116-110200-alexandre): só o worker
-- =============================================================================================
create function core.expurgar_rastreamento(p_agora timestamptz default now(), p_limite integer default 10000)
  returns table (tenant_id uuid, pontos integer, resumos integer)
  language plpgsql volatile security definer
  set search_path = pg_catalog, core, pg_temp
  as $$
begin
  if p_agora is null or p_limite is null or p_limite < 1 or p_limite > 50000 then
    raise exception 'expurgar_rastreamento: p_agora obrigatório e p_limite entre 1 e 50000' using errcode = '22023';
  end if;

  return query
  with
  pts as (
    delete from core.ponto_trajeto x
     where x.id in (select y.id from core.ponto_trajeto y
                     where y.capturado_em < p_agora - interval '90 days'
                     order by y.capturado_em
                     limit p_limite
                       for update skip locked)
    returning x.tenant_id
  ),
  res as (
    delete from core.deslocamento_dia x
     where x.id in (select y.id from core.deslocamento_dia y
                     where y.data < ((p_agora at time zone 'UTC')::date - interval '5 years')::date
                     order by y.data
                     limit p_limite
                       for update skip locked)
    returning x.tenant_id
  ),
  todos (tenant_id, tipo) as (
    select t.tenant_id, 'p' from pts t
    union all select t.tenant_id, 'r' from res t
  )
  select t.tenant_id,
         (count(*) filter (where t.tipo = 'p'))::integer,
         (count(*) filter (where t.tipo = 'r'))::integer
    from todos t
   group by t.tenant_id
   order by t.tenant_id;
end
$$;
revoke all on function core.expurgar_rastreamento(timestamptz, integer) from public;
-- USAGE no schema só para chamar a função (como integracao na 0010): sem grant de tabela, o worker lê 0 tabelas do core (42501)
grant usage on schema core to macuxi_worker;
grant execute on function core.expurgar_rastreamento(timestamptz, integer) to macuxi_worker;

-- =============================================================================================
-- Conferência pelo catálogo (aborta com 42501 e nada muda)
-- =============================================================================================
do $$
declare
  v_t text;
begin
  if has_function_privilege('macuxi_app', 'core.expurgar_rastreamento(timestamptz, integer)', 'execute')
     or has_function_privilege('macuxi_portal', 'core.expurgar_rastreamento(timestamptz, integer)', 'execute')
     or has_function_privilege('macuxi_leitura', 'core.expurgar_rastreamento(timestamptz, integer)', 'execute') then
    raise exception '0089: core.expurgar_rastreamento executável fora do macuxi_worker' using errcode = '42501';
  end if;
  foreach v_t in array array['core.ponto_trajeto', 'core.ausencia_usuario'] loop
    if has_any_column_privilege('macuxi_leitura', v_t, 'SELECT, INSERT, UPDATE, REFERENCES')
       or has_table_privilege('macuxi_worker', v_t, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
       or has_table_privilege('macuxi_portal', v_t, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
       or has_table_privilege('macuxi_app', v_t, 'DELETE, TRUNCATE') then
      raise exception '0089: privilégio fora do desenho em %', v_t using errcode = '42501';
    end if;
  end loop;
end
$$;
