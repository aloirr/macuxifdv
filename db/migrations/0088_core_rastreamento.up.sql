-- 0088_core_rastreamento (up) — T-0156 (rastreamento contínuo no expediente, v1.0.15). ADR 0061; desenho
-- docs/desenho/tracking.md §5.1, §5.4, §8 e §11 (item 1); retenção aprovada em R-20261116-110200-alexandre
-- (docs/desenho/T-0156-legal-finalidade.md §5). Migração em cima da 0087 (o número segue a ordem de merge). Dicionário:
-- docs/banco/core.md ("0088"). Teste: db/testes/rastreamento.db.test.ts (estático sempre; banco e up/down com o Postgres local).
--
-- Migração ADITIVA: 5 tabelas novas no Core, 1 índice novo em core.deslocamento_dia (0066) e 1 função de expurgo. Nenhuma
-- tabela, coluna, política ou grant que já existe muda. Nenhum contrato muda de versão.
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
-- 2. core.pausa_trajeto — pausa pessoal (§4.3), só início e fim, sem motivo (só de envio):
--      usuario_id uuid not null (FK composta core.usuario) · inicio timestamptz not null · fim timestamptz null (pausa em curso)
--    CHECK fim > inicio. Índice (tenant_id, usuario_id, inicio). Fora do sync. macuxi_app: select, insert e update (o fim
--    chega depois); sem delete. Retenção dos pontos (90 dias pelo inicio).
-- 3. core.ausencia_usuario — férias, folga ou afastamento (§4.2), sem motivo (minimização):
--      usuario_id uuid not null (FK composta core.usuario) · de date not null · ate date not null (dias no fuso do tenant)
--    CHECK de <= ate. Cadastro do BKO (admin ou supervisor da equipe; a permissão core.ausencia.cadastrar é da API).
--    Pull ao aparelho do próprio usuário: índices de sync (tenant_id, updated_at, id) e (tenant_id, usuario_id, updated_at, id).
--    Cancelar = deleted_at. macuxi_app: select, insert e update (sem delete). Volume: poucas por usuário por ano.
-- 4. core.termo_rastreamento — versão do termo de ciência publicada pela empresa (§6):
--      versao integer not null (>= 1) · texto text not null (1..20000 caracteres) · publicado_em timestamptz not null default
--      now() · publicado_por uuid not null (FK composta core.usuario)
--    termo_rastreamento_versao_uk UNIQUE (tenant_id, versao), NÃO parcial: número de versão nunca se repete, nem depois de
--    excluída (é o alvo da FK do aceite). Vigente = a maior versão viva (quem resolve é o Core). Publicada não muda:
--    macuxi_app só select e insert. Pull ao aparelho: índice de sync (tenant_id, updated_at, id). Volume: poucas por tenant.
-- 5. core.aceite_termo_rastreamento — "Li e estou ciente" do usuário numa versão (§6):
--      usuario_id uuid not null (FK composta core.usuario) · termo_versao integer not null (FK (tenant_id, termo_versao) ->
--      core.termo_rastreamento (tenant_id, versao)) · aceito_em timestamptz not null · aparelho_id uuid null (FK composta
--      core.dispositivo)
--    Único vivo (tenant_id, usuario_id, termo_versao) where deleted_at is null (o push repetido com outro id cai no
--    on conflict do nothing do Core). Índices de sync (tenant_id, updated_at, id) e (tenant_id, usuario_id, updated_at, id):
--    o aceite sai do aparelho e pode voltar no pull do próprio usuário (depois de apagar os bancos do aparelho, o aceite já
--    feito não é pedido de novo). macuxi_app: select e insert. Registro de prova: fica enquanto o usuário existir + 5 anos.
--
-- macuxi_leitura (0078, ADR 0055): NENHUM grant e NENHUMA política leitura nas 5 tabelas (ADR 0061 item 7: trajeto, pausa,
-- ausência e aceite são dado pessoal do trabalhador, e a saída da consulta vai para o log do Actions). Declaradas em
-- TABELAS_SEM_LEITURA (db/src/excecoes.ts), lidas pelo conferir-rls.sql e pelos testes. macuxi_worker: nenhum grant de
-- tabela, só o EXECUTE da função abaixo. macuxi_portal: nada.
--
-- core.deslocamento_dia (0066): + índice deslocamento_dia_expurgo_ix (data), para o expurgo dos resumos de mais de 5 anos.
--
-- Função core.expurgar_rastreamento(p_agora timestamptz default now(), p_limite integer default 10000)
--   returns table (tenant_id uuid, pontos integer, pausas integer, resumos integer, aceites integer)
--   SECURITY DEFINER (dono = migrador, que enxerga os tenants pela política manutencao), search_path fixo com pg_temp por
--   último, EXECUTE só ao macuxi_worker (job diário do worker, desenho §5.4). Apaga DE FATO (DELETE físico), em lote de até
--   p_limite linhas por tabela por chamada, do mais antigo para o mais novo, pulando linha travada (skip locked):
--   - core.ponto_trajeto com capturado_em < p_agora - 90 dias;
--   - core.pausa_trajeto com inicio < p_agora - 90 dias;
--   - core.deslocamento_dia com data < (dia UTC de p_agora) - 5 anos (o resumo vale 5 anos);
--   - core.aceite_termo_rastreamento de usuário com deleted_at < p_agora - 5 anos.
--   Devolve uma linha por tenant com algo apagado (só o tenant e as contagens, sem usuário nem coordenada: desenho §5.4);
--   nenhuma linha = nada a apagar. O worker chama de novo enquanto alguma contagem for igual a p_limite.
--   p_agora nulo ou p_limite fora de 1..50000 = 22023. O macuxi_worker ganha USAGE no schema core só para chamar a função
--   (como no integracao, 0010); continua sem grant de tabela no core.
--
-- Caminho de volta: 0088_core_rastreamento.down.sql (APAGA as 5 tabelas com tudo o que tiverem — pontos, pausas, ausências,
-- termos e aceites —, a função e o índice novo de deslocamento_dia; os resumos ficam). Volte antes o código do Core e do
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
-- core.pausa_trajeto — pausa pessoal (desenho §4.3)
-- =============================================================================================
create table core.pausa_trajeto (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references plataforma.tenant (id),
  usuario_id   uuid not null,
  inicio       timestamptz not null,
  fim          timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  external_id  text,
  constraint pausa_trajeto_tenant_id_uk unique (tenant_id, id),
  constraint pausa_trajeto_usuario_fk foreign key (tenant_id, usuario_id) references core.usuario (tenant_id, id),
  constraint pausa_trajeto_ordem check (fim is null or fim > inicio)
);
create index pausa_trajeto_usuario_inicio_ix on core.pausa_trajeto (tenant_id, usuario_id, inicio);
create trigger pausa_trajeto_updated_at before update on core.pausa_trajeto
  for each row execute function plataforma.definir_updated_at();
