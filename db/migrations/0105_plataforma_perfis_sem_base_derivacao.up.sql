-- 0105_plataforma_perfis_sem_base_derivacao (up) — v1.0.35, etapa E2 do plano docs/banco/plano-migracao-perfis-sem-base.md
-- (§3, §4.2, §4.4 e §2.0 da ADR 0073). Diagnóstico por tenant e derivação base + sobreposições -> concessões explícitas
-- (plataforma.perfil_concessao). RN-CORE-04, RN-CORE-33, RN-CORE-35, RN-PRO-01, RN-CAT-05. Dicionário: docs/banco/plataforma.md
-- ("0104 a 0106 — perfis sem perfil base").
--
-- Funções (todas SECURITY INVOKER, search_path fixo, sem EXECUTE para PUBLIC; as de leitura pura também para o macuxi_app):
-- 1. permissoes_legado_do_perfil(perfil, parametros) — gêmea SQL de resolverPerfil do SDK: modelo v1 da base
--    (plataforma.modelo_permissao) − sobreposições concedida=false ∪ sobreposições concedida=true (nível = o da sobreposição, o do
--    modelo ou o menor da família; alvos = os da sobreposição ou os do modelo) − travas da BASE (acesso.bko em vendedor,
--    promotor e supervisor; acesso.portal fora de admin; escrita de pedido no promotor); dados.escopo fora da família ->
--    'carteira', acima do teto da base -> o teto. Com parametros = true, o ajuste dos 2 parâmetros do tenant (plano §3.3; o
--    efeito de hoje vem do NOME do perfil + o parâmetro): base promotor perde pedido.ver se core.promotor_ve_pedidos = false (sem
--    linha = ligado) e tem produto.ver_preco_estoque só se catalogo.promotor_ve_preco_estoque = true; as outras bases sempre
--    têm produto.ver_preco_estoque (PERFIS_PRECO_ESTOQUE do Catálogo: o preço aparece pelo nome, mesmo com a chave revogada).
--    Saída: jsonb { chave: { nivel?, alvos? } }.
-- 2. aplicar_travas_do_cargo(permissoes, cargo) — tira o que a trava do CARGO proíbe (plataforma.trava_da_chave_do_cargo, 0104),
--    corta dados.escopo no teto do cargo e tira acesso.portal sem a gestão do acesso completa (ADR 0073 §2.5 item 2).
-- 3. concessoes_derivadas(perfil, cargo) = aplicar_travas_do_cargo(permissoes_legado_do_perfil(perfil, true), cargo).
-- 4. concessoes_do_perfil(perfil) — o que está gravado em perfil_concessao (vivo), no mesmo formato.
-- 5. permissoes_normalizadas(jsonb) — alvos em ordem (comparação por conjunto ordenado).
-- 6. tem_gestao_do_acesso(jsonb) — acesso.bko + perfil.gerir + usuario.criar + usuario.editar + usuario.desativar (decisão 4).
-- 7. perfil_compat(cargo, permissoes) — perfilDeCompatibilidade da ADR §2.8 (o valor de core.usuario.perfil na transição).
-- 8. diagnosticar_perfis_sem_base(tenant) — só leitura; uma linha por achado (plano §4.4, ADR §2.0 decisões 3 a 5):
--      CARGO_DIFERENTE_DA_BASE  perfil.cargo <> cargo_da_base(base): com usuários 'para_tenant'; sem usuários 'ajustado' (o cargo
--                               vira o da base, com auditoria)
--      TRAVA_NOVA_CORTA         chave que a trava do cargo corta (e a da base não cortava): com usuários 'para_tenant'; sem
--                               usuários 'ajustado' (a chave sai do perfil, ou o escopo desce ao teto)
--      PERFIL_SEM_ACESSO        perfil ativo sem nenhum acesso.*: com usuários 'para_tenant'; sem usuários 'aviso'
--      REVOGACAO_SEM_EFEITO     sobreposição concedida=false que hoje não muda o que vale (produto.ver_preco_estoque fora do
--                               promotor): a caixa fica marcada, 'aviso' (decisão 5)
--      CONCESSAO_SEM_EFEITO     sobreposição concedida=true que hoje não vale pelo parâmetro (promotor): a caixa fica
--                               desmarcada, 'aviso'
--      ADMIN_MUDA               perfil com usuários que passa a ser (ou deixa de ser) "admin" pela gestão do acesso, ou cujo
--                               alcance pelo senha.redefinir '*' muda (de "não é de base admin" para "não tem perfil.gerir"):
--                               'aviso' (decisão 4)
--      TENANT_SEM_ADMIN         o tenant tinha admin com gestão (0041) e ficaria sem nenhum: 'para_tenant'
--      NOME_DIVERGENTE          perfil com usuários em que perfil_compat(cargo, concessões) <> base: 'aviso' (a base fica)
-- 9. sincronizar_concessoes(perfil, desejado) — grava o conjunto: soft delete do que saiu, update do que mudou, reativa a linha
--    de id determinístico plataforma.uuid_de_chave('<tenant>:plataforma.perfil_concessao:<perfil>:<chave>') ou insere. Nada muda
--    (nem o updated_at) quando o conjunto já é o desejado.
-- 10. migrar_perfis_sem_base(tenant) -> 'migrado' | 'ja_migrado' | 'parado'. Tenant já em 'concessao': nada. Grava os achados em
--    perfil_migracao_conflito (id determinístico por tenant, tipo, perfil e chave; o que deixou de aparecer ganha resolvido_em).
--    Com algum 'para_tenant': nenhuma concessão, catalogo_aplicado (versão 1) em 'legado' e o tenant segue no modelo de hoje.
--    Sem: aplica os ajustes (cargo e cortes dos perfis sem usuários), grava as concessões de todo perfil vivo (ativos e
--    inativos; apagados não), confere a equivalência de todo perfil com usuário (concessões = permissoes_legado_do_perfil com
--    os parâmetros; diferença = 23514 e a migração INTEIRA volta: defeito da derivação, não do tenant) e marca 'concessao'.
--    Sem EXECUTE para ninguém: só o dono do banco (migração, ou depois de o tenant corrigir os conflitos).
-- 11. Rodada em todos os tenants (bloco no fim), com raise notice da contagem por resultado e por tipo de achado (sem dado
--    pessoal). Idempotente: rodar de novo não muda nenhuma linha.
-- Perfis de hoje: nada é apagado. perfil.base, perfil.fabrica, perfil_permissao e core.usuario.perfil ficam (caminho de volta e
-- transição, ADR §2.8). Só muda perfil.cargo de perfil SEM usuários com cargo diferente do da base (auditoria
-- 'perfil.migracao_cargo', modulo core, antes/depois); a chave cortada pela trava num perfil SEM usuários fica na auditoria
-- 'perfil.migracao_corte' (uma linha por perfil e chave; antes/depois só com a chave e o valor, sem dado pessoal).
--
-- Caminho de volta: 0105_plataforma_perfis_sem_base_derivacao.down.sql (recalcula as sobreposições dos perfis cujas concessões
-- mudaram fora da derivação, devolve o cargo dos perfis ajustados, apaga concessões, conflitos e catalogo_aplicado, e as funções).

