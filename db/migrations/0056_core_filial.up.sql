-- 0056_core_filial (up) — T-0149 (filial: cadastro, filial do cliente, estoque e preço por filial, filial no pedido até o ERP;
-- RN-CORE-39, RF-CORE-16; ADR 0040). Desenho docs/desenho/T-0149.md §3; pedidos R-20261110-064112-engenheiro-software e
-- R-20261110-074414-modulo-integracao (origem R-20261110-062236-alexandre). Migração em cima da 0055.
-- Dicionário: docs/banco/core.md, catalogo.md, vendedor.md e integracao.md ("0056 — filial").
-- Migração ADITIVA: 1 tabela nova (core.filial), colunas novas em core.cliente, catalogo.deposito, catalogo.tabela_preco_item,
-- catalogo.tabela_escalonada e vendedor.pedido, a semeadura da filial padrão (função + gatilho em plataforma.tenant + backfill)
-- e a entidade `filial` nos CHECKs do Hub. Nenhum contrato muda de versão.
--
-- core.filial (dono: Core): unidade de onde saem as entregas. codigo 1..20, único vivo no tenant (filial_codigo_uk); nome 1..80;
--   cidade 1..80 e uf ^[A-Z]{2}$, as duas NULAS no banco só para a padrão recém-nascida (o BKO pede para completar; o
--   obrigatório é do domain, validarFilial); padrao: UMA viva por tenant (filial_padrao_uk, único parcial) e a padrão é
--   sempre ativa e viva (filial_padrao_ativa: not padrao or (ativo and deleted_at is null)). Trocar a padrão = numa transação,
--   tirar a marca da atual ANTES de marcar a nova (o único parcial não é adiável). external_id = chave do ERP, única viva.
--   Pull escopo tenant. Volume: unidades a dezenas por tenant.
-- Semeadura (RN-CORE-39, "a empresa nasce com 1 filial padrão"): código '0001', nome 'Filial padrão', cidade/UF nulas, id =
--   uuid_de_chave('<tenant>:core.filial:padrao') (idFilialPadrao em db/src/ids.ts). Tenants existentes: backfill abaixo.
--   Tenant novo: gatilho tenant_semear_filial (AFTER INSERT em plataforma.tenant), o padrão da 0006/0018/0037 — vale para o
--   plataforma.provisionar_tenant e a sa_provisionar_tenant (que inserem o tenant) SEM mexer nas funções, e para seeds e
--   fixtures. Idempotente: só cria se o tenant não tem padrão viva. A carga do ERP "adota" a padrão pelo código (desenho §4.4).
-- core.filial_padrao_id(tenant): id da padrão viva do tenant (NULO se não houver). Comum (NÃO SECURITY DEFINER): roda com o RLS
--   de quem chama. Usada pelos gatilhos abaixo.
-- core.cliente.filial_id uuid NOT NULL, FK composta (cliente_filial_fk) para core.filial. Gatilho cliente_filial_padrao (BEFORE
--   INSERT OR UPDATE OF filial_id): filial_id nulo vira a padrão do tenant em TODO caminho de escrita (ERP, BKO, seed, fixture);
--   sem padrão viva = 23502. Índice (tenant_id, filial_id) para "clientes da filial" (BKO e a trava de inativar filial com
--   cliente). Backfill: todo cliente na padrão — ANDA o updated_at dos clientes uma vez (o pull repuxa a carteira com o filial_id).
-- catalogo.deposito.filial_id uuid NOT NULL e catalogo.tabela_preco_item.filial_id uuid NOT NULL, SEM FK (fronteira de schema,
--   ADR 0005; o Catálogo valida pelo core.filiais@1). Backfill = padrão do tenant. Gatilhos deposito_filial_padrao e
--   tabela_preco_item_filial_padrao (BEFORE INSERT OR UPDATE OF filial_id): nulo vira a padrão — é a regra do contrato do Hub
--   ("ausente ou nulo = filial padrão", desenho §4.4) e mantém os caminhos de escrita que ainda não mandam a filial. Índices:
--   deposito (tenant_id, filial_id) para o pull do estoque por filial; tabela_preco_item (tenant_id, tabela_preco_id, filial_id)
--   para "a tabela tem item nesta filial?" (filialDoPreco). O único vivo do item passa a incluir a filial:
--   tabela_preco_item_filial_vigencia_uk (tenant, tabela, filial, produto, unidade, início) NULLS NOT DISTINCT (substitui o
--   tabela_preco_item_unidade_vigencia_uk da 0013; a unidade continua na chave).
-- catalogo.tabela_escalonada.filial_id uuid NULO = todas as filiais (as linhas atuais ficam nulas). A filial entra no único da
--   faixa (tabela_escalonada_faixa_uk recriado com filial_id): a faixa da filial e a geral convivem na mesma (produto, medida,
--   quantidade mínima, tabela, início) e a da filial vence (faixasDaFilial, domain do Catálogo).
-- vendedor.pedido.filial_id uuid (SEM FK) + vendedor.pedido.filial jsonb (retrato: id, codigo, nome, cidade, uf, external_id,
--   padrao), nulos nos pedidos anteriores. CHECKs: pedido_filial_objeto (objeto) e pedido_filial_coerente (os dois nulos ou os
--   dois preenchidos com filial->>'id' = filial_id). Índice parcial (tenant_id, filial_id) para o filtro "Filial" do BKO.
-- integracao (Hub v1, aditivo; R-20261110-074414): os 7 CHECKs *_entidade_valida e conector_entidades_validas aceitam `filial`
--   (16 = ENTIDADES_BANCO em modules/integracao/db/nuvem.ts = ENTIDADES do contrato). O padrão de conector.entidades continua
--   as 8 originais (o admin liga `filial` no Conector 1.4.0).
--
-- RLS: core.filial com enable + force + isolamento_tenant (macuxi_app) + manutencao (0031). macuxi_app: select, insert, update,
-- delete (como core.cliente). macuxi_worker: sem acesso. As colunas novas herdam o RLS das tabelas.
-- Caminho de volta: 0056_core_filial.down.sql (APAGA core.filial com as filiais cadastradas, as colunas filial_id/filial dos
-- clientes, depósitos, itens de preço, faixas e pedidos — os itens de preço e as faixas de filial NÃO padrão são apagados antes,
-- senão o único antigo colidiria —, e o que o Hub recebeu da entidade `filial`; os CHECKs voltam às 15 da 0037).

