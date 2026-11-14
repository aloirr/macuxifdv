-- 0068_core_cargo_hierarquia (up) — cargo do perfil, um perfil por usuário e a hierarquia do cadastro de usuário.
-- Decisão do dono do produto (R-20261114-153500-alexandre, 14/11/2026): "No cadastro de usuario devem ter os cargos. Se é
-- vendedor tem o supervisor para cadastrar, e o gerente é o gerente do supervisor. Se é supervisor cadastra o gerente e o nome
-- da equipe para aparecer na tela inicial da foto do vendedor. Codigo ERP para todos. Cada usuario so pode ter um perfil. E
-- cada perfil so pode ter um cargo. cargo é algo padrao do fdv. Vendedor, Supervisor, Gerente, Administrativo".
-- Migração em cima da 0067. Dicionário: docs/banco/plataforma.md ("0068") e docs/banco/core.md ("0068"). Teste:
-- db/testes/cargo-hierarquia.db.test.ts (estático no PC; banco e up/down no CI). Diagnóstico: db/scripts/diagnostico-0068.sql.
--
-- 1. CARGO (lista fixa da plataforma): vendedor | supervisor | gerente | administrativo. Coluna plataforma.perfil.cargo NOT NULL,
--    sem padrão (CHECK perfil_cargo_valido): todo perfil tem exatamente um cargo; quem cria perfil (o Core, BKO) informa.
--    Mapeamento da base para o cargo = plataforma.cargo_da_base(base) (PARÂMETRO, logo abaixo): vale para o backfill dos 7 de
--    fábrica, dos personalizados que já existem (cargo da base deles; não há perfil sem base) e para a semeadura de tenant novo.
--      vendedor -> vendedor | promotor -> vendedor (A CONFIRMAR COM O DONO DO PRODUTO) | supervisor -> supervisor |
--      gerente -> gerente | analista, assistente, admin -> administrativo | qualquer outro texto -> administrativo.
--    Trocar o mapeamento depois = nova migração com `create or replace function plataforma.cargo_da_base` + update dos perfis.
-- 2. UM PERFIL POR USUÁRIO: restrição de exclusão usuario_perfil_um_vivo em plataforma.usuario_perfil — no máximo um vínculo
--    VIVO (deleted_at nulo) por (tenant, usuário). ADIÁVEL e adiada (conferida no COMMIT, junto das conferências da 0041): a
--    troca de perfil numa transação pode inserir o novo e apagar o antigo em qualquer ordem. Segura também contra 2 gravações
--    concorrentes (é índice, não gatilho). Erro: 23P01, constraint usuario_perfil_um_vivo.
--    Antes, quem tem 2+ vínculos vivos fica com UM (os demais: soft delete, deleted_at = now() desta transação, igual ao
--    public.macuxi_migracao.aplicada_em da 0068 — é por esse instante que o down os devolve). Ordem de nível (fica o 1º):
--      perfil ativo e vivo antes do inativo/apagado; base admin > gerente > supervisor > analista > assistente > vendedor >
--      promotor; na MESMA base, o personalizado antes do de fábrica (foi a escolha explícita do admin), salvo na base admin,
--      em que fica o de fábrica (garante a gestão do acesso, RN-CORE-35); depois o vínculo mais novo; por fim o id.
--    core.usuario.perfil (o principal, vai no token) passa a ser a base do perfil que ficou, quando era outra (anda o
--    updated_at: o aparelho puxa o usuário de novo).
--    plataforma.garantir_perfil_principal() (gatilho usuario_perfil_principal, 0041): trocar core.usuario.perfil para uma base
--    que o usuário não tem SUBSTITUI o vínculo (soft delete do vivo + o de fábrica da base nova), em vez de acrescentar.
-- 3. HIERARQUIA: reaproveita core.equipe (0002), sem colunas novas em core.usuario (uma informação, um lugar: a árvore de
--    equipes já é a base do escopo RN-CORE-04 do Gestor e o nome da equipe já vai ao Início do app). O cadastro grava:
--      vendedor   -> core.usuario.equipe_id = a equipe cujo responsavel_id é o supervisor escolhido;
--      supervisor -> a equipe dele (core.equipe: responsavel_id = ele, nome = "nome da equipe", equipe_pai_id = a equipe do
--                    gerente escolhido) e core.usuario.equipe_id = essa equipe;
--      gerente    -> a equipe dele (responsavel_id = ele, a raiz/regional) e equipe_id = essa equipe (opcional).
--    O gerente do vendedor NÃO é gravado no vendedor: é o responsável da equipe-pai da equipe do supervisor.
--    Leitura pronta: view core.v_usuario_hierarquia (security_invoker) — cargo, equipe, supervisor_id e gerente_id derivados.
--    Regras cargo x hierarquia (vendedor com equipe de um supervisor; equipe-pai de um gerente; nome da equipe obrigatório):
--    validadas no domain/API do Core, NÃO por restrição — os dados que já existem (ex.: equipe com responsável administrativo)
--    quebrariam. O diagnóstico lista as inconsistências. A equipe do supervisor escolhido sai pelo equipe_responsavel_ix (0004).
-- 4. CÓDIGO ERP: core.usuario.external_id já atende — único vivo por tenant desde a 0002 (usuario_external_uk, parcial em
--    external_id não nulo e deleted_at nulo). Continua NULO no banco (usuários antigos e o admin inicial não têm código); o
--    "obrigatório para todos" é regra do cadastro (domain/API do Core).
-- RLS: nenhuma tabela nova. perfil e usuario_perfil seguem com isolamento_tenant/manutencao; a view roda com o papel de quem
-- consulta (RLS de core.usuario, core.equipe, plataforma.usuario_perfil e plataforma.perfil). macuxi_app: select na view e
-- EXECUTE em cargo_da_base; worker e portal: nada.
-- Volume: 7 + poucos perfis por tenant; 1 vínculo vivo por usuário; dezenas de equipes.
--
-- Caminho de volta: 0068_core_cargo_hierarquia.down.sql — apaga a view, a restrição de exclusão e a coluna cargo
-- (o cargo de perfil personalizado se perde), volta garantir_perfil_principal ao texto da 0041 e semear_perfis_fabrica ao da
-- 0051, e devolve os vínculos que a 0068 apagou (os de deleted_at = aplicada_em da 0068). core.usuario.perfil NÃO volta (fica
-- a base mais alta, que continua entre os perfis do usuário). Volte antes o código do Core que grava/lê o cargo e a view.