-- 1. Gêmea de resolverPerfil -------------------------------------------------------------------------------------------------
create function plataforma.permissoes_legado_do_perfil(p_perfil uuid, p_parametros boolean default false) returns jsonb
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
revoke all on function plataforma.permissoes_legado_do_perfil(uuid, boolean) from public;
grant execute on function plataforma.permissoes_legado_do_perfil(uuid, boolean) to macuxi_app;

-- 2 a 7. Auxiliares puras ---------------------------------------------------------------------------------------------------
create function plataforma.tem_gestao_do_acesso(p_permissoes jsonb) returns boolean
  language sql immutable parallel safe
  set search_path = pg_catalog, pg_temp
  as $$
    select coalesce(p_permissoes ?& array['acesso.bko', 'perfil.gerir', 'usuario.criar', 'usuario.editar', 'usuario.desativar'], false)
  $$;
revoke all on function plataforma.tem_gestao_do_acesso(jsonb) from public;
grant execute on function plataforma.tem_gestao_do_acesso(jsonb) to macuxi_app;

create function plataforma.aplicar_travas_do_cargo(p_permissoes jsonb, p_cargo text) returns jsonb
  language sql immutable parallel safe
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
    with e as (
      select x.key as chave, x.value as valor, plataforma.trava_da_chave_do_cargo(p_cargo, x.key, x.value ->> 'nivel') as regra
        from jsonb_each(coalesce(p_permissoes, '{}'::jsonb)) x
    ),
    t as (
      select e.chave,
             case when e.regra = 'RN-CORE-04' then jsonb_build_object('nivel', plataforma.teto_escopo_do_cargo(p_cargo)) else e.valor end as valor
        from e
       where e.regra is null or (e.chave = 'dados.escopo' and e.regra = 'RN-CORE-04')
    )
    select coalesce(jsonb_object_agg(t.chave, t.valor) filter (
             where t.chave <> 'acesso.portal'
                or (select count(*) from t g
                     where g.chave in ('acesso.bko', 'perfil.gerir', 'usuario.criar', 'usuario.editar', 'usuario.desativar')) = 5),
           '{}'::jsonb)
      from t
  $$;
