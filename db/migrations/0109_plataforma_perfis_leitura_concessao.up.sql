-- 0109_plataforma_perfis_leitura_concessao (up) — v1.0.40, etapa E6 (troca de leitura) do plano
-- docs/banco/plano-migracao-perfis-sem-base.md (§5 passo 2, §4.1 a §4.4), ADR 0073 (§2.5, §2.7 e §2.8). RN-CORE-01, RN-CORE-34,
-- RN-CORE-35. Dicionário e contrato das funções: docs/banco/plataforma.md ("0109 — leitura por concessão").
--
-- Liga o motor novo (perfil_concessao) por tenant, pela conferência. As funções do banco passam a ter caminho duplo por
-- plataforma.leitura_de_perfis(tenant) (0105): 'legado' = o modelo de hoje (base + sobreposições), sem nenhuma mudança;
-- 'concessao' = as concessões gravadas. Num tenant que acabou de ligar, os dois caminhos dão o mesmo resultado (é o que a
-- conferência garante).
-- 1. plataforma.permissoes_efetivas_do_perfil(perfil) -> jsonb { chave: { nivel?, alvos? } }, normalizado (alvos em ordem):
--    'concessao' = concessoes_do_perfil; 'legado' = permissoes_legado_do_perfil(perfil, true) (o acesso de hoje, com os 2
--    parâmetros). INVOKER, stable; EXECUTE do macuxi_app.
-- 2. plataforma.perfil_do_usuario(usuario) — NOVA; o perfil vivo e ativo do usuário no tenant do contexto (um só, RN-CORE-54):
--    (perfil_id, codigo, nome, cargo, base, leitura, permissoes). Fora de contexto ou sem perfil = 0 linhas. É a leitura da API
--    para ctx.usuario.cargo e perfil_acesso (ADR 0073 §2.7). INVOKER, stable; EXECUTE do macuxi_app.
-- 3. plataforma.perfis_do_usuario(usuario) — recriada (drop + create: retorno novo) com as colunas de antes e mais cargo e
--    permissoes (as efetivas, item 1) no fim. As colunas de antes seguem iguais (sobreposicoes = perfil_permissao), para a API
--    de hoje. Mesmas ACLs.
-- 4. Último admin pela gestão do acesso (ADR 0073 §2.5, decisão 4): usuario_admin_com_gestao e tenant_tem_admin_com_gestao
--    (0041). 'concessao': usuário ativo com perfil vivo e ativo cujas concessões têm acesso.bko e a gestão completa
--    (tem_gestao_do_acesso, 0106), de qualquer cargo; 'legado': o corpo da 0041. As conferências no COMMIT de hoje (0041/0049)
--    seguem chamando conferir_ultimo_admin, que passa a usar o caminho duplo. Gatilho NOVO perfil_concessao_conferir
--    (restrição adiável, SECURITY DEFINER como os da 0049): no tenant 'concessao', a concessão viva de uma chave da gestão que
--    sai (ou muda) de um perfil ativo com usuário ativo, que tinha a gestão completa antes da transação, confere o último admin
--    (tenant_ultimo_admin, 23514).
-- 5. plataforma.usuario_tem_perfil_admin (0047, portal e sa_*): 'concessao' = algum perfil vivo e ativo com a concessão viva
--    perfil.gerir (o alvo que o BKO nunca alcança, RN-CORE-34); 'legado' = o corpo da 0047. Mesmas ACLs (nenhum EXECUTE).
-- 6. plataforma.licencas_em_uso (0086): 'concessao' = o item da licença pelo CARGO do perfil (vendedor, promotor,
--    supervisor/gerente -> gestor, administrativo -> bko); 'legado' = pela base, como na 0086.
-- 7. plataforma.ligar_leitura_por_concessao(tenant) -> 'ligado' | 'ja_ligado' | 'parado' | 'sem_tenant'. Sem EXECUTE para
--    ninguém (só o dono). Trava do tenant (a de migrar_perfis_sem_base). Roda migrar_perfis_sem_base (0106) e
--    aplicar_catalogo_v2 (0108); tenant com conflito 'para_tenant' fica em 'legado' com os conflitos gravados ('parado'); sem
--    conflito, a conferência do §4.1 (conferir_perfis_sem_base, 0107): uma linha DIFERENCA = 23514 e a migração inteira volta
--    (defeito da derivação, não do tenant); sem diferença, catalogo_aplicado passa a 'concessao', com aplicado_em = agora.
--    Idempotente: tenant já em 'concessao' não muda; o parado repete a mesma derivação sem mudar linha.
-- 8. Tenant novo: tenant_semear_concessoes (0107/0108) passa a chamar ligar_leitura_por_concessao (nasce derivado, na v2 e em
--    'concessao').
-- 9. Rodada em todos os tenants (bloco no fim), com raise notice da contagem por resultado e dos achados abertos por tipo e
--    efeito (sem dado pessoal).
-- Não muda a lista de funções sa_* nem o kit do Conector. Não muda perfil.base, perfil_permissao nem core.usuario.perfil (a base
-- fica congelada, §2.5). O espelho da 0107 segue ligado no tenant 'concessao' (janela até o deploy da API nova).
--
-- Caminho de volta: 0109_plataforma_perfis_leitura_concessao.down.sql (§4.3: sobreposições recalculadas dos perfis mudados
-- pela API nova, todo tenant volta a 'legado', as funções voltam como cópia exata e as novas saem).

