-- 0108_plataforma_catalogo_permissoes_v2 (up) — v1.0.35, ADR 0073 (perfis sem perfil base), catálogo de permissões versão 2 do
-- SDK (CATALOGO_PERMISSOES_VERSAO = 2; ACOES_DA_TRANSICAO de packages/platform-sdk/src/permissoes-perfil.ts). RN-CORE-04,
-- RF-PES-01, RN-PRO-10. Dicionário: docs/banco/plataforma.md ("0108 — catálogo de permissões v2").
--
-- O catálogo v2 = o v1 + 7 chaves de leitura, sem nível e sem alvos, das rotas que hoje restringem só pelo perfil base, com os
-- MESMOS perfis da rota (ninguém ganha nem perde acesso):
--   core      carteira.ver, equipe.ver, rota.ver, visita.ver       modelos supervisor, gerente, analista, assistente e admin
--   pesquisa  questionario.ver                                    modelos supervisor, gerente, analista e admin (o assistente não)
--   promotor  cadastro_trade.ver, relatorio_trade.ver             idem
--
-- 1. plataforma.modelo_permissao versão 2 = linhasDosModelos(modelosDePerfil(manifestos), 2): as 406 linhas da v1 (copiadas da
--    própria tabela; a v1 é congelada) + as 32 das chaves novas = 438 (vendedor 29, promotor 33, supervisor 57, gerente 71,
--    analista 104, assistente 26, admin 118). Id plataforma.uuid_de_chave('plataforma.modelo_permissao:2:<modelo>:<chave>').
--    A v1 fica (histórico e caminho de volta). db/testes/catalogo-v2.db.test.ts compara a v2 com o SDK.
-- 2. plataforma.permissoes_legado_do_perfil (gêmea de resolverPerfil, 0106) passa a ler o modelo v2: é o acesso de hoje com as
--    chaves novas pela BASE do perfil (a rota de hoje aceita o perfil pela base). Com ela, concessoes_derivadas, o espelho da
--    0107 (espelhar_perfil), conferir_perfis_sem_base e a derivação de um tenant ainda não derivado (migrar_perfis_sem_base)
--    ficam coerentes com a v2 sem mudar de corpo.
-- 3. plataforma.aplicar_catalogo_v2(tenant) -> 'aplicado' | 'ja_aplicado' | 'sem_catalogo'. Sem EXECUTE para ninguém. Trava do
--    tenant (a mesma de migrar_perfis_sem_base). Tenant derivado (perfis_derivados, 0106; na v1.0.37 todos em 'legado'): todo
--    perfil vivo (padrão ou personalizado, ativo ou não)
--    ganha cada chave nova que concessoes_derivadas(perfil, cargo) dá, isto é, conforme o modelo v2 da base (o personalizado de
--    cargo administrativo derivado do assistente fica sem questionario.ver, cadastro_trade.ver e relatorio_trade.ver, decisão
--    do gerente-projetos); nenhuma outra concessão muda (sincronizar_concessoes com as concessões de hoje + as novas; id
--    determinístico; nada muda quando já estão lá). Tenant não derivado (parado com 'para_tenant'): sem concessões a gravar (a
--    derivação dele, quando vier, já deriva da v2). Por fim, e só então, catalogo_aplicado do tenant passa de versao 1 a 2 (a
--    mesma linha: o id segue o da
--    primeira aplicação, plataforma.uuid_de_chave('<tenant>:plataforma.catalogo_aplicado:1'), que migrar_perfis_sem_base
--    usa no upsert). A leitura NÃO muda: nenhum tenant passa a 'concessao' (motor novo desligado na v1.0.37, decisão do dono
--    do produto; quem liga é a 0109). Idempotente.
-- 4. Tenant novo: tenant_semear_concessoes (0107) roda migrar_perfis_sem_base e depois aplicar_catalogo_v2 (nasce derivado na
--    v2, em 'legado').
-- 5. Rodada em todos os tenants (bloco no fim), com raise notice da contagem por resultado (sem dado pessoal).
--
-- Caminho de volta: 0108_plataforma_catalogo_permissoes_v2.down.sql (catalogo_aplicado volta a 1, as concessões das 7 chaves
-- saem com soft delete, a gêmea volta a ler a v1, tenant_semear_concessoes volta ao da 0107 e a v2 do modelo é apagada).

-- 1. Modelo v2 ---------------------------------------------------------------------------------------------------------------
insert into plataforma.modelo_permissao (id, versao, modelo, cargo, chave, nivel, alvos)
select plataforma.uuid_de_chave('plataforma.modelo_permissao:2:' || m.modelo || ':' || m.chave), 2, m.modelo, m.cargo, m.chave,
       m.nivel, m.alvos
  from plataforma.modelo_permissao m
 where m.versao = 1 and m.deleted_at is null
