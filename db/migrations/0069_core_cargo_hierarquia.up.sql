-- 0069_core_cargo_hierarquia (up) — cargo do perfil, um perfil por usuário e a hierarquia do cadastro de usuário.
-- Decisão: ADR 0049, docs/decisoes/0049-cargos-fixos-e-um-perfil-por-usuario.md (R-20261114-153500, -153800, -154000).
-- Migração em cima da 0068 (plataforma_tenant_numero_licenca). Dicionário: docs/banco/plataforma.md ("0069") e docs/banco/core.md ("0069"). Teste:
-- db/testes/cargo-hierarquia.db.test.ts (estático no PC; banco e up/down no CI). Diagnóstico: db/scripts/diagnostico-0069.sql.
--
-- 1. CARGO (lista fixa da plataforma): vendedor | promotor | supervisor | gerente | administrativo. Coluna plataforma.perfil.cargo NOT NULL,
--    sem padrão (CHECK perfil_cargo_valido): todo perfil tem exatamente um cargo; quem cria perfil (o Core, BKO) informa.
--    Mapeamento da base para o cargo = plataforma.cargo_da_base(base) (PARÂMETRO, logo abaixo): vale para o backfill dos 7 de
--    fábrica, dos personalizados que já existem (cargo da base deles; não há perfil sem base) e para a semeadura de tenant novo.
--      vendedor -> vendedor | promotor -> promotor (R-20261114-153800) | supervisor -> supervisor | gerente -> gerente |
--      analista, assistente, admin -> administrativo | qualquer outro texto -> administrativo.
--    Trocar o mapeamento depois = nova migração com `create or replace function plataforma.cargo_da_base` + update dos perfis.
-- 2. UM PERFIL POR USUÁRIO: restrição de exclusão usuario_perfil_um_vivo em plataforma.usuario_perfil — no máximo um vínculo
--    VIVO (deleted_at nulo) por (tenant, usuário). ADIÁVEL e adiada (conferida no COMMIT, junto das conferências da 0041): a
--    troca de perfil numa transação pode inserir o novo e apagar o antigo em qualquer ordem. Segura também contra 2 gravações
--    concorrentes (é índice, não gatilho). Erro: 23P01, constraint usuario_perfil_um_vivo.
--    Antes, quem tem 2+ vínculos vivos fica com UM (os demais: soft delete, deleted_at = now() desta transação, igual ao
--    public.macuxi_migracao.aplicada_em da 0069 — é por esse instante que o down os devolve). Ordem de nível (fica o 1º):
--      perfil ativo e vivo antes do inativo/apagado; base admin > gerente > supervisor > analista > assistente > vendedor >
--      promotor (pela BASE; o cargo promotor não muda a ordem); na MESMA base, o personalizado antes do de fábrica (foi a escolha explícita do admin), salvo na base admin,
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
--      promotor   -> COM supervisor: core.usuario.equipe_id = a equipe do supervisor (como o vendedor); SEM supervisor:
--                    equipe_id = a equipe do gerente (responsavel_id = o gerente), direto embaixo dele.
--    O gerente do vendedor NÃO é gravado no vendedor: é o responsável da equipe-pai da equipe do supervisor. Idem o promotor com
--    supervisor; o do promotor sem supervisor é o responsável da própria equipe. O que separa os 2 casos do promotor é o CARGO
--    do responsável da equipe dele (supervisor ou gerente).
--    Leitura pronta: view core.v_usuario_hierarquia (security_invoker) — cargo, equipe, supervisor_id e gerente_id derivados.
--    PROMOTOR (R-20261114-154000, RN-CORE-56, ADR 0049) — gerente OBRIGATÓRIO. Promotor COM equipe (core.usuario.equipe_id
--    não nulo) é conferido no banco por gatilhos de restrição ADIADOS (no COMMIT; a ordem das gravações na transação não
--    importa), função core.conferir_promotores; promotor SEM equipe (ainda não alocado: carga do ERP/CSV, cadastro antigo) é
--    recusado pelo domain/API do Core (RN-CORE-56, 422), como o vendedor sem supervisor, e listado no diagnóstico:
--      promotor_sem_gerente (23514)           promotor vivo e ativo, com equipe, sem gerente na view (gerente_id nulo ou de
--                                             cargo diferente de gerente: equipe apagada, sem responsável supervisor/gerente);
--      promotor_gerente_do_supervisor (23514) promotor com supervisor cujo gerente (a linha do supervisor na view) não é o
--                                             gerente do promotor.
--      Pela árvore, o gerente do promotor com supervisor JÁ É o responsável da equipe-pai da equipe do supervisor (nada gravado
--      no promotor pode divergir); o 2º erro só pega o supervisor membro de outra equipe que não a que lidera.
--      Valem para GRAVAÇÕES novas ou alteradas: core.usuario (insert; update de perfil, equipe_id, ativo, deleted_at: o próprio
--      usuário, se promotor, e os promotores das equipes que ele lidera e das filhas delas), core.equipe (update de
--      responsavel_id, equipe_pai_id, deleted_at: os promotores da equipe, das filhas e das equipes lideradas por membros
--      dela), plataforma.usuario_perfil (insert; update de perfil_id, deleted_at) e plataforma.perfil (update de cargo).
--      Promotor legado fora da regra não quebra a migração nem gravação que não o alcança: consulta 3 do diagnóstico.
--      hint = 'RN-CORE-56' nos 2 erros (ADR 0049).
--      core.promotor_conferir() é SECURITY DEFINER (como as conferências da 0041 desde a 0049): gatilho adiado dispara no
--      COMMIT, fora da sa_* (DEFINER) que escreveu; a sa_provisionar_tenant cria o admin em core.usuario pelo macuxi_portal, que
--      não tem USAGE em core nem grant de tabela (ADR 0029) — como invoker, "permission denied for schema core" no COMMIT = 500
--      ao criar empresa pelo portal. Roda como o dono, só LÊ, só o tenant da linha (new.tenant_id); nenhum EXECUTE a ninguém
--      (função de gatilho só é chamada pelo gatilho; core.conferir_promotores, invoker, só é chamada de dentro dela).
--    Regras do vendedor e do supervisor (vendedor com equipe de um supervisor; equipe-pai de um gerente; nome da equipe
--    obrigatório): validadas no domain/API do Core, NÃO por restrição — os dados que já existem (ex.: equipe com responsável
--    administrativo) quebrariam. O diagnóstico lista as inconsistências. A equipe do supervisor escolhido sai pelo
--    equipe_responsavel_ix (0004).
-- 4. CÓDIGO ERP: core.usuario.external_id já atende — único vivo por tenant desde a 0002 (usuario_external_uk, parcial em
--    external_id não nulo e deleted_at nulo). Continua NULO no banco (usuários antigos e o admin inicial não têm código); o
--    "obrigatório para todos" é regra do cadastro (domain/API do Core).
-- RLS: nenhuma tabela nova. perfil e usuario_perfil seguem com isolamento_tenant/manutencao; a view roda com o papel de quem
-- consulta (RLS de core.usuario, core.equipe, plataforma.usuario_perfil e plataforma.perfil). macuxi_app: select na view e
-- EXECUTE em cargo_da_base; worker e portal: nada. Os gatilhos do promotor rodam como o dono (SECURITY DEFINER, item 3) e
-- leem a view só do tenant da linha.
-- Volume: 7 + poucos perfis por tenant; 1 vínculo vivo por usuário; dezenas de equipes; promotores: dezenas por tenant.
--
-- Caminho de volta: 0069_core_cargo_hierarquia.down.sql — apaga os 4 gatilhos do promotor e as funções deles, a view, a
-- restrição de exclusão e a coluna cargo
-- (o cargo de perfil personalizado se perde), volta garantir_perfil_principal ao texto da 0041 e semear_perfis_fabrica ao da
-- 0051, e devolve os vínculos que a 0069 apagou (os de deleted_at = aplicada_em da 0069). core.usuario.perfil NÃO volta (fica
-- a base mais alta, que continua entre os perfis do usuário). Volte antes o código do Core que grava/lê o cargo e a view.

