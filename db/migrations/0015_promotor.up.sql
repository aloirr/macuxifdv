-- 0015_promotor (up) — schema do módulo Promotor (trade marketing): visita de loja, coletas e cadastros de trade.
-- Pedido R-20261102-131328-2-modulo-promotor (T-0056) e desenho em docs/modulos/promotor/coletas.md §4; contratos em
-- modules/promotor/contracts/{coletas,cadastros,entidades}.ts; regras RN-PRO-01..11 (doc 03). Dicionário: docs/banco/promotor.md.
--
-- COLETAS (push do aparelho, idempotentes pelo id gerado no aparelho): uma tabela por entidade de sync
-- (visita_loja, foto_coleta, checklist_resposta, gondola_registro, medicao_share, coleta_preco, ruptura_item, validade_item,
-- ponto_extra, acao_concorrencia, tarefa_execucao). Cada linha guarda o PAYLOAD do contrato exatamente como aceito pela API
-- (jsonb) — é a fonte da verdade e a base da idempotência do reenvio (mesmoConteudo do domain compara o payload; uma volta
-- por timestamptz/numeric mudaria o texto e daria conflito falso). As colunas tipadas que relatórios, índices e CHECKs usam
-- são DERIVADAS do payload por um gatilho BEFORE INSERT OR UPDATE por tabela (promotor.derivar_<tabela>): o gatilho
-- SEMPRE sobrescreve o que vier nelas, então há uma fonte só, sem divergência, e a API grava só
-- (id, tenant_id, promotor_id, [cliente_id,] payload, recebido_em). Não são GENERATED ALWAYS de propósito: coluna gerada
-- recusa valor explícito no INSERT (428C9) e os testes de isolamento (db/testes/vazamento.test.ts e
-- tests/integracao/multitenant/vazamento-escrita.test.ts) copiam linhas inteiras com INSERT ... SELECT para provar o RLS.
-- Instantes e datas do payload passam por promotor.instante_iso/data_iso (IMMUTABLE, só aceitam ISO 8601 em UTC "…Z" e
-- "AAAA-MM-DD"; outro formato vira nulo e o CHECK de obrigatório recusa com 23514).
--   - promotor_id = quem enviou (token); cliente_id = loja da visita. FK composta (tenant_id, visita_loja_id, promotor_id,
--     cliente_id) -> visita_loja: a coleta é da visita, do mesmo promotor e da mesma loja (RN-PRO-02, RN-CORE-04).
--   - Sem FK da coleta para os cadastros de trade (*_id da versão vigente, RN-PRO-10): o aparelho pode mandar o id de uma
--     versão que o BKO já removeu; o banco não recusa (a API decide). Nenhuma FK para outro schema (fronteira, ADR 0012):
--     cliente_id, promotor_id, produto_id, visita_id e arquivo_id são validados pela API via contratos/consultas do Core.
--   - App: select e insert nas coletas (somente inserção); visita_loja também UPDATE, mas só da coluna payload (o checkout
--     troca o payload; o gatilho rederiva as colunas). Sem DELETE em nenhuma tabela do schema.
-- CADASTROS DE TRADE (pull, servidor vence; BKO de trade RF-PRO-11): categoria_gondola, checklist_loja (itens em jsonb),
-- mix_obrigatorio, meta_share, concorrente, produto_concorrente, foto_referencia, tarefa_trade, ponto_extra_negociado — as
-- colunas das linhas de contracts/cadastros.ts. Alvo (RN-PRO-10): cliente_id (loja) OU segmento OU nenhum (todas as lojas);
-- vigência por data civil no fuso do tenant. Sem DELETE para a aplicação: removido = deleted_at (o pull leva a lápide).
-- Listas fechadas = código do Promotor (conferidas em db/testes/promotor.test.ts): desfecho = DESFECHOS_VISITA,
-- conformidade = CONFORMIDADES, status de presença = STATUS_PRESENCA, tipo de ponto extra = TIPOS_PONTO_EXTRA,
-- tipo de foto = TIPOS_FOTO, etapa do checklist = TIPOS_ETAPA_CHECKLIST (dentro do jsonb, conferido pela API).
-- RN-PRO-01: nada aqui fala de pedido (nenhuma tabela, coluna ou função com "pedido").
-- macuxi_worker: nenhum privilégio (os eventos promotor.*@1 vão pela outbox da plataforma, ADR 0007).
-- Licença do módulo na demo: seed db/seeds/demo/promotor.ts (não é dado de migração).
-- Caminho de volta: 0015_promotor.down.sql (DROP SCHEMA promotor CASCADE — APAGA coletas, fotos (metadados) e cadastros).

create schema promotor;
grant usage on schema promotor to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- Conversões do payload (o cast text -> timestamptz/date é só STABLE porque depende de TimeZone/DateStyle). Aqui o formato
-- é travado por expressão regular: com "Z" explícito (UTC) e data ISO, o resultado não depende de configuração da sessão
-- (por isso IMMUTABLE: servem também a índice de expressão). Fora do formato = nulo (o CHECK da coluna recusa).
create function promotor.instante_iso(p text) returns timestamptz
  language sql immutable strict parallel safe
  as $$ select case when p ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z$' then p::timestamptz end $$;
create function promotor.data_iso(p text) returns date
  language sql immutable strict parallel safe
  as $$ select case when p ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then p::date end $$;
revoke all on function promotor.instante_iso(text) from public;
revoke all on function promotor.data_iso(text) from public;
grant execute on function promotor.instante_iso(text) to macuxi_app;
grant execute on function promotor.data_iso(text) to macuxi_app;

-- =============================================================================================
-- CADASTROS DE TRADE (pull, escopo tenant; volume baixo: dezenas a poucos milhares por tenant)
-- =============================================================================================

-- categoria_gondola — categorias de gôndola (share, gôndola, mix). Nome único entre as vivas (sem diferenciar maiúsculas).
create table promotor.categoria_gondola (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references plataforma.tenant (id),
  nome         text not null,
  ordem        integer not null default 0,
  ativo        boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  external_id  text,
  constraint categoria_gondola_tenant_id_uk unique (tenant_id, id),
  constraint categoria_gondola_nome_valido check (btrim(nome) <> '' and char_length(nome) <= 120)
);
create unique index categoria_gondola_nome_uk on promotor.categoria_gondola (tenant_id, lower(nome)) where deleted_at is null;
create index categoria_gondola_sync_ix on promotor.categoria_gondola (tenant_id, updated_at, id);
create unique index categoria_gondola_external_uk on promotor.categoria_gondola (tenant_id, external_id) where external_id is not null and deleted_at is null;
create trigger categoria_gondola_updated_at before update on promotor.categoria_gondola
  for each row execute function plataforma.definir_updated_at();
