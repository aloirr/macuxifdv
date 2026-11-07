-- 0037_forma_prazo_escalonada (up) — T-0089 (Novo pedido: formas de pagamento e prazos com prazo médio, prazo médio do
-- cliente, tabela escalonada; RN-VEN-15 nova, RN-VEN-23, RN-VEN-24, RN-VEN-25; a RN-VEN-14 foi substituída). Desenho
-- docs/desenho/T-0089.md §1, §2, §6 e §8; pedido R-20261106-073325-engenheiro-software; P7 ajustada pelo gerente
-- (R-20261106-074250-gerente-projetos). Uma migração só (o desenho falava em 0037-0039; o gerente juntou, como a 0033).
-- Dicionário: docs/banco/vendedor.md, docs/banco/core.md e docs/banco/catalogo.md ("0037").
-- Migração ADITIVA: 3 tabelas novas, colunas nulas novas em vendedor.pedido e core.cliente, 4 funções imutáveis de CHECK,
-- a semeadura da forma "À vista" (função + gatilho em plataforma.tenant + backfill). Nada da condição antiga
-- (vendedor.condicao_pagamento, cliente_condicao, pedido.condicao_pagamento*) muda nem é convertido (§2: legado para o APK
-- antigo).
--
-- vendedor.forma_pagamento (dono: Vendedor): forma do tenant (Pix, Dinheiro, Cartão, Boleto...). codigo 1..20, único no
--   tenant entre as vivas (forma_pagamento_codigo_uk); nome 1..60; ativo; ordem (int, ordem da lista). Pull escopo tenant.
--   Volume: dezenas por tenant.
-- vendedor.prazo_pagamento (dono: Vendedor): prazo da forma. FK composta (tenant_id, forma_pagamento_id); codigo 1..20,
--   ÚNICO NO TENANT entre os vivos (não só na forma: o código do prazo vai no condicao_pagamento_codigo do
--   vendedor.pedido.aprovado@1 e no de-para do Hub, §4.3); descricao 1..60 ("28/56 dias", "À vista");
--   parcelas_dias int[] (vendedor.parcelas_validas: 1..24 itens, cada um 0..365, sem decrescer; [0] = à vista);
--   prazo_medio_dias int GRAVADO pela API ou pelo consumidor do Hub com o prazoMedioDias do domain do Vendedor (média
--   arredondada para cima, §8 P2: 28/56 = 42). O banco NÃO recalcula (a regra de arredondamento é do domain e pode
--   mudar sem migração); só confere que o valor está entre a menor e a maior parcela (vendedor.prazo_medio_coerente, vale
--   para qualquer arredondamento da média). ativo; ordem. Pull escopo tenant. Volume: dezenas por tenant.
-- vendedor.pedido (aditivo, nulos nos pedidos antigos e nos do APK antigo): forma_pagamento_id e prazo_pagamento_id (FKs
--   compostas no schema) e o retrato no aceite — forma_pagamento_codigo, forma_pagamento_nome, prazo_codigo,
--   prazo_descricao, prazo_parcelas_dias int[] e prazo_medio_dias. Os 8 vêm juntos ou nenhum (pedido_pagamento_completo):
--   o servidor grava o retrato quando o push traz forma e prazo (§4.1). Que o prazo é da forma, que estão ativos e que o
--   cliente pode usá-los (RN-VEN-24/25) é a API que garante (validarPagamento). A condição antiga fica nula no pedido novo.
-- core.cliente (dono: Core; aditivo, nulos): prazo_medio_max_dias int (0..365; nulo = sem teto, §8 P1) e
--   formas_pagamento text[] (CÓDIGOS das formas, SEM FK: a forma é do Vendedor, regra 1 e ADR 0027; nulo ou vazio = todas
--   as ativas, §8 P1; core.codigos_forma_validos: até 20, cada um 1..20 caracteres, sem repetir). Sem índice (lidos
--   junto do cliente no pull e no cadastro_resumo@1).
-- catalogo.tabela_escalonada (dono: Catálogo, ADR 0005; RN-VEN-23): faixa de preço por quantidade. produto_id SEM FK
--   (core.produto, como a tabela_preco_item); medida = sigla (^[A-Z]{1,4}$) da medida em que a faixa vale, nulo = unidade
--   base (§8 P3: a faixa de 10 FD não vale para 120 UN); quantidade_minima int > 0 (na medida); preco_unidade_cents
--   bigint > 0 = preço da UNIDADE BASE (o da medida é × a quantidade da embalagem, RN-VEN-15); vigência em DATA CIVIL do
--   fuso do tenant, como o Hub manda (DataCivil), FECHADA nas duas pontas [vigencia_inicio, vigencia_fim] (fim nulo =
--   aberta; tabela_escalonada_vigencia_valida: fim >= início); tabela_preco_id nulo = vale para todas as tabelas, com FK
--   composta (tenant_id, tabela_preco_id) -> catalogo.tabela_preco; ativo. Sem grupo de clientes (§8 P6: entra aditivo
--   depois). Única viva por (tenant, produto, medida, quantidade_minima, tabela, vigencia_inicio) com NULLS NOT DISTINCT
--   (tabela_escalonada_faixa_uk; mesmo padrão da tabela_preco_item_vigencia_uk da 0008). Pull escopo tenant. Consulta
--   principal (catalogo.precos_cliente@1, K2): tenant + produto_id = any(...) -> prefixo do faixa_uk. Volume: até
--   dezenas por produto com faixa (milhares por tenant).
-- Semeadura (P7 ajustada): todo tenant tem a forma "À vista" (codigo AVISTA, ordem 0, ativa) com o prazo "À vista"
--   (codigo AVISTA, parcelas [0], prazo médio 0, ativo), external_id nulo, ids determinísticos
--   uuid_de_chave('<tenant>:vendedor.forma_pagamento:AVISTA' | '<tenant>:vendedor.prazo_pagamento:AVISTA'). Tenants
--   existentes: backfill no fim desta migração. Tenant novo: gatilho tenant_semear_pagamento (AFTER INSERT em
--   plataforma.tenant), o mesmo padrão da 0006 (tenant_semear_core) e da 0018 (tenant_semear_medidas) — vale para o
--   plataforma.provisionar_tenant (tenant:criar e o passo Empresa do portal, que inserem o tenant) sem mexer na função, e
--   para os seeds e fixtures. Só semeia se o tenant não tem NENHUMA forma (viva ou apagada): o tenant que apagou ou
--   trocou a forma padrão não a recebe de volta. Função comum (NÃO SECURITY DEFINER), contexto do tenant ligado só
--   durante a semeadura.
--
-- RLS: enable + force + isolamento_tenant (macuxi_app) + manutencao (0031) nas 3 tabelas. macuxi_app: select, insert,
-- update, delete (como condicao_pagamento e tabela_preco_item). macuxi_worker: sem acesso.
-- Caminho de volta: 0037_forma_prazo_escalonada.down.sql (APAGA as 3 tabelas com as formas, os prazos e as faixas, as
-- colunas novas do pedido com o retrato do pagamento e as do cliente com o prazo médio e as formas permitidas; o gatilho e
-- as funções). Os pedidos continuam com a condição antiga quando a tiverem; os do modelo novo perdem forma e prazo.

