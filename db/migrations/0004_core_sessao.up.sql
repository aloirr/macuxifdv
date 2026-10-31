-- 0004_core_sessao (up) — T-0003 Fase 2 (pedido R-20261031-121739-modulo-core; RF-CORE-01; doc 04 "Sessão")
-- Login real do Core: refresh rotativo por família, bloqueio remoto de aparelho e bloqueio por tentativas.
-- 1. core.usuario: tentativas_falhas e bloqueio_ate (bloqueio TEMPORÁRIO por tentativas: 5 falhas seguidas
--    bloqueiam 15 min, login certo zera — regra no domain do Core). bloqueado_em continua sendo o bloqueio
--    MANUAL do admin.
-- 2. core.dispositivo: aparelho (id = UUID gerado no aparelho), bloqueio remoto (bloqueado_em).
-- 3. core.sessao: refresh opaco `<tenant_id>.<segredo>`; aqui só o sha256 hex do segredo (token_hash),
--    único POR TENANT (a busca é sempre dentro do tenant). familia_id agrupa os refresh descendentes de um
--    login: reuso de refresh já usado revoga a família inteira.
-- 4. core.equipe (tenant_id, responsavel_id): escopo de supervisor/gerente (RN-CORE-04).
-- sessao e dispositivo NÃO entram no sync (sem índice (tenant_id, updated_at, id); db/src/excecoes.ts).
-- Caminho de volta: 0004_core_sessao.down.sql (APAGA sessões, aparelhos e a contagem de tentativas: todo
-- mundo precisa logar de novo; o bloqueio manual bloqueado_em fica).

-- ---------------------------------------------------------------------------------------------
-- usuario — bloqueio por tentativas
alter table core.usuario add column tentativas_falhas smallint not null default 0;
alter table core.usuario add column bloqueio_ate timestamptz;
alter table core.usuario add constraint usuario_tentativas_nao_negativas check (tentativas_falhas >= 0);

-- ---------------------------------------------------------------------------------------------
-- dispositivo — aparelho do usuário (RF-CORE-01: bloqueio remoto). O login faz upsert por id
-- (`on conflict (id)`) e recusa aparelho com bloqueado_em. Volume: 1-2 por usuário.
create table core.dispositivo (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references plataforma.tenant (id),
  usuario_id        uuid not null,
  nome              text,
  plataforma        text,
  ultimo_acesso_em  timestamptz,
  bloqueado_em      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  external_id       text,
  constraint dispositivo_tenant_id_uk unique (tenant_id, id),
  constraint dispositivo_usuario_fk foreign key (tenant_id, usuario_id) references core.usuario (tenant_id, id)
);
create index dispositivo_usuario_ix on core.dispositivo (tenant_id, usuario_id);
create trigger dispositivo_updated_at before update on core.dispositivo
  for each row execute function plataforma.definir_updated_at();
alter table core.dispositivo enable row level security;
alter table core.dispositivo force row level security;
create policy isolamento_tenant on core.dispositivo for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert, update, delete on core.dispositivo to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- sessao — refresh token rotativo (30 dias). Ao trocar: marca usado_em e cria o próximo da mesma família.
-- Consultas: por token_hash (sessao_token_uk); revogar a família (sessao_familia_ix); revogar tudo do
-- usuário no bloqueio remoto (sessao_usuario_ativa_ix); limpeza por expiração (sessao_expira_ix).
-- Volume: ~1 linha por login/refresh por aparelho.
create table core.sessao (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references plataforma.tenant (id),
  usuario_id      uuid not null,
  familia_id      uuid not null,
  token_hash      text not null,
  dispositivo_id  uuid,
  expira_em       timestamptz not null,
  usado_em        timestamptz,
  revogado_em     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  external_id     text,
  constraint sessao_usuario_fk foreign key (tenant_id, usuario_id) references core.usuario (tenant_id, id),
  constraint sessao_dispositivo_fk foreign key (tenant_id, dispositivo_id) references core.dispositivo (tenant_id, id),
  constraint sessao_token_hash_sha256 check (token_hash ~ '^[0-9a-f]{64}$')
);
create unique index sessao_token_uk on core.sessao (tenant_id, token_hash);
create index sessao_usuario_ativa_ix on core.sessao (tenant_id, usuario_id) where revogado_em is null;
create index sessao_familia_ix on core.sessao (tenant_id, familia_id);
create index sessao_expira_ix on core.sessao (tenant_id, expira_em);
create trigger sessao_updated_at before update on core.sessao
  for each row execute function plataforma.definir_updated_at();
alter table core.sessao enable row level security;
alter table core.sessao force row level security;
create policy isolamento_tenant on core.sessao for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert, update, delete on core.sessao to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- equipe — equipes de que o usuário é responsável (escopo de supervisor/gerente, RN-CORE-04).
create index equipe_responsavel_ix on core.equipe (tenant_id, responsavel_id);