alter table promotor.categoria_gondola enable row level security;
alter table promotor.categoria_gondola force row level security;
create policy isolamento_tenant on promotor.categoria_gondola for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert, update on promotor.categoria_gondola to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- checklist_loja — modelo de checklist da loja, uma linha por versão (RN-PRO-10), itens embutidos (ChecklistItem[]:
-- id, rotulo, tipo, obrigatoria (RN-PRO-06), ordem, categoria_gondola_id). VisitaLoja.checklist_modelo_id aponta para cá.
-- Uma versão por (alvo, início) entre as vivas: a visita guarda UM checklist vigente, dois empatados seriam ambíguos.
create table promotor.checklist_loja (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references plataforma.tenant (id),
  cliente_id       uuid,
  segmento         text,
  vigencia_inicio  date not null,
  vigencia_fim     date,
  nome             text not null,
  itens            jsonb not null default '[]'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  external_id      text,
  constraint checklist_loja_tenant_id_uk unique (tenant_id, id),
  constraint checklist_loja_alvo_unico check (cliente_id is null or segmento is null),
  constraint checklist_loja_segmento_preenchido check (segmento is null or (btrim(segmento) <> '' and char_length(segmento) <= 120)),
  constraint checklist_loja_vigencia check (vigencia_fim is null or vigencia_fim >= vigencia_inicio),
  constraint checklist_loja_nome_valido check (btrim(nome) <> '' and char_length(nome) <= 120),
  constraint checklist_loja_itens_lista check (jsonb_typeof(itens) = 'array')
);
create unique index checklist_loja_versao_uk on promotor.checklist_loja (tenant_id, cliente_id, lower(segmento), vigencia_inicio) nulls not distinct where deleted_at is null;
create index checklist_loja_cliente_ix on promotor.checklist_loja (tenant_id, cliente_id) where cliente_id is not null;
create index checklist_loja_sync_ix on promotor.checklist_loja (tenant_id, updated_at, id);
create unique index checklist_loja_external_uk on promotor.checklist_loja (tenant_id, external_id) where external_id is not null and deleted_at is null;
create trigger checklist_loja_updated_at before update on promotor.checklist_loja
  for each row execute function plataforma.definir_updated_at();
alter table promotor.checklist_loja enable row level security;
alter table promotor.checklist_loja force row level security;
create policy isolamento_tenant on promotor.checklist_loja for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert, update on promotor.checklist_loja to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- mix_obrigatorio — produto (core.produto, por id) que precisa estar na gôndola das lojas do alvo (RN-PRO-05).
-- Uma versão por (produto, alvo, início) entre as vivas: duas versões empatadas deixariam a vigente ambígua (RN-PRO-10).
create table promotor.mix_obrigatorio (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references plataforma.tenant (id),
  cliente_id            uuid,
  segmento              text,
  vigencia_inicio       date not null,
  vigencia_fim          date,
  produto_id            uuid not null,
  categoria_gondola_id  uuid,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz,
  external_id           text,
  constraint mix_obrigatorio_tenant_id_uk unique (tenant_id, id),
  constraint mix_obrigatorio_categoria_fk foreign key (tenant_id, categoria_gondola_id) references promotor.categoria_gondola (tenant_id, id),
  constraint mix_obrigatorio_alvo_unico check (cliente_id is null or segmento is null),
  constraint mix_obrigatorio_segmento_preenchido check (segmento is null or (btrim(segmento) <> '' and char_length(segmento) <= 120)),
  constraint mix_obrigatorio_vigencia check (vigencia_fim is null or vigencia_fim >= vigencia_inicio)
);
create unique index mix_obrigatorio_versao_uk on promotor.mix_obrigatorio (tenant_id, produto_id, cliente_id, lower(segmento), vigencia_inicio) nulls not distinct where deleted_at is null;
create index mix_obrigatorio_cliente_ix on promotor.mix_obrigatorio (tenant_id, cliente_id) where cliente_id is not null;
create index mix_obrigatorio_sync_ix on promotor.mix_obrigatorio (tenant_id, updated_at, id);
create unique index mix_obrigatorio_external_uk on promotor.mix_obrigatorio (tenant_id, external_id) where external_id is not null and deleted_at is null;
create trigger mix_obrigatorio_updated_at before update on promotor.mix_obrigatorio
  for each row execute function plataforma.definir_updated_at();
alter table promotor.mix_obrigatorio enable row level security;
alter table promotor.mix_obrigatorio force row level security;
create policy isolamento_tenant on promotor.mix_obrigatorio for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert, update on promotor.mix_obrigatorio to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- meta_share — meta de share (%) da categoria nas lojas do alvo (RN-PRO-03). Uma versão por (categoria, alvo, início).
create table promotor.meta_share (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references plataforma.tenant (id),
  cliente_id            uuid,
  segmento              text,
  vigencia_inicio       date not null,
  vigencia_fim          date,
  categoria_gondola_id  uuid not null,
  meta_pct              numeric(5, 2) not null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz,
  external_id           text,
  constraint meta_share_tenant_id_uk unique (tenant_id, id),
  constraint meta_share_categoria_fk foreign key (tenant_id, categoria_gondola_id) references promotor.categoria_gondola (tenant_id, id),
  constraint meta_share_alvo_unico check (cliente_id is null or segmento is null),
  constraint meta_share_segmento_preenchido check (segmento is null or (btrim(segmento) <> '' and char_length(segmento) <= 120)),
  constraint meta_share_vigencia check (vigencia_fim is null or vigencia_fim >= vigencia_inicio),
  constraint meta_share_pct_faixa check (meta_pct between 0 and 100)
);
create unique index meta_share_versao_uk on promotor.meta_share (tenant_id, categoria_gondola_id, cliente_id, lower(segmento), vigencia_inicio) nulls not distinct where deleted_at is null;
create index meta_share_cliente_ix on promotor.meta_share (tenant_id, cliente_id) where cliente_id is not null;
create index meta_share_sync_ix on promotor.meta_share (tenant_id, updated_at, id);
create unique index meta_share_external_uk on promotor.meta_share (tenant_id, external_id) where external_id is not null and deleted_at is null;
create trigger meta_share_updated_at before update on promotor.meta_share
  for each row execute function plataforma.definir_updated_at();
alter table promotor.meta_share enable row level security;
alter table promotor.meta_share force row level security;
create policy isolamento_tenant on promotor.meta_share for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert, update on promotor.meta_share to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- concorrente — concorrentes monitorados (preço, ações da concorrência RF-PRO-09). Nome único entre os vivos.
create table promotor.concorrente (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references plataforma.tenant (id),
  nome         text not null,
  ativo        boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  external_id  text,
  constraint concorrente_tenant_id_uk unique (tenant_id, id),
  constraint concorrente_nome_valido check (btrim(nome) <> '' and char_length(nome) <= 120)
);
create unique index concorrente_nome_uk on promotor.concorrente (tenant_id, lower(nome)) where deleted_at is null;
create index concorrente_sync_ix on promotor.concorrente (tenant_id, updated_at, id);
create unique index concorrente_external_uk on promotor.concorrente (tenant_id, external_id) where external_id is not null and deleted_at is null;
create trigger concorrente_updated_at before update on promotor.concorrente
  for each row execute function plataforma.definir_updated_at();
