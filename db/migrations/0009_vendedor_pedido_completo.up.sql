-- 0009_vendedor_pedido_completo (up) — T-0029 (fatia vertical do pedido), desenho docs/desenho/T-0029.md §10 e
-- ADR 0011 (aprovação mora no Vendedor); pedidos R-20261101-042135-engenheiro-software e
-- R-20261101-044128-modulo-vendedor (nomes exatos das colunas do pull e listas do contrato).
-- Listas fechadas = código do Vendedor (fonte da verdade), conferidas em db/testes/estatico.test.ts:
--   status (pedido.status, pedido_evento.de/para) = ORDER_STATUSES (modules/vendedor/domain/order.ts; CHECK da 0007);
--   nivel_aprovacao / pedido_evento.nivel = NIVEIS_APROVACAO; motivos_aprovacao = MOTIVOS_APROVACAO
--   (modules/vendedor/domain/aprovacao.ts). O vocabulário do doc 03 (STATUS_CONTRATO) é só dos eventos: não vem ao banco.
-- Regras: RN-VEN-30 (estados), RN-VEN-10 (alçada -> nível), RN-GES-08 (rejeição com motivo de 3+ caracteres),
-- RN-VEN-14 (condição de pagamento permitida ao cliente), RN-VEN-33 (idempotência: hash_envio), D-6 (retrato).
-- Mudanças:
--   pedido: numero (legível, único por tenant, gerado só no servidor por vendedor.proximo_numero_pedido()), hash_envio,
--     retrato (cliente_resumo, cliente_nome, vendedor_nome, condicao_pagamento_descricao), tabela_preco_id,
--     condicao_pagamento_id (FK no schema), aprovação (nivel_aprovacao, motivos_aprovacao, aprovacao_automatica,
--     decidido_por_id, decidido_em, motivo_rejeicao); CHECKs pending_approval => nível e rejected => motivo >= 3;
--     índice (tenant_id, status, created_at desc) para a lista do BKO.
--   pedido_item: retrato do produto (produto_sku, produto_nome, unidade).
--   novas: pedido_evento (linha do tempo, RF-VEN-05), condicao_pagamento, cliente_condicao e numeracao_pedido
--     (contador por tenant; fora do sync).
-- DADOS EXISTENTES (antes dos CHECKs): pedido pending_approval sem nível recebe o nível pela política padrão do doc 03
-- (desconto <= 10% supervisor, <= 15% gerente, acima analista) e motivos {desconto}; rejected sem motivo recebe
-- 'Rejeitado antes do registro do motivo.'. Pedidos antigos ficam sem numero (nulo; a API mostra vazio).
-- FRONTEIRA: nenhuma FK para o schema core nem para o catalogo (cliente_id, produto_id, tabela_preco_id,
-- decidido_por_id e autor_id são validados pela API do Vendedor via consultas, ADR 0012). FKs só dentro do schema.
-- Caminho de volta: 0009_vendedor_pedido_completo.down.sql (APAGA histórico, condições, contador e as colunas novas).

-- ---------------------------------------------------------------------------------------------
-- condicao_pagamento — condições do tenant (À vista, 28 dias...). Pull escopo tenant. Volume baixo (dezenas).
-- No máximo UMA padrão viva por tenant (usada quando o cliente não tem lista própria, RN-VEN-14); padrão é ativa.
create table vendedor.condicao_pagamento (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references plataforma.tenant (id),
  codigo       text not null,
  descricao    text not null,
  ativo        boolean not null default true,
  padrao       boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  external_id  text,
  constraint condicao_pagamento_tenant_id_uk unique (tenant_id, id),
  constraint condicao_pagamento_codigo_preenchido check (btrim(codigo) <> ''),
  constraint condicao_pagamento_descricao_preenchida check (btrim(descricao) <> ''),
  constraint condicao_pagamento_padrao_ativa check (not padrao or ativo)
);
create unique index condicao_pagamento_codigo_uk on vendedor.condicao_pagamento (tenant_id, codigo) where deleted_at is null;
create unique index condicao_pagamento_padrao_uk on vendedor.condicao_pagamento (tenant_id) where padrao and deleted_at is null;
create index condicao_pagamento_sync_ix on vendedor.condicao_pagamento (tenant_id, updated_at, id);
create unique index condicao_pagamento_external_uk on vendedor.condicao_pagamento (tenant_id, external_id) where external_id is not null and deleted_at is null;
create trigger condicao_pagamento_updated_at before update on vendedor.condicao_pagamento
  for each row execute function plataforma.definir_updated_at();
