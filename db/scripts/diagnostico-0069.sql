-- Diagnóstico da 0069_core_cargo_hierarquia (cargo, um perfil por usuário, hierarquia). Só leitura; rode como administrador do
-- banco (vê todos os tenants) ou como macuxi_app com app.tenant_id (vê só o tenant). Dicionário: docs/banco/plataforma.md ("0069").
--
-- Consulta 1 — ANTES da 0069: quem tem 2+ perfis vivos e o que a migração faz (fica = o vínculo que fica; o resto vai para soft
-- delete; principal_novo = a base que core.usuario.perfil passa a ter). Mesma ordem de nível da migração: perfil ativo e vivo
-- primeiro; admin > gerente > supervisor > analista > assistente > vendedor > promotor; mesma base: personalizado antes do de
-- fábrica, salvo admin (fica o de fábrica); vínculo mais novo; id.
with ordem as (
  select up.tenant_id, up.usuario_id, up.id as vinculo_id, p.codigo, p.base, p.fabrica,
         row_number() over (
           partition by up.tenant_id, up.usuario_id
           order by (p.ativo and p.deleted_at is null) desc,
                    array_position(array['admin', 'gerente', 'supervisor', 'analista', 'assistente', 'vendedor', 'promotor']::text[], p.base),
                    case when p.base = 'admin' then not p.fabrica else p.fabrica end,
                    up.created_at desc,
                    up.id
         ) as n,
         count(*) over (partition by up.tenant_id, up.usuario_id) as vivos
    from plataforma.usuario_perfil up
    join plataforma.perfil p on p.tenant_id = up.tenant_id and p.id = up.perfil_id
   where up.deleted_at is null
)
select t.codigo as tenant, o.usuario_id, u.perfil as principal_atual, o.vivos,
       string_agg(o.codigo, ', ' order by o.n) filter (where o.n = 1) as fica,
       string_agg(o.codigo, ', ' order by o.n) filter (where o.n > 1) as sai,
       max(o.base) filter (where o.n = 1) as principal_novo
  from ordem o
  join core.usuario u on u.tenant_id = o.tenant_id and u.id = o.usuario_id
  join plataforma.tenant t on t.id = o.tenant_id
 where o.vivos > 1
 group by t.codigo, o.usuario_id, u.perfil, o.vivos
 order by t.codigo, o.usuario_id;

-- Consulta 2 — DEPOIS da 0069: vínculos que a 0069 apagou (o down os devolve).
-- select up.tenant_id, up.usuario_id, p.codigo
--   from plataforma.usuario_perfil up join plataforma.perfil p on p.tenant_id = up.tenant_id and p.id = up.perfil_id
--  where up.deleted_at = (select aplicada_em from public.macuxi_migracao where versao = '0069')
--  order by 1, 2, 3;

-- Consulta 3 — DEPOIS da 0069: cadastro fora da hierarquia (aqui só lista). Vendedor e supervisor: o domain do Core recusa no
-- próximo salvamento. Promotor (R-20261114-154000): o BANCO recusa no COMMIT a próxima gravação que o alcance (gatilhos
-- *_conferir_promotor), com os mesmos 2 nomes de erro; o promotor legado listado aqui precisa de equipe antes disso.
--   vendedor_sem_supervisor          vendedor sem equipe ou cuja equipe não tem responsável de cargo supervisor
--   supervisor_sem_equipe            supervisor que não é o responsável da própria equipe (core.usuario.equipe_id)
--   supervisor_sem_gerente           supervisor cuja equipe não tem equipe-pai com responsável de cargo gerente
--   promotor_sem_gerente             promotor ativo sem gerente (equipe de um supervisor sem gerente na equipe-pai, equipe de
--                                    outro cargo, sem responsável ou sem equipe)
--   promotor_gerente_do_supervisor   promotor ativo com supervisor cujo gerente não é o dele
-- select h.tenant_id, h.usuario_id, h.cargo, problema
--   from core.v_usuario_hierarquia h
--   join core.usuario u on u.tenant_id = h.tenant_id and u.id = h.usuario_id
--   left join core.v_usuario_hierarquia s on s.tenant_id = h.tenant_id and s.usuario_id = h.supervisor_id
--   left join core.v_usuario_hierarquia g on g.tenant_id = h.tenant_id and g.usuario_id = h.gerente_id
--   cross join lateral (values
--     (case when h.cargo = 'vendedor' and s.cargo is distinct from 'supervisor' then 'vendedor_sem_supervisor' end),
--     (case when h.cargo = 'supervisor' and not exists (select 1 from core.equipe e where e.tenant_id = h.tenant_id
--            and e.id = h.equipe_id and e.responsavel_id = h.usuario_id) then 'supervisor_sem_equipe' end),
--     (case when h.cargo = 'supervisor' and g.cargo is distinct from 'gerente' then 'supervisor_sem_gerente' end),
--     (case when h.cargo = 'promotor' and u.ativo and g.cargo is distinct from 'gerente' then 'promotor_sem_gerente' end),
--     (case when h.cargo = 'promotor' and u.ativo and h.supervisor_id is not null
--            and s.gerente_id is distinct from h.gerente_id then 'promotor_gerente_do_supervisor' end)
--   ) as x (problema)
--  where x.problema is not null
--  order by 1, 3, 2;
