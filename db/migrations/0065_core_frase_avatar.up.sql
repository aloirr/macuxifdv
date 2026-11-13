-- 0065_core_frase_avatar (up) — T-0170 (frase do dia RN-CORE-41 e foto ou avatar do usuário RN-CORE-42). Desenho
-- docs/desenho/inicio-frase-avatar-pedidos.md §1.1, §1.2 e §2. Migração em cima da 0064. Dicionário: docs/banco/core.md
-- ("0065"). Teste: db/testes/t0170-frase-avatar.db.test.ts (estático no PC; banco e up/down no CI).
--
-- Migração ADITIVA: 2 tabelas novas no Core e a carga das 30 frases padrão (função + gatilho em plataforma.tenant + backfill).
--
-- core.frase_dia (dono: Core): frases do rodízio do Início. texto 1..120 depois do trim; ativa (inativa fica no BKO e sai do
--   rodízio); ordem (o BKO reordena; empate pelo id); padrao_codigo P01..P30 nas que vieram com o FDV (nulo nas do tenant).
--   Únicos: frase_dia_padrao_uk (tenant, padrao_codigo) SEM filtro de deleted_at (de propósito: a frase padrão removida pelo
--   tenant não volta em nenhuma recarga) e frase_dia_texto_uk (tenant, lower(btrim(texto))) VIVO (sem frase repetida).
--   Limite de 366 vivas por tenant: domain e API (422 RN-CORE-41), não o banco. Pull `frase_dia` escopo tenant (inclui
--   removidas). Volume: 30 a 366 por tenant.
-- Carga das 30 (texto = modules/core/domain/frase-avatar/frases-padrao.ts, aprovado pelo dono do produto): função
--   core.semear_frase_dia(tenant), id = uuid_de_chave('<tenant>:core.frase_dia:<código>'), ordem 1..30, ON CONFLICT DO NOTHING
--   (idempotente: código, texto vivo ou id já existentes ficam como estão). Tenant novo: gatilho tenant_semear_frase_dia
--   (AFTER INSERT em plataforma.tenant), o padrão da 0006/0018/0037/0056/0057 — roda na mesma transação do
--   plataforma.provisionar_tenant e da sa_provisionar_tenant (que inserem o tenant) SEM recriar as funções, e vale para seeds e
--   fixtures. Tenants existentes: backfill no fim desta migração.
-- core.usuario_avatar (dono: Core): uma linha POR TROCA de foto/avatar; a viva é a escolha atual (sem viva = iniciais). id =
--   UUID da troca (aparelho ou navegador: idempotência). usuario_id (FK composta core.usuario); tipo iniciais|avatar|foto;
--   avatar_codigo m1..m3|f1..f3 só e sempre no tipo avatar; arquivo_id (id de plataforma.arquivo, SEM FK: ADR 0010) só e sempre
--   no tipo foto, único no tenant entre todas as linhas; alterado_em (instante da troca: decide quem vence); alterado_por (FK
--   composta core.usuario). Uma viva por usuário (usuario_avatar_vivo_uk). Pull `usuario_avatar` escopo usuários visíveis
--   (índice (tenant_id, usuario_id, updated_at, id)). Volume: 1 viva por usuário + o histórico de trocas.
--
-- RLS: as 2 tabelas com enable + force + isolamento_tenant (macuxi_app) + manutencao (0031). macuxi_app: select, insert e
-- update, SEM delete (remover = deleted_at). macuxi_worker: sem acesso.
--
-- Caminho de volta: 0065_core_frase_avatar.down.sql (APAGA as frases — padrão e do tenant — e as trocas de avatar; os metadados
-- das fotos em plataforma.arquivo, finalidade 'avatar', e os bytes FICAM). Volte antes o Core que lê ou grava as tabelas.

-- =============================================================================================
-- core.frase_dia — frase do dia do Início (RN-CORE-41)
-- =============================================================================================
create table core.frase_dia (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references plataforma.tenant (id),
  texto          text not null,
  ativa          boolean not null default true,
  ordem          integer not null,
  padrao_codigo  text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  external_id    text,
  constraint frase_dia_tenant_id_uk unique (tenant_id, id),
  constraint frase_dia_texto_tamanho check (char_length(btrim(texto)) between 1 and 120),
  constraint frase_dia_padrao_codigo_formato check (padrao_codigo is null or padrao_codigo ~ '^P[0-9]{2,3}$')
);
create unique index frase_dia_padrao_uk on core.frase_dia (tenant_id, padrao_codigo);
create unique index frase_dia_texto_uk on core.frase_dia (tenant_id, lower(btrim(texto))) where deleted_at is null;
create index frase_dia_sync_ix on core.frase_dia (tenant_id, updated_at, id);
create unique index frase_dia_external_uk on core.frase_dia (tenant_id, external_id) where external_id is not null and deleted_at is null;
create trigger frase_dia_updated_at before update on core.frase_dia
  for each row execute function plataforma.definir_updated_at();
alter table core.frase_dia enable row level security;
alter table core.frase_dia force row level security;
create policy isolamento_tenant on core.frase_dia for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
create policy manutencao on core.frase_dia for all to macuxi_manutencao using (true) with check (true);
grant select, insert, update on core.frase_dia to macuxi_app;

