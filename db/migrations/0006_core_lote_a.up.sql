-- 0006_core_lote_a (up) — Sprint 1: T-0017 (carteira e Cliente 360), T-0018 (rotas e visitas), T-0019 (notificações),
-- T-0020 (metas). Especificação: desenho T-0016 §2 e §7; pedido R-20261031-152927-engenheiro-software.
-- Regras: RN-CORE-04 (escopo), RN-CORE-05 (RLS), RN-CORE-10 (raio/justificativa/coordenada sugerida),
-- RN-CORE-11 (um atendimento aberto por usuário), RN-CORE-12/14 (checkout, cliente fechado com motivo e foto),
-- RN-CORE-20..22 (metas e indicadores).
-- Tabelas novas: cliente_contato, cliente_financeiro, titulo, historico_compra, motivo, rota, rota_parada, visita,
-- visita_etapa, notificacao, meta, indicador_diario. Alterações: carteira (frequência de visita), dispositivo (push).
-- Toda tabela: campos comuns, RLS forçado com isolamento_tenant, gatilho de updated_at, índice de sync
-- (tenant_id, updated_at, id), external_id único por tenant e FKs COMPOSTAS (tenant_id, x_id).
-- Padrões semeados em TODO tenant (existentes agora e novos pelo gatilho core.semear_tenant): motivos de sistema
-- loja_fechada e acesso_negado (RN-CORE-14), motivos de não venda da Fase M (editáveis) e os parâmetros do Core
-- checkin.raio_m = 200 e metas.base_apuracao = 'aprovado'. Ids determinísticos: plataforma.uuid_de_chave (0005).
-- Caminho de volta: 0006_core_lote_a.down.sql (APAGA rotas, visitas, títulos, histórico, contatos, financeiro,
-- motivos, notificações, metas e indicadores; tira as colunas novas de carteira/dispositivo e os parâmetros semeados).

-- ---------------------------------------------------------------------------------------------
-- carteira — frequência de visita para a agenda (RF-CORE-05: gerar rotas pela frequência).
alter table core.carteira add column frequencia_semanas smallint;
alter table core.carteira add column dia_semana smallint;
alter table core.carteira add constraint carteira_frequencia_valida check (frequencia_semanas is null or frequencia_semanas in (1, 2, 4));
alter table core.carteira add constraint carteira_dia_semana_valido check (dia_semana is null or dia_semana between 1 and 7);

-- dispositivo — token de push (Expo) do aparelho da sessão (T-0019; PUT dispositivos/atual/push). Fora do sync.
alter table core.dispositivo add column push_token text;
alter table core.dispositivo add column push_plataforma text;
alter table core.dispositivo add column push_atualizado_em timestamptz;
alter table core.dispositivo add constraint dispositivo_push_plataforma_valida check (push_plataforma is null or push_plataforma in ('android'));
alter table core.dispositivo add constraint dispositivo_push_completo check ((push_token is null) = (push_plataforma is null));

-- ---------------------------------------------------------------------------------------------
-- cliente_contato — contatos do cliente (ligar/WhatsApp em 1 toque, RF-CORE-04). Pull por carteira.
create table core.cliente_contato (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references plataforma.tenant (id),
  cliente_id   uuid not null,
  nome         text not null,
  cargo        text,
  telefone     text,
  whatsapp     text,
  email        text,
  principal    boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  external_id  text,
  constraint cliente_contato_cliente_fk foreign key (tenant_id, cliente_id) references core.cliente (tenant_id, id)
);
create index cliente_contato_sync_ix on core.cliente_contato (tenant_id, updated_at, id);
create index cliente_contato_cliente_ix on core.cliente_contato (tenant_id, cliente_id);
create unique index cliente_contato_principal_uk on core.cliente_contato (tenant_id, cliente_id) where principal and deleted_at is null;
create unique index cliente_contato_external_uk on core.cliente_contato (tenant_id, external_id) where external_id is not null and deleted_at is null;
create trigger cliente_contato_updated_at before update on core.cliente_contato
  for each row execute function plataforma.definir_updated_at();
