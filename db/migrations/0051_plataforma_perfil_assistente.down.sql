-- 0051_plataforma_perfil_assistente (down) — desfaz a 0051 (RD-0014) e volta ao texto da 0041.
-- 1. plataforma.semear_perfis_fabrica(uuid) volta a semear 'Assistente de BKO' (create or replace: mesmas ACLs).
-- 2. Perfil de FÁBRICA de base assistente com o nome 'Assistente' volta a 'Assistente de BKO'. Limite: um admin que tenha
--    renomeado à mão para exatamente 'Assistente' também volta (não há como distinguir; o nome é só exibição).
-- Idempotente. Pré-condição: 0052+ desfeitas.

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
      ('analista', 'Analista'), ('assistente', 'Assistente de BKO'), ('admin', 'Admin')
    ) as f (base, nome)
  on conflict do nothing;
end
$$;

update plataforma.perfil set nome = 'Assistente de BKO'
 where fabrica and base = 'assistente' and nome = 'Assistente';
