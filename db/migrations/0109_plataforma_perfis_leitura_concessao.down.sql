-- 0109_plataforma_perfis_leitura_concessao (down) — volta todo tenant ao modelo de hoje (plano §4.3; a 0108 fica como estava):
-- 1. Sai o gatilho perfil_concessao_conferir (antes de qualquer gravação, sem evento pendente).
-- 2. No tenant em 'concessao', o perfil cujas concessões mudaram fora da derivação (gravadas pela API nova: diferem de
--    concessoes_derivadas) recebe as sobreposições recalculadas: a diferença entre as concessões (lidas ANTES de gravar, porque o
--    espelho da 0107 refaz as concessões a cada sobreposição) e o modelo v2 da base (o catálogo da 0108), como em
--    sobreposicoesDoDesejado do Core e na 0106.down. Perda documentada: o que só o modelo novo aceita volta cortado pelas travas
--    da BASE (ex.: acesso.portal num perfil de base analista; escopo acima do da base vira o da base). Os perfis intocados
--    mantêm as sobreposições originais, que a 0109 nunca apagou.
-- 3. Todo tenant volta a 'legado' (catalogo_aplicado fica, com a versão e o aplicado_em; as concessões e os achados ficam).
-- 4. As funções recriadas voltam como cópia exata: usuario_admin_com_gestao e tenant_tem_admin_com_gestao (0041),
--    usuario_conferir_acesso, usuario_perfil_conferir e perfil_conferir (0041, com o SECURITY DEFINER da 0049),
--    usuario_tem_perfil_admin (0047), licencas_em_uso (0086) e tenant_semear_concessoes (0108). As novas saem:
--    perfil_do_usuario, permissoes_efetivas_do_perfil, perfil_com_gestao_na_transacao, ligar_leitura_por_concessao e
--    perfil_concessao_conferir. perfis_do_usuario (0041) a 0109 não muda.
-- Volte antes o código da API e do Core que lê perfil_do_usuario ou grava perfil_concessao.
drop trigger perfil_concessao_conferir on plataforma.perfil_concessao;
drop function plataforma.perfil_concessao_conferir();

create temporary table perfil_mudado_0109 on commit drop as
  select p.tenant_id, p.id, p.base, plataforma.concessoes_do_perfil(p.id) as concessoes
    from plataforma.perfil p
   where p.deleted_at is null
     and exists (select 1 from plataforma.catalogo_aplicado c
                  where c.tenant_id = p.tenant_id and c.deleted_at is null and c.leitura = 'concessao')
     and plataforma.permissoes_normalizadas(plataforma.concessoes_do_perfil(p.id))
         is distinct from plataforma.permissoes_normalizadas(plataforma.concessoes_derivadas(p.id, p.cargo));

do $$
declare
  r record;
begin
  for r in select m.tenant_id, m.id, m.base, m.concessoes from perfil_mudado_0109 m order by m.tenant_id, m.id loop
    update plataforma.perfil_permissao s set deleted_at = now()
     where s.tenant_id = r.tenant_id and s.perfil_id = r.id and s.deleted_at is null;
    insert into plataforma.perfil_permissao (tenant_id, perfil_id, chave, concedida, nivel, alvos)
    with d as (
      select e.key as chave, e.value ->> 'nivel' as nivel,
             case when jsonb_typeof(e.value -> 'alvos') = 'array' then array(select jsonb_array_elements_text(e.value -> 'alvos')) end as alvos
        from jsonb_each(r.concessoes) e
    ),
    m as (
      select x.chave, x.nivel, x.alvos from plataforma.modelo_permissao x
       where x.versao = 2 and x.modelo = r.base and x.deleted_at is null
    ),
    sob as (
      select m.chave, false as concedida, null::text as nivel, null::text[] as alvos
        from m where not exists (select 1 from d where d.chave = m.chave)
      union all
      select d.chave, true, d.nivel, d.alvos
        from d left join m on m.chave = d.chave
       where m.chave is null or m.nivel is distinct from d.nivel or m.alvos is distinct from d.alvos
    )
    select r.tenant_id, r.id, s.chave, s.concedida,
           case when s.chave = 'dados.escopo' and s.concedida
                     and array_position(array['proprio', 'carteira', 'equipe', 'equipes_abaixo', 'tenant'], s.nivel)
                       > array_position(array['proprio', 'carteira', 'equipe', 'equipes_abaixo', 'tenant'],
                                        plataforma.teto_escopo_do_cargo(plataforma.cargo_da_base(r.base)))
                then plataforma.teto_escopo_do_cargo(plataforma.cargo_da_base(r.base))
                else s.nivel end,
           s.alvos
      from sob s
     where not (s.concedida and s.chave = 'acesso.bko' and r.base in ('vendedor', 'promotor', 'supervisor'))
       and not (s.concedida and s.chave = 'acesso.portal' and r.base <> 'admin')
       and not (s.concedida and r.base = 'promotor' and s.chave ~ '^pedido(_[a-z0-9_]+)?\.' and split_part(s.chave, '.', 2) <> 'ver');
  end loop;
