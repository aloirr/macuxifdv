-- 0018_medidas (up) — T-0063 (desenho fixado pelo gerente-projetos; T-0061 rev. 2, R-20261102-123436-engenheiro-software).
-- Regras: RN-CORE-19 (medidas por tenant; produto com a medida da unidade e embalagem opcional), RF-CORE-14 (cadastro em
-- Parâmetros → Produtos: sigla até 4 letras, única, descrição, ativo, não apaga em uso; lista inicial), RN-VEN-15 (o pedido
-- grava a medida, a quantidade da embalagem e a quantidade em unidades). Dicionário: docs/banco/core.md e vendedor.md.
--
-- Mudanças:
--   core.medida (nova): sigla ^[A-Z]{1,4}$, descrição, ativo. ÚNICO TOTAL (tenant_id, sigla) — medida_sigla_uk — alvo das
--     FKs: a medida nunca é apagada fisicamente; sai de uso com ativo = false. Soft delete (deleted_at) de medida em uso por
--     produto vivo é recusado pelo gatilho medida_em_uso (23503); DELETE físico não é concedido ao macuxi_app (e a FK o
--     recusaria). Troca de sigla de medida em uso é recusada pela FK (NO ACTION); a descrição se edita livre.
--   Lista inicial (11) semeada em TODO tenant: UN Unidade, CX Caixa, PCT Pacote, FD Fardo, LT Lata, BD Balde, TB Tubo,
--     GL Galão, KG Quilograma, DZ Dúzia, DP Display — e, nos tenants que já existem, também as siglas já usadas em
--     core.produto.unidade / core.produto_unidade.unidade (descrição = sigla, ativa), para nenhuma FK quebrar. Ids
--     determinísticos plataforma.uuid_de_chave('<tenant>:core.medida:<sigla>') (gêmea: idMedida em db/src/ids.ts).
--     Tenant novo: gatilho tenant_semear_medidas (AFTER INSERT em plataforma.tenant), mesmo padrão da 0006
--     (core.semear_padroes): função comum (NÃO SECURITY DEFINER), contexto do tenant ligado só durante a semeadura —
--     o gatilho roda como quem insere o tenant (executor/admin); o macuxi_app não insere tenant.
--   core.produto: unidade (existente) = sigla da medida da unidade, FK composta produto_medida_fk (tenant_id, unidade) ->
--     core.medida (tenant_id, sigla). Novas embalagem_medida (FK produto_embalagem_medida_fk) e embalagem_quantidade
--     (2 a 9999, produto_embalagem_quantidade_faixa — o mesmo teto no domain do Core e no contrato da Integração): as duas
--     juntas ou nenhuma (produto_embalagem_completa) e embalagem diferente da unidade.
--   core.produto_unidade: FK produto_unidade_medida_fk (tenant_id, unidade) -> core.medida (tenant_id, sigla).
--   Antes das FKs, unidade é normalizada com upper(btrim()) em produto e produto_unidade; sigla que continuar fora do
--   formato ^[A-Z]{1,4}$ ABORTA a migração (23514) com a lista "tenant <codigo> (<id>): <tabela> '<sigla>'" e a dica de
--   correção (corrigir o dado antes; nada é adivinhado).
--   vendedor.pedido_item: medida (sigla vendida), quantidade_embalagem (unidades por embalagem; 1 na unidade) e
--     quantidade_unidades (total em unidades). Retrato, SEM FK para core.medida: a fronteira proíbe FK entre schemas de
--     módulo (0007/0013/0015, ADR 0005/0012) — a API do Vendedor valida a sigla contra o Core. As três são DERIVADAS de
--     unidade/fator/quantidade pelo gatilho pedido_item_medida, que SEMPRE sobrescreve (nunca grave nelas): medida =
--     vendedor.medida_do_item(unidade) (upper(btrim()) se no formato ^[A-Z]{1,4}$, senão NULA), quantidade_embalagem =
--     fator, quantidade_unidades = quantidade × fator (= quantidade_base). CHECKs travam a coerência mesmo sem o gatilho.
--     Compatível com o código atual do Vendedor (grava unidade/fator; não muda nada). Por que não GENERATED: ver o bloco.
--     Itens existentes: backfill sem reescrever unidade e sem mexer em updated_at; unidade histórica fora do formato fica
--     com medida nula (NOTICE com tenant e sigla), não aborta.
--   catalogo.tabela_preco_item.unidade (0013): SEM FK (outro schema). Pendência: a API do Catálogo valida a sigla.
-- Caminho de volta: 0018_medidas.down.sql (APAGA o cadastro de medidas e as colunas novas de produto e item com os dados
-- delas; a normalização upper(btrim()) de unidade não é desfeita — era a forma esperada).

