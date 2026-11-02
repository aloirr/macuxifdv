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
--     (> 1): as duas juntas ou nenhuma (produto_embalagem_completa) e embalagem diferente da unidade.
--   core.produto_unidade: FK produto_unidade_medida_fk (tenant_id, unidade) -> core.medida (tenant_id, sigla).
--   Antes das FKs, unidade é normalizada com upper(btrim()) em produto e produto_unidade; sigla que continuar fora do
--   formato ^[A-Z]{1,4}$ ABORTA a migração com a lista (corrigir o dado antes; nada é adivinhado).
--   vendedor.pedido_item: medida (sigla vendida), quantidade_embalagem (unidades por embalagem; 1 na unidade) e
--     quantidade_unidades (total em unidades). Retrato, SEM FK para core.medida: a fronteira proíbe FK entre schemas de
--     módulo (0007/0013/0015, ADR 0005/0012) — CHECK de formato e a API do Vendedor valida a sigla contra o Core.
--     O gatilho pedido_item_medida (BEFORE INSERT/UPDATE, roda antes de pedido_item_quantidade_base) preenche o que vier
--     nulo a partir das colunas da 0009/0013 (medida = upper(btrim(unidade)), quantidade_embalagem = fator) e mantém as
--     duas famílias coerentes (quem gravar só uma, a outra acompanha); quantidade_unidades é SEMPRE calculada
--     (quantidade × quantidade_embalagem; nunca grave nela). Compatível com o código atual do Vendedor (não muda nada).
--     Itens existentes: backfill (medida = unidade, quantidade_embalagem = fator, quantidade_unidades = quantidade_base).
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
  select string_agg(distinct s, ', ') into v_ruins
    from (select unidade as s from core.produto union all select unidade from core.produto_unidade) x
   where s !~ '^[A-Z]{1,4}$';
  if v_ruins is not null then
    raise exception '0018_medidas: unidade fora do formato de sigla (^[A-Z]{1,4}$): %. Corrija o cadastro e rode de novo.', v_ruins;
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
alter table core.produto add constraint produto_embalagem_quantidade_minima check (embalagem_quantidade is null or embalagem_quantidade > 1);
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

create function vendedor.pedido_item_medida() returns trigger
  language plpgsql
  set search_path = pg_catalog, vendedor, pg_temp
  as $$
begin
  if tg_op = 'UPDATE' then
    -- só uma família mudou: a outra acompanha (código antigo grava unidade/fator; o novo, medida/quantidade_embalagem)
    if new.unidade is distinct from old.unidade and new.medida is not distinct from old.medida then
      new.medida := null;
    elsif new.medida is distinct from old.medida and new.unidade is not distinct from old.unidade then
      new.unidade := new.medida;
    end if;
    if new.fator is distinct from old.fator and new.quantidade_embalagem is not distinct from old.quantidade_embalagem then
      new.quantidade_embalagem := null;
    elsif new.quantidade_embalagem is distinct from old.quantidade_embalagem and new.fator is not distinct from old.fator then
      new.fator := new.quantidade_embalagem;
    end if;
  elsif new.quantidade_embalagem is not null and new.fator = 1 then
    new.fator := new.quantidade_embalagem;
  end if;
  new.medida := coalesce(new.medida, upper(btrim(new.unidade)));
  if new.unidade is null then
    new.unidade := new.medida;
  end if;
  new.quantidade_embalagem := coalesce(new.quantidade_embalagem, new.fator);
  new.quantidade_unidades := new.quantidade * new.quantidade_embalagem;
  return new;
end
$$;
-- nome < pedido_item_quantidade_base: os BEFORE ROW disparam em ordem alfabética (o fator já chega ajustado)
create trigger pedido_item_medida before insert or update on vendedor.pedido_item
  for each row execute function vendedor.pedido_item_medida();

update vendedor.pedido_item
   set medida = upper(btrim(unidade)), quantidade_embalagem = fator, quantidade_unidades = quantidade_base
 where medida is null or quantidade_embalagem is null or quantidade_unidades is null;

alter table vendedor.pedido_item alter column quantidade_embalagem set not null;
alter table vendedor.pedido_item alter column quantidade_unidades set not null;
alter table vendedor.pedido_item add constraint pedido_item_medida_formato check (medida is null or medida ~ '^[A-Z]{1,4}$');
alter table vendedor.pedido_item add constraint pedido_item_quantidade_embalagem_positiva check (quantidade_embalagem > 0);
alter table vendedor.pedido_item add constraint pedido_item_embalagem_coerente check (quantidade_embalagem = fator);
alter table vendedor.pedido_item add constraint pedido_item_quantidade_unidades_coerente check (quantidade_unidades = quantidade * quantidade_embalagem);