alter table promotor.concorrente enable row level security;
alter table promotor.concorrente force row level security;
create policy isolamento_tenant on promotor.concorrente for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert, update on promotor.concorrente to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- produto_concorrente — produto do concorrente comparado a um produto nosso (produto_id; índice de preço RN-PRO-04).
create table promotor.produto_concorrente (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references plataforma.tenant (id),
  concorrente_id        uuid not null,
  nome                  text not null,
  produto_id            uuid,
  categoria_gondola_id  uuid,
  ativo                 boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz,
  external_id           text,
  constraint produto_concorrente_tenant_id_uk unique (tenant_id, id),
  constraint produto_concorrente_concorrente_fk foreign key (tenant_id, concorrente_id) references promotor.concorrente (tenant_id, id),
  constraint produto_concorrente_categoria_fk foreign key (tenant_id, categoria_gondola_id) references promotor.categoria_gondola (tenant_id, id),
  constraint produto_concorrente_nome_valido check (btrim(nome) <> '' and char_length(nome) <= 200)
);
create unique index produto_concorrente_nome_uk on promotor.produto_concorrente (tenant_id, concorrente_id, lower(nome)) where deleted_at is null;
create index produto_concorrente_produto_ix on promotor.produto_concorrente (tenant_id, produto_id) where produto_id is not null;
create index produto_concorrente_sync_ix on promotor.produto_concorrente (tenant_id, updated_at, id);
create unique index produto_concorrente_external_uk on promotor.produto_concorrente (tenant_id, external_id) where external_id is not null and deleted_at is null;
create trigger produto_concorrente_updated_at before update on promotor.produto_concorrente
  for each row execute function plataforma.definir_updated_at();
alter table promotor.produto_concorrente enable row level security;
alter table promotor.produto_concorrente force row level security;
create policy isolamento_tenant on promotor.produto_concorrente for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert, update on promotor.produto_concorrente to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- foto_referencia — foto/planograma de referência da categoria (arquivo_id = plataforma.arquivo, ADR 0010; sem FK).
create table promotor.foto_referencia (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references plataforma.tenant (id),
  cliente_id            uuid,
  segmento              text,
  vigencia_inicio       date not null,
  vigencia_fim          date,
  categoria_gondola_id  uuid not null,
  arquivo_id            uuid not null,
  descricao             text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz,
  external_id           text,
  constraint foto_referencia_tenant_id_uk unique (tenant_id, id),
  constraint foto_referencia_categoria_fk foreign key (tenant_id, categoria_gondola_id) references promotor.categoria_gondola (tenant_id, id),
  constraint foto_referencia_alvo_unico check (cliente_id is null or segmento is null),
  constraint foto_referencia_segmento_preenchido check (segmento is null or (btrim(segmento) <> '' and char_length(segmento) <= 120)),
  constraint foto_referencia_vigencia check (vigencia_fim is null or vigencia_fim >= vigencia_inicio),
  constraint foto_referencia_descricao_tamanho check (descricao is null or char_length(descricao) <= 300)
);
create index foto_referencia_categoria_ix on promotor.foto_referencia (tenant_id, categoria_gondola_id);
create index foto_referencia_sync_ix on promotor.foto_referencia (tenant_id, updated_at, id);
create unique index foto_referencia_external_uk on promotor.foto_referencia (tenant_id, external_id) where external_id is not null and deleted_at is null;
create trigger foto_referencia_updated_at before update on promotor.foto_referencia
  for each row execute function plataforma.definir_updated_at();
alter table promotor.foto_referencia enable row level security;
alter table promotor.foto_referencia force row level security;
create policy isolamento_tenant on promotor.foto_referencia for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert, update on promotor.foto_referencia to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- tarefa_trade — tarefa pontual de campanha (RF-PRO-10): comprovação por foto, prazo opcional (data civil).
create table promotor.tarefa_trade (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references plataforma.tenant (id),
  cliente_id       uuid,
  segmento         text,
  vigencia_inicio  date not null,
  vigencia_fim     date,
  titulo           text not null,
  instrucao        text,
  prazo            date,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  external_id      text,
  constraint tarefa_trade_tenant_id_uk unique (tenant_id, id),
  constraint tarefa_trade_alvo_unico check (cliente_id is null or segmento is null),
  constraint tarefa_trade_segmento_preenchido check (segmento is null or (btrim(segmento) <> '' and char_length(segmento) <= 120)),
  constraint tarefa_trade_vigencia check (vigencia_fim is null or vigencia_fim >= vigencia_inicio),
  constraint tarefa_trade_titulo_valido check (btrim(titulo) <> '' and char_length(titulo) <= 160),
  constraint tarefa_trade_instrucao_tamanho check (instrucao is null or char_length(instrucao) <= 1000)
);
create index tarefa_trade_cliente_ix on promotor.tarefa_trade (tenant_id, cliente_id) where cliente_id is not null;
create index tarefa_trade_sync_ix on promotor.tarefa_trade (tenant_id, updated_at, id);
create unique index tarefa_trade_external_uk on promotor.tarefa_trade (tenant_id, external_id) where external_id is not null and deleted_at is null;
create trigger tarefa_trade_updated_at before update on promotor.tarefa_trade
  for each row execute function plataforma.definir_updated_at();
alter table promotor.tarefa_trade enable row level security;
alter table promotor.tarefa_trade force row level security;
create policy isolamento_tenant on promotor.tarefa_trade for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert, update on promotor.tarefa_trade to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- ponto_extra_negociado — ponto extra combinado com a loja (RF-PRO-08), com vigência; conferido pela coleta ponto_extra.
create table promotor.ponto_extra_negociado (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references plataforma.tenant (id),
  cliente_id       uuid not null,
  tipo             text not null,
  local_combinado  text not null,
  produto_id       uuid,
  vigencia_inicio  date not null,
  vigencia_fim     date,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  external_id      text,
  constraint ponto_extra_negociado_tenant_id_uk unique (tenant_id, id),
  constraint ponto_extra_negociado_tipo_valido check (tipo in ('ponta_gondola', 'ilha', 'display', 'cartaz', 'checkout', 'outro')),
  constraint ponto_extra_negociado_local_valido check (btrim(local_combinado) <> '' and char_length(local_combinado) <= 500),
  constraint ponto_extra_negociado_vigencia check (vigencia_fim is null or vigencia_fim >= vigencia_inicio)
);
create index ponto_extra_negociado_cliente_ix on promotor.ponto_extra_negociado (tenant_id, cliente_id);
create index ponto_extra_negociado_sync_ix on promotor.ponto_extra_negociado (tenant_id, updated_at, id);
create unique index ponto_extra_negociado_external_uk on promotor.ponto_extra_negociado (tenant_id, external_id) where external_id is not null and deleted_at is null;
create trigger ponto_extra_negociado_updated_at before update on promotor.ponto_extra_negociado
  for each row execute function plataforma.definir_updated_at();