end
$$;

update plataforma.catalogo_aplicado c set leitura = 'legado' where c.leitura = 'concessao';

-- cópia exata da 0108
create or replace function plataforma.tenant_semear_concessoes() returns trigger
  language plpgsql security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
begin
  perform plataforma.migrar_perfis_sem_base(new.id);
  perform plataforma.aplicar_catalogo_v2(new.id);
  return null;
end
$$;

drop function plataforma.ligar_leitura_por_concessao(uuid);

-- cópia exata da 0086
create or replace function plataforma.licencas_em_uso(p_tenant uuid)
  returns table (item text, em_uso integer)
  language sql stable
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
    with ativos as (
      select u.id as usuario_id, pf.base, pf.codigo
        from core.usuario u
        join plataforma.usuario_perfil up on up.tenant_id = u.tenant_id and up.usuario_id = u.id and up.deleted_at is null
        join plataforma.perfil pf on pf.tenant_id = up.tenant_id and pf.id = up.perfil_id and pf.deleted_at is null and pf.ativo
       where u.tenant_id = p_tenant and u.ativo and u.deleted_at is null
    ),
    ocupa (usuario_id, item) as (
      select a.usuario_id,
             case a.base when 'vendedor' then 'vendedor' when 'promotor' then 'promotor'
                         when 'supervisor' then 'gestor' when 'gerente' then 'gestor'
                         when 'analista' then 'bko' when 'assistente' then 'bko' when 'admin' then 'bko' end
        from ativos a
      union
      select a.usuario_id, pm.modulo
        from ativos a
        join plataforma.perfil_modulo pm on pm.tenant_id = p_tenant and pm.perfil = a.codigo and pm.deleted_at is null
                                        and pm.modulo in ('pesquisa', 'treinamento')
       where exists (select 1 from plataforma.tenant_modulo tm
                      where tm.tenant_id = p_tenant and tm.modulo = pm.modulo and tm.ativo and tm.deleted_at is null)
         and not exists (select 1 from plataforma.usuario_modulo um
                          where um.tenant_id = p_tenant and um.usuario_id = a.usuario_id and um.modulo = pm.modulo
                            and um.efeito = 'remover' and um.deleted_at is null)
    )
    select i.item, (select count(distinct o.usuario_id) from ocupa o where o.item = i.item)::integer
      from unnest(array['vendedor', 'gestor', 'bko', 'promotor', 'pesquisa', 'treinamento']) with ordinality as i (item, n)
     order by i.n
  $$;
revoke all on function plataforma.licencas_em_uso(uuid) from public, macuxi_worker, macuxi_portal;
grant execute on function plataforma.licencas_em_uso(uuid) to macuxi_app;