-- 1. Permissões efetivas do perfil (caminho duplo) ---------------------------------------------------------------------------
create function plataforma.permissoes_efetivas_do_perfil(p_perfil uuid) returns jsonb
  language sql stable
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
    select plataforma.permissoes_normalizadas(
             case when plataforma.leitura_de_perfis(p.tenant_id) = 'concessao' then plataforma.concessoes_do_perfil(p.id)
                  else plataforma.permissoes_legado_do_perfil(p.id, true) end)
      from plataforma.perfil p
     where p.id = p_perfil
  $$;
revoke all on function plataforma.permissoes_efetivas_do_perfil(uuid) from public;
grant execute on function plataforma.permissoes_efetivas_do_perfil(uuid) to macuxi_app;

-- 2. Perfil do usuário (leitura da API, ADR 0073 §2.7) -----------------------------------------------------------------------
create function plataforma.perfil_do_usuario(p_usuario uuid)
  returns table (perfil_id uuid, codigo text, nome text, cargo text, base text, leitura text, permissoes jsonb)
  language sql stable
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
    select p.id, p.codigo, p.nome, p.cargo, p.base, plataforma.leitura_de_perfis(p.tenant_id),
           plataforma.permissoes_efetivas_do_perfil(p.id)
      from plataforma.usuario_perfil up
      join plataforma.perfil p on p.tenant_id = up.tenant_id and p.id = up.perfil_id
     where up.tenant_id = plataforma.tenant_atual() and up.usuario_id = p_usuario and up.deleted_at is null
       and p.ativo and p.deleted_at is null
     order by p.codigo
     limit 1
  $$;
revoke all on function plataforma.perfil_do_usuario(uuid) from public;
grant execute on function plataforma.perfil_do_usuario(uuid) to macuxi_app;

-- 3. Perfis do usuário (retorno novo: + cargo e permissoes) -------------------------------------------------------------------
drop function plataforma.perfis_do_usuario(uuid);
create function plataforma.perfis_do_usuario(p_usuario uuid)
  returns table (perfil_id uuid, codigo text, base text, nome text, fabrica boolean, sobreposicoes jsonb, modulos text[],
                 cargo text, permissoes jsonb)
  language sql stable
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
    select p.id, p.codigo, p.base, p.nome, p.fabrica,
           coalesce((select jsonb_agg(jsonb_build_object('chave', pp.chave, 'concedida', pp.concedida, 'nivel', pp.nivel,
                                                         'alvos', to_jsonb(pp.alvos)) order by pp.chave)
                       from plataforma.perfil_permissao pp
                      where pp.tenant_id = p.tenant_id and pp.perfil_id = p.id and pp.deleted_at is null), '[]'::jsonb),
           coalesce((select array_agg(pm.modulo order by pm.modulo)
                       from plataforma.perfil_modulo pm
                      where pm.tenant_id = p.tenant_id and pm.perfil = p.codigo and pm.deleted_at is null), '{}'::text[]),
           p.cargo,
           plataforma.permissoes_efetivas_do_perfil(p.id)
      from plataforma.usuario_perfil up
      join plataforma.perfil p on p.tenant_id = up.tenant_id and p.id = up.perfil_id
     where up.tenant_id = plataforma.tenant_atual() and up.usuario_id = p_usuario and up.deleted_at is null
       and p.ativo and p.deleted_at is null
     order by p.fabrica desc, p.codigo
  $$;
revoke all on function plataforma.perfis_do_usuario(uuid) from public;
grant execute on function plataforma.perfis_do_usuario(uuid) to macuxi_app;