-- =============================================================================================
-- core.filial — unidade de onde saem as entregas (RN-CORE-39)
-- =============================================================================================
create table core.filial (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references plataforma.tenant (id),
  codigo       text not null,
  nome         text not null,
  cidade       text,
  uf           text,
  padrao       boolean not null default false,
  ativo        boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  external_id  text,
  constraint filial_tenant_id_uk unique (tenant_id, id),
  constraint filial_codigo_preenchido check (btrim(codigo) <> '' and char_length(codigo) <= 20),
  constraint filial_nome_preenchido check (btrim(nome) <> '' and char_length(nome) <= 80),
  constraint filial_cidade_tamanho check (cidade is null or (btrim(cidade) <> '' and char_length(cidade) <= 80)),
  constraint filial_uf_formato check (uf is null or uf ~ '^[A-Z]{2}$'),
  constraint filial_padrao_ativa check (not padrao or (ativo and deleted_at is null))
);
create unique index filial_codigo_uk on core.filial (tenant_id, codigo) where deleted_at is null;
create unique index filial_padrao_uk on core.filial (tenant_id) where padrao and deleted_at is null;
create index filial_sync_ix on core.filial (tenant_id, updated_at, id);
create unique index filial_external_uk on core.filial (tenant_id, external_id) where external_id is not null and deleted_at is null;
create trigger filial_updated_at before update on core.filial
  for each row execute function plataforma.definir_updated_at();
alter table core.filial enable row level security;
alter table core.filial force row level security;
create policy isolamento_tenant on core.filial for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
create policy manutencao on core.filial for all to macuxi_manutencao using (true) with check (true);
grant select, insert, update, delete on core.filial to macuxi_app;

-- =============================================================================================
-- Semeadura: filial padrão em todo tenant (RN-CORE-39)
-- =============================================================================================
create function core.semear_filial(p_tenant uuid) returns void
  language plpgsql
  set search_path = pg_catalog, core, plataforma, pg_temp
  as $$
declare
  v_contexto text := current_setting('app.tenant_id', true);
begin
  perform set_config('app.tenant_id', p_tenant::text, true);
  insert into core.filial (id, tenant_id, codigo, nome, padrao, ativo)
  select plataforma.uuid_de_chave(p_tenant::text || ':core.filial:padrao'), p_tenant, '0001', 'Filial padrão', true, true
   where not exists (select 1 from core.filial f where f.tenant_id = p_tenant and f.padrao and f.deleted_at is null)
  on conflict do nothing;
  perform set_config('app.tenant_id', coalesce(v_contexto, ''), true);
end
$$;
revoke all on function core.semear_filial(uuid) from public;

create function core.semear_tenant_filial() returns trigger
  language plpgsql
  set search_path = pg_catalog, core, pg_temp
  as $$