alter table core.cliente_contato enable row level security;
alter table core.cliente_contato force row level security;
create policy isolamento_tenant on core.cliente_contato for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert, update, delete on core.cliente_contato to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- cliente_financeiro — um por cliente (vivo). Valores em centavos (bigint). credito_disponivel_cents nulo =
-- o domínio calcula limite − saldo. Carga pelo Hub (Sprint 2); na Sprint 1, fixture/seed.
create table core.cliente_financeiro (
  id                        uuid primary key default gen_random_uuid(),
  tenant_id                 uuid not null references plataforma.tenant (id),
  cliente_id                uuid not null,
  limite_cents              bigint not null default 0,
  saldo_aberto_cents        bigint not null default 0,
  credito_disponivel_cents  bigint,
  bloqueado                 boolean not null default false,
  motivo_bloqueio           text,
  atualizado_erp_em         timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  deleted_at                timestamptz,
  external_id               text,
  constraint cliente_financeiro_cliente_fk foreign key (tenant_id, cliente_id) references core.cliente (tenant_id, id),
  constraint cliente_financeiro_limite_nao_negativo check (limite_cents >= 0),
  constraint cliente_financeiro_saldo_nao_negativo check (saldo_aberto_cents >= 0)
);
create unique index cliente_financeiro_cliente_uk on core.cliente_financeiro (tenant_id, cliente_id) where deleted_at is null;
create index cliente_financeiro_sync_ix on core.cliente_financeiro (tenant_id, updated_at, id);
create unique index cliente_financeiro_external_uk on core.cliente_financeiro (tenant_id, external_id) where external_id is not null and deleted_at is null;
create trigger cliente_financeiro_updated_at before update on core.cliente_financeiro
  for each row execute function plataforma.definir_updated_at();
alter table core.cliente_financeiro enable row level security;
alter table core.cliente_financeiro force row level security;
create policy isolamento_tenant on core.cliente_financeiro for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert, update, delete on core.cliente_financeiro to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- titulo — títulos a receber do cliente (Cliente 360, filtro "vencidos"). Dono: Core (doc 04); carga pelo Hub.
-- Pull por carteira, janela: abertos + vencimento >= hoje − 90.
create table core.titulo (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references plataforma.tenant (id),
  cliente_id    uuid not null,
  documento     text not null,
  parcela       text,
  emissao       date not null,
  vencimento    date not null,
  valor_cents   bigint not null,
  saldo_cents   bigint not null,
  situacao      text not null default 'aberto',
  liquidado_em  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  external_id   text,
  constraint titulo_cliente_fk foreign key (tenant_id, cliente_id) references core.cliente (tenant_id, id),
  constraint titulo_situacao_valida check (situacao in ('aberto', 'liquidado', 'cancelado')),
  constraint titulo_valor_nao_negativo check (valor_cents >= 0),
  constraint titulo_saldo_nao_negativo check (saldo_cents >= 0)
);
create index titulo_sync_ix on core.titulo (tenant_id, updated_at, id);
create index titulo_cliente_vencimento_ix on core.titulo (tenant_id, cliente_id, vencimento);
create index titulo_abertos_ix on core.titulo (tenant_id, cliente_id, vencimento) where situacao = 'aberto' and deleted_at is null;
create unique index titulo_external_uk on core.titulo (tenant_id, external_id) where external_id is not null and deleted_at is null;
create trigger titulo_updated_at before update on core.titulo
  for each row execute function plataforma.definir_updated_at();
