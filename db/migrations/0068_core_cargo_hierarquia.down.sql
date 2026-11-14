-- 0068_core_cargo_hierarquia (down) — desfaz a 0068 (cargo, um perfil por usuário, view da hierarquia) e volta ao catálogo da
-- 0067. Ordem: a view; a restrição de exclusão (antes de devolver vínculos); as 2 funções aos textos anteriores
-- (garantir_perfil_principal da 0041, semear_perfis_fabrica da 0051); os vínculos que a 0068 apagou voltam a vivos — os de
-- deleted_at = public.macuxi_migracao.aplicada_em da 0068 (o migrador apaga a linha só depois do down), cujo perfil segue ativo
-- e vivo e sem outro vínculo vivo igual; por fim a coluna cargo (com o CHECK) e a função cargo_da_base.
-- Limites: core.usuario.perfil fica com a base mais alta (válida: continua entre os perfis do usuário); o cargo gravado em perfil
-- personalizado se perde (reaplicar a 0068 volta ao cargo da base); vínculo apagado pelo Core depois da 0068 não volta.
-- Idempotente. Pré-condição: 0069+ desfeitas e o código do Core que grava/lê o cargo e a view já desfeito.

drop view if exists core.v_usuario_hierarquia;
alter table plataforma.usuario_perfil drop constraint if exists usuario_perfil_um_vivo;

create or replace function plataforma.garantir_perfil_principal() returns trigger
  language plpgsql
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_perfil uuid;
  v_vivos uuid[];
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
  -- troca de perfil de quem tem só o vínculo de fábrica do perfil anterior (perfil único, o Core de hoje): substitui
  if tg_op = 'UPDATE' and old.perfil is distinct from new.perfil then
    select array_agg(up.id) into v_vivos
      from plataforma.usuario_perfil up
     where up.tenant_id = new.tenant_id and up.usuario_id = new.id and up.deleted_at is null;
    if cardinality(v_vivos) = 1 and exists (select 1 from plataforma.usuario_perfil up
                                               join plataforma.perfil p on p.tenant_id = up.tenant_id and p.id = up.perfil_id
                                              where up.tenant_id = new.tenant_id and up.id = v_vivos[1]
                                                and p.fabrica and p.codigo = old.perfil) then
      update plataforma.usuario_perfil up set deleted_at = now() where up.tenant_id = new.tenant_id and up.id = v_vivos[1];
    end if;
  end if;
  insert into plataforma.usuario_perfil (id, tenant_id, usuario_id, perfil_id)
  values (plataforma.uuid_de_chave(new.tenant_id::text || ':plataforma.usuario_perfil:' || new.id::text || ':' || v_perfil::text),
          new.tenant_id, new.id, v_perfil)
  on conflict (id) do update set deleted_at = null;
  return null;
end
$$;

create or replace function plataforma.semear_perfis_fabrica(p_tenant uuid) returns void
  language plpgsql volatile
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
begin
  if p_tenant is null then
    raise exception 'semear_perfis_fabrica: p_tenant obrigatório' using errcode = '22004';
  end if;
  insert into plataforma.perfil (id, tenant_id, codigo, nome, base, fabrica, ativo)
  select plataforma.uuid_de_chave(p_tenant::text || ':plataforma.perfil:' || f.base), p_tenant, f.base, f.nome, f.base, true, true
    from (values
      ('vendedor', 'Vendedor'), ('promotor', 'Promotor'), ('supervisor', 'Supervisor'), ('gerente', 'Gerente'),
      ('analista', 'Analista'), ('assistente', 'Assistente'), ('admin', 'Admin')
    ) as f (base, nome)
  on conflict do nothing;
end
$$;

-- Vínculos que a 0068 apagou (multiperfil de antes): voltam a vivos.
update plataforma.usuario_perfil up set deleted_at = null
 where up.deleted_at = (select m.aplicada_em from public.macuxi_migracao m where m.versao = '0068')
   and exists (select 1 from plataforma.perfil p
                where p.tenant_id = up.tenant_id and p.id = up.perfil_id and p.ativo and p.deleted_at is null)
   and not exists (select 1 from plataforma.usuario_perfil o
                    where o.tenant_id = up.tenant_id and o.usuario_id = up.usuario_id and o.perfil_id = up.perfil_id
                      and o.deleted_at is null);

alter table plataforma.perfil drop column if exists cargo;
drop function if exists plataforma.cargo_da_base(text);