begin
  perform core.semear_filial(new.id);
  return null;
end
$$;
revoke all on function core.semear_tenant_filial() from public;

create trigger tenant_semear_filial after insert on plataforma.tenant
  for each row execute function core.semear_tenant_filial();

-- tenants existentes (demo, piloto e os de teste): a filial padrão
select core.semear_filial(t.id) from plataforma.tenant t;

-- id da filial padrão viva do tenant (RLS de quem chama; nulo se não houver)
create function core.filial_padrao_id(p_tenant uuid) returns uuid
  language sql stable
  set search_path = pg_catalog, core, pg_temp
  as $$
    select f.id from core.filial f where f.tenant_id = p_tenant and f.padrao and f.deleted_at is null
  $$;
revoke all on function core.filial_padrao_id(uuid) from public;
grant execute on function core.filial_padrao_id(uuid) to macuxi_app;

-- gatilho comum: filial_id nulo -> a padrão do tenant da linha (RN-CORE-39; "ausente ou nulo = padrão" do Hub)
create function core.preencher_filial_padrao() returns trigger
  language plpgsql
  set search_path = pg_catalog, core, pg_temp
  as $$
begin
  if new.filial_id is null then
    new.filial_id := core.filial_padrao_id(new.tenant_id);
    if new.filial_id is null then
      raise exception '%.%: filial_id nulo e o tenant sem filial padrão viva (RN-CORE-39)', tg_table_schema, tg_table_name
        using errcode = '23502';
    end if;
  end if;
  return new;
end
$$;
revoke all on function core.preencher_filial_padrao() from public;
grant execute on function core.preencher_filial_padrao() to macuxi_app;

-- =============================================================================================
-- core.cliente.filial_id — a filial do cliente, nunca nula (RN-CORE-39)
-- =============================================================================================
alter table core.cliente add column filial_id uuid;
update core.cliente c
   set filial_id = f.id
  from core.filial f
 where f.tenant_id = c.tenant_id and f.padrao and f.deleted_at is null and c.filial_id is null;
alter table core.cliente alter column filial_id set not null;
alter table core.cliente add constraint cliente_filial_fk foreign key (tenant_id, filial_id) references core.filial (tenant_id, id);
create index cliente_filial_ix on core.cliente (tenant_id, filial_id);
create trigger cliente_filial_padrao before insert or update of filial_id on core.cliente
  for each row execute function core.preencher_filial_padrao();

-- =============================================================================================
-- catalogo — depósito e item de preço por filial; faixa da filial (sem FK para o Core, ADR 0005)
-- =============================================================================================
alter table catalogo.deposito add column filial_id uuid;
update catalogo.deposito d
   set filial_id = f.id
  from core.filial f
 where f.tenant_id = d.tenant_id and f.padrao and f.deleted_at is null and d.filial_id is null;
alter table catalogo.deposito alter column filial_id set not null;
create index deposito_filial_ix on catalogo.deposito (tenant_id, filial_id);
create trigger deposito_filial_padrao before insert or update of filial_id on catalogo.deposito
  for each row execute function core.preencher_filial_padrao();

alter table catalogo.tabela_preco_item add column filial_id uuid;
update catalogo.tabela_preco_item i
   set filial_id = f.id
  from core.filial f
 where f.tenant_id = i.tenant_id and f.padrao and f.deleted_at is null and i.filial_id is null;
alter table catalogo.tabela_preco_item alter column filial_id set not null;
drop index catalogo.tabela_preco_item_unidade_vigencia_uk;
create unique index tabela_preco_item_filial_vigencia_uk on catalogo.tabela_preco_item
  (tenant_id, tabela_preco_id, filial_id, produto_id, unidade, vigencia_inicio) nulls not distinct where deleted_at is null;
create index tabela_preco_item_filial_ix on catalogo.tabela_preco_item (tenant_id, tabela_preco_id, filial_id);
create trigger tabela_preco_item_filial_padrao before insert or update of filial_id on catalogo.tabela_preco_item
  for each row execute function core.preencher_filial_padrao();

alter table catalogo.tabela_escalonada add column filial_id uuid;
drop index catalogo.tabela_escalonada_faixa_uk;
create unique index tabela_escalonada_faixa_uk on catalogo.tabela_escalonada
  (tenant_id, produto_id, medida, quantidade_minima, tabela_preco_id, filial_id, vigencia_inicio) nulls not distinct where deleted_at is null;