revoke all on function plataforma.aplicar_travas_do_cargo(jsonb, text) from public;
grant execute on function plataforma.aplicar_travas_do_cargo(jsonb, text) to macuxi_app;

create function plataforma.concessoes_derivadas(p_perfil uuid, p_cargo text) returns jsonb
  language sql stable
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
    select plataforma.aplicar_travas_do_cargo(plataforma.permissoes_legado_do_perfil(p_perfil, true), p_cargo)
  $$;
revoke all on function plataforma.concessoes_derivadas(uuid, text) from public;
grant execute on function plataforma.concessoes_derivadas(uuid, text) to macuxi_app;

create function plataforma.concessoes_do_perfil(p_perfil uuid) returns jsonb
  language sql stable
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
    select coalesce(jsonb_object_agg(c.chave, jsonb_strip_nulls(jsonb_build_object('nivel', c.nivel, 'alvos', to_jsonb(c.alvos)))),
                    '{}'::jsonb)
      from plataforma.perfil p
      join plataforma.perfil_concessao c on c.tenant_id = p.tenant_id and c.perfil_id = p.id and c.deleted_at is null
     where p.id = p_perfil
  $$;
revoke all on function plataforma.concessoes_do_perfil(uuid) from public;
grant execute on function plataforma.concessoes_do_perfil(uuid) to macuxi_app;

create function plataforma.permissoes_normalizadas(p_permissoes jsonb) returns jsonb
  language sql immutable parallel safe
  set search_path = pg_catalog, pg_temp
  as $$
    select coalesce(jsonb_object_agg(e.key,
             case when jsonb_typeof(e.value -> 'alvos') = 'array'
                  then jsonb_set(e.value, '{alvos}', (select coalesce(jsonb_agg(a order by a), '[]'::jsonb)
                                                        from (select distinct x as a from jsonb_array_elements_text(e.value -> 'alvos') x) d))
                  else e.value end), '{}'::jsonb)
      from jsonb_each(coalesce(p_permissoes, '{}'::jsonb)) e
  $$;
revoke all on function plataforma.permissoes_normalizadas(jsonb) from public;
grant execute on function plataforma.permissoes_normalizadas(jsonb) to macuxi_app;

create function plataforma.perfil_compat(p_cargo text, p_permissoes jsonb) returns text
  language sql immutable parallel safe
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
    select case
             when p_cargo in ('vendedor', 'promotor', 'supervisor', 'gerente') then p_cargo
             when plataforma.tem_gestao_do_acesso(p_permissoes) then 'admin'
             when coalesce(p_permissoes ?| array['carteira.editar', 'pedido.aprovar'], false) then 'analista'
             else 'assistente'
           end
  $$;
revoke all on function plataforma.perfil_compat(text, jsonb) from public;
grant execute on function plataforma.perfil_compat(text, jsonb) to macuxi_app;

-- 8. Diagnóstico por tenant (só leitura) ----------------------------------------------------------------------------------
create function plataforma.diagnosticar_perfis_sem_base(p_tenant uuid)
  returns table (perfil_id uuid, perfil_codigo text, tipo text, efeito text, chave text, antes jsonb, depois jsonb)
  language plpgsql stable
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  r record;
  v_cargo text;
  v_bruto jsonb;
  v_legado jsonb;
  v_final jsonb;
  v_k text;
  v_admin_antes boolean;
  v_admin_depois boolean;
  v_admins uuid[] := '{}';
  c_gestao constant text[] := array['acesso.bko', 'perfil.gerir', 'usuario.criar', 'usuario.editar', 'usuario.desativar'];