-- 1. Cargo ----------------------------------------------------------------------------------------------------------------------
-- PARÂMETRO do mapeamento base -> cargo (a confirmar com o dono do produto: promotor -> vendedor).
create function plataforma.cargo_da_base(p_base text) returns text
  language sql immutable parallel safe
  set search_path = pg_catalog, pg_temp
  as $$
    select case p_base
             when 'vendedor' then 'vendedor'
             when 'promotor' then 'vendedor' -- a confirmar com o dono do produto
             when 'supervisor' then 'supervisor'
             when 'gerente' then 'gerente'
             else 'administrativo'           -- analista, assistente, admin
           end
  $$;
revoke all on function plataforma.cargo_da_base(text) from public;
grant execute on function plataforma.cargo_da_base(text) to macuxi_app;

alter table plataforma.perfil add column cargo text;
update plataforma.perfil set cargo = plataforma.cargo_da_base(base);
alter table plataforma.perfil alter column cargo set not null;
alter table plataforma.perfil add constraint perfil_cargo_valido
  check (cargo in ('vendedor', 'supervisor', 'gerente', 'administrativo'));

-- Semeadura dos 7 de fábrica: o texto da 0051 com o cargo (create or replace: mesma assinatura, mesmas ACLs).
create or replace function plataforma.semear_perfis_fabrica(p_tenant uuid) returns void
  language plpgsql volatile
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
begin
  if p_tenant is null then
    raise exception 'semear_perfis_fabrica: p_tenant obrigatório' using errcode = '22004';
  end if;
  insert into plataforma.perfil (id, tenant_id, codigo, nome, base, fabrica, ativo, cargo)
  select plataforma.uuid_de_chave(p_tenant::text || ':plataforma.perfil:' || f.base), p_tenant, f.base, f.nome, f.base, true, true,
         plataforma.cargo_da_base(f.base)
    from (values
      ('vendedor', 'Vendedor'), ('promotor', 'Promotor'), ('supervisor', 'Supervisor'), ('gerente', 'Gerente'),
      ('analista', 'Analista'), ('assistente', 'Assistente'), ('admin', 'Admin')
    ) as f (base, nome)
  on conflict do nothing;
end
$$;