-- =============================================================================================
-- vendedor.pedido — retrato da filial do cliente no recebimento (RN-CORE-39, RN-VEN-02)
-- =============================================================================================
alter table vendedor.pedido add column filial_id uuid;
alter table vendedor.pedido add column filial jsonb;
alter table vendedor.pedido add constraint pedido_filial_objeto check (filial is null or jsonb_typeof(filial) = 'object');
alter table vendedor.pedido add constraint pedido_filial_coerente
  check ((filial_id is null and filial is null) or (filial_id is not null and filial is not null and coalesce(filial->>'id' = filial_id::text, false)));
create index pedido_filial_ix on vendedor.pedido (tenant_id, filial_id) where filial_id is not null;

-- =============================================================================================
-- integracao — o Hub v1 recebe `filial` (aditivo; R-20261110-074414). CHECKs com as 16 do banco (ENTIDADES_BANCO). O PADRÃO
-- de integracao.conector.entidades continua as 8 ORIGINAIS.
-- =============================================================================================
alter table integracao.conector drop constraint conector_entidades_validas;
alter table integracao.conector add constraint conector_entidades_validas check (cardinality(entidades) >= 1 and entidades <@ array['vendedor', 'cliente', 'produto', 'preco', 'estoque', 'titulo', 'nota', 'rota', 'catalogo_no', 'produto_unidade', 'cliente_endereco', 'transportadora', 'forma_pagamento', 'prazo_pagamento', 'tabela_escalonada', 'filial']::text[] and integracao.sem_repeticao(entidades));
alter table integracao.sessao_carga drop constraint sessao_carga_entidade_valida;
alter table integracao.sessao_carga add constraint sessao_carga_entidade_valida check (entidade in ('vendedor', 'cliente', 'produto', 'preco', 'estoque', 'titulo', 'nota', 'rota', 'catalogo_no', 'produto_unidade', 'cliente_endereco', 'transportadora', 'forma_pagamento', 'prazo_pagamento', 'tabela_escalonada', 'filial'));
alter table integracao.lote drop constraint lote_entidade_valida;
alter table integracao.lote add constraint lote_entidade_valida check (entidade in ('vendedor', 'cliente', 'produto', 'preco', 'estoque', 'titulo', 'nota', 'rota', 'catalogo_no', 'produto_unidade', 'cliente_endereco', 'transportadora', 'forma_pagamento', 'prazo_pagamento', 'tabela_escalonada', 'filial'));
alter table integracao.registro_atual drop constraint registro_atual_entidade_valida;
alter table integracao.registro_atual add constraint registro_atual_entidade_valida check (entidade in ('vendedor', 'cliente', 'produto', 'preco', 'estoque', 'titulo', 'nota', 'rota', 'catalogo_no', 'produto_unidade', 'cliente_endereco', 'transportadora', 'forma_pagamento', 'prazo_pagamento', 'tabela_escalonada', 'filial'));
alter table integracao.pendencia_inativacao drop constraint pendencia_inativacao_entidade_valida;
alter table integracao.pendencia_inativacao add constraint pendencia_inativacao_entidade_valida check (entidade in ('vendedor', 'cliente', 'produto', 'preco', 'estoque', 'titulo', 'nota', 'rota', 'catalogo_no', 'produto_unidade', 'cliente_endereco', 'transportadora', 'forma_pagamento', 'prazo_pagamento', 'tabela_escalonada', 'filial'));
alter table integracao.inativacao_auditoria drop constraint inativacao_auditoria_entidade_valida;
alter table integracao.inativacao_auditoria add constraint inativacao_auditoria_entidade_valida check (entidade in ('vendedor', 'cliente', 'produto', 'preco', 'estoque', 'titulo', 'nota', 'rota', 'catalogo_no', 'produto_unidade', 'cliente_endereco', 'transportadora', 'forma_pagamento', 'prazo_pagamento', 'tabela_escalonada', 'filial'));
alter table integracao.cursor_entidade drop constraint cursor_entidade_entidade_valida;
alter table integracao.cursor_entidade add constraint cursor_entidade_entidade_valida check (entidade in ('vendedor', 'cliente', 'produto', 'preco', 'estoque', 'titulo', 'nota', 'rota', 'catalogo_no', 'produto_unidade', 'cliente_endereco', 'transportadora', 'forma_pagamento', 'prazo_pagamento', 'tabela_escalonada', 'filial'));
alter table integracao.reconciliacao drop constraint reconciliacao_entidade_valida;
alter table integracao.reconciliacao add constraint reconciliacao_entidade_valida check (entidade in ('vendedor', 'cliente', 'produto', 'preco', 'estoque', 'titulo', 'nota', 'rota', 'catalogo_no', 'produto_unidade', 'cliente_endereco', 'transportadora', 'forma_pagamento', 'prazo_pagamento', 'tabela_escalonada', 'filial'));