-- =============================================================================================
-- Funções de CHECK (imutáveis; CHECK não aceita subconsulta)
-- =============================================================================================
-- parcelas: array de 1 dimensão, 1..24 itens, cada um não nulo e 0..365, sem decrescer (RN-VEN-24)
create function vendedor.parcelas_validas(p integer[]) returns boolean
  language sql immutable parallel safe
  set search_path = pg_catalog, pg_temp
  as $$
    select p is not null
       and array_ndims(p) = 1
       and cardinality(p) between 1 and 24
       and coalesce((select bool_and(e is not null and e between 0 and 365) from unnest(p) as e), false)
       and coalesce((select bool_and(p[i] >= p[i - 1]) from generate_subscripts(p, 1) as i where i > array_lower(p, 1)), true)
  $$;
grant execute on function vendedor.parcelas_validas(integer[]) to macuxi_app;

-- prazo médio entre a menor e a maior parcela (qualquer arredondamento da média passa; o cálculo é do domain, §5)
create function vendedor.prazo_medio_coerente(p integer[], m integer) returns boolean
  language sql immutable parallel safe
  set search_path = pg_catalog, pg_temp
  as $$
    select p is not null and m is not null and cardinality(p) > 0
       and m between (select min(e) from unnest(p) as e) and (select max(e) from unnest(p) as e)
  $$;