-- cópia exata da 0047
create or replace function plataforma.usuario_tem_perfil_admin(p_tenant uuid, p_usuario uuid) returns boolean
  language sql stable security invoker
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
    select exists (
      select 1
        from plataforma.usuario_perfil up
        join plataforma.perfil p on p.tenant_id = up.tenant_id and p.id = up.perfil_id and p.ativo and p.deleted_at is null
       where up.tenant_id = p_tenant and up.usuario_id = p_usuario and up.deleted_at is null and p.base = 'admin')
  $$;
revoke all on function plataforma.usuario_tem_perfil_admin(uuid, uuid) from public, macuxi_app, macuxi_worker, macuxi_portal;

-- cópia exata da 0041 com o SECURITY DEFINER da 0049 (as 3 funções dos gatilhos de restrição; gatilhos e ACLs não mudam)
create or replace function plataforma.usuario_conferir_acesso() returns trigger
  language plpgsql security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
begin
  if not exists (select 1 from plataforma.tenant t where t.id = new.tenant_id) then
    return null;
  end if;
  perform plataforma.conferir_perfis_do_usuario(new.tenant_id, new.id);
  -- desativou ou apagou quem tem perfil de base admin
  if tg_op = 'UPDATE' and old.ativo and old.deleted_at is null
     and exists (select 1 from plataforma.usuario_perfil up
                   join plataforma.perfil p on p.tenant_id = up.tenant_id and p.id = up.perfil_id
                  where up.tenant_id = new.tenant_id and up.usuario_id = new.id and up.deleted_at is null and p.base = 'admin') then
    perform plataforma.conferir_ultimo_admin(new.tenant_id);
  end if;
  return null;
end
$$;
revoke all on function plataforma.usuario_conferir_acesso() from public;

create or replace function plataforma.usuario_perfil_conferir() returns trigger
  language plpgsql security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_tenant uuid := case when tg_op = 'DELETE' then old.tenant_id else new.tenant_id end;
  v_base_antes text;
  v_base_depois text;
begin
  if not exists (select 1 from plataforma.tenant t where t.id = v_tenant) then
    return null;
  end if;
  if tg_op <> 'DELETE' then
    perform plataforma.conferir_perfis_do_usuario(new.tenant_id, new.usuario_id);
    select p.base into v_base_depois from plataforma.perfil p where p.tenant_id = new.tenant_id and p.id = new.perfil_id;
  end if;
  if tg_op <> 'INSERT' then
    if tg_op = 'DELETE' or old.usuario_id is distinct from new.usuario_id then
      perform plataforma.conferir_perfis_do_usuario(old.tenant_id, old.usuario_id);
    end if;
    if old.deleted_at is null then
      select p.base into v_base_antes from plataforma.perfil p where p.tenant_id = old.tenant_id and p.id = old.perfil_id;
    end if;
  end if;
  -- saiu um vínculo vivo com perfil de base admin; ou quem tem perfil de base admin ganhou um que fecha o BKO (RN-CORE-33)
  if v_base_antes = 'admin'
     or (tg_op <> 'DELETE' and new.deleted_at is null and v_base_depois in ('vendedor', 'promotor', 'supervisor')
         and exists (select 1 from plataforma.usuario_perfil up
                       join plataforma.perfil p on p.tenant_id = up.tenant_id and p.id = up.perfil_id
                      where up.tenant_id = new.tenant_id and up.usuario_id = new.usuario_id and up.deleted_at is null
                        and p.base = 'admin')) then
    perform plataforma.conferir_ultimo_admin(v_tenant);
  end if;
  return null;
end
$$;
revoke all on function plataforma.usuario_perfil_conferir() from public;

create or replace function plataforma.perfil_conferir() returns trigger
  language plpgsql security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_atual record;
