-- 0057_core_foto_pdv (up) — T-0147 (fotos do PDV: tipos no BKO, fotos na ficha por câmera ou galeria, documentos sensíveis;
-- RN-CORE-38, RF-CORE-15; ADR 0041). Desenho docs/desenho/T-0147.md §3 e §7; pedido R-20261110-065020-engenheiro-software
-- (origem R-20261110-062234-alexandre e R-20261110-062242-alexandre). Migração em cima da 0056.
-- Dicionário: docs/banco/core.md, plataforma.md e lgpd.md ("0057 — fotos do PDV").
-- Migração ADITIVA: 2 tabelas novas no Core, 1 coluna + gatilho em core.cliente, 1 coluna + CHECK em plataforma.arquivo e a
-- semeadura do tipo "Fachada" (função + gatilho em plataforma.tenant + backfill).
--
-- core.foto_tipo (dono: Core): tipo de foto do PDV do tenant (Fachada, CNH do sócio, Contrato social...). nome 1..60, único vivo
--   no tenant SEM diferenciar maiúsculas (foto_tipo_nome_uk sobre lower(nome)); obrigatorio; sensivel (documento: só admin,
--   analista e supervisor da carteira abrem, ADR 0041); fachada (o tipo do botão "Ver foto do PDV"): UM vivo por tenant
--   (foto_tipo_fachada_uk), nunca sensível (foto_tipo_fachada_nao_sensivel) e nunca apagado (foto_tipo_fachada_viva); ordem;
--   ativo. Pull escopo tenant. Volume: unidades por tenant.
-- Semeadura (desenho §3): "Fachada" (fachada, obrigatório, ordem 0), id = uuid_de_chave('<tenant>:core.foto_tipo:fachada')
--   (idFotoTipoFachada em db/src/ids.ts). Tenant novo: gatilho tenant_semear_foto_tipo (AFTER INSERT em plataforma.tenant), o
--   padrão da 0006/0018/0037/0056 — vale para o provisionar_tenant e a sa_provisionar_tenant sem mexer nelas. Idempotente: só
--   cria se o tenant não tem tipo fachada vivo nem um tipo vivo chamado "fachada".
-- core.cliente_foto (dono: Core): a foto VIGENTE de cada tipo de cada cliente. id = UUID do aparelho (escrita idempotente);
--   cliente_id e foto_tipo_id com FK composta; arquivo_id = id de plataforma.arquivo (SEM FK: outro schema, ADR 0010), único no
--   tenant entre TODAS as linhas (um arquivo é de uma foto só); origem camera|galeria; enviado_por (FK composta core.usuario);
--   tirada_em (instante do aparelho, UTC). Única viva por (tenant, cliente, tipo) (cliente_foto_vigente_uk): substituir = apagar a
--   antiga logicamente e gravar a nova na mesma transação (BKO; o vendedor só envia o que falta, podeEnviarFoto). Pull escopo
--   carteira (índice (tenant_id, cliente_id)), com arquivo_id NULO quando o tipo é sensível (consulta em docs/banco/core.md).
--   Volume: até ~1 por tipo por cliente (500 clientes × 3 tipos por vendedor).
-- core.cliente.inativado_em timestamptz (relógio da retenção de 5 anos, desenho §7 e docs/banco/lgpd.md): gatilho
--   cliente_inativado_em (BEFORE INSERT OR UPDATE OF ativo): ativo vira falso -> now() (mantém se já estava inativo); volta a
--   verdadeiro -> nulo. Fora do pull (só o expurgo do servidor usa). Backfill: clientes já inativos = updated_at (melhor
--   estimativa; o prazo de 5 anos não vence antes de 2031).
-- plataforma.arquivo.perfis_leitura text[] (ADR 0041): NULO = regra de hoje (licença + perfil do módulo + carteira); lista =
--   o usuário precisa de um destes perfis E da carteira. CHECK arquivo_perfis_leitura_validos: 1..7 perfis da plataforma
--   (PERFIS do platform-sdk), sem nulo; lista vazia é recusada (use nulo).
--
-- RLS: core.foto_tipo e core.cliente_foto com enable + force + isolamento_tenant (macuxi_app) + manutencao (0031). macuxi_app:
-- select, insert, update, delete. macuxi_worker: sem acesso. Colunas novas herdam o RLS das tabelas.
-- Caminho de volta: 0057_core_foto_pdv.down.sql (APAGA os tipos e as fotos do PDV — os metadados em plataforma.arquivo e os
-- bytes no armazenamento ficam; perfis_leitura sai, e com ela a restrição de leitura dos documentos sensíveis: desfaça antes a
-- regra do GET /v1/arquivos/:id e apague os arquivos de finalidade 'pdv' se a restrição não puder cair).