begin
  for r in
    select p.id, p.codigo, p.base, p.cargo, p.ativo,
           exists (select 1 from plataforma.usuario_perfil up
                     join core.usuario u on u.tenant_id = up.tenant_id and u.id = up.usuario_id and u.deleted_at is null
                    where up.tenant_id = p.tenant_id and up.perfil_id = p.id and up.deleted_at is null) as com_usuarios
      from plataforma.perfil p
     where p.tenant_id = p_tenant and p.deleted_at is null
     order by p.codigo
  loop
    v_cargo := r.cargo;
    if r.cargo <> plataforma.cargo_da_base(r.base) then
      if not r.com_usuarios then
        v_cargo := plataforma.cargo_da_base(r.base);
      end if;
      perfil_id := r.id; perfil_codigo := r.codigo; tipo := 'CARGO_DIFERENTE_DA_BASE';
      efeito := case when r.com_usuarios then 'para_tenant' else 'ajustado' end; chave := null;
      antes := jsonb_build_object('base', r.base, 'cargo', r.cargo); depois := jsonb_build_object('base', r.base, 'cargo', v_cargo);
      return next;
      -- com usuário, o caso vai ao tenant (decisão 3) e o resto do perfil depende do cargo que ele escolher: nada mais a apurar
      if r.com_usuarios then
        continue;
      end if;
    end if;
    v_bruto := plataforma.permissoes_legado_do_perfil(r.id, false);
    v_legado := plataforma.permissoes_legado_do_perfil(r.id, true);
    v_final := plataforma.aplicar_travas_do_cargo(v_legado, v_cargo);
    -- o que a trava do cargo corta ou muda
    for v_k in select k from jsonb_object_keys(v_legado) k where v_final -> k is distinct from v_legado -> k order by 1 loop
      perfil_id := r.id; perfil_codigo := r.codigo; tipo := 'TRAVA_NOVA_CORTA';
      efeito := case when r.com_usuarios then 'para_tenant' else 'ajustado' end; chave := v_k;
      antes := jsonb_build_object(v_k, v_legado -> v_k); depois := case when v_final ? v_k then jsonb_build_object(v_k, v_final -> v_k) end;
      return next;
    end loop;
    if r.ativo and not exists (select 1 from jsonb_object_keys(v_final) k where k like 'acesso.%') then
      perfil_id := r.id; perfil_codigo := r.codigo; tipo := 'PERFIL_SEM_ACESSO';
      efeito := case when r.com_usuarios then 'para_tenant' else 'aviso' end; chave := null; antes := null; depois := null;
      return next;
    end if;
    -- sobreposição sem efeito hoje (a caixa fica como o usuário vê: decisão 5)
    for v_k in
      select s.chave from plataforma.perfil_permissao s
       where s.tenant_id = p_tenant and s.perfil_id = r.id and s.deleted_at is null
         and s.concedida is distinct from (v_legado ? s.chave)
         and s.chave in ('pedido.ver', 'produto.ver_preco_estoque')
       order by 1
    loop
      perfil_id := r.id; perfil_codigo := r.codigo; chave := v_k; efeito := 'aviso';
      tipo := case when v_legado ? v_k then 'REVOGACAO_SEM_EFEITO' else 'CONCESSAO_SEM_EFEITO' end;
      antes := jsonb_build_object('concedida', not (v_legado ? v_k)); depois := jsonb_build_object('concedida', v_legado ? v_k);
      return next;
    end loop;
    if r.com_usuarios and r.ativo then
      v_admin_antes := r.base = 'admin' and coalesce(v_bruto ?& c_gestao, false);
      v_admin_depois := plataforma.tem_gestao_do_acesso(v_final);
      if v_admin_depois then
        v_admins := v_admins || r.id;
      end if;
      if v_admin_antes is distinct from v_admin_depois then
        perfil_id := r.id; perfil_codigo := r.codigo; tipo := 'ADMIN_MUDA'; efeito := 'aviso'; chave := null;
        antes := jsonb_build_object('admin', v_admin_antes); depois := jsonb_build_object('admin', v_admin_depois);
        return next;
      end if;
      if (r.base <> 'admin') is distinct from not (v_final ? 'perfil.gerir') then
        perfil_id := r.id; perfil_codigo := r.codigo; tipo := 'ADMIN_MUDA'; efeito := 'aviso'; chave := 'senha.redefinir';
        antes := jsonb_build_object('alvo_de_todos', r.base <> 'admin'); depois := jsonb_build_object('alvo_de_todos', not (v_final ? 'perfil.gerir'));
        return next;
      end if;
      if plataforma.perfil_compat(v_cargo, v_final) <> r.base then
        perfil_id := r.id; perfil_codigo := r.codigo; tipo := 'NOME_DIVERGENTE'; efeito := 'aviso'; chave := null;
        antes := jsonb_build_object('perfil', r.base); depois := jsonb_build_object('perfil', plataforma.perfil_compat(v_cargo, v_final));
        return next;
      end if;
    end if;
  end loop;
  if plataforma.tenant_tem_admin_com_gestao(p_tenant)
     and not exists (select 1 from plataforma.usuario_perfil up
                       join core.usuario u on u.tenant_id = up.tenant_id and u.id = up.usuario_id and u.ativo and u.deleted_at is null
                      where up.tenant_id = p_tenant and up.deleted_at is null and up.perfil_id = any (v_admins)) then
    perfil_id := null; perfil_codigo := null; tipo := 'TENANT_SEM_ADMIN'; efeito := 'para_tenant'; chave := null;
    antes := jsonb_build_object('admin', true); depois := jsonb_build_object('admin', false);
    return next;
  end if;