-- =============================================================================================
-- core.medida
-- =============================================================================================
create table core.medida (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references plataforma.tenant (id),
  sigla        text not null,
  descricao    text not null,
  ativo        boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  external_id  text,
  constraint medida_tenant_id_uk unique (tenant_id, id),
  constraint medida_sigla_uk unique (tenant_id, sigla),
  constraint medida_sigla_formato check (sigla ~ '^[A-Z]{1,4}$'),
  constraint medida_descricao_preenchida check (btrim(descricao) <> '')
);
create index medida_sync_ix on core.medida (tenant_id, updated_at, id);
create unique index medida_external_uk on core.medida (tenant_id, external_id) where external_id is not null and deleted_at is null;
create trigger medida_updated_at before update on core.medida
  for each row execute function plataforma.definir_updated_at();
alter table core.medida enable row level security;
alter table core.medida force row level security;
create policy isolamento_tenant on core.medida for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
-- sem DELETE: medida não se apaga (RF-CORE-14); sai de uso com ativo = false
grant select, insert, update on core.medida to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- Semeadura: lista inicial + siglas já usadas pelo tenant. Idempotente (on conflict do nothing): não sobrescreve o que o
-- tenant editou (descrição, ativo). Mesmo padrão de contexto da 0006.
create function core.semear_medidas(p_tenant uuid) returns void
  language plpgsql
  set search_path = pg_catalog, core, plataforma, pg_temp
  as $$
declare
  v_contexto text := current_setting('app.tenant_id', true);
begin
  perform set_config('app.tenant_id', p_tenant::text, true);
  insert into core.medida (id, tenant_id, sigla, descricao, ativo)
  select plataforma.uuid_de_chave(p_tenant::text || ':core.medida:' || m.sigla), p_tenant, m.sigla, m.descricao, true
    from (values
      ('UN', 'Unidade'), ('CX', 'Caixa'), ('PCT', 'Pacote'), ('FD', 'Fardo'), ('LT', 'Lata'), ('BD', 'Balde'),
      ('TB', 'Tubo'), ('GL', 'Galão'), ('KG', 'Quilograma'), ('DZ', 'Dúzia'), ('DP', 'Display')
    ) as m (sigla, descricao)
  on conflict do nothing;
  insert into core.medida (id, tenant_id, sigla, descricao, ativo)
  select plataforma.uuid_de_chave(p_tenant::text || ':core.medida:' || u.sigla), p_tenant, u.sigla, u.sigla, true
    from (select p.unidade as sigla from core.produto p where p.tenant_id = p_tenant
          union
          select pu.unidade from core.produto_unidade pu where pu.tenant_id = p_tenant) as u
   where u.sigla ~ '^[A-Z]{1,4}$'
  on conflict do nothing;
  perform set_config('app.tenant_id', coalesce(v_contexto, ''), true);
end
$$;
revoke all on function core.semear_medidas(uuid) from public;

create function core.semear_tenant_medidas() returns trigger
  language plpgsql
  set search_path = pg_catalog, core, pg_temp
  as $$
begin
  perform core.semear_medidas(new.id);
  return null;
end
$$;
revoke all on function core.semear_tenant_medidas() from public;

create trigger tenant_semear_medidas after insert on plataforma.tenant
  for each row execute function core.semear_tenant_medidas();