alter table vendedor.condicao_pagamento enable row level security;
alter table vendedor.condicao_pagamento force row level security;
create policy isolamento_tenant on vendedor.condicao_pagamento for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert, update, delete on vendedor.condicao_pagamento to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- cliente_condicao — condições permitidas ao cliente (RN-VEN-14). Sem linha viva = só a padrão do tenant.
-- Pull escopo carteira. Volume = clientes x 1..4.
create table vendedor.cliente_condicao (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references plataforma.tenant (id),
  cliente_id             uuid not null,
  condicao_pagamento_id  uuid not null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  deleted_at             timestamptz,
  external_id            text,
  constraint cliente_condicao_condicao_fk foreign key (tenant_id, condicao_pagamento_id) references vendedor.condicao_pagamento (tenant_id, id)
);
create unique index cliente_condicao_uk on vendedor.cliente_condicao (tenant_id, cliente_id, condicao_pagamento_id) where deleted_at is null;
create index cliente_condicao_condicao_ix on vendedor.cliente_condicao (tenant_id, condicao_pagamento_id);
create index cliente_condicao_sync_ix on vendedor.cliente_condicao (tenant_id, updated_at, id);
create unique index cliente_condicao_external_uk on vendedor.cliente_condicao (tenant_id, external_id) where external_id is not null and deleted_at is null;
create trigger cliente_condicao_updated_at before update on vendedor.cliente_condicao
  for each row execute function plataforma.definir_updated_at();
alter table vendedor.cliente_condicao enable row level security;
alter table vendedor.cliente_condicao force row level security;
create policy isolamento_tenant on vendedor.cliente_condicao for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert, update, delete on vendedor.cliente_condicao to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- numeracao_pedido — contador do número legível do pedido, uma linha por tenant (id = uuid_de_chave
-- '<tenant>:vendedor.numeracao_pedido'). Sequencial SEM buraco e sem revelar o volume de outro tenant (por isso não é
-- uma sequence global). Fora do sync (nunca vai ao aparelho).
create table vendedor.numeracao_pedido (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references plataforma.tenant (id),
  ultimo       bigint not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  external_id  text,
  constraint numeracao_pedido_tenant_uk unique (tenant_id),
  constraint numeracao_pedido_ultimo_nao_negativo check (ultimo >= 0)
);
create trigger numeracao_pedido_updated_at before update on vendedor.numeracao_pedido
  for each row execute function plataforma.definir_updated_at();
alter table vendedor.numeracao_pedido enable row level security;
alter table vendedor.numeracao_pedido force row level security;
create policy isolamento_tenant on vendedor.numeracao_pedido for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert, update on vendedor.numeracao_pedido to macuxi_app;

-- proximo_numero_pedido — próximo número do tenant do contexto (app.tenant_id), com 6 dígitos ('000001').
-- SECURITY INVOKER (RLS vale); sem contexto, o id/tenant ficam nulos e o INSERT falha (fecha). A linha do contador
-- fica travada até o fim da transação: pedidos do mesmo tenant numeram em fila, e o rollback devolve o número.
-- Uso no receber do Vendedor: chamar SÓ depois de saber que o pedido é novo (idempotência RN-VEN-33), na mesma
-- transação do INSERT; chamar num reenvio consome um número à toa.
create function vendedor.proximo_numero_pedido() returns text
  language sql volatile
  as $$
    insert into vendedor.numeracao_pedido as n (id, tenant_id, ultimo)
    values (plataforma.uuid_de_chave(plataforma.tenant_atual()::text || ':vendedor.numeracao_pedido'), plataforma.tenant_atual(), 1)
    on conflict (tenant_id) do update set ultimo = n.ultimo + 1
    returning lpad(n.ultimo::text, 6, '0')
  $$;
revoke all on function vendedor.proximo_numero_pedido() from public;
grant execute on function vendedor.proximo_numero_pedido() to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- pedido — colunas novas (todas opcionais no pull; APKs antigos ignoram).
alter table vendedor.pedido add column numero text;
alter table vendedor.pedido add column hash_envio text;
alter table vendedor.pedido add column cliente_resumo jsonb;
alter table vendedor.pedido add column cliente_nome text;
alter table vendedor.pedido add column vendedor_nome text;
alter table vendedor.pedido add column tabela_preco_id uuid;
alter table vendedor.pedido add column condicao_pagamento_id uuid;
alter table vendedor.pedido add column condicao_pagamento_descricao text;
alter table vendedor.pedido add column nivel_aprovacao text constraint pedido_nivel_valido check (nivel_aprovacao is null or nivel_aprovacao in ('supervisor', 'gerente', 'analista'));
alter table vendedor.pedido add column motivos_aprovacao text[] not null default '{}' constraint pedido_motivos_validos check (motivos_aprovacao <@ array['desconto', 'credito', 'estoque', 'preco_minimo']::text[]);
alter table vendedor.pedido add column aprovacao_automatica boolean not null default false;
alter table vendedor.pedido add column decidido_por_id uuid;
alter table vendedor.pedido add column decidido_em timestamptz;
alter table vendedor.pedido add column motivo_rejeicao text;

