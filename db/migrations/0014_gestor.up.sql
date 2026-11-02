-- 0014_gestor (up) — T-0055 (frente nuvem; pedido R-20261102-131601-modulo-gestor, PR #40). Schema do módulo Gestor:
-- read-model da projeção dos eventos consumidos, idempotência do consumidor, alertas da equipe e ajustes das regras.
-- Regras: RF-GES-01/02/03/04/07, RN-GES-01..08 (docs/modulos/gestor/regras.md), RN-CORE-04/05 (escopo e RLS).
-- Tabelas (todas com os campos comuns, RLS forçado com isolamento_tenant, gatilho de updated_at, índice de sync
-- (tenant_id, updated_at, id), external_id único por tenant e grant ao macuxi_app):
--   evento_aplicado  — `evento_id` já aplicados pelo consumidor (idempotência, `processados` do EstadoProjecao).
--   projecao_fato    — o EstadoProjecao (modules/gestor/domain/projecao.ts) achatado: um fato por (tabela, chave).
--   alerta           — contrato `Alerta` (modules/gestor/contracts/alerta.ts); um alerta vivo por chave.
--   alerta_regra     — `AjustesRegras` (ajuste parcial por tipo de alerta, BKO `alerta_regra.gerenciar`).
-- Nada do schema gestor vai ao aparelho por sync de tabela: o app Gestão lê a API /v1/gestor e guarda o cache do módulo
-- (docs/modulos/gestor/api-e-telas.md §4). O índice de sync existe pela regra 5 (conformidade), não por pull.
-- Retenção (120 dias) SEM função SECURITY DEFINER nova: a API do Gestor apaga, na transação do tenant (RLS), o
-- evento_aplicado mais velho que 120 dias (`delete ... where created_at < $agora - interval '120 days'`, índice
-- evento_aplicado_retencao_ix); as chaves de negócio da projeção continuam protegendo a reentrega tardia. Um expurgo
-- de todos os tenants pelo macuxi_worker, se preciso, vem em migração própria com revisão (lista de funções revisadas).
-- Listas fechadas (check) = contratos do Gestor (TIPOS_ALERTA, SEVERIDADES, ALVOS_ALERTA, STATUS_ALERTA,
-- MOTIVOS_ENCERRAMENTO e as tabelas do EstadoProjecao), conferidas em db/testes/gestor.test.ts.
-- FRONTEIRA: nenhuma FK para core/vendedor/promotor (alvo_id, responsavel_id, usuario_id são ids dos contratos).
-- A licença do Gestor no tenant demo vem do seed (db/seeds/demo/gestor.ts), não da migração (nenhum tenant é criado aqui).
-- Caminho de volta: 0014_gestor.down.sql (DROP SCHEMA gestor CASCADE — apaga projeção, alertas e ajustes; a projeção
-- se refaz com os eventos novos e os alertas com a próxima leitura).

create schema gestor;
grant usage on schema gestor to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- evento_aplicado — idempotência do consumidor por `evento_id` (envelope do platform-sdk). Inserir com
-- `on conflict (tenant_id, evento_id) do nothing`: 0 linhas = reentrega (duplicado). Volume: 1 linha por evento
-- consumido (dezenas de milhares/mês por tenant), podado pela retenção.
create table gestor.evento_aplicado (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references plataforma.tenant (id),
  evento_id    text not null,
  nome         text not null,
  ocorrido_em  timestamptz not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  external_id  text,
  constraint evento_aplicado_evento_uk unique (tenant_id, evento_id),
  constraint evento_aplicado_evento_preenchido check (btrim(evento_id) <> ''),
  constraint evento_aplicado_nome_formato check (nome ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*@[1-9][0-9]*$')
);
create index evento_aplicado_sync_ix on gestor.evento_aplicado (tenant_id, updated_at, id);
create index evento_aplicado_retencao_ix on gestor.evento_aplicado (tenant_id, created_at);
create unique index evento_aplicado_external_uk on gestor.evento_aplicado (tenant_id, external_id) where external_id is not null and deleted_at is null;
create trigger evento_aplicado_updated_at before update on gestor.evento_aplicado
  for each row execute function plataforma.definir_updated_at();
alter table gestor.evento_aplicado enable row level security;
alter table gestor.evento_aplicado force row level security;
create policy isolamento_tenant on gestor.evento_aplicado for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert, update, delete on gestor.evento_aplicado to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- projecao_fato — EstadoProjecao achatado. `tabela` = chave do EstadoProjecao (menos `processados`, que é o
-- evento_aplicado); `chave` = chave do fato dentro dela (pedido_id, visita_id, `<usuario_id>|<AAAA-MM-DD>`...);
-- `dados` = o valor do fato como o domain o guarda (objeto com `v`, ou texto em carteira_pendente/entradas_carteira);
-- `carimbo` = maior carimbo `v` conhecido do fato ("<ms 15 dígitos>|<evento_id>"; comparação de texto = ordem).
-- `ocorrido_em` e `usuario_id` (opcionais) são cópias para recorte por período e por pessoa sem abrir o jsonb.
-- Upsert: `on conflict (tenant_id, tabela, chave) do update` — quem decide o vencedor é o domain (aplicarEvento), sob
-- o lock do tenant (docs/banco/gestor.md §3). Volume: 1 fato por pedido, visita, registro de trade, meta e dia de rota.
-- Consultas: estado do tenant inteiro (tenant_id) e, depois, recorte por período (tenant_id, tabela, ocorrido_em).
create table gestor.projecao_fato (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references plataforma.tenant (id),
  tabela       text not null,
  chave        text not null,
  carimbo      text not null default '',
  dados        jsonb not null,
  ocorrido_em  timestamptz,
  usuario_id   uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  external_id  text,
  constraint projecao_fato_chave_uk unique (tenant_id, tabela, chave),
  constraint projecao_fato_tabela_valida check (tabela in ('clientes', 'carteira_pendente', 'entradas_carteira', 'planejadas', 'metas', 'pedidos', 'aprovacoes', 'visitas', 'visitas_loja', 'gondolas', 'shares', 'precos', 'rupturas', 'tarefas', 'respostas', 'licoes', 'medalhas')),
  constraint projecao_fato_chave_preenchida check (btrim(chave) <> '')
);
create index projecao_fato_sync_ix on gestor.projecao_fato (tenant_id, updated_at, id);
create index projecao_fato_periodo_ix on gestor.projecao_fato (tenant_id, tabela, ocorrido_em);
create index projecao_fato_usuario_ix on gestor.projecao_fato (tenant_id, usuario_id, tabela) where usuario_id is not null;
create unique index projecao_fato_external_uk on gestor.projecao_fato (tenant_id, external_id) where external_id is not null and deleted_at is null;
create trigger projecao_fato_updated_at before update on gestor.projecao_fato
  for each row execute function plataforma.definir_updated_at();
alter table gestor.projecao_fato enable row level security;
alter table gestor.projecao_fato force row level security;
create policy isolamento_tenant on gestor.projecao_fato for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert, update, delete on gestor.projecao_fato to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- alerta — contrato Alerta (RF-GES-07). id = UUID gerado pela API (`novoId`). Chave de deduplicação `<tipo>:<alvo_id>`:
-- no máximo UM alerta vivo (aberto ou dispensado) por chave e tenant; encerrado vira histórico e a mesma chave pode
-- abrir de novo (RN-GES: "se a condição some, encerra; se voltar, abre um alerta novo"). valor/limiar em double precision
-- (o pg devolve number ao Node). Consultas: alertas vivos do tenant (status), por responsável (escopo, RN-CORE-04).
create table gestor.alerta (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references plataforma.tenant (id),
  chave                text not null,
  tipo                 text not null,
  alvo_tipo            text not null,
  alvo_id              uuid not null,
  responsavel_id       uuid,
  valor                double precision,
  limiar               double precision,
  severidade           text not null,
  mensagem             text not null,
  status               text not null default 'aberto',
  aberto_em            timestamptz not null,
  encerrado_em         timestamptz,
  motivo_encerramento  text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  deleted_at           timestamptz,
  external_id          text,
  constraint alerta_tenant_id_uk unique (tenant_id, id),
  constraint alerta_chave_minima check (char_length(chave) >= 3),
  constraint alerta_tipo_valido check (tipo in ('cliente_sem_visita', 'ritmo_abaixo_meta', 'pedido_aguardando_aprovacao', 'ruptura_recorrente', 'visita_curta', 'fotos_sem_gps')),
  constraint alerta_alvo_valido check (alvo_tipo in ('cliente', 'usuario', 'pedido', 'visita_loja')),
  constraint alerta_severidade_valida check (severidade in ('info', 'atencao', 'critica')),
  constraint alerta_status_valido check (status in ('aberto', 'dispensado', 'encerrado')),
  constraint alerta_motivo_valido check (motivo_encerramento is null or motivo_encerramento in ('condicao_normalizada', 'regra_inativa', 'duplicado')),
  constraint alerta_mensagem_preenchida check (btrim(mensagem) <> ''),
  constraint alerta_encerramento_coerente check ((status = 'encerrado') = (encerrado_em is not null) and (motivo_encerramento is null or status = 'encerrado'))
);
create unique index alerta_vivo_uk on gestor.alerta (tenant_id, chave) where status <> 'encerrado' and deleted_at is null;
create index alerta_status_ix on gestor.alerta (tenant_id, status) where deleted_at is null;
create index alerta_responsavel_ix on gestor.alerta (tenant_id, responsavel_id) where responsavel_id is not null and deleted_at is null;
create index alerta_sync_ix on gestor.alerta (tenant_id, updated_at, id);
create unique index alerta_external_uk on gestor.alerta (tenant_id, external_id) where external_id is not null and deleted_at is null;
create trigger alerta_updated_at before update on gestor.alerta
  for each row execute function plataforma.definir_updated_at();
alter table gestor.alerta enable row level security;
alter table gestor.alerta force row level security;
create policy isolamento_tenant on gestor.alerta for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert, update, delete on gestor.alerta to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- alerta_regra — ajuste PARCIAL da regra por tipo (AjusteRegraAlerta: ativa, limiar, janela_dias, amostra_min,
-- severidade); sem linha = padrão do domain (resolverRegras). Um ajuste por (tenant, tipo): upsert com
-- `on conflict (tenant_id, tipo) do update`. Volume: até 6 linhas por tenant.
create table gestor.alerta_regra (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references plataforma.tenant (id),
  tipo               text not null,
  ajuste             jsonb not null default '{}'::jsonb,
  atualizado_por_id  uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  external_id        text,
  constraint alerta_regra_tipo_uk unique (tenant_id, tipo),
  constraint alerta_regra_tipo_valido check (tipo in ('cliente_sem_visita', 'ritmo_abaixo_meta', 'pedido_aguardando_aprovacao', 'ruptura_recorrente', 'visita_curta', 'fotos_sem_gps')),
  constraint alerta_regra_ajuste_objeto check (jsonb_typeof(ajuste) = 'object')
);
create index alerta_regra_sync_ix on gestor.alerta_regra (tenant_id, updated_at, id);
create unique index alerta_regra_external_uk on gestor.alerta_regra (tenant_id, external_id) where external_id is not null and deleted_at is null;
create trigger alerta_regra_updated_at before update on gestor.alerta_regra
  for each row execute function plataforma.definir_updated_at();
alter table gestor.alerta_regra enable row level security;
alter table gestor.alerta_regra force row level security;
create policy isolamento_tenant on gestor.alerta_regra for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert, update, delete on gestor.alerta_regra to macuxi_app;