begin
  if not exists (select 1 from plataforma.tenant t where t.id = old.tenant_id) then
    return null;
  end if;
  select p.ativo, p.deleted_at into v_atual from plataforma.perfil p where p.tenant_id = old.tenant_id and p.id = old.id;
  -- os 7 de fábrica ficam (o CHECK perfil_fabrica_ativo cobre a desativação; aqui, a exclusão física fora da excluir_tenant)
  if old.fabrica and not exists (select 1 from plataforma.perfil p
                                   where p.tenant_id = old.tenant_id and p.codigo = old.codigo and p.fabrica) then
    raise exception 'o perfil de fábrica % não pode ser apagado', old.codigo using errcode = '23514',
      constraint = 'perfil_fabrica_presente', hint = 'RN-CORE-35';
  end if;
  -- perfil desativado ou apagado não pode ficar com usuário (os vínculos saem antes)
  if (v_atual is null or not v_atual.ativo or v_atual.deleted_at is not null)
     and exists (select 1 from plataforma.usuario_perfil up
                   join core.usuario u on u.tenant_id = up.tenant_id and u.id = up.usuario_id and u.deleted_at is null
                  where up.tenant_id = old.tenant_id and up.perfil_id = old.id and up.deleted_at is null) then
    raise exception 'perfil em uso por usuário não pode ser desativado nem apagado' using errcode = '23514',
      constraint = 'perfil_em_uso', hint = 'RN-CORE-01';
  end if;
  if old.base = 'admin' and old.ativo and old.deleted_at is null then
    perform plataforma.conferir_ultimo_admin(old.tenant_id);
  end if;
  return null;
end
$$;
revoke all on function plataforma.perfil_conferir() from public;

drop function plataforma.perfil_com_gestao_na_transacao(uuid, uuid);

-- cópia exata da 0041
create or replace function plataforma.usuario_admin_com_gestao(p_tenant uuid, p_usuario uuid) returns boolean
  language sql stable
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
    with perfis as (
      select p.id, p.base
        from core.usuario u
        join plataforma.usuario_perfil up on up.tenant_id = u.tenant_id and up.usuario_id = u.id and up.deleted_at is null
        join plataforma.perfil p on p.tenant_id = up.tenant_id and p.id = up.perfil_id and p.ativo and p.deleted_at is null
       where u.tenant_id = p_tenant and u.id = p_usuario and u.ativo and u.deleted_at is null
    )
    select exists (select 1 from perfis f where f.base = 'admin')
       and not exists (select 1 from perfis f where f.base in ('vendedor', 'promotor', 'supervisor'))
       and not exists (
         select 1
           from unnest(array['acesso.bko', 'perfil.gerir', 'usuario.criar', 'usuario.editar', 'usuario.desativar']) as k (chave)
          where not exists (
            select 1 from perfis f
             where coalesce(
                     (select pp.concedida from plataforma.perfil_permissao pp
                       where pp.tenant_id = p_tenant and pp.perfil_id = f.id and pp.chave = k.chave and pp.deleted_at is null),
                     case when k.chave = 'acesso.bko' then f.base in ('gerente', 'analista', 'assistente', 'admin')
                          else f.base = 'admin' end)))
  $$;
revoke all on function plataforma.usuario_admin_com_gestao(uuid, uuid) from public;
grant execute on function plataforma.usuario_admin_com_gestao(uuid, uuid) to macuxi_app;

create or replace function plataforma.tenant_tem_admin_com_gestao(p_tenant uuid) returns boolean
  language sql stable
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
    select exists (
      select 1
        from plataforma.usuario_perfil up
        join plataforma.perfil p on p.tenant_id = up.tenant_id and p.id = up.perfil_id
       where up.tenant_id = p_tenant and up.deleted_at is null and p.base = 'admin' and p.ativo and p.deleted_at is null
         and plataforma.usuario_admin_com_gestao(p_tenant, up.usuario_id))
  $$;
revoke all on function plataforma.tenant_tem_admin_com_gestao(uuid) from public;
grant execute on function plataforma.tenant_tem_admin_com_gestao(uuid) to macuxi_app;

drop function plataforma.perfil_do_usuario(uuid);
drop function plataforma.permissoes_efetivas_do_perfil(uuid);