alter table promotor.ponto_extra_negociado enable row level security;
alter table promotor.ponto_extra_negociado force row level security;
create policy isolamento_tenant on promotor.ponto_extra_negociado for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert, update on promotor.ponto_extra_negociado to macuxi_app;

-- =============================================================================================
-- COLETAS (push do aparelho). Volume: ~8 visitas por promotor/dia, ~40 coletas por visita.
-- =============================================================================================

-- visita_loja — a visita de loja do promotor (RF-PRO-02): o mesmo id chega aberto no check-in e fechado no checkout
-- (app_edita_ate_status). payload = VisitaLoja (contracts/coletas.ts) como guardada pela API (sem promotor_id, que vem do
-- token). Consultas: por id com FOR UPDATE (envios simultâneos viram um); visitas do período pela data local do check-in
-- (a API converte o período do fuso do tenant em instantes UTC e usa (tenant_id, checkin_em)); histórico da loja.
-- RN-PRO-06: loja fechada/acesso negado exigem a foto da fachada; RN-PRO-07: permanência só existe com checkout.
create table promotor.visita_loja (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references plataforma.tenant (id),
  promotor_id          uuid not null,
  payload              jsonb not null,
  visita_id            uuid,
  cliente_id           uuid,
  checklist_modelo_id  uuid,
  checkin_em           timestamptz,
  checkout_em          timestamptz,
  permanencia_min      numeric,
  desfecho             text,
  foto_fachada_id      uuid,
  recebido_em          timestamptz not null default now(),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  deleted_at           timestamptz,
  external_id          text,
  constraint visita_loja_tenant_id_uk unique (tenant_id, id),
  constraint visita_loja_dono_uk unique (tenant_id, id, promotor_id, cliente_id),
  constraint visita_loja_payload_valido check (jsonb_typeof(payload) = 'object' and coalesce((payload ->> 'id')::uuid = id, false)),
  constraint visita_loja_campos_obrigatorios check (visita_id is not null and cliente_id is not null and checkin_em is not null),
  constraint visita_loja_checkout_formato check ((payload ->> 'checkout_em') is null or checkout_em is not null),
  constraint visita_loja_desfecho_valido check (desfecho is null or desfecho in ('realizada', 'loja_fechada', 'acesso_negado')),
  constraint visita_loja_checkout_completo check ((checkout_em is null) = (desfecho is null) and (checkout_em is null) = (permanencia_min is null)),
  constraint visita_loja_checkout_depois check (checkout_em is null or checkout_em >= checkin_em),
  constraint visita_loja_permanencia_nao_negativa check (permanencia_min is null or permanencia_min >= 0),
  constraint visita_loja_fachada check (desfecho is null or desfecho = 'realizada' or foto_fachada_id is not null)
);
create index visita_loja_checkin_ix on promotor.visita_loja (tenant_id, checkin_em);
create index visita_loja_cliente_ix on promotor.visita_loja (tenant_id, cliente_id, checkin_em desc);
create index visita_loja_promotor_ix on promotor.visita_loja (tenant_id, promotor_id, checkin_em desc);
create index visita_loja_visita_ix on promotor.visita_loja (tenant_id, visita_id);
create index visita_loja_sync_ix on promotor.visita_loja (tenant_id, updated_at, id);
create unique index visita_loja_external_uk on promotor.visita_loja (tenant_id, external_id) where external_id is not null and deleted_at is null;
create trigger visita_loja_updated_at before update on promotor.visita_loja
  for each row execute function plataforma.definir_updated_at();
create function promotor.derivar_visita_loja() returns trigger
  language plpgsql
  as $$
begin
  new.visita_id           := (new.payload ->> 'visita_id')::uuid;
  new.cliente_id          := (new.payload ->> 'cliente_id')::uuid;
  new.checklist_modelo_id := (new.payload ->> 'checklist_modelo_id')::uuid;
  new.checkin_em          := promotor.instante_iso(new.payload ->> 'checkin_em');
  new.checkout_em         := promotor.instante_iso(new.payload ->> 'checkout_em');
  new.permanencia_min     := (new.payload ->> 'permanencia_min')::numeric;
  new.desfecho            := new.payload ->> 'desfecho';
  new.foto_fachada_id     := (new.payload ->> 'foto_fachada_id')::uuid;
  return new;
end
$$;
create trigger visita_loja_derivar before insert or update on promotor.visita_loja
  for each row execute function promotor.derivar_visita_loja();
alter table promotor.visita_loja enable row level security;
alter table promotor.visita_loja force row level security;
create policy isolamento_tenant on promotor.visita_loja for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert on promotor.visita_loja to macuxi_app;
grant update (payload) on promotor.visita_loja to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- foto_coleta — foto tirada na hora pela câmera (RN-PRO-02: galeria bloqueada; coordenada ou sem_gps). O binário vai pela
-- fila de arquivos (plataforma.arquivo, ADR 0010); aqui só o metadado. Consultas: por id; fotos da visita.
create table promotor.foto_coleta (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references plataforma.tenant (id),
  promotor_id     uuid not null,
  cliente_id      uuid not null,
  payload         jsonb not null,
  visita_loja_id  uuid,
  tipo            text,
  tirada_em       timestamptz,
  sem_gps         boolean,
  arquivo_ref     text,
  recebido_em     timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  external_id     text,
  constraint foto_coleta_visita_fk foreign key (tenant_id, visita_loja_id, promotor_id, cliente_id) references promotor.visita_loja (tenant_id, id, promotor_id, cliente_id),
  constraint foto_coleta_payload_valido check (jsonb_typeof(payload) = 'object' and coalesce((payload ->> 'id')::uuid = id, false)),
  constraint foto_coleta_campos_obrigatorios check (visita_loja_id is not null and tirada_em is not null and sem_gps is not null),
  constraint foto_coleta_tipo_valido check (tipo in ('gondola_antes', 'gondola_depois', 'validade', 'avaria', 'ponto_extra', 'concorrencia', 'fachada', 'tarefa', 'preco', 'outro'))
);
create index foto_coleta_visita_ix on promotor.foto_coleta (tenant_id, visita_loja_id);
create index foto_coleta_sync_ix on promotor.foto_coleta (tenant_id, updated_at, id);
create unique index foto_coleta_external_uk on promotor.foto_coleta (tenant_id, external_id) where external_id is not null and deleted_at is null;
create trigger foto_coleta_updated_at before update on promotor.foto_coleta
  for each row execute function plataforma.definir_updated_at();