-- =============================================================================================
-- core.usuario_avatar — foto ou avatar do usuário, uma linha por troca (RN-CORE-42)
-- =============================================================================================
create table core.usuario_avatar (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references plataforma.tenant (id),
  usuario_id     uuid not null,
  tipo           text not null,
  avatar_codigo  text,
  arquivo_id     uuid,
  alterado_em    timestamptz not null,
  alterado_por   uuid not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  external_id    text,
  constraint usuario_avatar_tenant_id_uk unique (tenant_id, id),
  constraint usuario_avatar_usuario_fk foreign key (tenant_id, usuario_id) references core.usuario (tenant_id, id),
  constraint usuario_avatar_alterado_por_fk foreign key (tenant_id, alterado_por) references core.usuario (tenant_id, id),
  constraint usuario_avatar_tipo_valido check (tipo in ('iniciais', 'avatar', 'foto')),
  constraint usuario_avatar_codigo_valido check (avatar_codigo is null or avatar_codigo in ('m1', 'm2', 'm3', 'f1', 'f2', 'f3')),
  constraint usuario_avatar_codigo_coerente check ((tipo = 'avatar') = (avatar_codigo is not null)),
  constraint usuario_avatar_arquivo_coerente check ((tipo = 'foto') = (arquivo_id is not null))
);
create unique index usuario_avatar_vivo_uk on core.usuario_avatar (tenant_id, usuario_id) where deleted_at is null;
create unique index usuario_avatar_arquivo_uk on core.usuario_avatar (tenant_id, arquivo_id);
create index usuario_avatar_sync_ix on core.usuario_avatar (tenant_id, updated_at, id);
create index usuario_avatar_usuario_sync_ix on core.usuario_avatar (tenant_id, usuario_id, updated_at, id);
create unique index usuario_avatar_external_uk on core.usuario_avatar (tenant_id, external_id) where external_id is not null and deleted_at is null;
create trigger usuario_avatar_updated_at before update on core.usuario_avatar
  for each row execute function plataforma.definir_updated_at();
alter table core.usuario_avatar enable row level security;
alter table core.usuario_avatar force row level security;
create policy isolamento_tenant on core.usuario_avatar for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
create policy manutencao on core.usuario_avatar for all to macuxi_manutencao using (true) with check (true);
grant select, insert, update on core.usuario_avatar to macuxi_app;

-- =============================================================================================
-- Carga das 30 frases padrão (desenho §1.1): função + gatilho em plataforma.tenant + backfill
-- =============================================================================================
create function core.semear_frase_dia(p_tenant uuid) returns void
  language plpgsql
  set search_path = pg_catalog, core, plataforma, pg_temp
  as $$
declare
  v_contexto text := current_setting('app.tenant_id', true);
begin
  perform set_config('app.tenant_id', p_tenant::text, true);
  insert into core.frase_dia (id, tenant_id, texto, ativa, ordem, padrao_codigo)
  select plataforma.uuid_de_chave(p_tenant::text || ':core.frase_dia:' || f.codigo), p_tenant, f.texto, true, f.ordem, f.codigo
    from (values
30
    ('P01', 1, 'Cada visita bem feita abre a porta para a próxima venda.'),
    ('P02', 2, 'O cliente lembra de quem aparece. Apareça.'),
    ('P03', 3, 'Rota cumprida é meta mais perto.'),
    ('P04', 4, 'Hoje é dia de positivar quem ficou para trás.'),
    ('P05', 5, 'Quem conhece o cliente vende mais do que quem só oferece.'),
    ('P06', 6, 'Um bom pedido começa com uma boa pergunta.'),
    ('P07', 7, 'A meta do mês se faz no dia de hoje.'),
    ('P08', 8, 'Constância vence talento que não aparece.'),
    ('P09', 9, 'Ouça primeiro, ofereça depois.'),
    ('P10', 10, 'Cada cliente atendido é uma relação que cresce.'),
    ('P11', 11, 'Seu sorriso também está no catálogo.'),
    ('P12', 12, 'Planejar a rota é ganhar tempo na rua.'),
    ('P13', 13, 'O "não" de hoje pode ser o pedido de amanhã.'),
    ('P14', 14, 'Mix bem vendido é cliente bem atendido.'),
    ('P15', 15, 'Chegue cedo, saia com o pedido.'),
    ('P16', 16, 'Quem cuida da gôndola cuida da venda.'),
    ('P17', 17, 'Resultado é a soma de pequenas visitas bem feitas.'),
    ('P18', 18, 'Confiança se constrói a cada entrega cumprida.'),
    ('P19', 19, 'Venda boa é a que o cliente quer repetir.'),
    ('P20', 20, 'Hoje tem cliente esperando a sua visita.'),
    ('P21', 21, 'Foco no que você controla: a próxima visita.'),
    ('P22', 22, 'Seu trabalho move o comércio da cidade.'),
    ('P23', 23, 'Cada quilômetro rodado tem um cliente no final.'),
    ('P24', 24, 'Bom atendimento não tem dia ruim.'),
    ('P25', 25, 'A diferença está nos detalhes da visita.'),
    ('P26', 26, 'Persistência transforma rota em resultado.'),
    ('P27', 27, 'O melhor argumento é conhecer bem o produto.'),
    ('P28', 28, 'Um cliente satisfeito indica outro.'),
    ('P29', 29, 'Comece forte, termine com pedido.'),
    ('P30', 30, 'Você é a cara da empresa na rua. Faça valer.')
    ) as f (codigo, ordem, texto)
   order by f.ordem
  on conflict do nothing;
  perform set_config('app.tenant_id', coalesce(v_contexto, ''), true);
end
$$;
revoke all on function core.semear_frase_dia(uuid) from public;

create function core.semear_tenant_frase_dia() returns trigger
  language plpgsql
  set search_path = pg_catalog, core, pg_temp
  as $$
begin
  perform core.semear_frase_dia(new.id);
  return null;
end
$$;
revoke all on function core.semear_tenant_frase_dia() from public;

create trigger tenant_semear_frase_dia after insert on plataforma.tenant
  for each row execute function core.semear_tenant_frase_dia();

-- tenants existentes (demo, piloto e os de teste): as 30 frases padrão
select core.semear_frase_dia(t.id) from plataforma.tenant t;