alter table core.pausa_trajeto enable row level security;
alter table core.pausa_trajeto force row level security;
create policy isolamento_tenant on core.pausa_trajeto for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
create policy manutencao on core.pausa_trajeto for all to macuxi_manutencao using (true) with check (true);
grant select, insert, update on core.pausa_trajeto to macuxi_app;

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
-- core.termo_rastreamento — versões do termo de ciência (desenho §6)
-- =============================================================================================
create table core.termo_rastreamento (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references plataforma.tenant (id),
  versao         integer not null,
  texto          text not null,
  publicado_em   timestamptz not null default now(),
  publicado_por  uuid not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  external_id    text,
  constraint termo_rastreamento_tenant_id_uk unique (tenant_id, id),
  constraint termo_rastreamento_versao_uk unique (tenant_id, versao),
  constraint termo_rastreamento_publicado_por_fk foreign key (tenant_id, publicado_por) references core.usuario (tenant_id, id),
  constraint termo_rastreamento_versao_positiva check (versao >= 1),
  constraint termo_rastreamento_texto_tamanho check (char_length(texto) between 1 and 20000)
);
create index termo_rastreamento_sync_ix on core.termo_rastreamento (tenant_id, updated_at, id);
create index termo_rastreamento_publicado_por_ix on core.termo_rastreamento (tenant_id, publicado_por);
create trigger termo_rastreamento_updated_at before update on core.termo_rastreamento
  for each row execute function plataforma.definir_updated_at();
alter table core.termo_rastreamento enable row level security;
alter table core.termo_rastreamento force row level security;
create policy isolamento_tenant on core.termo_rastreamento for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
create policy manutencao on core.termo_rastreamento for all to macuxi_manutencao using (true) with check (true);
grant select, insert on core.termo_rastreamento to macuxi_app;