-- dados existentes (ver cabeçalho) antes dos CHECKs de estado
update vendedor.pedido
   set nivel_aprovacao = case when desconto_pct <= 10 then 'supervisor' when desconto_pct <= 15 then 'gerente' else 'analista' end,
       motivos_aprovacao = array['desconto']::text[]
 where status = 'pending_approval' and nivel_aprovacao is null;
update vendedor.pedido
   set motivo_rejeicao = 'Rejeitado antes do registro do motivo.'
 where status = 'rejected' and coalesce(char_length(btrim(motivo_rejeicao)), 0) < 3;

alter table vendedor.pedido add constraint pedido_pendente_com_nivel check (status <> 'pending_approval' or nivel_aprovacao is not null);
alter table vendedor.pedido add constraint pedido_rejeitado_com_motivo check (status <> 'rejected' or coalesce(char_length(btrim(motivo_rejeicao)), 0) >= 3);
alter table vendedor.pedido add constraint pedido_hash_envio_formato check (hash_envio is null or hash_envio ~ '^[0-9a-f]{64}$');
alter table vendedor.pedido add constraint pedido_cliente_resumo_objeto check (cliente_resumo is null or jsonb_typeof(cliente_resumo) = 'object');
alter table vendedor.pedido add constraint pedido_numero_preenchido check (numero is null or btrim(numero) <> '');
alter table vendedor.pedido add constraint pedido_condicao_fk foreign key (tenant_id, condicao_pagamento_id) references vendedor.condicao_pagamento (tenant_id, id);
create unique index pedido_numero_uk on vendedor.pedido (tenant_id, numero) where numero is not null;
create index pedido_status_ix on vendedor.pedido (tenant_id, status, created_at desc);

-- pedido_item — retrato do produto no momento do aceite (D-6).
alter table vendedor.pedido_item add column produto_sku text;
alter table vendedor.pedido_item add column produto_nome text;
alter table vendedor.pedido_item add column unidade text;

-- ---------------------------------------------------------------------------------------------
-- pedido_evento — linha do tempo do pedido (RF-VEN-05) e auditoria de negócio: uma linha por transição
-- (null -> received, received -> approved | pending_approval, pending_approval -> approved | rejected, -> cancelled).
-- Só INSERT pela aplicação (histórico não se edita). Pull com o escopo do pedido (join por pedido_id).
-- Volume: ~2 a 3 por pedido.
create table vendedor.pedido_evento (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references plataforma.tenant (id),
  pedido_id       uuid not null,
  de              text,
  para            text not null,
  autor_id        uuid,
  autor_nome      text,
  autor_perfil    text,
  motivo          text,
  nivel           text,
  acima_do_nivel  boolean not null default false,
  ocorrido_em     timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  external_id     text,
  constraint pedido_evento_pedido_fk foreign key (tenant_id, pedido_id) references vendedor.pedido (tenant_id, id),
  constraint pedido_evento_de_valido check (de is null or de in ('draft', 'queued', 'received', 'pending_approval', 'approved', 'sent_to_erp', 'integrated', 'invoiced_partial', 'invoiced', 'rejected', 'cancelled')),
  constraint pedido_evento_para_valido check (para in ('draft', 'queued', 'received', 'pending_approval', 'approved', 'sent_to_erp', 'integrated', 'invoiced_partial', 'invoiced', 'rejected', 'cancelled')),
  constraint pedido_evento_nivel_valido check (nivel is null or nivel in ('supervisor', 'gerente', 'analista')),
  constraint pedido_evento_transicao check (de is distinct from para)
);
create index pedido_evento_pedido_ix on vendedor.pedido_evento (tenant_id, pedido_id, ocorrido_em);
create index pedido_evento_sync_ix on vendedor.pedido_evento (tenant_id, updated_at, id);
create unique index pedido_evento_external_uk on vendedor.pedido_evento (tenant_id, external_id) where external_id is not null and deleted_at is null;
create trigger pedido_evento_updated_at before update on vendedor.pedido_evento
  for each row execute function plataforma.definir_updated_at();
alter table vendedor.pedido_evento enable row level security;
alter table vendedor.pedido_evento force row level security;
create policy isolamento_tenant on vendedor.pedido_evento for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert on vendedor.pedido_evento to macuxi_app;