grant execute on function vendedor.prazo_medio_coerente(integer[], integer) to macuxi_app;

-- códigos das formas permitidas ao cliente: até 20, array de 1 dimensão, cada um não nulo, não vazio, até 20 caracteres,
-- sem repetir (vazio = todas as ativas, §8 P1)
create function core.codigos_forma_validos(p text[]) returns boolean
  language sql immutable parallel safe
  set search_path = pg_catalog, pg_temp
  as $$
    select p is not null
       and cardinality(p) <= 20
       and (array_ndims(p) is null or array_ndims(p) = 1)
       and coalesce((select bool_and(e is not null and btrim(e) <> '' and char_length(e) <= 20) from unnest(p) as e), true)
       and (select count(distinct e) from unnest(p) as e) = cardinality(p)
  $$;
grant execute on function core.codigos_forma_validos(text[]) to macuxi_app;

-- =============================================================================================
-- vendedor.forma_pagamento — forma de pagamento do tenant (RN-VEN-24)
-- =============================================================================================
create table vendedor.forma_pagamento (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references plataforma.tenant (id),
  codigo       text not null,
  nome         text not null,
  ativo        boolean not null default true,
  ordem        integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  external_id  text,
  constraint forma_pagamento_tenant_id_uk unique (tenant_id, id),
  constraint forma_pagamento_codigo_preenchido check (btrim(codigo) <> '' and char_length(codigo) <= 20),
  constraint forma_pagamento_nome_preenchido check (btrim(nome) <> '' and char_length(nome) <= 60)
);
create unique index forma_pagamento_codigo_uk on vendedor.forma_pagamento (tenant_id, codigo) where deleted_at is null;
create index forma_pagamento_sync_ix on vendedor.forma_pagamento (tenant_id, updated_at, id);
create unique index forma_pagamento_external_uk on vendedor.forma_pagamento (tenant_id, external_id) where external_id is not null and deleted_at is null;
create trigger forma_pagamento_updated_at before update on vendedor.forma_pagamento
  for each row execute function plataforma.definir_updated_at();
alter table vendedor.forma_pagamento enable row level security;
alter table vendedor.forma_pagamento force row level security;
create policy isolamento_tenant on vendedor.forma_pagamento for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
create policy manutencao on vendedor.forma_pagamento for all to macuxi_manutencao using (true) with check (true);
grant select, insert, update, delete on vendedor.forma_pagamento to macuxi_app;

-- =============================================================================================
-- vendedor.prazo_pagamento — prazo da forma, com parcelas e prazo médio (RN-VEN-24, RN-VEN-25)
-- =============================================================================================
create table vendedor.prazo_pagamento (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references plataforma.tenant (id),
  forma_pagamento_id  uuid not null,
  codigo              text not null,
  descricao           text not null,
  parcelas_dias       integer[] not null,
  prazo_medio_dias    integer not null,
  ativo               boolean not null default true,
  ordem               integer not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz,
  external_id         text,
  constraint prazo_pagamento_tenant_id_uk unique (tenant_id, id),
  constraint prazo_pagamento_forma_fk foreign key (tenant_id, forma_pagamento_id) references vendedor.forma_pagamento (tenant_id, id),
  constraint prazo_pagamento_codigo_preenchido check (btrim(codigo) <> '' and char_length(codigo) <= 20),
  constraint prazo_pagamento_descricao_preenchida check (btrim(descricao) <> '' and char_length(descricao) <= 60),
  constraint prazo_pagamento_parcelas_validas check (vendedor.parcelas_validas(parcelas_dias)),
  constraint prazo_pagamento_prazo_medio_coerente check (vendedor.prazo_medio_coerente(parcelas_dias, prazo_medio_dias))
);
create unique index prazo_pagamento_codigo_uk on vendedor.prazo_pagamento (tenant_id, codigo) where deleted_at is null;
create index prazo_pagamento_forma_ix on vendedor.prazo_pagamento (tenant_id, forma_pagamento_id);
create index prazo_pagamento_sync_ix on vendedor.prazo_pagamento (tenant_id, updated_at, id);
create unique index prazo_pagamento_external_uk on vendedor.prazo_pagamento (tenant_id, external_id) where external_id is not null and deleted_at is null;
create trigger prazo_pagamento_updated_at before update on vendedor.prazo_pagamento
  for each row execute function plataforma.definir_updated_at();
