-- 0051_plataforma_perfil_assistente (up) — RD-0014 (T-0111): o perfil de fábrica do assistente se chama "Assistente".
-- Pedido R-20261108-202329-designer-ux (texto em docs/design/perfis-de-acesso.md §0.1). Dicionário: docs/banco/plataforma.md
-- ("0051 — nome do perfil Assistente"). Migração em cima da 0050. Só o NOME exibido: código, base, marca de fábrica, ids,
-- permissões, políticas e grants não mudam (perfil_imutavel trava código/base/fábrica; o nome é editável).
-- 1. plataforma.semear_perfis_fabrica(uuid): mesmo texto da 0041 com 'Assistente' no lugar de 'Assistente de BKO'
--    (create or replace: mesma assinatura, mesmo dono, mesmas ACLs — EXECUTE só ao macuxi_app; o gatilho do tenant novo chama).
-- 2. Tenants que já existem: nome = 'Assistente' só no perfil de FÁBRICA de base assistente que ainda tem o nome antigo
--    exato ('Assistente de BKO'). Quem já renomeou o perfil não é tocado. O gatilho perfil_updated_at anda o updated_at.
-- Os outros 6 nomes de fábrica já estão certos (Vendedor, Promotor, Supervisor, Gerente, Analista, Admin).
-- Caminho de volta: 0051_plataforma_perfil_assistente.down.sql.

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

update plataforma.perfil set nome = 'Assistente'
 where fabrica and base = 'assistente' and nome = 'Assistente de BKO';