-- ---------------------------------------------------------------------------------------------
-- "Não apaga em uso" (RF-CORE-14): soft delete de medida usada por produto vivo (unidade ou embalagem) ou por unidade de
-- venda viva é recusado. Roda como quem altera (RLS do próprio tenant: as FKs são compostas, a referência é sempre do
-- mesmo tenant). Inativar (ativo = false) é permitido.
create function core.medida_em_uso() returns trigger
  language plpgsql
  set search_path = pg_catalog, core, pg_temp
  as $$
begin
  if old.deleted_at is null and new.deleted_at is not null and (
       exists (select 1 from core.produto p
                where p.tenant_id = old.tenant_id and p.deleted_at is null
                  and (p.unidade = old.sigla or p.embalagem_medida = old.sigla))
    or exists (select 1 from core.produto_unidade pu
                where pu.tenant_id = old.tenant_id and pu.deleted_at is null and pu.unidade = old.sigla)) then
    raise exception 'medida % em uso por produto: inative (ativo = false) em vez de apagar', old.sigla
      using errcode = '23503', constraint = 'medida_em_uso';
  end if;
  return new;
end
$$;
create trigger medida_em_uso before update on core.medida
  for each row execute function core.medida_em_uso();

-- =============================================================================================
-- core.produto e core.produto_unidade: medida da unidade, embalagem e FKs
-- =============================================================================================
update core.produto set unidade = upper(btrim(unidade)) where unidade <> upper(btrim(unidade));
update core.produto_unidade set unidade = upper(btrim(unidade)) where unidade <> upper(btrim(unidade));
do $$
declare
  v_ruins text;
begin
  select string_agg(format('tenant %s (%s): %s %L', t.codigo, t.id, x.tabela, x.sigla), '; ' order by t.codigo, x.tabela, x.sigla)
    into v_ruins
    from (select distinct tenant_id, 'core.produto' as tabela, unidade as sigla from core.produto
          union
          select distinct tenant_id, 'core.produto_unidade', unidade from core.produto_unidade) x
    join plataforma.tenant t on t.id = x.tenant_id
   where x.sigla !~ '^[A-Z]{1,4}$';
  if v_ruins is not null then
    raise exception '0018_medidas: unidade fora do formato de sigla (1 a 4 letras, ^[A-Z]{1,4}$) — %', v_ruins
      using errcode = '23514',
            hint = 'Corrija a unidade desses produtos/unidades de venda (no ERP e no banco) para uma sigla de 1 a 4 letras e rode a migração de novo; nada é adivinhado.';
  end if;
end
$$;

-- tenants que já existem (lista inicial + siglas usadas)
select core.semear_medidas(t.id) from plataforma.tenant t;

alter table core.produto add column embalagem_medida text;
alter table core.produto add column embalagem_quantidade integer;
alter table core.produto add constraint produto_medida_fk foreign key (tenant_id, unidade) references core.medida (tenant_id, sigla);
alter table core.produto add constraint produto_embalagem_medida_fk foreign key (tenant_id, embalagem_medida) references core.medida (tenant_id, sigla);
alter table core.produto add constraint produto_embalagem_completa check ((embalagem_medida is null) = (embalagem_quantidade is null));
alter table core.produto add constraint produto_embalagem_quantidade_faixa check (embalagem_quantidade is null or embalagem_quantidade between 2 and 9999);
alter table core.produto add constraint produto_embalagem_diferente check (embalagem_medida is null or embalagem_medida <> unidade);
create index produto_medida_ix on core.produto (tenant_id, unidade);
create index produto_embalagem_medida_ix on core.produto (tenant_id, embalagem_medida) where embalagem_medida is not null;

alter table core.produto_unidade add constraint produto_unidade_medida_fk foreign key (tenant_id, unidade) references core.medida (tenant_id, sigla);
create index produto_unidade_medida_ix on core.produto_unidade (tenant_id, unidade);

-- =============================================================================================
-- vendedor.pedido_item: medida, quantidade da embalagem e quantidade em unidades (RN-VEN-15) — retrato, sem FK
-- =============================================================================================
alter table vendedor.pedido_item add column medida text;
alter table vendedor.pedido_item add column quantidade_embalagem integer;
alter table vendedor.pedido_item add column quantidade_unidades integer;