create function promotor.derivar_foto_coleta() returns trigger
  language plpgsql
  as $$
begin
  new.visita_loja_id := (new.payload ->> 'visita_loja_id')::uuid;
  new.tipo           := new.payload ->> 'tipo';
  new.tirada_em      := promotor.instante_iso(new.payload ->> 'tirada_em');
  new.sem_gps        := (new.payload ->> 'sem_gps')::boolean;
  new.arquivo_ref    := new.payload ->> 'arquivo_ref';
  return new;
end
$$;
create trigger foto_coleta_derivar before insert or update on promotor.foto_coleta
  for each row execute function promotor.derivar_foto_coleta();
alter table promotor.foto_coleta enable row level security;
alter table promotor.foto_coleta force row level security;
create policy isolamento_tenant on promotor.foto_coleta for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert on promotor.foto_coleta to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- checklist_resposta — resposta de uma etapa do checklist (RN-PRO-06: a última resposta de cada item vale no checkout;
-- por isso não há único por item). Consultas: respostas da visita.
create table promotor.checklist_resposta (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references plataforma.tenant (id),
  promotor_id        uuid not null,
  cliente_id         uuid not null,
  payload            jsonb not null,
  visita_loja_id     uuid,
  checklist_item_id  uuid,
  obrigatoria        boolean,
  concluida          boolean,
  respondido_em      timestamptz,
  recebido_em        timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  external_id        text,
  constraint checklist_resposta_visita_fk foreign key (tenant_id, visita_loja_id, promotor_id, cliente_id) references promotor.visita_loja (tenant_id, id, promotor_id, cliente_id),
  constraint checklist_resposta_payload_valido check (jsonb_typeof(payload) = 'object' and coalesce((payload ->> 'id')::uuid = id, false)),
  constraint checklist_resposta_campos_obrigatorios check (visita_loja_id is not null and checklist_item_id is not null and obrigatoria is not null and concluida is not null and respondido_em is not null)
);
create index checklist_resposta_visita_ix on promotor.checklist_resposta (tenant_id, visita_loja_id);
create index checklist_resposta_sync_ix on promotor.checklist_resposta (tenant_id, updated_at, id);
create unique index checklist_resposta_external_uk on promotor.checklist_resposta (tenant_id, external_id) where external_id is not null and deleted_at is null;
create trigger checklist_resposta_updated_at before update on promotor.checklist_resposta
  for each row execute function plataforma.definir_updated_at();
create function promotor.derivar_checklist_resposta() returns trigger
  language plpgsql
  as $$
begin
  new.visita_loja_id    := (new.payload ->> 'visita_loja_id')::uuid;
  new.checklist_item_id := (new.payload ->> 'checklist_item_id')::uuid;
  new.obrigatoria       := (new.payload ->> 'obrigatoria')::boolean;
  new.concluida         := (new.payload ->> 'concluida')::boolean;
  new.respondido_em     := promotor.instante_iso(new.payload ->> 'respondido_em');
  return new;
end
$$;
create trigger checklist_resposta_derivar before insert or update on promotor.checklist_resposta
  for each row execute function promotor.derivar_checklist_resposta();