end
$$;
revoke all on function plataforma.diagnosticar_perfis_sem_base(uuid) from public;
grant execute on function plataforma.diagnosticar_perfis_sem_base(uuid) to macuxi_app;

-- 9. Gravação do conjunto de um perfil --------------------------------------------------------------------------------------
create function plataforma.sincronizar_concessoes(p_perfil uuid, p_desejado jsonb) returns integer
  language plpgsql volatile
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_tenant uuid;
  v_n integer;
  v_total integer := 0;
begin
  select p.tenant_id into v_tenant from plataforma.perfil p where p.id = p_perfil;
  if v_tenant is null then
    return 0;
  end if;
  -- saiu
  update plataforma.perfil_concessao c set deleted_at = now()
   where c.tenant_id = v_tenant and c.perfil_id = p_perfil and c.deleted_at is null
     and not (coalesce(p_desejado, '{}'::jsonb) ? c.chave);
  get diagnostics v_n = row_count; v_total := v_total + v_n;
  -- mudou o nível ou os alvos
  update plataforma.perfil_concessao c set nivel = d.nivel, alvos = d.alvos
    from (select e.key as chave, e.value ->> 'nivel' as nivel,
                 case when jsonb_typeof(e.value -> 'alvos') = 'array' then array(select jsonb_array_elements_text(e.value -> 'alvos')) end as alvos
            from jsonb_each(coalesce(p_desejado, '{}'::jsonb)) e) d
   where c.tenant_id = v_tenant and c.perfil_id = p_perfil and c.deleted_at is null and c.chave = d.chave
     and (c.nivel is distinct from d.nivel or c.alvos is distinct from d.alvos);
  get diagnostics v_n = row_count; v_total := v_total + v_n;
  -- voltou: reativa a linha de id determinístico
  update plataforma.perfil_concessao c set deleted_at = null, nivel = d.nivel, alvos = d.alvos
    from (select e.key as chave, e.value ->> 'nivel' as nivel,
                 case when jsonb_typeof(e.value -> 'alvos') = 'array' then array(select jsonb_array_elements_text(e.value -> 'alvos')) end as alvos
            from jsonb_each(coalesce(p_desejado, '{}'::jsonb)) e) d
   where c.id = plataforma.uuid_de_chave(v_tenant::text || ':plataforma.perfil_concessao:' || p_perfil::text || ':' || d.chave)
     and c.deleted_at is not null
     and not exists (select 1 from plataforma.perfil_concessao v
                      where v.tenant_id = v_tenant and v.perfil_id = p_perfil and v.chave = d.chave and v.deleted_at is null);
  get diagnostics v_n = row_count; v_total := v_total + v_n;
  -- entrou
  insert into plataforma.perfil_concessao (id, tenant_id, perfil_id, chave, nivel, alvos)
  select plataforma.uuid_de_chave(v_tenant::text || ':plataforma.perfil_concessao:' || p_perfil::text || ':' || d.chave),
         v_tenant, p_perfil, d.chave, d.nivel, d.alvos
    from (select e.key as chave, e.value ->> 'nivel' as nivel,
                 case when jsonb_typeof(e.value -> 'alvos') = 'array' then array(select jsonb_array_elements_text(e.value -> 'alvos')) end as alvos
            from jsonb_each(coalesce(p_desejado, '{}'::jsonb)) e) d
   where not exists (select 1 from plataforma.perfil_concessao v
                      where v.tenant_id = v_tenant and v.perfil_id = p_perfil and v.chave = d.chave and v.deleted_at is null)
  on conflict do nothing;
  get diagnostics v_n = row_count; v_total := v_total + v_n;
  return v_total;