-- 1. Cargo ----------------------------------------------------------------------------------------------------------------------
-- PARÂMETRO do mapeamento base -> cargo (R-20261114-153500 e R-20261114-153800).
create function plataforma.cargo_da_base(p_base text) returns text
  language sql immutable parallel safe
  set search_path = pg_catalog, pg_temp
  as $$
    select case p_base
             when 'vendedor' then 'vendedor'
             when 'promotor' then 'promotor'
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
  check (cargo in ('vendedor', 'promotor', 'supervisor', 'gerente', 'administrativo'));

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
  -- 0069: um perfil por usuário — o vínculo vivo de outra base sai (soft delete) e entra o de fábrica da base nova
  update plataforma.usuario_perfil up set deleted_at = now()
   where up.tenant_id = new.tenant_id and up.usuario_id = new.id and up.deleted_at is null;
  insert into plataforma.usuario_perfil (id, tenant_id, usuario_id, perfil_id)
  values (plataforma.uuid_de_chave(new.tenant_id::text || ':plataforma.usuario_perfil:' || new.id::text || ':' || v_perfil::text),
          new.tenant_id, new.id, v_perfil)
  on conflict (id) do update set deleted_at = null;
  return null;
end
$$;

-- Quem tem 2+ vínculos vivos fica com o de nível mais alto (a consulta de quem é afetado: db/scripts/diagnostico-0069.sql).
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
       case when p.cargo = 'vendedor' and e.responsavel_id is distinct from u.id then e.responsavel_id
            when p.cargo = 'promotor' and r.cargo = 'supervisor' then e.responsavel_id end as supervisor_id,
       case when p.cargo in ('vendedor', 'supervisor') then ep.responsavel_id
            when p.cargo = 'promotor' and r.cargo = 'gerente' then e.responsavel_id
            when p.cargo = 'promotor' and r.cargo = 'supervisor' then ep.responsavel_id end as gerente_id,
       greatest(u.updated_at, up.updated_at, p.updated_at, e.updated_at, ep.updated_at, r.updated_at) as updated_at
  from core.usuario u
  left join plataforma.usuario_perfil up on up.tenant_id = u.tenant_id and up.usuario_id = u.id and up.deleted_at is null
  left join plataforma.perfil p on p.tenant_id = up.tenant_id and p.id = up.perfil_id
  left join core.equipe e on e.tenant_id = u.tenant_id and e.id = u.equipe_id and e.deleted_at is null
  left join core.equipe ep on ep.tenant_id = e.tenant_id and ep.id = e.equipe_pai_id and ep.deleted_at is null
  -- promotor: o cargo do responsável da equipe dele diz se ela é a do supervisor (gerente na equipe-pai) ou a do gerente
  left join lateral (
    select rp.cargo, greatest(rup.updated_at, rp.updated_at) as updated_at
      from plataforma.usuario_perfil rup
      join plataforma.perfil rp on rp.tenant_id = rup.tenant_id and rp.id = rup.perfil_id
     where p.cargo = 'promotor' and rup.tenant_id = e.tenant_id and rup.usuario_id = e.responsavel_id and rup.deleted_at is null
     order by rup.id
     limit 1
  ) r on true
 where u.deleted_at is null;