-- 4. Último admin pela gestão do acesso (caminho duplo; o 'legado' é o corpo da 0041) ------------------------------------------
create or replace function plataforma.usuario_admin_com_gestao(p_tenant uuid, p_usuario uuid) returns boolean
  language sql stable
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
    select case when plataforma.leitura_de_perfis(p_tenant) = 'concessao' then
      exists (
        select 1
          from core.usuario u
          join plataforma.usuario_perfil up on up.tenant_id = u.tenant_id and up.usuario_id = u.id and up.deleted_at is null
          join plataforma.perfil p on p.tenant_id = up.tenant_id and p.id = up.perfil_id and p.ativo and p.deleted_at is null
         where u.tenant_id = p_tenant and u.id = p_usuario and u.ativo and u.deleted_at is null
           and plataforma.tem_gestao_do_acesso(plataforma.concessoes_do_perfil(p.id)))
    else (
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
                          else f.base = 'admin' end))))
    end
  $$;

create or replace function plataforma.tenant_tem_admin_com_gestao(p_tenant uuid) returns boolean
  language sql stable
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
    select exists (
      select 1
        from plataforma.usuario_perfil up
        join plataforma.perfil p on p.tenant_id = up.tenant_id and p.id = up.perfil_id
       where up.tenant_id = p_tenant and up.deleted_at is null and p.ativo and p.deleted_at is null
         and (p.base = 'admin' or plataforma.leitura_de_perfis(p_tenant) = 'concessao')
         and plataforma.usuario_admin_com_gestao(p_tenant, up.usuario_id))
  $$;

create function plataforma.perfil_concessao_conferir() returns trigger
  language plpgsql security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  c_chaves constant text[] := array['acesso.bko', 'perfil.gerir', 'usuario.criar', 'usuario.editar', 'usuario.desativar'];
  v_antes jsonb;
begin
  if tg_op = 'INSERT' or old.deleted_at is not null or old.chave <> all (c_chaves) then
    return null;
  end if;
  if not exists (select 1 from plataforma.tenant t where t.id = old.tenant_id)
     or plataforma.leitura_de_perfis(old.tenant_id) <> 'concessao' then
    return null;
  end if;
  -- a gestão do perfil antes da transação: as concessões vivas + as que saíram nesta transação (updated_at = now()) + a linha
  v_antes := plataforma.concessoes_do_perfil(old.perfil_id)
             || coalesce((select jsonb_object_agg(c.chave, '{}'::jsonb) from plataforma.perfil_concessao c
                           where c.tenant_id = old.tenant_id and c.perfil_id = old.perfil_id and c.deleted_at is not null
                             and c.updated_at = now()), '{}'::jsonb)
             || jsonb_build_object(old.chave, '{}'::jsonb);
  if plataforma.tem_gestao_do_acesso(v_antes)
     and exists (select 1 from plataforma.usuario_perfil up
                   join plataforma.perfil p on p.tenant_id = up.tenant_id and p.id = up.perfil_id and p.ativo and p.deleted_at is null
                   join core.usuario u on u.tenant_id = up.tenant_id and u.id = up.usuario_id and u.ativo and u.deleted_at is null
                  where up.tenant_id = old.tenant_id and up.perfil_id = old.perfil_id and up.deleted_at is null) then
    perform plataforma.conferir_ultimo_admin(old.tenant_id);
  end if;
  return null;
end
$$;
revoke all on function plataforma.perfil_concessao_conferir() from public;
create constraint trigger perfil_concessao_conferir after update or delete on plataforma.perfil_concessao
  deferrable initially deferred
  for each row execute function plataforma.perfil_concessao_conferir();

-- 5. Portal: o admin que o BKO não alcança (caminho duplo; o 'legado' é o corpo da 0047) ----------------------------------------
create or replace function plataforma.usuario_tem_perfil_admin(p_tenant uuid, p_usuario uuid) returns boolean
  language sql stable security invoker
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
    select exists (
      select 1
        from plataforma.usuario_perfil up
        join plataforma.perfil p on p.tenant_id = up.tenant_id and p.id = up.perfil_id and p.ativo and p.deleted_at is null
       where up.tenant_id = p_tenant and up.usuario_id = p_usuario and up.deleted_at is null
         and case when plataforma.leitura_de_perfis(p_tenant) = 'concessao'
                  then exists (select 1 from plataforma.perfil_concessao c
                                where c.tenant_id = p.tenant_id and c.perfil_id = p.id and c.chave = 'perfil.gerir'
                                  and c.deleted_at is null)
                  else p.base = 'admin' end)
  $$;

