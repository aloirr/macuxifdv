-- 0107_plataforma_perfis_sem_base_conferencia_espelho (up) — v1.0.35, etapa E2 do plano docs/banco/plano-migracao-perfis-sem-base.md
-- (§4.1 e §5, janela de transição). ADR 0073 §2.0 (decisão 6: o modelo antigo fica por uma versão inteira do app ou 30 dias),
-- §2.8. RN-CORE-35. Dicionário: docs/banco/plataforma.md ("0105 a 0107 — perfis sem perfil base").
--
-- 1. plataforma.conferir_perfis_sem_base(tenant) -> (usuario_id, perfil_codigo, chave, antes, depois, tipo): para cada usuário
--    não apagado do tenant, compara o acesso de hoje do seu perfil vivo (permissoes_legado_do_perfil com os 2 parâmetros) com as
--    concessões gravadas (concessoes_do_perfil), por chave, nível e alvos (conjunto ordenado). Tipos: DIFERENCA (uma linha por
--    chave que difere) e NOME_DIVERGENTE (perfil_compat(cargo, concessões) <> core.usuario.perfil; só aviso: a base fica
--    congelada). ESPERADO: zero linhas DIFERENCA em todo tenant derivado. Só leitura, INVOKER (macuxi_app vê só o próprio
--    tenant). Sem dado pessoal: ids e códigos.
--    A equivalência no deploy é a de migrar_perfis_sem_base (0106, rodada em todo tenant): esta função é a do testes e do suporte.
-- 2. Espelho da janela de transição (entre o deploy do banco e o da API nova, e enquanto a API antiga ou o app antigo gravarem
--    pelo caminho de hoje): no tenant derivado (plataforma.perfis_derivados, 0106: 'concessao', ou 'legado' com as concessões
--    derivadas e sem achado 'para_tenant' em aberto), toda gravação do modelo antigo refaz as concessões do perfil a partir dele
--    (plataforma.espelhar_perfil -> concessoes_derivadas -> sincronizar_concessoes), sem mudar nada quando o conjunto já é o
--    mesmo. O que a trava do cargo cortar entra em perfil_migracao_conflito como 'aviso' (TRAVA_NOVA_CORTA), e o perfil ativo sem
--    nenhum acesso.* como 'aviso' (PERFIL_SEM_ACESSO); o achado que deixa de valer ganha resolvido_em. Gatilhos (AFTER, por
--    linha, imediatos):
--      perfil_permissao_espelho  insert/update/delete em plataforma.perfil_permissao (sobreposição gravada ou "restaurar padrão")
--      perfil_espelho            insert e update de cargo em plataforma.perfil (perfil novo pelo caminho antigo; troca de cargo)
--      parametro_espelho         insert/update/delete em plataforma.parametro de core.promotor_ve_pedidos ou
--                                catalogo.promotor_ve_preco_estoque (refaz os perfis de base promotor; as outras bases têm
--                                produto.ver_preco_estoque sempre)
--      tenant_semear_perfis_concessao  tenant NOVO nasce derivado: depois de tenant_semear_perfis (ordem alfabética dos
--                                gatilhos AFTER INSERT), roda migrar_perfis_sem_base (os 7 perfis com as concessões do modelo e
--                                catalogo_aplicado em 'legado': o motor novo fica desligado na v1.0.37; a 0109 liga).
--    O espelho só grava concessões e achados: nada do modelo antigo (perfil_permissao, parametro, perfil.base, os perfis) é
--    apagado nem alterado. Tenant não derivado (sem catalogo_aplicado, ou parado com 'para_tenant'): os gatilhos não fazem nada. Na exclusão do tenant (plataforma.excluir_tenant, ordem das FKs e alfabética),
--    catalogo_aplicado sai antes de perfil_permissao e parametro: o espelho não regrava nada no meio da exclusão.
--    As funções dos gatilhos são SECURITY DEFINER (como as conferências da 0049): gravam concessões e achados (o macuxi_app só lê
--    os achados) e rodam também dentro das sa_* do portal; search_path fixo, sem EXECUTE para ninguém. Saem na fase 2 (ADR
--    seguinte), junto de perfil.base, perfil_permissao e dos 2 parâmetros.
--
-- Caminho de volta: 0107_plataforma_perfis_sem_base_conferencia_espelho.down.sql (apaga os 4 gatilhos e as funções desta
-- migração; as concessões ficam, como a 0106 as deixou).