-- =============================================================================================
-- core.foto_tipo — tipos de foto do PDV (RN-CORE-38)
-- =============================================================================================
create table core.foto_tipo (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references plataforma.tenant (id),
  nome         text not null,
  obrigatorio  boolean not null default false,
  sensivel     boolean not null default false,
  fachada      boolean not null default false,
  ordem        integer not null default 0,
  ativo        boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  external_id  text,
  constraint foto_tipo_tenant_id_uk unique (tenant_id, id),
  constraint foto_tipo_nome_preenchido check (btrim(nome) <> '' and char_length(nome) <= 60),
  constraint foto_tipo_fachada_nao_sensivel check (not (fachada and sensivel)),
  constraint foto_tipo_fachada_viva check (not fachada or deleted_at is null)
);
create unique index foto_tipo_nome_uk on core.foto_tipo (tenant_id, lower(nome)) where deleted_at is null;
create unique index foto_tipo_fachada_uk on core.foto_tipo (tenant_id) where fachada and deleted_at is null;
create index foto_tipo_sync_ix on core.foto_tipo (tenant_id, updated_at, id);
create unique index foto_tipo_external_uk on core.foto_tipo (tenant_id, external_id) where external_id is not null and deleted_at is null;
create trigger foto_tipo_updated_at before update on core.foto_tipo
  for each row execute function plataforma.definir_updated_at();
alter table core.foto_tipo enable row level security;
alter table core.foto_tipo force row level security;
create policy isolamento_tenant on core.foto_tipo for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
create policy manutencao on core.foto_tipo for all to macuxi_manutencao using (true) with check (true);
grant select, insert, update, delete on core.foto_tipo to macuxi_app;

-- =============================================================================================
-- core.cliente_foto — a foto vigente de cada tipo de cada cliente (RN-CORE-38)
-- =============================================================================================
create table core.cliente_foto (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references plataforma.tenant (id),
  cliente_id    uuid not null,
  foto_tipo_id  uuid not null,
  arquivo_id    uuid not null,
  origem        text not null default 'camera',
  enviado_por   uuid not null,
  tirada_em     timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  external_id   text,
  constraint cliente_foto_tenant_id_uk unique (tenant_id, id),
  constraint cliente_foto_cliente_fk foreign key (tenant_id, cliente_id) references core.cliente (tenant_id, id),
  constraint cliente_foto_tipo_fk foreign key (tenant_id, foto_tipo_id) references core.foto_tipo (tenant_id, id),
  constraint cliente_foto_enviado_por_fk foreign key (tenant_id, enviado_por) references core.usuario (tenant_id, id),
  constraint cliente_foto_origem_valida check (origem in ('camera', 'galeria'))
);
create unique index cliente_foto_vigente_uk on core.cliente_foto (tenant_id, cliente_id, foto_tipo_id) where deleted_at is null;
create unique index cliente_foto_arquivo_uk on core.cliente_foto (tenant_id, arquivo_id);
create index cliente_foto_cliente_ix on core.cliente_foto (tenant_id, cliente_id);
create index cliente_foto_tipo_ix on core.cliente_foto (tenant_id, foto_tipo_id);
create index cliente_foto_sync_ix on core.cliente_foto (tenant_id, updated_at, id);
create unique index cliente_foto_external_uk on core.cliente_foto (tenant_id, external_id) where external_id is not null and deleted_at is null;
create trigger cliente_foto_updated_at before update on core.cliente_foto
  for each row execute function plataforma.definir_updated_at();
