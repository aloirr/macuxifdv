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
--    plataforma.perfis_do_usuario (0041) NÃO muda: ninguém lê cargo nem permissoes por ela (a API lê perfil_do_usuario).
-- 3. Último admin pela gestão do acesso (ADR 0073 §2.5, decisão 4; RN-CORE-35):
--    - usuario_admin_com_gestao e tenant_tem_admin_com_gestao (0041): 'concessao' = usuário ativo com perfil vivo e ativo cujas
--      concessões têm acesso.bko e a gestão completa (tem_gestao_do_acesso, 0106), de qualquer cargo ou base; 'legado' = o
--      corpo da 0041. tenant_tem_admin_com_gestao filtra antes o perfil: base admin ('legado') ou a concessão viva perfil.gerir
--      ('concessao'), para não agregar as concessões de todo vínculo do tenant.
--    - perfil_com_gestao_na_transacao(tenant, perfil) — NOVA, interna dos gatilhos (sem EXECUTE para ninguém): o perfil tem a
--      concessão viva perfil.gerir ou teve alguma concessão gravada nesta transação (updated_at = now(), a que saiu agora). É o
--      "podia contar como admin antes da transação" do tenant 'concessao', como a base admin (imutável) é no 'legado'.
--    - Os 3 gatilhos de restrição da 0041 (SECURITY DEFINER desde a 0049) passam a conferir o último admin também pelo perfil
--      com a gestão no tenant 'concessao', além da base admin: usuario_conferir_acesso (desativar ou apagar o usuário),
--      usuario_perfil_conferir (tirar ou trocar o vínculo, ou seja, o perfil do usuário) e perfil_conferir (desativar ou apagar
--      o perfil). No 'legado', o mesmo de hoje. Recriados com SECURITY DEFINER explícito (o create or replace sem ele voltaria a
--      INVOKER e desfaria a 0049) e o search_path fixo de antes; conferência no fim do bloco.
--    - Gatilho NOVO perfil_concessao_conferir (restrição adiável, SECURITY DEFINER como os da 0049): no tenant 'concessao', a
--      concessão viva de uma chave da gestão que sai (ou muda) de um perfil ativo com usuário ativo, que tinha a gestão completa
--      antes da transação, confere o último admin (tenant_ultimo_admin, 23514). Se o usuário ou o vínculo também sai na mesma
--      transação, quem confere é o gatilho do usuário ou do vínculo (o perfil teve concessão gravada nesta transação).
-- 4. plataforma.usuario_tem_perfil_admin (0047, portal e sa_*): 'concessao' = algum perfil vivo e ativo com a concessão viva
--    perfil.gerir (o alvo que o BKO nunca alcança, RN-CORE-34); 'legado' = o corpo da 0047. Mesmas ACLs (nenhum EXECUTE).
-- 5. plataforma.licencas_em_uso (0086): 'concessao' = o item da licença pelo CARGO do perfil (vendedor, promotor,
--    supervisor/gerente -> gestor, administrativo -> bko); 'legado' = pela base, como na 0086.
-- 6. plataforma.ligar_leitura_por_concessao(tenant) -> 'ligado' | 'ja_ligado' | 'parado' | 'sem_tenant'. Sem EXECUTE para
--    ninguém (só o dono). Trava do tenant (a de migrar_perfis_sem_base). Roda migrar_perfis_sem_base (0106) e
--    aplicar_catalogo_v2 (0108); tenant com conflito 'para_tenant' fica em 'legado' com os conflitos gravados ('parado'); sem
--    conflito, a conferência do §4.1 (conferir_perfis_sem_base, 0107): uma linha DIFERENCA = 23514 e a migração inteira volta
--    (defeito da derivação, não do tenant); sem diferença, catalogo_aplicado passa a 'concessao', com aplicado_em = agora.
--    Idempotente: tenant já em 'concessao' não muda; o parado repete a mesma derivação sem mudar linha.
-- 7. Tenant novo: tenant_semear_concessoes (0107/0108) passa a chamar ligar_leitura_por_concessao (nasce derivado, na v2 e em
--    'concessao').
-- 8. Rodada em todos os tenants (bloco no fim), com raise notice da contagem por resultado e dos achados abertos por tipo e
--    efeito (sem dado pessoal).
-- Não muda a lista de funções sa_* nem o kit do Conector. Não muda perfil.base, perfil_permissao nem core.usuario.perfil (a base
-- fica congelada, §2.5). O espelho da 0107 segue ligado no tenant 'concessao' (janela até o deploy da API nova).
--
-- Caminho de volta: 0109_plataforma_perfis_leitura_concessao.down.sql (§4.3: sobreposições recalculadas dos perfis mudados
-- pela API nova, todo tenant volta a 'legado', as funções recriadas e as dos 3 gatilhos voltam como cópia exata e as novas
-- saem).

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

-- 3. Último admin pela gestão do acesso (caminho duplo; o 'legado' é o corpo da 0041) ------------------------------------------
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

-- filtro prévio do perfil (1.S1): base admin no 'legado'; a concessão viva perfil.gerir (pelo perfil_concessao_uk) no 'concessao'
create or replace function plataforma.tenant_tem_admin_com_gestao(p_tenant uuid) returns boolean
  language sql stable
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
    select exists (
      select 1
        from plataforma.usuario_perfil up
        join plataforma.perfil p on p.tenant_id = up.tenant_id and p.id = up.perfil_id
       where up.tenant_id = p_tenant and up.deleted_at is null and p.ativo and p.deleted_at is null
         and case when plataforma.leitura_de_perfis(p_tenant) = 'concessao'
                  then exists (select 1 from plataforma.perfil_concessao c
                                where c.tenant_id = p.tenant_id and c.perfil_id = p.id and c.chave = 'perfil.gerir'
                                  and c.deleted_at is null)
                  else p.base = 'admin' end
         and plataforma.usuario_admin_com_gestao(p_tenant, up.usuario_id))
  $$;