-- 1. Conferência por usuário --------------------------------------------------------------------------------------------------
create function plataforma.conferir_perfis_sem_base(p_tenant uuid)
  returns table (usuario_id uuid, perfil_codigo text, chave text, antes jsonb, depois jsonb, tipo text)
  language sql stable
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
    with u as (
      select u.id as usuario_id, u.perfil as nome, p.id as perfil_id, p.codigo, p.cargo,
             plataforma.permissoes_normalizadas(plataforma.permissoes_legado_do_perfil(p.id, true)) as a,
             plataforma.permissoes_normalizadas(plataforma.concessoes_do_perfil(p.id)) as d
        from core.usuario u
        join plataforma.usuario_perfil up on up.tenant_id = u.tenant_id and up.usuario_id = u.id and up.deleted_at is null
        join plataforma.perfil p on p.tenant_id = up.tenant_id and p.id = up.perfil_id and p.deleted_at is null
       where u.tenant_id = p_tenant and u.deleted_at is null
    )
    select x.usuario_id, x.codigo, x.chave, x.antes, x.depois, x.tipo
      from (
        select u.usuario_id, u.codigo, k.chave, u.a -> k.chave as antes, u.d -> k.chave as depois, 'DIFERENCA' as tipo
          from u
          cross join lateral (select jsonb_object_keys(u.a) as chave union select jsonb_object_keys(u.d)) k
         where u.a -> k.chave is distinct from u.d -> k.chave
        union all
        select u.usuario_id, u.codigo, null, to_jsonb(u.nome), to_jsonb(plataforma.perfil_compat(u.cargo, u.d)), 'NOME_DIVERGENTE'
          from u
         where plataforma.perfil_compat(u.cargo, u.d) <> u.nome
      ) x
     order by x.usuario_id, x.tipo, x.chave
  $$;
revoke all on function plataforma.conferir_perfis_sem_base(uuid) from public;
grant execute on function plataforma.conferir_perfis_sem_base(uuid) to macuxi_app;

-- 2. Espelho ------------------------------------------------------------------------------------------------------------------
create function plataforma.espelhar_perfil(p_perfil uuid) returns void
  language plpgsql volatile
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v record;
  v_legado jsonb;
  v_final jsonb;
  v_ids uuid[] := '{}';
  v_id uuid;
  v_k text;
begin
  select p.tenant_id, p.id, p.codigo, p.cargo, p.ativo into v
    from plataforma.perfil p where p.id = p_perfil and p.deleted_at is null;
  if v.id is null or not plataforma.perfis_derivados(v.tenant_id) then
    return;
  end if;
  v_legado := plataforma.permissoes_legado_do_perfil(v.id, true);
  v_final := plataforma.aplicar_travas_do_cargo(v_legado, v.cargo);
  for v_k in select k from jsonb_object_keys(v_legado) k where v_final -> k is distinct from v_legado -> k loop
    v_id := plataforma.uuid_de_chave(v.tenant_id::text || ':plataforma.perfil_migracao_conflito:TRAVA_NOVA_CORTA:' || v.id::text || ':' || v_k);
    v_ids := v_ids || v_id;
    insert into plataforma.perfil_migracao_conflito as c (id, tenant_id, perfil_id, perfil_codigo, tipo, efeito, chave, antes, depois)
    values (v_id, v.tenant_id, v.id, v.codigo, 'TRAVA_NOVA_CORTA', 'aviso', v_k, jsonb_build_object(v_k, v_legado -> v_k),
            case when v_final ? v_k then jsonb_build_object(v_k, v_final -> v_k) end)
    on conflict (id) do update
       set efeito = excluded.efeito, antes = excluded.antes, depois = excluded.depois, resolvido_em = null, deleted_at = null
     where (c.efeito, c.antes, c.depois) is distinct from (excluded.efeito, excluded.antes, excluded.depois)
        or c.resolvido_em is not null or c.deleted_at is not null;
  end loop;
  if v.ativo and not exists (select 1 from jsonb_object_keys(v_final) k where k like 'acesso.%') then
    v_id := plataforma.uuid_de_chave(v.tenant_id::text || ':plataforma.perfil_migracao_conflito:PERFIL_SEM_ACESSO:' || v.id::text || ':-');
    v_ids := v_ids || v_id;
    insert into plataforma.perfil_migracao_conflito as c (id, tenant_id, perfil_id, perfil_codigo, tipo, efeito)
    values (v_id, v.tenant_id, v.id, v.codigo, 'PERFIL_SEM_ACESSO', 'aviso')
    on conflict (id) do update set efeito = excluded.efeito, resolvido_em = null, deleted_at = null
     where c.efeito is distinct from excluded.efeito or c.resolvido_em is not null or c.deleted_at is not null;
  end if;
  -- achado de espelho que deixou de valer (os da migração, de outros tipos, ficam como estão)
  update plataforma.perfil_migracao_conflito c set resolvido_em = now()
   where c.tenant_id = v.tenant_id and c.perfil_id = v.id and c.tipo in ('TRAVA_NOVA_CORTA', 'PERFIL_SEM_ACESSO')
     and c.efeito = 'aviso' and c.resolvido_em is null and c.id <> all (v_ids);
  perform plataforma.sincronizar_concessoes(v.id, v_final);