-- 2. Um perfil por usuário ------------------------------------------------------------------------------------------------------
-- Troca do principal substitui o vínculo (texto da 0041; muda só o bloco da troca).
create or replace function plataforma.garantir_perfil_principal() returns trigger
  language plpgsql
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_perfil uuid;
begin
  if new.deleted_at is not null then
    return null;
  end if;
  if exists (select 1 from plataforma.usuario_perfil up
               join plataforma.perfil p on p.tenant_id = up.tenant_id and p.id = up.perfil_id
              where up.tenant_id = new.tenant_id and up.usuario_id = new.id and up.deleted_at is null
                and p.base = new.perfil and p.ativo and p.deleted_at is null) then
    return null;
  end if;
  select p.id into v_perfil from plataforma.perfil p where p.tenant_id = new.tenant_id and p.codigo = new.perfil and p.fabrica;
  if v_perfil is null then
    perform plataforma.semear_perfis_fabrica(new.tenant_id);
    select p.id into v_perfil from plataforma.perfil p where p.tenant_id = new.tenant_id and p.codigo = new.perfil and p.fabrica;
  end if;
  if v_perfil is null then
    raise exception 'usuário sem o perfil de fábrica da base no tenant (contexto do tenant ausente?)' using errcode = '23514',
      constraint = 'usuario_perfil_principal', hint = 'RN-CORE-35';
  end if;
  -- 0068: um perfil por usuário — o vínculo vivo de outra base sai (soft delete) e entra o de fábrica da base nova
  update plataforma.usuario_perfil up set deleted_at = now()
   where up.tenant_id = new.tenant_id and up.usuario_id = new.id and up.deleted_at is null;
  insert into plataforma.usuario_perfil (id, tenant_id, usuario_id, perfil_id)
  values (plataforma.uuid_de_chave(new.tenant_id::text || ':plataforma.usuario_perfil:' || new.id::text || ':' || v_perfil::text),
          new.tenant_id, new.id, v_perfil)
  on conflict (id) do update set deleted_at = null;
  return null;
end
$$;

-- Quem tem 2+ vínculos vivos fica com o de nível mais alto (a consulta de quem é afetado: db/scripts/diagnostico-0068.sql).
with ordem as (
  select up.id,
         row_number() over (
           partition by up.tenant_id, up.usuario_id
           order by (p.ativo and p.deleted_at is null) desc,
                    array_position(array['admin', 'gerente', 'supervisor', 'analista', 'assistente', 'vendedor', 'promotor']::text[], p.base),
                    case when p.base = 'admin' then not p.fabrica else p.fabrica end,
                    up.created_at desc,
                    up.id
         ) as n
    from plataforma.usuario_perfil up
    join plataforma.perfil p on p.tenant_id = up.tenant_id and p.id = up.perfil_id
   where up.deleted_at is null
)
update plataforma.usuario_perfil up set deleted_at = now()
  from ordem o
 where o.id = up.id and o.n > 1;

update core.usuario u set perfil = p.base
  from plataforma.usuario_perfil up
  join plataforma.perfil p on p.tenant_id = up.tenant_id and p.id = up.perfil_id
 where up.tenant_id = u.tenant_id and up.usuario_id = u.id and up.deleted_at is null
   and u.perfil is distinct from p.base;

-- As conferências adiadas da 0041 (gatilhos de restrição) rodam agora: o ALTER TABLE abaixo recusa tabela com evento de gatilho
-- pendente (55006), e o estado já é válido (um vínculo vivo, da base do principal).
set constraints all immediate;

alter table plataforma.usuario_perfil add constraint usuario_perfil_um_vivo
  exclude using btree (tenant_id with =, usuario_id with =) where (deleted_at is null)
  deferrable initially deferred;

-- 3. Hierarquia (core.equipe) ---------------------------------------------------------------------------------------------------

create view core.v_usuario_hierarquia with (security_invoker = true) as
select u.tenant_id,
       u.id as usuario_id,
       p.id as perfil_id,
       p.cargo,
       e.id as equipe_id,
       e.nome as equipe_nome,
       case when p.cargo = 'vendedor' and e.responsavel_id is distinct from u.id then e.responsavel_id end as supervisor_id,
       case when p.cargo in ('vendedor', 'supervisor') then ep.responsavel_id end as gerente_id,
       greatest(u.updated_at, up.updated_at, p.updated_at, e.updated_at, ep.updated_at) as updated_at
  from core.usuario u
  left join plataforma.usuario_perfil up on up.tenant_id = u.tenant_id and up.usuario_id = u.id and up.deleted_at is null
  left join plataforma.perfil p on p.tenant_id = up.tenant_id and p.id = up.perfil_id
  left join core.equipe e on e.tenant_id = u.tenant_id and e.id = u.equipe_id and e.deleted_at is null
  left join core.equipe ep on ep.tenant_id = e.tenant_id and ep.id = e.equipe_pai_id and ep.deleted_at is null
 where u.deleted_at is null;
comment on view core.v_usuario_hierarquia is
  'Cargo e hierarquia do usuário (0068, R-20261114-153500-alexandre): cargo do perfil único; equipe e nome da equipe; supervisor_id (vendedor: responsável da equipe dele); gerente_id (vendedor e supervisor: responsável da equipe-pai). Nada gravado no usuário: deriva de core.equipe. security_invoker: RLS das 4 tabelas.';
grant select on core.v_usuario_hierarquia to macuxi_app;