-- Fonte única = unidade/fator/quantidade (0009/0013). O gatilho SEMPRE sobrescreve as três colunas (o que vier nelas é
-- ignorado), como os promotor.derivar_* da 0015. NÃO são GENERATED ALWAYS (decisão do gerente na revisão da T-0063,
-- R-20261102-232543-engenheiro-software 🟡1, com fallback documentado): coluna gerada recusa valor explícito no INSERT (428C9)
-- e os testes de isolamento (db/testes/vazamento.test.ts e tests/integracao/multitenant/vazamento-escrita.test.ts) copiam
-- linhas inteiras com INSERT ... SELECT (jsonb_populate_record(...)).* em toda tabela com tenant_id. Os CHECKs
-- pedido_item_medida_derivada, pedido_item_embalagem_coerente e pedido_item_quantidade_unidades_coerente garantem a
-- mesma coisa que a coluna gerada mesmo com o gatilho desligado: não há como divergir.
-- medida: sigla de unidade que esteja no formato ^[A-Z]{1,4}$ depois de upper(btrim()); fora do formato (item antigo com
-- "CAIXA", "CX12") ou unidade nula => medida NULA (exibir a unidade histórica). A unidade gravada NUNCA é reescrita.
create function vendedor.medida_do_item(p_unidade text) returns text
  language sql immutable parallel safe
  set search_path = pg_catalog, pg_temp
  as $$ select case when upper(btrim(p_unidade)) ~ '^[A-Z]{1,4}$' then upper(btrim(p_unidade)) end $$;

create function vendedor.pedido_item_medida() returns trigger
  language plpgsql
  set search_path = pg_catalog, vendedor, pg_temp
  as $$
begin
  new.medida := vendedor.medida_do_item(new.unidade);
  new.quantidade_embalagem := new.fator;
  new.quantidade_unidades := new.quantidade * new.fator; -- = quantidade_base (gatilho pedido_item_quantidade_base, mesmo cálculo)
  return new;
end
$$;
create trigger pedido_item_medida before insert or update on vendedor.pedido_item
  for each row execute function vendedor.pedido_item_medida();

-- Backfill dos itens existentes SEM tocar em unidade e SEM mexer em updated_at (o gatilho de updated_at fica desligado só
-- neste UPDATE, dentro da transação da migração): nenhum item é puxado de novo pelo app só por causa da 0018.
-- Unidade histórica fora do formato não aborta: vira medida nula e é só avisada (NOTICE com tenant e sigla).
do $$
declare
  v_aviso text;
begin
  select string_agg(format('tenant %s (%s): %L x%s', t.codigo, t.id, x.unidade, x.n), '; ' order by t.codigo, x.unidade)
    into v_aviso
    from (select i.tenant_id, i.unidade, count(*) as n
            from vendedor.pedido_item i
           where i.unidade is not null and vendedor.medida_do_item(i.unidade) is null
           group by i.tenant_id, i.unidade) x
    join plataforma.tenant t on t.id = x.tenant_id;
  if v_aviso is not null then
    raise notice '0018_medidas: itens de pedido com unidade fora do formato de sigla ficam com medida nula (unidade preservada): %', v_aviso;
  end if;
end
$$;
alter table vendedor.pedido_item disable trigger pedido_item_updated_at;
update vendedor.pedido_item set quantidade = quantidade;
alter table vendedor.pedido_item enable trigger pedido_item_updated_at;

alter table vendedor.pedido_item alter column quantidade_embalagem set not null;
alter table vendedor.pedido_item alter column quantidade_unidades set not null;
alter table vendedor.pedido_item add constraint pedido_item_medida_formato check (medida is null or medida ~ '^[A-Z]{1,4}$');
alter table vendedor.pedido_item add constraint pedido_item_medida_derivada check (medida is not distinct from vendedor.medida_do_item(unidade));
alter table vendedor.pedido_item add constraint pedido_item_quantidade_embalagem_positiva check (quantidade_embalagem > 0);
alter table vendedor.pedido_item add constraint pedido_item_embalagem_coerente check (quantidade_embalagem = fator);
alter table vendedor.pedido_item add constraint pedido_item_quantidade_unidades_coerente check (quantidade_unidades = quantidade * fator);