alter table core.cliente_foto enable row level security;
alter table core.cliente_foto force row level security;
create policy isolamento_tenant on core.cliente_foto for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
create policy manutencao on core.cliente_foto for all to macuxi_manutencao using (true) with check (true);
grant select, insert, update, delete on core.cliente_foto to macuxi_app;

-- =============================================================================================
-- Semeadura: tipo "Fachada" em todo tenant (desenho §3)
-- =============================================================================================
create function core.semear_foto_tipo(p_tenant uuid) returns void
  language plpgsql
  set search_path = pg_catalog, core, plataforma, pg_temp
  as $$
declare
  v_contexto text := current_setting('app.tenant_id', true);
begin
  perform set_config('app.tenant_id', p_tenant::text, true);
  insert into core.foto_tipo (id, tenant_id, nome, obrigatorio, sensivel, fachada, ordem, ativo)
  select plataforma.uuid_de_chave(p_tenant::text || ':core.foto_tipo:fachada'), p_tenant, 'Fachada', true, false, true, 0, true
   where not exists (
     select 1 from core.foto_tipo t
      where t.tenant_id = p_tenant and t.deleted_at is null and (t.fachada or lower(t.nome) = 'fachada')
   )
  on conflict do nothing;
  perform set_config('app.tenant_id', coalesce(v_contexto, ''), true);
end
$$;
revoke all on function core.semear_foto_tipo(uuid) from public;

create function core.semear_tenant_foto_tipo() returns trigger
  language plpgsql
  set search_path = pg_catalog, core, pg_temp
  as $$
begin
  perform core.semear_foto_tipo(new.id);
  return null;
end
$$;
revoke all on function core.semear_tenant_foto_tipo() from public;

create trigger tenant_semear_foto_tipo after insert on plataforma.tenant
  for each row execute function core.semear_tenant_foto_tipo();

-- tenants existentes (demo, piloto e os de teste): o tipo "Fachada"
select core.semear_foto_tipo(t.id) from plataforma.tenant t;

-- =============================================================================================
-- core.cliente.inativado_em — relógio da retenção (cliente inativo + 5 anos; desenho §7)
-- =============================================================================================
alter table core.cliente add column inativado_em timestamptz;
update core.cliente set inativado_em = updated_at where not ativo and inativado_em is null;

create function core.marcar_cliente_inativado() returns trigger
  language plpgsql
  set search_path = pg_catalog, core, pg_temp
  as $$
begin
  if new.ativo then
    new.inativado_em := null;
  elsif tg_op = 'INSERT' or old.ativo then
    new.inativado_em := coalesce(new.inativado_em, now());
  else
    new.inativado_em := coalesce(new.inativado_em, old.inativado_em, now());
  end if;
  return new;
end
$$;
revoke all on function core.marcar_cliente_inativado() from public;
grant execute on function core.marcar_cliente_inativado() to macuxi_app;

create trigger cliente_inativado_em before insert or update of ativo on core.cliente
  for each row execute function core.marcar_cliente_inativado();

-- =============================================================================================
-- plataforma.arquivo.perfis_leitura — leitura restrita por perfil (ADR 0041)
-- =============================================================================================
alter table plataforma.arquivo add column perfis_leitura text[];
alter table plataforma.arquivo add constraint arquivo_perfis_leitura_validos check (
  perfis_leitura is null
  or (
    cardinality(perfis_leitura) between 1 and 7
    and array_position(perfis_leitura, null) is null
    and perfis_leitura <@ array['vendedor', 'promotor', 'supervisor', 'gerente', 'analista', 'assistente', 'admin']::text[]
  )
);