comment on view core.v_usuario_hierarquia is
  'Cargo e hierarquia do usuário (0069, R-20261114-153500, R-20261114-153800 e R-20261114-154000): cargo do perfil único; equipe e nome da equipe; supervisor_id (vendedor: responsável da equipe dele; promotor: idem, quando ele tem cargo supervisor); gerente_id (vendedor e supervisor: responsável da equipe-pai; promotor: o responsável da equipe-pai quando a equipe é de um supervisor, ou o da própria equipe quando ela é de um gerente). Nada gravado no usuário: deriva de core.equipe. security_invoker: RLS das 4 tabelas.';
grant select on core.v_usuario_hierarquia to macuxi_app;

-- Promotor: gerente obrigatório e, com supervisor, o gerente do supervisor (R-20261114-154000, RN-CORE-56) ----------------------
-- Confere os promotores (cargo promotor, vivos, ativos e COM equipe; sem equipe = domain/API do Core) alcançados por uma gravação: os usuários dados (o próprio e os
-- promotores das equipes que eles lideram e das filhas delas) e as equipes dadas (os promotores delas, das filhas e das equipes
-- lideradas por membros delas). Lê a view (uma regra, um lugar). Sem tenant (exclusão do tenant em curso) = nada a conferir.
create function core.conferir_promotores(p_tenant uuid, p_usuarios uuid[], p_equipes uuid[]) returns void
  language plpgsql stable
  set search_path = pg_catalog, core, plataforma, pg_temp
  as $$
declare
  v record;
