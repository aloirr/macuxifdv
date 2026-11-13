-- 0066_core_meta_produtividade (up) — T-0170 (Performance: metas de produtividade, km do dia e meta de itens por pedido).
-- Desenho docs/desenho/performance-produtividade.md §5 (deslocamento_dia), §6.1 (meta_produtividade) e §7.4 (CHECK de
-- core.meta.indicador). Migração em cima da 0065. Dicionário: docs/banco/core.md ("0066").
-- Teste: db/testes/t0170-meta-produtividade.db.test.ts (estático no PC; banco e up/down no CI).
--
-- Migração ADITIVA: 2 tabelas novas no Core e 1 valor a mais no CHECK meta_indicador_valido de core.meta.
--
-- core.meta_produtividade (dono: Core): meta de produtividade por escopo tenant|equipe|usuario. equipe_id (FK composta
--   core.equipe) só e sempre no escopo equipe; usuario_id (FK composta core.usuario) só e sempre no escopo usuario (as duas
--   coerências no gatilho meta_produtividade_conferir_alvo, não em CHECK: a FK cruzada decide antes); indicador =
--   um dos 12 de INDICADORES_PRODUTIVIDADE (modules/core/contracts/performance.ts); valor inteiro >= 0 na unidade do indicador
--   (a faixa por indicador é do domain/API, FAIXA_META_PRODUTIVIDADE); vigencia_inicio 'AAAA-MM' (vale a partir do mês);
--   atualizado_por (FK composta core.usuario, nulo = carga). Único vivo por (tenant, escopo, alvo, indicador, vigência), com o
--   alvo nulo do escopo tenant normalizado por coalesce (meta_produtividade_vigencia_uk). O sentido ("até"/"a partir de") e o
--   padrão do FDV ficam no contrato, não no banco (tenant novo não precisa de seed). Pull `meta_produtividade`: todas as vivas
--   do tenant, sem janela. Volume: ~12 por alvo (dezenas a poucas centenas por tenant).
-- core.deslocamento_dia (dono: Core): resumo diário do km do usuário, mantido pelo servidor quando os pontos do rastreamento
--   chegam (T-0156; até lá fica VAZIA e os cards de km ficam sem dado). usuario_id (FK composta core.usuario), data (dia civil
--   no fuso do tenant), metros e pontos >= 0, primeiro_ponto_em/ultimo_ponto_em (juntos, último >= primeiro), origem
--   'rastreamento' (reservado 'manual' para o futuro, com nova migração). Único vivo por (tenant, usuário, data). Sem
--   coordenada (dado pessoal derivado; retenção do resumo: 5 anos, T-0145 §5). Pull `deslocamento_dia` com a janela das visitas
--   e escopo de usuário (índice (tenant_id, usuario_id, updated_at, id)). Volume: 1 por usuário por dia útil.
-- core.meta.indicador ganha 'itens_por_pedido' (valor em centésimos: 3,50 itens = 350). As metas que existem não mudam.
--
-- RLS: as 2 tabelas com enable + force + isolamento_tenant (macuxi_app) + manutencao (0031). macuxi_app: select, insert e
-- update, SEM delete ("voltar a herdar" = deleted_at). macuxi_worker: sem acesso.
--
-- Caminho de volta: 0066_core_meta_produtividade.down.sql (APAGA as metas de produtividade, os resumos de km e as metas de
-- core.meta com indicador 'itens_por_pedido' — o CHECK antigo não as aceita). Volte antes o Core que lê ou grava (senão 42P01).

