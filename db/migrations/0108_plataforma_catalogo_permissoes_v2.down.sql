-- 0108_plataforma_catalogo_permissoes_v2 (down) — volta ao catálogo v1 (0105 a 0107):
-- 1. catalogo_aplicado de todo tenant volta de versao 2 a 1 (a mesma linha);
-- 2. as concessões das 7 chaves que só a v2 tem saem com soft delete (a v1 não as conhece; o acesso volta a ser o da rota pela
--    base, o de antes da 0108). Perda documentada: a chave desmarcada pela API nova num perfil volta a valer pela base;
-- 3. a gêmea plataforma.permissoes_legado_do_perfil volta a ler o modelo v1 (o corpo da 0106);
-- 4. tenant_semear_concessoes volta ao corpo da 0107 e aplicar_catalogo_v2 é apagada;
-- 5. as linhas versao 2 de plataforma.modelo_permissao são apagadas (catálogo da plataforma; a v1 fica).
update plataforma.catalogo_aplicado set versao = 1 where versao = 2;

update plataforma.perfil_concessao c set deleted_at = now()
 where c.deleted_at is null
   and c.chave in (select m2.chave from plataforma.modelo_permissao m2
                    where m2.versao = 2
                      and not exists (select 1 from plataforma.modelo_permissao m1 where m1.versao = 1 and m1.chave = m2.chave));

create or replace function plataforma.permissoes_legado_do_perfil(p_perfil uuid, p_parametros boolean default false) returns jsonb
  language sql stable
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
    with p as (
      select pf.tenant_id, pf.id, pf.base,
             plataforma.teto_escopo_do_cargo(plataforma.cargo_da_base(pf.base)) as teto
        from plataforma.perfil pf where pf.id = p_perfil
    ),
    fab as (
      select m.chave, m.nivel, m.alvos
        from p join plataforma.modelo_permissao m on m.versao = 1 and m.modelo = p.base and m.deleted_at is null
    ),
    sob as (
      select s.chave, s.concedida, s.nivel, s.alvos
        from p join plataforma.perfil_permissao s on s.tenant_id = p.tenant_id and s.perfil_id = p.id and s.deleted_at is null
    ),
    res as (
      select f.chave, f.nivel, f.alvos from fab f where not exists (select 1 from sob s where s.chave = f.chave)
      union all
      select s.chave, coalesce(s.nivel, f.nivel, case when s.chave = 'dados.escopo' then 'proprio' end), coalesce(s.alvos, f.alvos)
        from sob s left join fab f on f.chave = s.chave
       where s.concedida
    ),
    travado as (
      select r.chave,
             case when r.chave <> 'dados.escopo' then r.nivel
                  when r.nivel is null or r.nivel not in ('proprio', 'carteira', 'equipe', 'equipes_abaixo', 'tenant') then 'carteira'
                  when array_position(array['proprio', 'carteira', 'equipe', 'equipes_abaixo', 'tenant'], r.nivel)
                       > array_position(array['proprio', 'carteira', 'equipe', 'equipes_abaixo', 'tenant'], p.teto) then p.teto
                  else r.nivel end as nivel,
             r.alvos
        from res r cross join p
       where not (r.chave = 'acesso.bko' and p.base in ('vendedor', 'promotor', 'supervisor'))
         and not (r.chave = 'acesso.portal' and p.base <> 'admin')
         and not (p.base = 'promotor' and r.chave ~ '^pedido(_[a-z0-9_]+)?\.' and split_part(r.chave, '.', 2) <> 'ver')
    ),
    par as (
      select coalesce((select pr.valor <> 'false'::jsonb from plataforma.parametro pr
                        where pr.tenant_id = p.tenant_id and pr.modulo = 'core' and pr.chave = 'promotor_ve_pedidos'
                          and pr.deleted_at is null limit 1), true) as ve_pedidos,
             coalesce((select pr.valor = 'true'::jsonb from plataforma.parametro pr
                        where pr.tenant_id = p.tenant_id and pr.modulo = 'catalogo' and pr.chave = 'promotor_ve_preco_estoque'
                          and pr.deleted_at is null limit 1), false) as ve_preco,
             p.base
        from p
    ),
    ajustado as (
      select t.chave, t.nivel, t.alvos
        from travado t cross join par
       where not (p_parametros and t.chave = 'produto.ver_preco_estoque')
         and not (p_parametros and par.base = 'promotor' and t.chave = 'pedido.ver' and not par.ve_pedidos)
      union all
      select 'produto.ver_preco_estoque', null, null
        from par
       where p_parametros and (par.base <> 'promotor' or par.ve_preco)
    )
    select case when exists (select 1 from p) then
             coalesce((select jsonb_object_agg(a.chave, jsonb_strip_nulls(jsonb_build_object('nivel', a.nivel, 'alvos', to_jsonb(a.alvos))))
                         from ajustado a), '{}'::jsonb)
           end
  $$;

create or replace function plataforma.tenant_semear_concessoes() returns trigger
  language plpgsql security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
begin
  perform plataforma.migrar_perfis_sem_base(new.id);
  return null;
end
$$;

drop function if exists plataforma.aplicar_catalogo_v2(uuid);

delete from plataforma.modelo_permissao where versao = 2;