alter table promotor.checklist_resposta enable row level security;
alter table promotor.checklist_resposta force row level security;
create policy isolamento_tenant on promotor.checklist_resposta for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert on promotor.checklist_resposta to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- gondola_registro — arrumação da gôndola com fotos antes/depois e conformidade (RF-PRO-03, RN-PRO-11).
create table promotor.gondola_registro (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references plataforma.tenant (id),
  promotor_id           uuid not null,
  cliente_id            uuid not null,
  payload               jsonb not null,
  visita_loja_id        uuid,
  categoria_gondola_id  uuid,
  foto_antes_id         uuid,
  foto_depois_id        uuid,
  conformidade          text,
  registrado_em         timestamptz,
  recebido_em           timestamptz not null default now(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz,
  external_id           text,
  constraint gondola_registro_visita_fk foreign key (tenant_id, visita_loja_id, promotor_id, cliente_id) references promotor.visita_loja (tenant_id, id, promotor_id, cliente_id),
  constraint gondola_registro_payload_valido check (jsonb_typeof(payload) = 'object' and coalesce((payload ->> 'id')::uuid = id, false)),
  constraint gondola_registro_campos_obrigatorios check (visita_loja_id is not null and categoria_gondola_id is not null and foto_antes_id is not null and foto_depois_id is not null and registrado_em is not null),
  constraint gondola_registro_conformidade_valida check (conformidade in ('conforme', 'parcial', 'nao_conforme'))
);
create index gondola_registro_visita_ix on promotor.gondola_registro (tenant_id, visita_loja_id);
create index gondola_registro_sync_ix on promotor.gondola_registro (tenant_id, updated_at, id);
create unique index gondola_registro_external_uk on promotor.gondola_registro (tenant_id, external_id) where external_id is not null and deleted_at is null;
create trigger gondola_registro_updated_at before update on promotor.gondola_registro
  for each row execute function plataforma.definir_updated_at();
create function promotor.derivar_gondola_registro() returns trigger
  language plpgsql
  as $$
begin
  new.visita_loja_id       := (new.payload ->> 'visita_loja_id')::uuid;
  new.categoria_gondola_id := (new.payload ->> 'categoria_gondola_id')::uuid;
  new.foto_antes_id        := (new.payload ->> 'foto_antes_id')::uuid;
  new.foto_depois_id       := (new.payload ->> 'foto_depois_id')::uuid;
  new.conformidade         := new.payload ->> 'conformidade';
  new.registrado_em        := promotor.instante_iso(new.payload ->> 'registrado_em');
  return new;
end
$$;
create trigger gondola_registro_derivar before insert or update on promotor.gondola_registro
  for each row execute function promotor.derivar_gondola_registro();
alter table promotor.gondola_registro enable row level security;
alter table promotor.gondola_registro force row level security;
create policy isolamento_tenant on promotor.gondola_registro for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert on promotor.gondola_registro to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- medicao_share — share de gôndola (RF-PRO-04, RN-PRO-03): share e atingimento recalculados pela API; meta vigente
-- guardada (RN-PRO-10). Relatório share × meta: medições das visitas do período + última por loja/categoria.
create table promotor.medicao_share (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references plataforma.tenant (id),
  promotor_id           uuid not null,
  cliente_id            uuid not null,
  payload               jsonb not null,
  visita_loja_id        uuid,
  categoria_gondola_id  uuid,
  frentes_nossas        integer,
  frentes_total         integer,
  share_pct             numeric,
  meta_share_id         uuid,
  meta_pct              numeric,
  atingimento_pct       numeric,
  medido_em             timestamptz,
  recebido_em           timestamptz not null default now(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz,
  external_id           text,
  constraint medicao_share_visita_fk foreign key (tenant_id, visita_loja_id, promotor_id, cliente_id) references promotor.visita_loja (tenant_id, id, promotor_id, cliente_id),
  constraint medicao_share_payload_valido check (jsonb_typeof(payload) = 'object' and coalesce((payload ->> 'id')::uuid = id, false)),
  constraint medicao_share_campos_obrigatorios check (visita_loja_id is not null and categoria_gondola_id is not null and frentes_nossas is not null and frentes_total is not null and medido_em is not null),
  constraint medicao_share_frentes_nao_negativas check (frentes_nossas >= 0 and frentes_total >= 0),
  constraint medicao_share_pct_faixa check ((share_pct is null or share_pct between 0 and 100) and (meta_pct is null or meta_pct between 0 and 100) and (atingimento_pct is null or atingimento_pct >= 0))
);
create index medicao_share_visita_ix on promotor.medicao_share (tenant_id, visita_loja_id);
create index medicao_share_loja_categoria_ix on promotor.medicao_share (tenant_id, cliente_id, categoria_gondola_id, medido_em desc);
create index medicao_share_sync_ix on promotor.medicao_share (tenant_id, updated_at, id);
create unique index medicao_share_external_uk on promotor.medicao_share (tenant_id, external_id) where external_id is not null and deleted_at is null;
create trigger medicao_share_updated_at before update on promotor.medicao_share
  for each row execute function plataforma.definir_updated_at();
create function promotor.derivar_medicao_share() returns trigger
  language plpgsql
  as $$
begin
  new.visita_loja_id       := (new.payload ->> 'visita_loja_id')::uuid;
  new.categoria_gondola_id := (new.payload ->> 'categoria_gondola_id')::uuid;
  new.frentes_nossas       := (new.payload ->> 'frentes_nossas')::integer;
  new.frentes_total        := (new.payload ->> 'frentes_total')::integer;
  new.share_pct            := (new.payload ->> 'share_pct')::numeric;
  new.meta_share_id        := (new.payload ->> 'meta_share_id')::uuid;
  new.meta_pct             := (new.payload ->> 'meta_pct')::numeric;
  new.atingimento_pct      := (new.payload ->> 'atingimento_pct')::numeric;
  new.medido_em            := promotor.instante_iso(new.payload ->> 'medido_em');
  return new;
end
$$;
create trigger medicao_share_derivar before insert or update on promotor.medicao_share
  for each row execute function promotor.derivar_medicao_share();
alter table promotor.medicao_share enable row level security;
alter table promotor.medicao_share force row level security;
create policy isolamento_tenant on promotor.medicao_share for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert on promotor.medicao_share to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- coleta_preco — preço de prateleira, nosso (produto_concorrente_id nulo) ou do concorrente (RF-PRO-05, RN-PRO-04), em
-- centavos. Consulta extra: última coleta do item na loja (checagem de variação), por (cliente, produto, coletado_em).
create table promotor.coleta_preco (
  id                       uuid primary key default gen_random_uuid(),
  tenant_id                uuid not null references plataforma.tenant (id),
  promotor_id              uuid not null,
  cliente_id               uuid not null,
  payload                  jsonb not null,
  visita_loja_id           uuid,
  produto_id               uuid,
  concorrente_id           uuid,
  produto_concorrente_id   uuid,
  preco_cents              bigint,
  preco_promocional_cents  bigint,
  em_promocao              boolean,
  indice_preco             numeric,
  coletado_em              timestamptz,
  recebido_em              timestamptz not null default now(),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  deleted_at               timestamptz,
  external_id              text,
  constraint coleta_preco_visita_fk foreign key (tenant_id, visita_loja_id, promotor_id, cliente_id) references promotor.visita_loja (tenant_id, id, promotor_id, cliente_id),
  constraint coleta_preco_payload_valido check (jsonb_typeof(payload) = 'object' and coalesce((payload ->> 'id')::uuid = id, false)),
  constraint coleta_preco_campos_obrigatorios check (visita_loja_id is not null and produto_id is not null and preco_cents is not null and coletado_em is not null),
  constraint coleta_preco_precos_positivos check (preco_cents > 0 and (preco_promocional_cents is null or preco_promocional_cents > 0)),
  constraint coleta_preco_concorrente_informado check (produto_concorrente_id is null or concorrente_id is not null),
  constraint coleta_preco_indice_nao_negativo check (indice_preco is null or indice_preco >= 0)
);
create index coleta_preco_visita_ix on promotor.coleta_preco (tenant_id, visita_loja_id);
create index coleta_preco_loja_produto_ix on promotor.coleta_preco (tenant_id, cliente_id, produto_id, coletado_em desc);
create index coleta_preco_sync_ix on promotor.coleta_preco (tenant_id, updated_at, id);
create unique index coleta_preco_external_uk on promotor.coleta_preco (tenant_id, external_id) where external_id is not null and deleted_at is null;
create trigger coleta_preco_updated_at before update on promotor.coleta_preco
  for each row execute function plataforma.definir_updated_at();
create function promotor.derivar_coleta_preco() returns trigger
  language plpgsql
  as $$
begin
  new.visita_loja_id          := (new.payload ->> 'visita_loja_id')::uuid;
  new.produto_id              := (new.payload ->> 'produto_id')::uuid;
  new.concorrente_id          := (new.payload ->> 'concorrente_id')::uuid;
  new.produto_concorrente_id  := (new.payload ->> 'produto_concorrente_id')::uuid;
  new.preco_cents             := (new.payload ->> 'preco_cents')::bigint;
  new.preco_promocional_cents := (new.payload ->> 'preco_promocional_cents')::bigint;
  new.em_promocao             := (new.payload ->> 'em_promocao')::boolean;
  new.indice_preco            := (new.payload ->> 'indice_preco')::numeric;
  new.coletado_em             := promotor.instante_iso(new.payload ->> 'coletado_em');
  return new;
end
$$;
create trigger coleta_preco_derivar before insert or update on promotor.coleta_preco
  for each row execute function promotor.derivar_coleta_preco();
alter table promotor.coleta_preco enable row level security;
alter table promotor.coleta_preco force row level security;
create policy isolamento_tenant on promotor.coleta_preco for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert on promotor.coleta_preco to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- ruptura_item — presença do mix obrigatório (RF-PRO-06, RN-PRO-05): ruptura total não tem quantidade reposta.
create table promotor.ruptura_item (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references plataforma.tenant (id),
  promotor_id         uuid not null,
  cliente_id          uuid not null,
  payload             jsonb not null,
  visita_loja_id      uuid,
  produto_id          uuid,
  mix_obrigatorio_id  uuid,
  status              text,
  quantidade_reposta  integer,
  registrado_em       timestamptz,
  recebido_em         timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz,
  external_id         text,
  constraint ruptura_item_visita_fk foreign key (tenant_id, visita_loja_id, promotor_id, cliente_id) references promotor.visita_loja (tenant_id, id, promotor_id, cliente_id),
  constraint ruptura_item_payload_valido check (jsonb_typeof(payload) = 'object' and coalesce((payload ->> 'id')::uuid = id, false)),
  constraint ruptura_item_campos_obrigatorios check (visita_loja_id is not null and produto_id is not null and mix_obrigatorio_id is not null and quantidade_reposta is not null and registrado_em is not null),
  constraint ruptura_item_status_valido check (status in ('presente', 'ruptura_gondola', 'ruptura_total')),
  constraint ruptura_item_reposicao check (quantidade_reposta >= 0 and (status <> 'ruptura_total' or quantidade_reposta = 0))
);
create index ruptura_item_visita_ix on promotor.ruptura_item (tenant_id, visita_loja_id);
create index ruptura_item_loja_ix on promotor.ruptura_item (tenant_id, cliente_id, registrado_em desc);
create index ruptura_item_sync_ix on promotor.ruptura_item (tenant_id, updated_at, id);
create unique index ruptura_item_external_uk on promotor.ruptura_item (tenant_id, external_id) where external_id is not null and deleted_at is null;
create trigger ruptura_item_updated_at before update on promotor.ruptura_item
  for each row execute function plataforma.definir_updated_at();
create function promotor.derivar_ruptura_item() returns trigger
  language plpgsql
  as $$
begin
  new.visita_loja_id     := (new.payload ->> 'visita_loja_id')::uuid;
  new.produto_id         := (new.payload ->> 'produto_id')::uuid;
  new.mix_obrigatorio_id := (new.payload ->> 'mix_obrigatorio_id')::uuid;
  new.status             := new.payload ->> 'status';
  new.quantidade_reposta := (new.payload ->> 'quantidade_reposta')::integer;
  new.registrado_em      := promotor.instante_iso(new.payload ->> 'registrado_em');
  return new;
end
$$;
create trigger ruptura_item_derivar before insert or update on promotor.ruptura_item
  for each row execute function promotor.derivar_ruptura_item();
alter table promotor.ruptura_item enable row level security;
alter table promotor.ruptura_item force row level security;
create policy isolamento_tenant on promotor.ruptura_item for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert on promotor.ruptura_item to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- validade_item — validade próxima e avarias (RF-PRO-07, RN-PRO-08): validade exige a data; avaria exige motivo e foto
-- (conferidos pelo contrato). Consulta extra: vencimentos por data (alertas de validade próxima/crítica).
create table promotor.validade_item (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references plataforma.tenant (id),
  promotor_id     uuid not null,
  cliente_id      uuid not null,
  payload         jsonb not null,
  visita_loja_id  uuid,
  produto_id      uuid,
  tipo            text,
  validade        date,
  quantidade      integer,
  registrado_em   timestamptz,
  recebido_em     timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  external_id     text,
  constraint validade_item_visita_fk foreign key (tenant_id, visita_loja_id, promotor_id, cliente_id) references promotor.visita_loja (tenant_id, id, promotor_id, cliente_id),
  constraint validade_item_payload_valido check (jsonb_typeof(payload) = 'object' and coalesce((payload ->> 'id')::uuid = id, false)),
  constraint validade_item_campos_obrigatorios check (visita_loja_id is not null and produto_id is not null and quantidade is not null and registrado_em is not null),
  constraint validade_item_tipo_valido check (tipo in ('validade', 'avaria')),
  constraint validade_item_data_da_validade check (tipo <> 'validade' or validade is not null),
  constraint validade_item_quantidade_positiva check (quantidade > 0)
);
create index validade_item_visita_ix on promotor.validade_item (tenant_id, visita_loja_id);
create index validade_item_vencimento_ix on promotor.validade_item (tenant_id, validade) where validade is not null;
create index validade_item_sync_ix on promotor.validade_item (tenant_id, updated_at, id);
create unique index validade_item_external_uk on promotor.validade_item (tenant_id, external_id) where external_id is not null and deleted_at is null;
create trigger validade_item_updated_at before update on promotor.validade_item
  for each row execute function plataforma.definir_updated_at();
create function promotor.derivar_validade_item() returns trigger
  language plpgsql
  as $$
begin
  new.visita_loja_id := (new.payload ->> 'visita_loja_id')::uuid;
  new.produto_id     := (new.payload ->> 'produto_id')::uuid;
  new.tipo           := new.payload ->> 'tipo';
  new.validade       := promotor.data_iso(new.payload ->> 'validade');
  new.quantidade     := (new.payload ->> 'quantidade')::integer;
  new.registrado_em  := promotor.instante_iso(new.payload ->> 'registrado_em');
  return new;
end
$$;
create trigger validade_item_derivar before insert or update on promotor.validade_item
  for each row execute function promotor.derivar_validade_item();
alter table promotor.validade_item enable row level security;
alter table promotor.validade_item force row level security;
create policy isolamento_tenant on promotor.validade_item for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert on promotor.validade_item to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- ponto_extra — conferência de ponto extra negociado ou ponto encontrado sem negociação (RF-PRO-08).
create table promotor.ponto_extra (
  id                        uuid primary key default gen_random_uuid(),
  tenant_id                 uuid not null references plataforma.tenant (id),
  promotor_id               uuid not null,
  cliente_id                uuid not null,
  payload                   jsonb not null,
  visita_loja_id            uuid,
  ponto_extra_negociado_id  uuid,
  tipo                      text,
  existe                    boolean,
  no_lugar                  boolean,
  abastecido                boolean,
  registrado_em             timestamptz,
  recebido_em               timestamptz not null default now(),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  deleted_at                timestamptz,
  external_id               text,
  constraint ponto_extra_visita_fk foreign key (tenant_id, visita_loja_id, promotor_id, cliente_id) references promotor.visita_loja (tenant_id, id, promotor_id, cliente_id),
  constraint ponto_extra_payload_valido check (jsonb_typeof(payload) = 'object' and coalesce((payload ->> 'id')::uuid = id, false)),
  constraint ponto_extra_campos_obrigatorios check (visita_loja_id is not null and existe is not null and no_lugar is not null and abastecido is not null and registrado_em is not null),
  constraint ponto_extra_tipo_valido check (tipo in ('ponta_gondola', 'ilha', 'display', 'cartaz', 'checkout', 'outro'))
);
create index ponto_extra_visita_ix on promotor.ponto_extra (tenant_id, visita_loja_id);
create index ponto_extra_negociado_ix on promotor.ponto_extra (tenant_id, ponto_extra_negociado_id) where ponto_extra_negociado_id is not null;
create index ponto_extra_sync_ix on promotor.ponto_extra (tenant_id, updated_at, id);
create unique index ponto_extra_external_uk on promotor.ponto_extra (tenant_id, external_id) where external_id is not null and deleted_at is null;
create trigger ponto_extra_updated_at before update on promotor.ponto_extra
  for each row execute function plataforma.definir_updated_at();
create function promotor.derivar_ponto_extra() returns trigger
  language plpgsql
  as $$
begin
  new.visita_loja_id           := (new.payload ->> 'visita_loja_id')::uuid;
  new.ponto_extra_negociado_id := (new.payload ->> 'ponto_extra_negociado_id')::uuid;
  new.tipo                     := new.payload ->> 'tipo';
  new.existe                   := (new.payload ->> 'existe')::boolean;
  new.no_lugar                 := (new.payload ->> 'no_lugar')::boolean;
  new.abastecido               := (new.payload ->> 'abastecido')::boolean;
  new.registrado_em            := promotor.instante_iso(new.payload ->> 'registrado_em');
  return new;
end
$$;
create trigger ponto_extra_derivar before insert or update on promotor.ponto_extra
  for each row execute function promotor.derivar_ponto_extra();
alter table promotor.ponto_extra enable row level security;
alter table promotor.ponto_extra force row level security;
create policy isolamento_tenant on promotor.ponto_extra for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert on promotor.ponto_extra to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- acao_concorrencia — ação da concorrência observada na loja (RF-PRO-09).
create table promotor.acao_concorrencia (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references plataforma.tenant (id),
  promotor_id     uuid not null,
  cliente_id      uuid not null,
  payload         jsonb not null,
  visita_loja_id  uuid,
  concorrente_id  uuid,
  tipo            text,
  registrado_em   timestamptz,
  recebido_em     timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  external_id     text,
  constraint acao_concorrencia_visita_fk foreign key (tenant_id, visita_loja_id, promotor_id, cliente_id) references promotor.visita_loja (tenant_id, id, promotor_id, cliente_id),
  constraint acao_concorrencia_payload_valido check (jsonb_typeof(payload) = 'object' and coalesce((payload ->> 'id')::uuid = id, false)),
  constraint acao_concorrencia_campos_obrigatorios check (visita_loja_id is not null and concorrente_id is not null and registrado_em is not null),
  constraint acao_concorrencia_tipo_valido check (tipo in ('lancamento', 'promocao', 'acao_pdv', 'outro'))
);
create index acao_concorrencia_visita_ix on promotor.acao_concorrencia (tenant_id, visita_loja_id);
create index acao_concorrencia_sync_ix on promotor.acao_concorrencia (tenant_id, updated_at, id);
create unique index acao_concorrencia_external_uk on promotor.acao_concorrencia (tenant_id, external_id) where external_id is not null and deleted_at is null;
create trigger acao_concorrencia_updated_at before update on promotor.acao_concorrencia
  for each row execute function plataforma.definir_updated_at();
create function promotor.derivar_acao_concorrencia() returns trigger
  language plpgsql
  as $$
begin
  new.visita_loja_id := (new.payload ->> 'visita_loja_id')::uuid;
  new.concorrente_id := (new.payload ->> 'concorrente_id')::uuid;
  new.tipo           := new.payload ->> 'tipo';
  new.registrado_em  := promotor.instante_iso(new.payload ->> 'registrado_em');
  return new;
end
$$;
create trigger acao_concorrencia_derivar before insert or update on promotor.acao_concorrencia
  for each row execute function promotor.derivar_acao_concorrencia();
alter table promotor.acao_concorrencia enable row level security;
alter table promotor.acao_concorrencia force row level security;
create policy isolamento_tenant on promotor.acao_concorrencia for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert on promotor.acao_concorrencia to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- tarefa_execucao — execução de tarefa de campanha com comprovação por foto (RF-PRO-10; foto_ids no payload). O contrato
-- traz cliente_id no payload: tem de ser a loja da visita (a coluna cliente_id, presa à visita pela FK composta).
create table promotor.tarefa_execucao (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references plataforma.tenant (id),
  promotor_id      uuid not null,
  cliente_id       uuid not null,
  payload          jsonb not null,
  visita_loja_id   uuid,
  tarefa_trade_id  uuid,
  concluida_em     timestamptz,
  recebido_em      timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  external_id      text,
  constraint tarefa_execucao_visita_fk foreign key (tenant_id, visita_loja_id, promotor_id, cliente_id) references promotor.visita_loja (tenant_id, id, promotor_id, cliente_id),
  constraint tarefa_execucao_payload_valido check (jsonb_typeof(payload) = 'object' and coalesce((payload ->> 'id')::uuid = id, false)),
  constraint tarefa_execucao_campos_obrigatorios check (visita_loja_id is not null and tarefa_trade_id is not null and concluida_em is not null),
  constraint tarefa_execucao_com_foto check (jsonb_typeof(payload -> 'foto_ids') = 'array' and jsonb_array_length(payload -> 'foto_ids') >= 1),
  constraint tarefa_execucao_cliente_da_visita check (coalesce((payload ->> 'cliente_id')::uuid = cliente_id, false))
);
create index tarefa_execucao_visita_ix on promotor.tarefa_execucao (tenant_id, visita_loja_id);
create index tarefa_execucao_tarefa_ix on promotor.tarefa_execucao (tenant_id, tarefa_trade_id);
create index tarefa_execucao_sync_ix on promotor.tarefa_execucao (tenant_id, updated_at, id);
create unique index tarefa_execucao_external_uk on promotor.tarefa_execucao (tenant_id, external_id) where external_id is not null and deleted_at is null;
create trigger tarefa_execucao_updated_at before update on promotor.tarefa_execucao
  for each row execute function plataforma.definir_updated_at();
create function promotor.derivar_tarefa_execucao() returns trigger
  language plpgsql
  as $$
begin
  new.visita_loja_id  := (new.payload ->> 'visita_loja_id')::uuid;
  new.tarefa_trade_id := (new.payload ->> 'tarefa_trade_id')::uuid;
  new.concluida_em    := promotor.instante_iso(new.payload ->> 'concluida_em');
  return new;
end
$$;
create trigger tarefa_execucao_derivar before insert or update on promotor.tarefa_execucao
  for each row execute function promotor.derivar_tarefa_execucao();
alter table promotor.tarefa_execucao enable row level security;
alter table promotor.tarefa_execucao force row level security;
create policy isolamento_tenant on promotor.tarefa_execucao for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert on promotor.tarefa_execucao to macuxi_app;