-- 6. Licenças em uso pelo cargo (caminho duplo; o 'legado' é o corpo da 0086) ---------------------------------------------------
create or replace function plataforma.licencas_em_uso(p_tenant uuid)
  returns table (item text, em_uso integer)
  language sql stable
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
    with ativos as (
      select u.id as usuario_id, pf.base, pf.codigo, pf.cargo
        from core.usuario u
        join plataforma.usuario_perfil up on up.tenant_id = u.tenant_id and up.usuario_id = u.id and up.deleted_at is null
        join plataforma.perfil pf on pf.tenant_id = up.tenant_id and pf.id = up.perfil_id and pf.deleted_at is null and pf.ativo
       where u.tenant_id = p_tenant and u.ativo and u.deleted_at is null
    ),
    ocupa (usuario_id, item) as (
      select a.usuario_id,
             case when plataforma.leitura_de_perfis(p_tenant) = 'concessao' then
               case a.cargo when 'vendedor' then 'vendedor' when 'promotor' then 'promotor'
                            when 'supervisor' then 'gestor' when 'gerente' then 'gestor' when 'administrativo' then 'bko' end
             else
               case a.base when 'vendedor' then 'vendedor' when 'promotor' then 'promotor'
                           when 'supervisor' then 'gestor' when 'gerente' then 'gestor'
                           when 'analista' then 'bko' when 'assistente' then 'bko' when 'admin' then 'bko' end
             end
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

-- 7. Troca de leitura de um tenant, pela conferência ------------------------------------------------------------------------
create function plataforma.ligar_leitura_por_concessao(p_tenant uuid) returns text
  language plpgsql volatile
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_r text;
begin
  if p_tenant is null then
    raise exception 'ligar_leitura_por_concessao: p_tenant obrigatório' using errcode = '22004';
  end if;
  if not exists (select 1 from plataforma.tenant t where t.id = p_tenant) then
    return 'sem_tenant';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('plataforma.migrar_perfis_sem_base:' || p_tenant::text, 0));
  if plataforma.leitura_de_perfis(p_tenant) = 'concessao' then
    return 'ja_ligado';
  end if;
  v_r := plataforma.migrar_perfis_sem_base(p_tenant);
  perform plataforma.aplicar_catalogo_v2(p_tenant);
  if v_r <> 'derivado' or not plataforma.perfis_derivados(p_tenant) then
    return 'parado';
  end if;
  -- conferência do plano §4.1, usuário por usuário: diferença = defeito da derivação, a migração inteira volta
  if exists (select 1 from plataforma.conferir_perfis_sem_base(p_tenant) x where x.tipo = 'DIFERENCA') then
    raise exception 'ligar_leitura_por_concessao: acesso por concessão diferente do de hoje para algum usuário (tenant %)', p_tenant
      using errcode = '23514', constraint = 'perfis_sem_base_conferencia', hint = 'RN-CORE-35';
  end if;
  update plataforma.catalogo_aplicado c set leitura = 'concessao', aplicado_em = now()
   where c.tenant_id = p_tenant and c.deleted_at is null and c.leitura = 'legado';
  return 'ligado';
end
$$;
revoke all on function plataforma.ligar_leitura_por_concessao(uuid) from public;

-- 8. Tenant novo nasce em 'concessao' --------------------------------------------------------------------------------------
create or replace function plataforma.tenant_semear_concessoes() returns trigger
  language plpgsql security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
begin
  perform plataforma.ligar_leitura_por_concessao(new.id);
  return null;
end
$$;

-- 9. Rodada em todos os tenants ----------------------------------------------------------------------------------------------
do $$
declare
  v_t uuid;
  v_r text;
  v_ligados integer := 0;
  v_parados integer := 0;
  v_outros integer := 0;
  v_tipos text;
begin
  for v_t in select t.id from plataforma.tenant t order by t.id loop
    v_r := plataforma.ligar_leitura_por_concessao(v_t);
    if v_r = 'ligado' then
      v_ligados := v_ligados + 1;
    elsif v_r = 'parado' then
      v_parados := v_parados + 1;
    else
      v_outros := v_outros + 1;
    end if;
  end loop;
  select string_agg(x.tipo || '/' || x.efeito || '=' || x.n, ', ' order by x.tipo, x.efeito) into v_tipos
    from (select c.tipo, c.efeito, count(*) as n from plataforma.perfil_migracao_conflito c
           where c.deleted_at is null and c.resolvido_em is null group by c.tipo, c.efeito) x;
  raise notice '0109: leitura por concessão ligada em % tenant(s), % parado(s) em legado, % sem mudança; achados abertos: %',
    v_ligados, v_parados, v_outros, coalesce(v_tipos, 'nenhum');
end
$$;