alter table vendedor.prazo_pagamento enable row level security;
alter table vendedor.prazo_pagamento force row level security;
create policy isolamento_tenant on vendedor.prazo_pagamento for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
create policy manutencao on vendedor.prazo_pagamento for all to macuxi_manutencao using (true) with check (true);
grant select, insert, update, delete on vendedor.prazo_pagamento to macuxi_app;

-- =============================================================================================
-- vendedor.pedido — forma, prazo e o retrato do pagamento no aceite (§4.1; nulos nos pedidos antigos)
-- =============================================================================================
alter table vendedor.pedido add column forma_pagamento_id uuid;
alter table vendedor.pedido add column prazo_pagamento_id uuid;
alter table vendedor.pedido add column forma_pagamento_codigo text;
alter table vendedor.pedido add column forma_pagamento_nome text;
alter table vendedor.pedido add column prazo_codigo text;
alter table vendedor.pedido add column prazo_descricao text;
alter table vendedor.pedido add column prazo_parcelas_dias integer[];
alter table vendedor.pedido add column prazo_medio_dias integer;
alter table vendedor.pedido add constraint pedido_forma_pagamento_fk foreign key (tenant_id, forma_pagamento_id) references vendedor.forma_pagamento (tenant_id, id);
alter table vendedor.pedido add constraint pedido_prazo_pagamento_fk foreign key (tenant_id, prazo_pagamento_id) references vendedor.prazo_pagamento (tenant_id, id);
alter table vendedor.pedido add constraint pedido_pagamento_completo check (
  num_nulls(forma_pagamento_id, prazo_pagamento_id, forma_pagamento_codigo, forma_pagamento_nome, prazo_codigo, prazo_descricao,
            prazo_parcelas_dias, prazo_medio_dias) in (0, 8));
alter table vendedor.pedido add constraint pedido_prazo_parcelas_validas check (prazo_parcelas_dias is null or vendedor.parcelas_validas(prazo_parcelas_dias));
alter table vendedor.pedido add constraint pedido_prazo_medio_coerente check (prazo_medio_dias is null or vendedor.prazo_medio_coerente(prazo_parcelas_dias, prazo_medio_dias));

-- =============================================================================================
-- core.cliente — formas permitidas (códigos) e prazo médio máximo (RN-VEN-25)
-- =============================================================================================
alter table core.cliente add column prazo_medio_max_dias integer;
alter table core.cliente add column formas_pagamento text[];
alter table core.cliente add constraint cliente_prazo_medio_max_faixa check (prazo_medio_max_dias is null or prazo_medio_max_dias between 0 and 365);
alter table core.cliente add constraint cliente_formas_pagamento_validas check (formas_pagamento is null or core.codigos_forma_validos(formas_pagamento));