begin
  if not exists (select 1 from plataforma.tenant t where t.id = p_tenant) then
    return;
  end if;
  for v in
    with eq as (
      select e.id from core.equipe e
       where e.tenant_id = p_tenant
         and (e.id = any(coalesce(p_equipes, '{}')) or e.responsavel_id = any(coalesce(p_usuarios, '{}')))
    ), alvo as (
      select e.id from core.equipe e
       where e.tenant_id = p_tenant
         and (e.id in (select eq.id from eq) or e.equipe_pai_id in (select eq.id from eq)
              or e.responsavel_id in (select m.id from core.usuario m where m.tenant_id = p_tenant and m.equipe_id in (select eq.id from eq)))
    )
    select h.usuario_id, h.supervisor_id, h.gerente_id,
           exists (select 1 from core.v_usuario_hierarquia g
                    where g.tenant_id = h.tenant_id and g.usuario_id = h.gerente_id and g.cargo = 'gerente') as com_gerente,
           exists (select 1 from core.v_usuario_hierarquia s
                    where s.tenant_id = h.tenant_id and s.usuario_id = h.supervisor_id and s.gerente_id = h.gerente_id) as gerente_do_supervisor
      from core.v_usuario_hierarquia h
      join core.usuario u on u.tenant_id = h.tenant_id and u.id = h.usuario_id
     where h.tenant_id = p_tenant and h.cargo = 'promotor' and u.ativo and u.equipe_id is not null
       and (u.id = any(coalesce(p_usuarios, '{}')) or u.equipe_id in (select alvo.id from alvo))
  loop
    if not v.com_gerente then
      raise exception 'promotor sem gerente: a equipe dele precisa ser a de um supervisor (com gerente na equipe-pai) ou a de um gerente'
        using errcode = '23514', constraint = 'promotor_sem_gerente', detail = 'usuario_id=' || v.usuario_id::text,
              hint = 'RN-CORE-56';
    end if;
    if v.supervisor_id is not null and not v.gerente_do_supervisor then
      raise exception 'o gerente do promotor precisa ser o gerente do supervisor dele'
        using errcode = '23514', constraint = 'promotor_gerente_do_supervisor', detail = 'usuario_id=' || v.usuario_id::text,
              hint = 'RN-CORE-56';
    end if;
  end loop;
end
$$;
revoke all on function core.conferir_promotores(uuid, uuid[], uuid[]) from public;

-- Uma função de gatilho para as 4 tabelas, conferida no COMMIT. SECURITY DEFINER (roda como o dono; ver o item 3 do cabeçalho
-- e a 0049): o COMMIT de uma sa_* chamada pelo macuxi_portal não tem acesso a core.
create function core.promotor_conferir() returns trigger
  language plpgsql security definer
  set search_path = pg_catalog, core, plataforma, pg_temp
  as $$
begin
  case tg_table_schema || '.' || tg_table_name
    when 'core.usuario' then
      perform core.conferir_promotores(new.tenant_id, array[new.id], null);
    when 'core.equipe' then
      perform core.conferir_promotores(new.tenant_id, null, array[new.id]);
    when 'plataforma.usuario_perfil' then
      perform core.conferir_promotores(new.tenant_id, array[new.usuario_id], null);
    when 'plataforma.perfil' then
      perform core.conferir_promotores(new.tenant_id,
        array(select up.usuario_id from plataforma.usuario_perfil up
               where up.tenant_id = new.tenant_id and up.perfil_id = new.id and up.deleted_at is null), null);
  end case;
  return null;
end
$$;
revoke all on function core.promotor_conferir() from public;

create constraint trigger usuario_conferir_promotor after insert or update of perfil, equipe_id, ativo, deleted_at on core.usuario
  deferrable initially deferred
  for each row execute function core.promotor_conferir();
create constraint trigger equipe_conferir_promotor after update of responsavel_id, equipe_pai_id, deleted_at on core.equipe
  deferrable initially deferred
  for each row execute function core.promotor_conferir();
create constraint trigger usuario_perfil_conferir_promotor after insert or update of perfil_id, deleted_at on plataforma.usuario_perfil
  deferrable initially deferred
  for each row execute function core.promotor_conferir();
create constraint trigger perfil_conferir_promotor after update of cargo on plataforma.perfil
  deferrable initially deferred
  for each row execute function core.promotor_conferir();