end
$$;
revoke all on function plataforma.sincronizar_concessoes(uuid, jsonb) from public;

-- 10. Migração de um tenant -------------------------------------------------------------------------------------------------
create function plataforma.migrar_perfis_sem_base(p_tenant uuid) returns text
  language plpgsql volatile
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_diag jsonb;
  v_ids uuid[];
  r record;
begin
  if p_tenant is null then
    raise exception 'migrar_perfis_sem_base: p_tenant obrigatório' using errcode = '22004';
  end if;
  if not exists (select 1 from plataforma.tenant t where t.id = p_tenant) then
    return 'sem_tenant';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('plataforma.migrar_perfis_sem_base:' || p_tenant::text, 0));
  if plataforma.leitura_de_perfis(p_tenant) = 'concessao' then
    return 'ja_migrado';
  end if;
  select coalesce(jsonb_agg(to_jsonb(d)), '[]'::jsonb) into v_diag from plataforma.diagnosticar_perfis_sem_base(p_tenant) d;

  -- achados (id determinístico): o que repete não muda; o que deixou de aparecer é dado por resolvido
  with d as (
    select x.*, plataforma.uuid_de_chave(p_tenant::text || ':plataforma.perfil_migracao_conflito:' || x.tipo || ':'
                                         || coalesce(x.perfil_id::text, '-') || ':' || coalesce(x.chave, '-')) as id
      from jsonb_to_recordset(v_diag) as x (perfil_id uuid, perfil_codigo text, tipo text, efeito text, chave text, antes jsonb, depois jsonb)
  ),
  gravado as (
    insert into plataforma.perfil_migracao_conflito as c (id, tenant_id, perfil_id, perfil_codigo, tipo, efeito, chave, antes, depois)
    select d.id, p_tenant, d.perfil_id, d.perfil_codigo, d.tipo, d.efeito, d.chave, d.antes, d.depois from d
    on conflict (id) do update
       set efeito = excluded.efeito, perfil_codigo = excluded.perfil_codigo, antes = excluded.antes, depois = excluded.depois,
           resolvido_em = null, deleted_at = null
     where (c.efeito, c.perfil_codigo, c.antes, c.depois) is distinct from (excluded.efeito, excluded.perfil_codigo, excluded.antes, excluded.depois)
        or c.resolvido_em is not null or c.deleted_at is not null
    returning c.id
  )
  select array(select d.id from d) into v_ids;
  update plataforma.perfil_migracao_conflito c set resolvido_em = now()
   where c.tenant_id = p_tenant and c.resolvido_em is null and c.deleted_at is null and c.id <> all (v_ids);

  if exists (select 1 from jsonb_array_elements(v_diag) e where e ->> 'efeito' = 'para_tenant') then
    insert into plataforma.catalogo_aplicado (id, tenant_id, versao, leitura)
    values (plataforma.uuid_de_chave(p_tenant::text || ':plataforma.catalogo_aplicado:1'), p_tenant, 1, 'legado')
    on conflict do nothing;
    return 'parado';
  end if;

  -- decisão 3: o perfil sem usuários é acertado para o cargo da base (auditado)
  for r in
    select x.perfil_id, x.antes, x.depois
      from jsonb_to_recordset(v_diag) as x (perfil_id uuid, tipo text, efeito text, antes jsonb, depois jsonb)
     where x.tipo = 'CARGO_DIFERENTE_DA_BASE' and x.efeito = 'ajustado'
  loop
    update plataforma.perfil p set cargo = r.depois ->> 'cargo'
     where p.tenant_id = p_tenant and p.id = r.perfil_id and p.cargo is distinct from r.depois ->> 'cargo';
    insert into plataforma.auditoria (id, tenant_id, usuario_id, modulo, acao, entidade, entidade_id, antes, depois)
    values (plataforma.uuid_de_chave(p_tenant::text || ':plataforma.auditoria:perfil.migracao_cargo:' || r.perfil_id::text),
            p_tenant, null, 'core', 'perfil.migracao_cargo', 'perfil', r.perfil_id, r.antes, r.depois)
    on conflict (id) do nothing;
  end loop;
  -- decisão 3: a chave que a trava do cargo corta no perfil sem usuários sai (ou o escopo desce ao teto), auditada por chave
  for r in
    select x.perfil_id, x.chave, x.antes, x.depois
      from jsonb_to_recordset(v_diag) as x (perfil_id uuid, tipo text, efeito text, chave text, antes jsonb, depois jsonb)
     where x.tipo = 'TRAVA_NOVA_CORTA' and x.efeito = 'ajustado'
  loop
    insert into plataforma.auditoria (id, tenant_id, usuario_id, modulo, acao, entidade, entidade_id, antes, depois)
    values (plataforma.uuid_de_chave(p_tenant::text || ':plataforma.auditoria:perfil.migracao_corte:' || r.perfil_id::text || ':' || r.chave),
            p_tenant, null, 'core', 'perfil.migracao_corte', 'perfil', r.perfil_id, r.antes, r.depois)
    on conflict (id) do nothing;
  end loop;

  -- concessões de todo perfil vivo (ativos e inativos), pelo cargo (já acertado)
  for r in select p.id, p.cargo from plataforma.perfil p where p.tenant_id = p_tenant and p.deleted_at is null order by p.id loop
    perform plataforma.sincronizar_concessoes(r.id, plataforma.concessoes_derivadas(r.id, r.cargo));
  end loop;

  -- equivalência de todo perfil com usuário (plano §4.1): diferença = defeito da derivação, a migração inteira volta
  if exists (
    select 1 from plataforma.perfil p
     where p.tenant_id = p_tenant and p.deleted_at is null
       and exists (select 1 from plataforma.usuario_perfil up
                     join core.usuario u on u.tenant_id = up.tenant_id and u.id = up.usuario_id and u.deleted_at is null
                    where up.tenant_id = p.tenant_id and up.perfil_id = p.id and up.deleted_at is null)
       and plataforma.permissoes_normalizadas(plataforma.concessoes_do_perfil(p.id))
           is distinct from plataforma.permissoes_normalizadas(plataforma.permissoes_legado_do_perfil(p.id, true))) then
    raise exception 'migrar_perfis_sem_base: concessões diferentes do acesso de hoje num perfil com usuário (tenant %)', p_tenant
      using errcode = '23514', constraint = 'perfis_sem_base_equivalencia', hint = 'RN-CORE-35';
  end if;

  update plataforma.perfil_migracao_conflito c set resolvido_em = now()
   where c.tenant_id = p_tenant and c.efeito = 'ajustado' and c.resolvido_em is null;
  insert into plataforma.catalogo_aplicado as c (id, tenant_id, versao, leitura)
  values (plataforma.uuid_de_chave(p_tenant::text || ':plataforma.catalogo_aplicado:1'), p_tenant, 1, 'concessao')
  on conflict (id) do update set leitura = 'concessao', aplicado_em = now(), deleted_at = null;
  return 'migrado';
end
$$;
revoke all on function plataforma.migrar_perfis_sem_base(uuid) from public;

-- 11. Rodada em todos os tenants ---------------------------------------------------------------------------------------------
do $$
declare
  v_t uuid;
  v_r text;
  v_migrados integer := 0;
  v_parados integer := 0;
  v_outros integer := 0;
  v_tipos text;
begin
  for v_t in select t.id from plataforma.tenant t order by t.id loop
    v_r := plataforma.migrar_perfis_sem_base(v_t);
    if v_r = 'migrado' then
      v_migrados := v_migrados + 1;
    elsif v_r = 'parado' then
      v_parados := v_parados + 1;
    else
      v_outros := v_outros + 1;
    end if;
  end loop;
  select string_agg(x.tipo || '/' || x.efeito || '=' || x.n, ', ' order by x.tipo, x.efeito) into v_tipos
    from (select c.tipo, c.efeito, count(*) as n from plataforma.perfil_migracao_conflito c
           where c.deleted_at is null group by c.tipo, c.efeito) x;
  raise notice '0105: % tenant(s) migrado(s), % parado(s), % sem mudança; achados: %', v_migrados, v_parados, v_outros,
    coalesce(v_tipos, 'nenhum');
end
$$;