-- =============================================================================================
-- catalogo.tabela_escalonada — faixa de preço por quantidade (RN-VEN-23)
-- =============================================================================================
create table catalogo.tabela_escalonada (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references plataforma.tenant (id),
  produto_id           uuid not null,
  medida               text,
  quantidade_minima    integer not null,
  preco_unidade_cents  bigint not null,
  vigencia_inicio      date not null,
  vigencia_fim         date,
  tabela_preco_id      uuid,
  ativo                boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  deleted_at           timestamptz,
  external_id          text,
  constraint tabela_escalonada_tabela_fk foreign key (tenant_id, tabela_preco_id) references catalogo.tabela_preco (tenant_id, id),
  constraint tabela_escalonada_medida_formato check (medida is null or medida ~ '^[A-Z]{1,4}$'),
  constraint tabela_escalonada_quantidade_positiva check (quantidade_minima > 0),
  constraint tabela_escalonada_preco_positivo check (preco_unidade_cents > 0),
  constraint tabela_escalonada_vigencia_valida check (vigencia_fim is null or vigencia_fim >= vigencia_inicio)
);
create unique index tabela_escalonada_faixa_uk on catalogo.tabela_escalonada
  (tenant_id, produto_id, medida, quantidade_minima, tabela_preco_id, vigencia_inicio) nulls not distinct where deleted_at is null;
create index tabela_escalonada_tabela_ix on catalogo.tabela_escalonada (tenant_id, tabela_preco_id) where tabela_preco_id is not null;
create index tabela_escalonada_sync_ix on catalogo.tabela_escalonada (tenant_id, updated_at, id);
create unique index tabela_escalonada_external_uk on catalogo.tabela_escalonada (tenant_id, external_id) where external_id is not null and deleted_at is null;
create trigger tabela_escalonada_updated_at before update on catalogo.tabela_escalonada
  for each row execute function plataforma.definir_updated_at();
alter table catalogo.tabela_escalonada enable row level security;
alter table catalogo.tabela_escalonada force row level security;
create policy isolamento_tenant on catalogo.tabela_escalonada for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
create policy manutencao on catalogo.tabela_escalonada for all to macuxi_manutencao using (true) with check (true);
grant select, insert, update, delete on catalogo.tabela_escalonada to macuxi_app;

-- =============================================================================================
-- Semeadura: forma "À vista" com o prazo "À vista" em todo tenant (P7 ajustada)
-- =============================================================================================
create function vendedor.semear_pagamento(p_tenant uuid) returns void
  language plpgsql
  set search_path = pg_catalog, vendedor, plataforma, pg_temp
  as $$
declare
  v_contexto text := current_setting('app.tenant_id', true);
  v_forma uuid := plataforma.uuid_de_chave(p_tenant::text || ':vendedor.forma_pagamento:AVISTA');
  v_n integer;
begin
  perform set_config('app.tenant_id', p_tenant::text, true);
  insert into vendedor.forma_pagamento (id, tenant_id, codigo, nome, ativo, ordem)
  select v_forma, p_tenant, 'AVISTA', 'À vista', true, 0
   where not exists (select 1 from vendedor.forma_pagamento f where f.tenant_id = p_tenant)
  on conflict do nothing;
  get diagnostics v_n = row_count;
  if v_n = 1 then
    insert into vendedor.prazo_pagamento (id, tenant_id, forma_pagamento_id, codigo, descricao, parcelas_dias, prazo_medio_dias, ativo, ordem)
    values (plataforma.uuid_de_chave(p_tenant::text || ':vendedor.prazo_pagamento:AVISTA'), p_tenant, v_forma, 'AVISTA', 'À vista', '{0}', 0, true, 0)
    on conflict do nothing;
  end if;
  perform set_config('app.tenant_id', coalesce(v_contexto, ''), true);
end
$$;
revoke all on function vendedor.semear_pagamento(uuid) from public;

create function vendedor.semear_tenant_pagamento() returns trigger
  language plpgsql
  set search_path = pg_catalog, vendedor, pg_temp
  as $$
begin
  perform vendedor.semear_pagamento(new.id);
  return null;
end
$$;
revoke all on function vendedor.semear_tenant_pagamento() from public;

create trigger tenant_semear_pagamento after insert on plataforma.tenant
  for each row execute function vendedor.semear_tenant_pagamento();

-- tenants existentes (demo, piloto e os de teste): a forma e o prazo padrão
select vendedor.semear_pagamento(t.id) from plataforma.tenant t;
