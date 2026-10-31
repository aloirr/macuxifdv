-- 0003_plataforma_worker (up) — T-0004 (pendências 1 e 2 da T-0002 §6; ADR 0007; desenho T-0004 §4–6)
-- 1. Papel macuxi_worker (despacho da outbox entre tenants) SEM BYPASSRLS: políticas próprias só em
--    plataforma.evento (ler todos os tenants; marcar publicado_em/tentativas/ultimo_erro). Nenhum grant em
--    core.*, nos schemas dos módulos nem nas outras tabelas da plataforma.
-- 2. Envelope completo na outbox: plataforma.evento ganha usuario_id e request_id (rastreio; sem dado pessoal).
-- 3. plataforma.evento_consumo: consumo idempotente por (consumidor, evento_id), RLS por tenant (o handler
--    roda com comTenant e o papel macuxi_app, nunca com o worker).
-- 4. core.carteira_usuario_sync_ix: pull da carteira por usuário (Q6 de docs/banco/desempenho-sync.md),
--    SEM filtro de deleted_at (o pull precisa devolver os removidos).
-- pg-boss (schema pgboss) NÃO entra aqui: vem com o primeiro consumidor real (ADR 0007 item 5).
-- Caminho de volta: 0003_plataforma_worker.down.sql (apaga evento_consumo e as colunas novas de evento — perde
-- esses dados; o papel macuxi_worker é do cluster e fica, sem nenhum privilégio neste banco).

-- Papel do worker: igual ao macuxi_app, LOGIN e senha são definidos pelo executor (db/src/papeis.ts,
-- garantirPapelWorker, MACUXI_PG_WORKER_SENHA). Papéis são do cluster: o down não o remove.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'macuxi_worker') then
    create role macuxi_worker nologin nosuperuser nobypassrls nocreatedb nocreaterole noreplication;
  end if;
end
$$;

grant usage on schema plataforma to macuxi_worker;

-- ---------------------------------------------------------------------------------------------
-- evento — colunas do envelope do SDK (usuario_id do autor e request_id da requisição). Sem FK para
-- core.usuario: evento pode vir do Hub/sistema e a outbox não depende do schema core.
alter table plataforma.evento add column usuario_id uuid;
alter table plataforma.evento add column request_id text;

-- Alvo de FK composta de evento_consumo (garante que o consumo é do mesmo tenant do evento).
create unique index evento_tenant_id_uk on plataforma.evento (tenant_id, id);

-- Worker: leitura das colunas do envelope e marcação do despacho. Só estas colunas (grant por coluna).
grant select (id, tenant_id, nome, modulo, agregado_id, payload, ocorrido_em, publicado_em, tentativas, usuario_id, request_id)
  on plataforma.evento to macuxi_worker;
grant update (publicado_em, tentativas, ultimo_erro) on plataforma.evento to macuxi_worker;
-- Políticas permissivas SÓ para macuxi_worker (todos os tenants, ADR 0007). A política isolamento_tenant
-- continua sendo a única que vale para macuxi_app (sem contexto => 0 linhas).
create policy despacho_outbox on plataforma.evento for select to macuxi_worker
  using (true);
create policy despacho_outbox_marcar on plataforma.evento for update to macuxi_worker
  using (true) with check (true);

-- ---------------------------------------------------------------------------------------------
-- evento_consumo — registro de evento processado por consumidor (idempotência do handler).
-- O handler grava aqui na MESMA transação do efeito, com `on conflict (tenant_id, consumidor, evento_id) do nothing`.
create table plataforma.evento_consumo (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references plataforma.tenant (id),
  consumidor    text not null,
  evento_id     uuid not null,
  processado_em timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  external_id   text,
  constraint evento_consumo_evento_fk foreign key (tenant_id, evento_id)
    references plataforma.evento (tenant_id, id) on delete cascade,
  constraint evento_consumo_consumidor_formato check (consumidor ~ '^[a-z][a-z0-9-]*(\.[a-z][a-z0-9_-]*)*$'),
  constraint evento_consumo_uk unique (tenant_id, consumidor, evento_id)
);
create index evento_consumo_evento_ix on plataforma.evento_consumo (tenant_id, evento_id);
create trigger evento_consumo_updated_at before update on plataforma.evento_consumo
  for each row execute function plataforma.definir_updated_at();
alter table plataforma.evento_consumo enable row level security;
alter table plataforma.evento_consumo force row level security;
create policy isolamento_tenant on plataforma.evento_consumo for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert, update, delete on plataforma.evento_consumo to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- core.carteira — pull por usuário: where tenant_id = $1 and usuario_id = $2 and (updated_at, id) > ($3, $4)
-- order by updated_at, id. Sem "where deleted_at is null": o pull devolve os removidos (exclusão no aparelho).
create index carteira_usuario_sync_ix on core.carteira (tenant_id, usuario_id, updated_at, id);