end
$$;
revoke all on function plataforma.espelhar_perfil(uuid) from public;

create function plataforma.perfil_permissao_espelho() returns trigger
  language plpgsql security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
begin
  if tg_op <> 'INSERT' then
    perform plataforma.espelhar_perfil(old.perfil_id);
  end if;
  if tg_op <> 'DELETE' and (tg_op = 'INSERT' or new.perfil_id is distinct from old.perfil_id) then
    perform plataforma.espelhar_perfil(new.perfil_id);
  end if;
  return null;
end
$$;
revoke all on function plataforma.perfil_permissao_espelho() from public;
create trigger perfil_permissao_espelho after insert or update or delete on plataforma.perfil_permissao
  for each row execute function plataforma.perfil_permissao_espelho();

create function plataforma.perfil_espelho() returns trigger
  language plpgsql security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
begin
  if tg_op = 'INSERT' or new.cargo is distinct from old.cargo then
    perform plataforma.espelhar_perfil(new.id);
  end if;
  return null;
end
$$;
revoke all on function plataforma.perfil_espelho() from public;
create trigger perfil_espelho after insert or update of cargo on plataforma.perfil
  for each row execute function plataforma.perfil_espelho();

create function plataforma.parametro_espelho() returns trigger
  language plpgsql security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_tenant uuid := case when tg_op = 'DELETE' then old.tenant_id else new.tenant_id end;
  v_perfil uuid;
begin
  if not ((tg_op <> 'DELETE' and ((new.modulo = 'core' and new.chave = 'promotor_ve_pedidos')
                                  or (new.modulo = 'catalogo' and new.chave = 'promotor_ve_preco_estoque')))
          or (tg_op <> 'INSERT' and ((old.modulo = 'core' and old.chave = 'promotor_ve_pedidos')
                                     or (old.modulo = 'catalogo' and old.chave = 'promotor_ve_preco_estoque')))) then
    return null;
  end if;
  if not plataforma.perfis_derivados(v_tenant) then
    return null;
  end if;
  for v_perfil in
    select p.id from plataforma.perfil p
     where p.tenant_id = v_tenant and p.base = 'promotor' and p.deleted_at is null order by p.id
  loop
    perform plataforma.espelhar_perfil(v_perfil);
  end loop;
  return null;
end
$$;
revoke all on function plataforma.parametro_espelho() from public;
create trigger parametro_espelho after insert or update or delete on plataforma.parametro
  for each row execute function plataforma.parametro_espelho();

create function plataforma.tenant_semear_concessoes() returns trigger
  language plpgsql security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
begin
  perform plataforma.migrar_perfis_sem_base(new.id);
  return null;
end
$$;
revoke all on function plataforma.tenant_semear_concessoes() from public;
create trigger tenant_semear_perfis_concessao after insert on plataforma.tenant
  for each row execute function plataforma.tenant_semear_concessoes();
