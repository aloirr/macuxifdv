-- 0105_plataforma_perfis_sem_base_derivacao (down) — volta ao modelo de hoje (fábrica da base + sobreposições), plano §4.3.
-- O migrador desce antes a 0106 (sem os gatilhos de espelho, nada mais grava concessões).
-- 1. Perfil cujas concessões mudaram fora da derivação (gravadas pela API nova; diferem de concessoes_derivadas): as
--    sobreposições passam a ser a diferença entre as concessões e o modelo v1 da base (o cálculo de sobreposicoesDoDesejado do
--    Core): concedida=false no que o modelo dá e o perfil não tem; concedida=true (com nível e alvos) no que sobra ou difere.
--    Perda documentada: o que só o modelo novo aceita volta cortado pelas travas da BASE (ex.: acesso.portal num perfil de base
--    analista; acesso.bko num de base vendedor; escopo acima do da base vira o da base). Os perfis intocados mantêm as
--    sobreposições originais, que a 0105 nunca apagou.
-- 2. O cargo dos perfis acertados pela 0105 (sem usuários; auditoria 'perfil.migracao_cargo') volta ao de antes, se o perfil
--    segue sem usuários e com o cargo que a 0105 gravou. A linha de auditoria fica (histórico).
-- 3. Apaga as concessões, os achados e catalogo_aplicado (as tabelas são da 0104) e as funções desta migração.
do $$
declare
  r record;
begin
  for r in
    select p.tenant_id, p.id, p.base
      from plataforma.perfil p
     where p.deleted_at is null
       and exists (select 1 from plataforma.catalogo_aplicado c
                    where c.tenant_id = p.tenant_id and c.deleted_at is null and c.leitura = 'concessao')
       and plataforma.permissoes_normalizadas(plataforma.concessoes_do_perfil(p.id))
           is distinct from plataforma.permissoes_normalizadas(plataforma.concessoes_derivadas(p.id, p.cargo))
     order by p.tenant_id, p.id
  loop
    update plataforma.perfil_permissao s set deleted_at = now()
     where s.tenant_id = r.tenant_id and s.perfil_id = r.id and s.deleted_at is null;
    insert into plataforma.perfil_permissao (tenant_id, perfil_id, chave, concedida, nivel, alvos)
    with d as (
      select e.key as chave, e.value ->> 'nivel' as nivel,
             case when jsonb_typeof(e.value -> 'alvos') = 'array' then array(select jsonb_array_elements_text(e.value -> 'alvos')) end as alvos
        from jsonb_each(plataforma.concessoes_do_perfil(r.id)) e
    ),
    m as (
      select x.chave, x.nivel, x.alvos from plataforma.modelo_permissao x
       where x.versao = 1 and x.modelo = r.base and x.deleted_at is null
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

update plataforma.perfil p set cargo = a.antes ->> 'cargo'
  from plataforma.auditoria a
 where a.tenant_id = p.tenant_id and a.acao = 'perfil.migracao_cargo' and a.entidade = 'perfil' and a.entidade_id = p.id
   and p.cargo = a.depois ->> 'cargo'
   and not exists (select 1 from plataforma.usuario_perfil up
                    where up.tenant_id = p.tenant_id and up.perfil_id = p.id and up.deleted_at is null);

delete from plataforma.perfil_concessao;
delete from plataforma.perfil_migracao_conflito;
delete from plataforma.catalogo_aplicado;

drop function if exists plataforma.migrar_perfis_sem_base(uuid);
drop function if exists plataforma.sincronizar_concessoes(uuid, jsonb);
drop function if exists plataforma.diagnosticar_perfis_sem_base(uuid);
drop function if exists plataforma.perfil_compat(text, jsonb);
drop function if exists plataforma.permissoes_normalizadas(jsonb);
drop function if exists plataforma.concessoes_do_perfil(uuid);
drop function if exists plataforma.concessoes_derivadas(uuid, text);
drop function if exists plataforma.aplicar_travas_do_cargo(jsonb, text);
drop function if exists plataforma.tem_gestao_do_acesso(jsonb);
drop function if exists plataforma.permissoes_legado_do_perfil(uuid, boolean);