union all
select plataforma.uuid_de_chave('plataforma.modelo_permissao:2:' || v.modelo || ':' || v.chave), 2, v.modelo, v.cargo, v.chave,
       null, null
  from (values
  ('supervisor', 'supervisor', 'cadastro_trade.ver'),
  ('supervisor', 'supervisor', 'carteira.ver'),
  ('supervisor', 'supervisor', 'equipe.ver'),
  ('supervisor', 'supervisor', 'questionario.ver'),
  ('supervisor', 'supervisor', 'relatorio_trade.ver'),
  ('supervisor', 'supervisor', 'rota.ver'),
  ('supervisor', 'supervisor', 'visita.ver'),
  ('gerente', 'gerente', 'cadastro_trade.ver'),
  ('gerente', 'gerente', 'carteira.ver'),
  ('gerente', 'gerente', 'equipe.ver'),
  ('gerente', 'gerente', 'questionario.ver'),
  ('gerente', 'gerente', 'relatorio_trade.ver'),
  ('gerente', 'gerente', 'rota.ver'),
  ('gerente', 'gerente', 'visita.ver'),
  ('analista', 'administrativo', 'cadastro_trade.ver'),
  ('analista', 'administrativo', 'carteira.ver'),
  ('analista', 'administrativo', 'equipe.ver'),
  ('analista', 'administrativo', 'questionario.ver'),
  ('analista', 'administrativo', 'relatorio_trade.ver'),
  ('analista', 'administrativo', 'rota.ver'),
  ('analista', 'administrativo', 'visita.ver'),
  ('assistente', 'administrativo', 'carteira.ver'),
  ('assistente', 'administrativo', 'equipe.ver'),
  ('assistente', 'administrativo', 'rota.ver'),
  ('assistente', 'administrativo', 'visita.ver'),
  ('admin', 'administrativo', 'cadastro_trade.ver'),
  ('admin', 'administrativo', 'carteira.ver'),
  ('admin', 'administrativo', 'equipe.ver'),
  ('admin', 'administrativo', 'questionario.ver'),
  ('admin', 'administrativo', 'relatorio_trade.ver'),
  ('admin', 'administrativo', 'rota.ver'),
  ('admin', 'administrativo', 'visita.ver')
  ) as v (modelo, cargo, chave)
on conflict (id) do nothing;

-- 2. Gêmea de resolverPerfil no modelo v2 (o corpo da 0106 com versao = 2; grants mantidos) --------------------------------
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
        from p join plataforma.modelo_permissao m on m.versao = 2 and m.modelo = p.base and m.deleted_at is null
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

-- 3. Aplicação da v2 a um tenant ---------------------------------------------------------------------------------------------
create function plataforma.aplicar_catalogo_v2(p_tenant uuid) returns text
  language plpgsql volatile
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_novas text[];
  r record;
begin
  if p_tenant is null then
    raise exception 'aplicar_catalogo_v2: p_tenant obrigatório' using errcode = '22004';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('plataforma.migrar_perfis_sem_base:' || p_tenant::text, 0));
  if not exists (select 1 from plataforma.catalogo_aplicado c where c.tenant_id = p_tenant and c.deleted_at is null) then
    return 'sem_catalogo';
  end if;
  if not exists (select 1 from plataforma.catalogo_aplicado c where c.tenant_id = p_tenant and c.deleted_at is null and c.versao < 2) then
    return 'ja_aplicado';
  end if;
  -- as chaves que a v2 traz (as 7 desta migração), lidas do próprio modelo
  select coalesce(array_agg(distinct m2.chave order by m2.chave), '{}') into v_novas
    from plataforma.modelo_permissao m2
   where m2.versao = 2 and m2.deleted_at is null
     and not exists (select 1 from plataforma.modelo_permissao m1 where m1.versao = 1 and m1.chave = m2.chave and m1.deleted_at is null);
  if plataforma.perfis_derivados(p_tenant) then
    for r in select p.id, p.cargo from plataforma.perfil p where p.tenant_id = p_tenant and p.deleted_at is null order by p.id loop
      perform plataforma.sincronizar_concessoes(r.id,
        plataforma.concessoes_do_perfil(r.id)
        || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(plataforma.concessoes_derivadas(r.id, r.cargo)) e
                      where e.key = any (v_novas)), '{}'::jsonb));
    end loop;
  end if;
  update plataforma.catalogo_aplicado c set versao = 2
   where c.tenant_id = p_tenant and c.deleted_at is null and c.versao < 2;
  return 'aplicado';
end
$$;
revoke all on function plataforma.aplicar_catalogo_v2(uuid) from public;

-- 4. Tenant novo nasce na v2 (o corpo da 0107 + a aplicação da v2) ------------------------------------------------------------
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

-- 5. Rodada em todos os tenants ----------------------------------------------------------------------------------------------
do $$
declare
  v_t uuid;
  v_r text;
  v_aplicados integer := 0;
  v_outros integer := 0;
begin
  for v_t in select t.id from plataforma.tenant t order by t.id loop
    v_r := plataforma.aplicar_catalogo_v2(v_t);
    if v_r = 'aplicado' then
      v_aplicados := v_aplicados + 1;
    else
      v_outros := v_outros + 1;
    end if;
  end loop;
  raise notice '0108: catálogo v2 aplicado em % tenant(s); % sem mudança', v_aplicados, v_outros;
end
$$;