-- =============================================================================================
-- core.meta_produtividade — metas de produtividade (desenho §6.1)
-- =============================================================================================
create table core.meta_produtividade (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references plataforma.tenant (id),
  escopo           text not null,
  equipe_id        uuid,
  usuario_id       uuid,
  indicador        text not null,
  valor            integer not null,
  vigencia_inicio  text not null,
  atualizado_por   uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  external_id      text,
  constraint meta_produtividade_tenant_id_uk unique (tenant_id, id),
  constraint meta_produtividade_equipe_fk foreign key (tenant_id, equipe_id) references core.equipe (tenant_id, id),
  constraint meta_produtividade_usuario_fk foreign key (tenant_id, usuario_id) references core.usuario (tenant_id, id),
  constraint meta_produtividade_atualizado_por_fk foreign key (tenant_id, atualizado_por) references core.usuario (tenant_id, id),
  constraint meta_produtividade_escopo_valido check (escopo in ('tenant', 'equipe', 'usuario')),
  constraint meta_produtividade_indicador_valido check (indicador in ('primeiro_checkin', 'ultimo_checkin', 'tma', 'tmd', 'almoco', 'jornada_liquida', 'fora_rota', 'visitas_dia', 'cobertura_rota', 'raio_checkin', 'km_dia', 'km_cliente')),
  constraint meta_produtividade_valor_nao_negativo check (valor >= 0),
  constraint meta_produtividade_vigencia_formato check (vigencia_inicio ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);
create unique index meta_produtividade_vigencia_uk on core.meta_produtividade
  (tenant_id, escopo, coalesce(equipe_id, usuario_id, '00000000-0000-0000-0000-000000000000'::uuid), indicador, vigencia_inicio)
  where deleted_at is null;
create index meta_produtividade_indicador_ix on core.meta_produtividade (tenant_id, indicador, escopo);
create index meta_produtividade_sync_ix on core.meta_produtividade (tenant_id, updated_at, id);
create unique index meta_produtividade_external_uk on core.meta_produtividade (tenant_id, external_id) where external_id is not null and deleted_at is null;
-- Alvo coerente (meta_produtividade_equipe_coerente: equipe_id só e sempre no escopo equipe; meta_produtividade_usuario_coerente:
-- usuario_id só e sempre no escopo usuario): gatilho de restrição AFTER, não CHECK. O CHECK roda na escrita da linha, ANTES da
-- FK (gatilho no fim do comando): apontar equipe_id/usuario_id para linha de outro tenant seria recusado pela coerência (23514)
-- e não pela FK (23503), que é quem prova o isolamento (S0-025, tests/integracao/multitenant/vazamento-escrita.test.ts). Mesma
-- regra, mesmo SQLSTATE (23514) e o nome da regra na mensagem e em CONSTRAINT; o nome em minúsculas ordena o gatilho depois
-- dos da FK ("RI_ConstraintTrigger_*": ordem alfabética).
create function core.meta_produtividade_conferir_alvo() returns trigger
  language plpgsql
  set search_path = pg_catalog, core, pg_temp
  as $$
declare
  v_regra text;
begin
  if (new.escopo = 'equipe') is distinct from (new.equipe_id is not null) then
    v_regra := 'meta_produtividade_equipe_coerente';
  elsif (new.escopo = 'usuario') is distinct from (new.usuario_id is not null) then
    v_regra := 'meta_produtividade_usuario_coerente';
  end if;
  if v_regra is not null then
    raise exception 'new row for relation "%" violates check constraint "%"', tg_table_name, v_regra
      using errcode = 'check_violation', constraint = v_regra, schema = tg_table_schema, table = tg_table_name;
  end if;
  return null;
end
$$;
revoke all on function core.meta_produtividade_conferir_alvo() from public;
create constraint trigger meta_produtividade_conferir_alvo
  after insert or update of escopo, equipe_id, usuario_id on core.meta_produtividade
  for each row execute function core.meta_produtividade_conferir_alvo();
create trigger meta_produtividade_updated_at before update on core.meta_produtividade
  for each row execute function plataforma.definir_updated_at();
alter table core.meta_produtividade enable row level security;
alter table core.meta_produtividade force row level security;
create policy isolamento_tenant on core.meta_produtividade for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
create policy manutencao on core.meta_produtividade for all to macuxi_manutencao using (true) with check (true);
grant select, insert, update on core.meta_produtividade to macuxi_app;

-- =============================================================================================
-- core.deslocamento_dia — resumo diário do km (desenho §5; vazia até o rastreamento da T-0156)
-- =============================================================================================
create table core.deslocamento_dia (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references plataforma.tenant (id),
  usuario_id         uuid not null,
  data               date not null,
  metros             integer not null default 0,
  pontos             integer not null default 0,
  primeiro_ponto_em  timestamptz,
  ultimo_ponto_em    timestamptz,
  origem             text not null default 'rastreamento',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  external_id        text,
  constraint deslocamento_dia_tenant_id_uk unique (tenant_id, id),
  constraint deslocamento_dia_usuario_fk foreign key (tenant_id, usuario_id) references core.usuario (tenant_id, id),
  constraint deslocamento_dia_metros_nao_negativo check (metros >= 0),
  constraint deslocamento_dia_pontos_nao_negativo check (pontos >= 0),
  constraint deslocamento_dia_pontos_par check ((primeiro_ponto_em is null) = (ultimo_ponto_em is null)),
  constraint deslocamento_dia_pontos_ordem check (ultimo_ponto_em is null or ultimo_ponto_em >= primeiro_ponto_em),
  constraint deslocamento_dia_origem_valida check (origem in ('rastreamento'))
);
create unique index deslocamento_dia_uk on core.deslocamento_dia (tenant_id, usuario_id, data) where deleted_at is null;
create index deslocamento_dia_sync_ix on core.deslocamento_dia (tenant_id, updated_at, id);
create index deslocamento_dia_usuario_sync_ix on core.deslocamento_dia (tenant_id, usuario_id, updated_at, id);
create unique index deslocamento_dia_external_uk on core.deslocamento_dia (tenant_id, external_id) where external_id is not null and deleted_at is null;
create trigger deslocamento_dia_updated_at before update on core.deslocamento_dia
  for each row execute function plataforma.definir_updated_at();
alter table core.deslocamento_dia enable row level security;
alter table core.deslocamento_dia force row level security;
create policy isolamento_tenant on core.deslocamento_dia for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
create policy manutencao on core.deslocamento_dia for all to macuxi_manutencao using (true) with check (true);
grant select, insert, update on core.deslocamento_dia to macuxi_app;

-- =============================================================================================
-- core.meta.indicador — 'itens_por_pedido' (desenho §7.4)
-- =============================================================================================
alter table core.meta drop constraint meta_indicador_valido;
alter table core.meta add constraint meta_indicador_valido
  check (indicador in ('venda_cents', 'positivacao', 'cobertura_pct', 'visitas', 'itens_por_pedido'));