-- =============================================================================================
-- core.aceite_termo_rastreamento — aceite do termo por usuário e versão (desenho §6)
-- =============================================================================================
create table core.aceite_termo_rastreamento (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references plataforma.tenant (id),
  usuario_id     uuid not null,
  termo_versao   integer not null,
  aceito_em      timestamptz not null,
  aparelho_id    uuid,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  external_id    text,
  constraint aceite_termo_rastreamento_tenant_id_uk unique (tenant_id, id),
  constraint aceite_termo_rastreamento_usuario_fk foreign key (tenant_id, usuario_id) references core.usuario (tenant_id, id),
  constraint aceite_termo_rastreamento_termo_fk foreign key (tenant_id, termo_versao) references core.termo_rastreamento (tenant_id, versao),
  constraint aceite_termo_rastreamento_aparelho_fk foreign key (tenant_id, aparelho_id) references core.dispositivo (tenant_id, id)
);
create unique index aceite_termo_rastreamento_uk on core.aceite_termo_rastreamento (tenant_id, usuario_id, termo_versao) where deleted_at is null;
create index aceite_termo_rastreamento_sync_ix on core.aceite_termo_rastreamento (tenant_id, updated_at, id);
create index aceite_termo_rastreamento_usuario_sync_ix on core.aceite_termo_rastreamento (tenant_id, usuario_id, updated_at, id);
create index aceite_termo_rastreamento_termo_ix on core.aceite_termo_rastreamento (tenant_id, termo_versao);
create index aceite_termo_rastreamento_aparelho_ix on core.aceite_termo_rastreamento (tenant_id, aparelho_id) where aparelho_id is not null;
create trigger aceite_termo_rastreamento_updated_at before update on core.aceite_termo_rastreamento
  for each row execute function plataforma.definir_updated_at();
alter table core.aceite_termo_rastreamento enable row level security;
alter table core.aceite_termo_rastreamento force row level security;
create policy isolamento_tenant on core.aceite_termo_rastreamento for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
create policy manutencao on core.aceite_termo_rastreamento for all to macuxi_manutencao using (true) with check (true);
grant select, insert on core.aceite_termo_rastreamento to macuxi_app;

-- =============================================================================================
-- core.deslocamento_dia (0066) — índice do expurgo dos resumos (5 anos)
-- =============================================================================================
create index deslocamento_dia_expurgo_ix on core.deslocamento_dia (data);

-- =============================================================================================
-- Expurgo (LGPD; retenção de R-20261116-110200-alexandre): só o worker
-- =============================================================================================
create function core.expurgar_rastreamento(p_agora timestamptz default now(), p_limite integer default 10000)
  returns table (tenant_id uuid, pontos integer, pausas integer, resumos integer, aceites integer)
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
  pas as (
    delete from core.pausa_trajeto x
     where x.id in (select y.id from core.pausa_trajeto y
                     where y.inicio < p_agora - interval '90 days'
                     order by y.inicio
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
  ace as (
    delete from core.aceite_termo_rastreamento x
     where x.id in (select y.id from core.aceite_termo_rastreamento y
                      join core.usuario u on u.tenant_id = y.tenant_id and u.id = y.usuario_id
                     where u.deleted_at < p_agora - interval '5 years'
                     order by u.deleted_at, y.id
                     limit p_limite
                       for update of y skip locked)
    returning x.tenant_id
  ),
  todos (tenant_id, tipo) as (
    select t.tenant_id, 'p' from pts t
    union all select t.tenant_id, 'z' from pas t
    union all select t.tenant_id, 'r' from res t
    union all select t.tenant_id, 'a' from ace t
  )
  select t.tenant_id,
         (count(*) filter (where t.tipo = 'p'))::integer,
         (count(*) filter (where t.tipo = 'z'))::integer,
         (count(*) filter (where t.tipo = 'r'))::integer,
         (count(*) filter (where t.tipo = 'a'))::integer
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
    raise exception '0088: core.expurgar_rastreamento executável fora do macuxi_worker' using errcode = '42501';
  end if;
  foreach v_t in array array['core.ponto_trajeto', 'core.pausa_trajeto', 'core.ausencia_usuario', 'core.termo_rastreamento',
                             'core.aceite_termo_rastreamento'] loop
    if has_any_column_privilege('macuxi_leitura', v_t, 'SELECT, INSERT, UPDATE, REFERENCES')
       or has_table_privilege('macuxi_worker', v_t, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
       or has_table_privilege('macuxi_portal', v_t, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
       or has_table_privilege('macuxi_app', v_t, 'DELETE, TRUNCATE') then
      raise exception '0088: privilégio fora do desenho em %', v_t using errcode = '42501';
    end if;
  end loop;
end
$$;