-- Interna dos gatilhos de restrição (rodam como o dono): o perfil podia contar como admin antes da transação. A concessão viva
-- perfil.gerir (sem ela, não há gestão completa) ou alguma concessão do perfil gravada nesta transação (a que saiu agora tem
-- updated_at = now(), pelo gatilho perfil_concessao_updated_at). Caminho 'concessao' só; no 'legado' vale a base admin.
create function plataforma.perfil_com_gestao_na_transacao(p_tenant uuid, p_perfil uuid) returns boolean
  language sql stable
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
    select exists (select 1 from plataforma.perfil_concessao c
                    where c.tenant_id = p_tenant and c.perfil_id = p_perfil and c.chave = 'perfil.gerir' and c.deleted_at is null)
        or exists (select 1 from plataforma.perfil_concessao c
                    where c.tenant_id = p_tenant and c.perfil_id = p_perfil and c.updated_at = now())
  $$;
revoke all on function plataforma.perfil_com_gestao_na_transacao(uuid, uuid) from public;

-- Os 3 gatilhos da 0041 (DEFINER desde a 0049): além da base admin, no tenant 'concessao' o perfil com a gestão do acesso.
create or replace function plataforma.usuario_conferir_acesso() returns trigger
  language plpgsql security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
begin
  if not exists (select 1 from plataforma.tenant t where t.id = new.tenant_id) then
    return null;
  end if;
  perform plataforma.conferir_perfis_do_usuario(new.tenant_id, new.id);
  -- desativou ou apagou quem tem perfil de base admin ou, no tenant 'concessao', perfil com a gestão do acesso
  if tg_op = 'UPDATE' and old.ativo and old.deleted_at is null
     and exists (select 1 from plataforma.usuario_perfil up
                   join plataforma.perfil p on p.tenant_id = up.tenant_id and p.id = up.perfil_id
                  where up.tenant_id = new.tenant_id and up.usuario_id = new.id and up.deleted_at is null
                    and (p.base = 'admin'
                         or (plataforma.leitura_de_perfis(new.tenant_id) = 'concessao'
                             and plataforma.perfil_com_gestao_na_transacao(p.tenant_id, p.id)))) then
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
  v_gestao_antes boolean := false;
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
      v_gestao_antes := plataforma.leitura_de_perfis(old.tenant_id) = 'concessao'
                        and plataforma.perfil_com_gestao_na_transacao(old.tenant_id, old.perfil_id);
    end if;
  end if;
  -- saiu (ou trocou) um vínculo vivo com perfil de base admin ou, no tenant 'concessao', com perfil com a gestão do acesso; ou
  -- quem tem perfil de base admin ganhou um que fecha o BKO (RN-CORE-33)
  if v_base_antes = 'admin' or v_gestao_antes
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
  -- perfil de base admin ou, no tenant 'concessao', com a gestão do acesso
  if old.ativo and old.deleted_at is null
     and (old.base = 'admin'
          or (plataforma.leitura_de_perfis(old.tenant_id) = 'concessao'
              and plataforma.perfil_com_gestao_na_transacao(old.tenant_id, old.id))) then
    perform plataforma.conferir_ultimo_admin(old.tenant_id);
  end if;
  return null;
end
$$;
revoke all on function plataforma.perfil_conferir() from public;

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

-- conferência: as 4 funções dos gatilhos de restrição DEFINER com o search_path fixo e sem EXECUTE para PUBLIC, app, worker ou
-- portal (a 0049 e o gatilho novo); a interna perfil_com_gestao_na_transacao sem EXECUTE para ninguém além do dono
do $$
declare
  v_n integer;
begin
  select count(*) into v_n
    from pg_proc p
   where p.oid in ('plataforma.usuario_conferir_acesso()'::regprocedure, 'plataforma.usuario_perfil_conferir()'::regprocedure,
                   'plataforma.perfil_conferir()'::regprocedure, 'plataforma.perfil_concessao_conferir()'::regprocedure)
     and p.prosecdef
     and p.proconfig @> array['search_path=pg_catalog, plataforma, pg_temp']
     and not exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                      where a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner);
  if v_n <> 4 then
    raise exception '0109: % de 4 funções de conferência DEFINER com search_path fixo e EXECUTE só do dono', v_n using errcode = '42501';
  end if;
  if exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              where p.oid = 'plataforma.perfil_com_gestao_na_transacao(uuid, uuid)'::regprocedure
                and a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner) then
    raise exception '0109: perfil_com_gestao_na_transacao com EXECUTE além do dono' using errcode = '42501';
  end if;
end
$$;

-- 4. Portal: o admin que o BKO não alcança (caminho duplo; o 'legado' é o corpo da 0047) ----------------------------------------
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

-- 5. Licenças em uso pelo cargo (caminho duplo; o 'legado' é o corpo da 0086) ---------------------------------------------------
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

-- 6. Troca de leitura de um tenant, pela conferência ------------------------------------------------------------------------
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

-- 7. Tenant novo nasce em 'concessao' --------------------------------------------------------------------------------------
create or replace function plataforma.tenant_semear_concessoes() returns trigger
  language plpgsql security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
begin
  perform plataforma.ligar_leitura_por_concessao(new.id);
  return null;
end
$$;

-- 8. Rodada em todos os tenants ----------------------------------------------------------------------------------------------
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
