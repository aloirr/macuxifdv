-- 0045_catalogo_marca_concorrente (up) — T-0113 fatia B: o cadastro de marcas concorrentes passa do Promotor para o Catálogo
-- (ADR 0034 §4, que substitui a 0027; desenho docs/desenho/T-0113.md §2 B; decisão do dono R-20261107-173950 b; pedido
-- R-20261108-002517-engenheiro-software). Dicionário: docs/banco/catalogo.md ("Marcas concorrentes (0045)") e
-- docs/banco/promotor.md. Migração em cima da 0044 (nenhuma anterior muda). LOTE ÚNICO com as fatias K (Catálogo) e P
-- (Promotor): a imagem da API é uma só e as migrações rodam antes dela subir.
--
-- 1. catalogo.marca_concorrente — a lista ÚNICA de marcas concorrentes do tenant (referência cruzada RN-CAT-09 e trade do
--    Promotor, que passa a ler pelo contrato catalogo.marcas@1). Mesma forma de promotor.concorrente (0015): regra 5 + nome
--    (btrim não vazio e até 120) + ativo (padrão true). Índices: (tenant_id, id) único; (tenant_id, lower(nome)) único entre
--    as vivas; (tenant_id, external_id) único entre as vivas não nulas; sync (tenant_id, updated_at, id). RLS e FORCE,
--    isolamento_tenant, manutencao (0031), select/insert/update ao macuxi_app (sem delete: apagar = deleted_at), gatilho
--    updated_at. Vai ao aparelho (entidade marca_concorrente do Catálogo; o SDK cria ent_marca_concorrente, sem versão nova
--    do esquema local).
-- 2. Cópia de TODAS as linhas de promotor.concorrente (inativas e apagadas também) com id, tenant_id, nome, ativo,
--    created_at, updated_at, deleted_at e external_id IDÊNTICOS (insert não dispara o gatilho de updated_at). É a ÚNICA
--    leitura entre schemas que a ADR 0034 §4.2 autoriza (regra 1 / ADR 0005): só aqui, uma vez, para transferir o dono.
--    Conferência: as linhas das duas tabelas, campo a campo, têm de ser as mesmas (o que vale também para a contagem e o
--    conjunto de ids por tenant); divergência = raise com a contagem e nada fica.
-- 3. catalogo.produto_referencia: confere que não há órfã (marca_id sem marca no mesmo tenant, apagadas inclusive; raise com a
--    contagem); preenche marca_nome onde está nulo com o nome da marca (o gatilho sobe updated_at e o aparelho recebe o nome
--    no pull); FK produto_referencia_marca_fk (tenant_id, marca_id) -> catalogo.marca_concorrente (tenant_id, id), agora do
--    mesmo schema; índice produto_referencia_marca_ix (tenant_id, marca_id) para a FK e para o "renomear/inativar a marca
--    toca as referências dela na mesma transação" (ADR 0034 §6).
-- 4. Promotor: sai a FK produto_concorrente_concorrente_fk (o concorrente_id passa a apontar para a marca do Catálogo, sem
--    FK entre schemas) e o macuxi_app perde insert e update em promotor.concorrente: a tabela fica SÓ DE LEITURA, como rede de
--    volta, até a fase 2 (drop, não antes de 2026-12-08, ADR 0034 §5). Uma gravação da API antiga no meio do deploy falha
--    (42501) e é refeita na tela nova; não há perda silenciosa (ADR 0034 §4.5).
-- Volume: dezenas de marcas por tenant; referências até 60 mil por tenant.
-- Caminho de volta: 0045_catalogo_marca_concorrente.down.sql (devolve as linhas ao Promotor por id, as permissões e a FK dele;
-- tira a FK e o índice da referência e apaga a tabela nova; o retrato marca_nome fica). Só vale com o código anterior.

create table catalogo.marca_concorrente (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references plataforma.tenant (id),
  nome         text not null,
  ativo        boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  external_id  text,
  constraint marca_concorrente_tenant_id_uk unique (tenant_id, id),
  constraint marca_concorrente_nome_valido check (btrim(nome) <> '' and char_length(nome) <= 120)
);
create unique index marca_concorrente_nome_uk on catalogo.marca_concorrente (tenant_id, lower(nome)) where deleted_at is null;
create unique index marca_concorrente_external_uk on catalogo.marca_concorrente (tenant_id, external_id) where external_id is not null and deleted_at is null;
create index marca_concorrente_sync_ix on catalogo.marca_concorrente (tenant_id, updated_at, id);
create trigger marca_concorrente_updated_at before update on catalogo.marca_concorrente
  for each row execute function plataforma.definir_updated_at();
alter table catalogo.marca_concorrente enable row level security;
alter table catalogo.marca_concorrente force row level security;
create policy isolamento_tenant on catalogo.marca_concorrente for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
create policy manutencao on catalogo.marca_concorrente for all to macuxi_manutencao using (true) with check (true);
grant select, insert, update on catalogo.marca_concorrente to macuxi_app;

-- 2. cópia (ADR 0034 §4.2: a única leitura entre schemas autorizada) e conferência campo a campo
insert into catalogo.marca_concorrente (id, tenant_id, nome, ativo, created_at, updated_at, deleted_at, external_id)
select id, tenant_id, nome, ativo, created_at, updated_at, deleted_at, external_id from promotor.concorrente;

do $$
declare
  v_faltam bigint;
  v_sobram bigint;
begin
  select count(*) into v_faltam from (
    select id, tenant_id, nome, ativo, created_at, updated_at, deleted_at, external_id from promotor.concorrente
    except
    select id, tenant_id, nome, ativo, created_at, updated_at, deleted_at, external_id from catalogo.marca_concorrente
  ) x;
  select count(*) into v_sobram from (
    select id, tenant_id, nome, ativo, created_at, updated_at, deleted_at, external_id from catalogo.marca_concorrente
    except
    select id, tenant_id, nome, ativo, created_at, updated_at, deleted_at, external_id from promotor.concorrente
  ) x;
  if v_faltam > 0 or v_sobram > 0 then
    raise exception '0045: cópia das marcas divergente (% linha(s) do Promotor sem igual no Catálogo, % do Catálogo sem igual no Promotor)', v_faltam, v_sobram;
  end if;
end $$;

-- 3. referência cruzada: sem órfã, retrato do nome, FK e índice por marca
do $$
declare
  v_orfas bigint;
begin
  select count(*) into v_orfas
    from catalogo.produto_referencia r
   where not exists (select 1 from catalogo.marca_concorrente m where m.tenant_id = r.tenant_id and m.id = r.marca_id);
  if v_orfas > 0 then
    raise exception '0045: % referência(s) cruzada(s) com marca_id sem marca no mesmo tenant; corrija antes de migrar', v_orfas;
  end if;
end $$;

update catalogo.produto_referencia r
   set marca_nome = m.nome
  from catalogo.marca_concorrente m
 where m.tenant_id = r.tenant_id and m.id = r.marca_id and r.marca_nome is null;

create index produto_referencia_marca_ix on catalogo.produto_referencia (tenant_id, marca_id);
alter table catalogo.produto_referencia add constraint produto_referencia_marca_fk
  foreign key (tenant_id, marca_id) references catalogo.marca_concorrente (tenant_id, id);

-- 4. Promotor: sem a FK do produto do concorrente e sem escrita no cadastro antigo (só leitura até a fase 2)
alter table promotor.produto_concorrente drop constraint produto_concorrente_concorrente_fk;
revoke insert, update on promotor.concorrente from macuxi_app;