alter table core.titulo enable row level security;
alter table core.titulo force row level security;
create policy isolamento_tenant on core.titulo for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert, update, delete on core.titulo to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- historico_compra — consolidado mensal de compras do cliente (12 meses no aparelho). Um por cliente e mês (vivo).
create table core.historico_compra (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references plataforma.tenant (id),
  cliente_id        uuid not null,
  ano_mes           text not null,
  valor_cents       bigint not null default 0,
  pedidos           integer not null default 0,
  itens             integer not null default 0,
  ultima_compra_em  date,
  origem            text not null default 'erp',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  external_id       text,
  constraint historico_compra_cliente_fk foreign key (tenant_id, cliente_id) references core.cliente (tenant_id, id),
  constraint historico_compra_ano_mes_formato check (ano_mes ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  constraint historico_compra_contagens_nao_negativas check (pedidos >= 0 and itens >= 0),
  constraint historico_compra_origem_valida check (origem in ('erp', 'macuxi'))
);
create unique index historico_compra_mes_uk on core.historico_compra (tenant_id, cliente_id, ano_mes) where deleted_at is null;
create index historico_compra_sync_ix on core.historico_compra (tenant_id, updated_at, id);
create unique index historico_compra_external_uk on core.historico_compra (tenant_id, external_id) where external_id is not null and deleted_at is null;
create trigger historico_compra_updated_at before update on core.historico_compra
  for each row execute function plataforma.definir_updated_at();
alter table core.historico_compra enable row level security;
alter table core.historico_compra force row level security;
create policy isolamento_tenant on core.historico_compra for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert, update, delete on core.historico_compra to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- motivo — motivos de não venda, cliente fechado e fora do raio. Pull do tenant inteiro.
-- RN-CORE-14: todo tenant tem loja_fechada e acesso_negado (tipo cliente_fechado, sistema, exige_foto); motivo de
-- sistema não é removido, desativado nem muda de tipo/código (checks abaixo; a API devolve 422 RN-CORE-14 antes).
create table core.motivo (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references plataforma.tenant (id),
  tipo         text not null,
  codigo       text not null,
  descricao    text not null,
  exige_foto   boolean not null default false,
  sistema      boolean not null default false,
  ativo        boolean not null default true,
  ordem        integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  external_id  text,
  constraint motivo_tenant_id_uk unique (tenant_id, id),
  constraint motivo_tipo_valido check (tipo in ('nao_venda', 'cliente_fechado', 'fora_do_raio')),
  constraint motivo_codigo_formato check (codigo ~ '^[a-z][a-z0-9_]*$'),
  constraint motivo_cliente_fechado_exige_foto check (tipo <> 'cliente_fechado' or exige_foto),
  constraint motivo_sistema_fixo check (
    not sistema
    or (tipo = 'cliente_fechado' and codigo in ('loja_fechada', 'acesso_negado') and exige_foto and ativo and deleted_at is null)
  )
);
create unique index motivo_codigo_uk on core.motivo (tenant_id, tipo, codigo) where deleted_at is null;
create index motivo_sync_ix on core.motivo (tenant_id, updated_at, id);
create unique index motivo_external_uk on core.motivo (tenant_id, external_id) where external_id is not null and deleted_at is null;
create trigger motivo_updated_at before update on core.motivo
  for each row execute function plataforma.definir_updated_at();
alter table core.motivo enable row level security;
alter table core.motivo force row level security;
create policy isolamento_tenant on core.motivo for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert, update, delete on core.motivo to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- rota — rota do dia de um usuário (uma viva por usuário e data). Pull por usuários visíveis,
-- janela data ∈ [hoje − 40, hoje + 30].
create table core.rota (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references plataforma.tenant (id),
  usuario_id   uuid not null,
  data         date not null,
  situacao     text not null default 'planejada',
  origem       text not null default 'bko',
  regiao       text,
  observacao   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  external_id  text,
  constraint rota_tenant_id_uk unique (tenant_id, id),
  -- alvo da FK de rota_parada: garante usuario_id e data da parada iguais aos da rota (on update cascade)
  constraint rota_usuario_data_uk unique (tenant_id, id, usuario_id, data),
  constraint rota_usuario_fk foreign key (tenant_id, usuario_id) references core.usuario (tenant_id, id),
  constraint rota_situacao_valida check (situacao in ('planejada', 'publicada', 'cancelada')),
  constraint rota_origem_valida check (origem in ('bko', 'frequencia', 'erp'))
);
create unique index rota_usuario_dia_uk on core.rota (tenant_id, usuario_id, data) where deleted_at is null;
create index rota_sync_ix on core.rota (tenant_id, updated_at, id);
create index rota_usuario_sync_ix on core.rota (tenant_id, usuario_id, updated_at, id);
create unique index rota_external_uk on core.rota (tenant_id, external_id) where external_id is not null and deleted_at is null;
create trigger rota_updated_at before update on core.rota
  for each row execute function plataforma.definir_updated_at();
alter table core.rota enable row level security;
alter table core.rota force row level security;
create policy isolamento_tenant on core.rota for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert, update, delete on core.rota to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- rota_parada — cliente na rota, em sequência. usuario_id e data DESNORMALIZADOS da rota (pull por usuário sem
-- join): a FK (tenant_id, rota_id, usuario_id, data) -> rota exige que sejam iguais e propaga mudança da rota
-- (on update cascade, o que também move o updated_at da parada). Sequência única por rota entre as vivas, ADIÁVEL
-- (reordenar numa transação: os conflitos intermediários só são conferidos no commit).
create table core.rota_parada (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references plataforma.tenant (id),
  rota_id        uuid not null,
  usuario_id     uuid not null,
  data           date not null,
  cliente_id     uuid not null,
  sequencia      integer not null,
  janela_inicio  time,
  janela_fim     time,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  external_id    text,
  constraint rota_parada_tenant_id_uk unique (tenant_id, id),
  constraint rota_parada_rota_fk foreign key (tenant_id, rota_id, usuario_id, data)
    references core.rota (tenant_id, id, usuario_id, data) on update cascade,
  constraint rota_parada_cliente_fk foreign key (tenant_id, cliente_id) references core.cliente (tenant_id, id),
  constraint rota_parada_sequencia_positiva check (sequencia >= 1),
  constraint rota_parada_janela_valida check (janela_inicio is null or janela_fim is null or janela_fim > janela_inicio),
  constraint rota_parada_sequencia_uk exclude using btree (tenant_id with =, rota_id with =, sequencia with =)
    where (deleted_at is null) deferrable initially deferred
);
create unique index rota_parada_cliente_uk on core.rota_parada (tenant_id, rota_id, cliente_id) where deleted_at is null;
create index rota_parada_sync_ix on core.rota_parada (tenant_id, updated_at, id);
create index rota_parada_usuario_sync_ix on core.rota_parada (tenant_id, usuario_id, updated_at, id);
create index rota_parada_cliente_ix on core.rota_parada (tenant_id, cliente_id);
create unique index rota_parada_external_uk on core.rota_parada (tenant_id, external_id) where external_id is not null and deleted_at is null;
create trigger rota_parada_updated_at before update on core.rota_parada
  for each row execute function plataforma.definir_updated_at();
alter table core.rota_parada enable row level security;
alter table core.rota_parada force row level security;
create policy isolamento_tenant on core.rota_parada for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert, update, delete on core.rota_parada to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- visita — check-in/checkout (id = UUID do aparelho; push idempotente). checkout_id = UUID do comando de checkout
-- (idempotência do push visita_checkout). pedido_id SEM FK (schema vendedor: fronteira). foto_fachada_id ->
-- plataforma.arquivo (FK composta ADIÁVEL, inicialmente imediata: a API pode registrar o arquivo depois do update
-- com `set constraints core.visita_foto_fachada_fk deferred`).
-- RN-CORE-11: no máximo UMA visita aberta (checkout_em nulo) e viva por usuário — índice único parcial.
-- RN-CORE-10: fora do raio exige justificativa. RN-CORE-14: cliente fechado exige motivo e foto da fachada.
create table core.visita (
  id                       uuid primary key default gen_random_uuid(),
  tenant_id                uuid not null references plataforma.tenant (id),
  usuario_id               uuid not null,
  cliente_id               uuid not null,
  rota_parada_id           uuid,
  data_local               date not null,
  checkin_em               timestamptz not null,
  checkin_lat              numeric(9, 6),
  checkin_lng              numeric(9, 6),
  checkin_precisao_m       integer,
  sem_gps                  boolean not null default false,
  distancia_m              integer,
  fora_do_raio             boolean not null default false,
  justificativa_fora_raio  text,
  sugere_coordenada        boolean not null default false,
  extra                    boolean not null default false,
  checkout_id              uuid,
  checkout_em              timestamptz,
  checkout_lat             numeric(9, 6),
  checkout_lng             numeric(9, 6),
  resultado                text,
  motivo_id                uuid,
  motivo_texto             text,
  pedido_id                uuid,
  foto_fachada_id          uuid,
  fechada_por              text,
  recebido_em              timestamptz not null default now(),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  deleted_at               timestamptz,
  external_id              text,
  constraint visita_tenant_id_uk unique (tenant_id, id),
  constraint visita_usuario_fk foreign key (tenant_id, usuario_id) references core.usuario (tenant_id, id),
  constraint visita_cliente_fk foreign key (tenant_id, cliente_id) references core.cliente (tenant_id, id),
  constraint visita_rota_parada_fk foreign key (tenant_id, rota_parada_id) references core.rota_parada (tenant_id, id),
  constraint visita_motivo_fk foreign key (tenant_id, motivo_id) references core.motivo (tenant_id, id),
  constraint visita_foto_fachada_fk foreign key (tenant_id, foto_fachada_id) references plataforma.arquivo (tenant_id, id)
    deferrable initially immediate,
  constraint visita_resultado_valido check (resultado is null or resultado in ('atendido', 'pedido', 'sem_pedido', 'cliente_fechado', 'nao_finalizado')),
  constraint visita_fechada_por_valida check (fechada_por is null or fechada_por in ('usuario', 'auto')),
  constraint visita_checkout_depois_do_checkin check (checkout_em is null or checkout_em >= checkin_em),
  constraint visita_fechamento_completo check ((checkout_em is null) = (resultado is null) and (checkout_em is null) = (fechada_por is null)),
  constraint visita_fora_do_raio_justificado check (not fora_do_raio or nullif(btrim(justificativa_fora_raio), '') is not null),
  constraint visita_cliente_fechado_motivo_foto check (resultado is distinct from 'cliente_fechado' or (motivo_id is not null and foto_fachada_id is not null)),
  constraint visita_checkin_coordenada_par check ((checkin_lat is null) = (checkin_lng is null)),
  constraint visita_checkout_coordenada_par check ((checkout_lat is null) = (checkout_lng is null)),
  constraint visita_sem_gps_sem_coordenada check (not sem_gps or checkin_lat is null),
  constraint visita_checkin_lat_faixa check (checkin_lat is null or checkin_lat between -90 and 90),
  constraint visita_checkin_lng_faixa check (checkin_lng is null or checkin_lng between -180 and 180),
  constraint visita_checkout_lat_faixa check (checkout_lat is null or checkout_lat between -90 and 90),
  constraint visita_checkout_lng_faixa check (checkout_lng is null or checkout_lng between -180 and 180),
  constraint visita_medidas_nao_negativas check ((distancia_m is null or distancia_m >= 0) and (checkin_precisao_m is null or checkin_precisao_m >= 0))
);
create unique index visita_aberta_uk on core.visita (tenant_id, usuario_id) where checkout_em is null and deleted_at is null;
create unique index visita_checkout_uk on core.visita (tenant_id, checkout_id) where checkout_id is not null;
create index visita_sync_ix on core.visita (tenant_id, updated_at, id);
create index visita_usuario_sync_ix on core.visita (tenant_id, usuario_id, updated_at, id);
create index visita_cliente_ix on core.visita (tenant_id, cliente_id, checkin_em desc);
create index visita_usuario_dia_ix on core.visita (tenant_id, usuario_id, data_local);
create index visita_sugere_coordenada_ix on core.visita (tenant_id, cliente_id, checkin_em desc) where sugere_coordenada and deleted_at is null;
create index visita_rota_parada_ix on core.visita (tenant_id, rota_parada_id) where rota_parada_id is not null;
create unique index visita_external_uk on core.visita (tenant_id, external_id) where external_id is not null and deleted_at is null;
create trigger visita_updated_at before update on core.visita
  for each row execute function plataforma.definir_updated_at();
alter table core.visita enable row level security;
alter table core.visita force row level security;
create policy isolamento_tenant on core.visita for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert, update, delete on core.visita to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- visita_etapa — etapas do checkout registradas pelos módulos (slot visita.etapas_checkout). Gravada pelo push do
-- checkout (uma por etapa, idempotente pelo único); sem provedor de pull na Sprint 1 (leitura no BKO).
create table core.visita_etapa (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references plataforma.tenant (id),
  visita_id      uuid not null,
  modulo         text not null,
  etapa          text not null,
  situacao       text not null,
  referencia_id  uuid,
  registrada_em  timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  external_id    text,
  constraint visita_etapa_uk unique (tenant_id, visita_id, modulo, etapa),
  constraint visita_etapa_visita_fk foreign key (tenant_id, visita_id) references core.visita (tenant_id, id),
  constraint visita_etapa_modulo_formato check (modulo ~ '^[a-z][a-z0-9-]*$'),
  constraint visita_etapa_etapa_formato check (etapa ~ '^[a-z][a-z0-9_.-]*$'),
  constraint visita_etapa_situacao_valida check (situacao in ('concluida', 'dispensada'))
);
create index visita_etapa_sync_ix on core.visita_etapa (tenant_id, updated_at, id);
create unique index visita_etapa_external_uk on core.visita_etapa (tenant_id, external_id) where external_id is not null and deleted_at is null;
create trigger visita_etapa_updated_at before update on core.visita_etapa
  for each row execute function plataforma.definir_updated_at();
alter table core.visita_etapa enable row level security;
alter table core.visita_etapa force row level security;
create policy isolamento_tenant on core.visita_etapa for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert, update, delete on core.visita_etapa to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- notificacao — caixa do usuário (RF-CORE-09). Pull só do próprio usuário (janela: criada >= hoje − 30 e não
-- expirada). Idempotência: por evento de origem (consumidor) e por envio do BKO (envio_id), cada um único por
-- usuário quando preenchido. Leitura pelo push notificacao_leitura: lida_em = coalesce(lida_em, payload.lida_em).
create table core.notificacao (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references plataforma.tenant (id),
  usuario_id        uuid not null,
  tipo              text not null,
  titulo            text not null,
  corpo             text not null,
  link              text,
  origem_modulo     text not null default 'core',
  origem_evento_id  uuid,
  envio_id          uuid,
  autor_id          uuid,
  prioridade        text not null default 'normal',
  lida_em           timestamptz,
  expira_em         timestamptz,
  push_enviado_em   timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  external_id       text,
  constraint notificacao_usuario_fk foreign key (tenant_id, usuario_id) references core.usuario (tenant_id, id),
  constraint notificacao_autor_fk foreign key (tenant_id, autor_id) references core.usuario (tenant_id, id),
  constraint notificacao_tipo_valido check (tipo in ('recado', 'sistema', 'pedido', 'treinamento', 'trade')),
  constraint notificacao_prioridade_valida check (prioridade in ('normal', 'alta')),
  constraint notificacao_titulo_tamanho check (char_length(titulo) between 1 and 120),
  constraint notificacao_corpo_tamanho check (char_length(corpo) <= 1000),
  constraint notificacao_link_formato check (link is null or link ~ '^/m/[a-z0-9-]+'),
  constraint notificacao_origem_modulo_formato check (origem_modulo ~ '^[a-z][a-z0-9-]*$')
);
create index notificacao_sync_ix on core.notificacao (tenant_id, updated_at, id);
create index notificacao_usuario_sync_ix on core.notificacao (tenant_id, usuario_id, updated_at, id);
create index notificacao_nao_lidas_ix on core.notificacao (tenant_id, usuario_id, created_at desc) where lida_em is null and deleted_at is null;
create unique index notificacao_evento_uk on core.notificacao (tenant_id, usuario_id, origem_evento_id) where origem_evento_id is not null;
create unique index notificacao_envio_uk on core.notificacao (tenant_id, usuario_id, envio_id) where envio_id is not null;
create unique index notificacao_external_uk on core.notificacao (tenant_id, external_id) where external_id is not null and deleted_at is null;
create trigger notificacao_updated_at before update on core.notificacao
  for each row execute function plataforma.definir_updated_at();
alter table core.notificacao enable row level security;
alter table core.notificacao force row level security;
create policy isolamento_tenant on core.notificacao for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert, update, delete on core.notificacao to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- meta — meta mensal por usuário e indicador (RN-CORE-20..22). valor inteiro: centavos (venda_cents),
-- contagem (positivacao, visitas) ou pontos-base (cobertura_pct). Pull por usuários visíveis (periodo >= mês anterior).
create table core.meta (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references plataforma.tenant (id),
  usuario_id   uuid not null,
  periodo      text not null,
  indicador    text not null,
  valor        bigint not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  external_id  text,
  constraint meta_usuario_fk foreign key (tenant_id, usuario_id) references core.usuario (tenant_id, id),
  constraint meta_periodo_formato check (periodo ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  constraint meta_indicador_valido check (indicador in ('venda_cents', 'positivacao', 'cobertura_pct', 'visitas')),
  constraint meta_valor_nao_negativo check (valor >= 0),
  constraint meta_cobertura_pontos_base check (indicador <> 'cobertura_pct' or valor <= 10000)
);
create unique index meta_uk on core.meta (tenant_id, usuario_id, periodo, indicador) where deleted_at is null;
create index meta_sync_ix on core.meta (tenant_id, updated_at, id);
create index meta_usuario_sync_ix on core.meta (tenant_id, usuario_id, updated_at, id);
create unique index meta_external_uk on core.meta (tenant_id, external_id) where external_id is not null and deleted_at is null;
create trigger meta_updated_at before update on core.meta
  for each row execute function plataforma.definir_updated_at();
alter table core.meta enable row level security;
alter table core.meta force row level security;
create policy isolamento_tenant on core.meta for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert, update, delete on core.meta to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- indicador_diario — read-model diário de vendas por usuário (lote B do §7, criado agora a pedido do gerente; o
-- consumidor de vendedor.pedido.* que o alimenta vem com o despachante, T-0021). usuario_id = vendedor
-- (RN-CORE-21: pedido em nome conta para o vendedor). data = dia no fuso do tenant. Sem provedor de pull na Sprint 1.
create table core.indicador_diario (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references plataforma.tenant (id),
  usuario_id       uuid not null,
  data             date not null,
  pedidos          integer not null default 0,
  vendido_cents    bigint not null default 0,
  cancelado_cents  bigint not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  external_id      text,
  constraint indicador_diario_usuario_fk foreign key (tenant_id, usuario_id) references core.usuario (tenant_id, id),
  constraint indicador_diario_nao_negativos check (pedidos >= 0 and vendido_cents >= 0 and cancelado_cents >= 0)
);
create unique index indicador_diario_uk on core.indicador_diario (tenant_id, usuario_id, data) where deleted_at is null;
create index indicador_diario_sync_ix on core.indicador_diario (tenant_id, updated_at, id);
create unique index indicador_diario_external_uk on core.indicador_diario (tenant_id, external_id) where external_id is not null and deleted_at is null;
create trigger indicador_diario_updated_at before update on core.indicador_diario
  for each row execute function plataforma.definir_updated_at();
alter table core.indicador_diario enable row level security;
alter table core.indicador_diario force row level security;
create policy isolamento_tenant on core.indicador_diario for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert, update, delete on core.indicador_diario to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- Padrões do Core em todo tenant (RN-CORE-14; desenho T-0016 §7). Ids determinísticos (plataforma.uuid_de_chave):
--   motivo:    '<tenant_id>:core.motivo:<tipo>:<codigo>'
--   parâmetro: '<tenant_id>:plataforma.parametro:core:<chave>'
-- `on conflict do nothing` (sem alvo) cobre os únicos parciais: rodar de novo não duplica nem sobrescreve o que o
-- tenant editou. Com FORCE RLS, o contexto do tenant é ligado só durante a semeadura e restaurado no fim (o
-- gatilho roda como quem insere o tenant — o executor/admin; o macuxi_app não insere tenant).
create function core.semear_padroes(p_tenant uuid) returns void
  language plpgsql
  as $$
declare
  v_contexto text := current_setting('app.tenant_id', true);
begin
  perform set_config('app.tenant_id', p_tenant::text, true);
  insert into core.motivo (id, tenant_id, tipo, codigo, descricao, exige_foto, sistema, ativo, ordem)
  select plataforma.uuid_de_chave(p_tenant::text || ':core.motivo:' || m.tipo || ':' || m.codigo),
         p_tenant, m.tipo, m.codigo, m.descricao, m.exige_foto, m.sistema, true, m.ordem
    from (values
      ('cliente_fechado', 'loja_fechada',       'Loja fechada',                true,  true,  1),
      ('cliente_fechado', 'acesso_negado',      'Acesso negado',               true,  true,  2),
      ('nao_venda',       'estoque_alto',       'Estoque alto',                false, false, 1),
      ('nao_venda',       'comprador_ausente',  'Comprador ausente',           false, false, 2),
      ('nao_venda',       'sem_limite_credito', 'Sem limite de crédito',       false, false, 3),
      ('nao_venda',       'preco_concorrente',  'Preço acima do concorrente',  false, false, 4),
      ('nao_venda',       'outro',              'Outro',                       false, false, 9)
    ) as m (tipo, codigo, descricao, exige_foto, sistema, ordem)
  on conflict do nothing;
  insert into plataforma.parametro (id, tenant_id, modulo, chave, valor)
  select plataforma.uuid_de_chave(p_tenant::text || ':plataforma.parametro:core:' || p.chave), p_tenant, 'core', p.chave, p.valor
    from (values
      ('checkin.raio_m',       '200'::jsonb),
      ('metas.base_apuracao',  '"aprovado"'::jsonb)
    ) as p (chave, valor)
  on conflict do nothing;
  perform set_config('app.tenant_id', coalesce(v_contexto, ''), true);
end
$$;
revoke all on function core.semear_padroes(uuid) from public;

create function core.semear_tenant() returns trigger
  language plpgsql
  as $$
begin
  perform core.semear_padroes(new.id);
  return null;
end
$$;
revoke all on function core.semear_tenant() from public;

create trigger tenant_semear_core after insert on plataforma.tenant
  for each row execute function core.semear_tenant();

-- tenants que já existem
select core.semear_padroes(t.id) from plataforma.tenant t;
