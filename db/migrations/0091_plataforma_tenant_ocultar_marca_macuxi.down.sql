-- 0091_plataforma_tenant_ocultar_marca_macuxi (down) — desfaz a 0091 e volta exatamente ao catálogo e às ACLs da 0090.
-- PERDE a escolha das empresas (anote antes: select id from plataforma.tenant where ocultar_marca_macuxi). As linhas
-- 'sa.empresa.ocultar_marca' da plataforma.auditoria_plataforma ficam (append-only).
-- Pré-condição: a API sem a rota PUT .../marca/ocultar-macuxi e sem o campo ocultar_marca_macuxi no contrato da marca.

drop function if exists plataforma.sa_gravar_ocultar_marca(uuid, uuid, boolean);
-- a interna volta ao corpo da 0083 (sem ocultar_marca_macuxi) antes de a coluna sair
create or replace function plataforma.marca_da_empresa_json(p_tenant uuid)
  returns jsonb
  language sql stable security invoker
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
    select jsonb_build_object(
             'tenant_id', t.id, 'razao_social', t.nome, 'nome_fantasia', t.nome_fantasia,
             'logo', case when t.logo_id is null then null else jsonb_build_object(
               'sha256', t.logo_sha256, 'tipo', t.logo_tipo, 'tamanho_bytes', t.logo_tamanho_bytes,
               'largura_px', t.logo_largura_px, 'altura_px', t.logo_altura_px,
               'atualizada_em', plataforma.instante_iso(t.logo_atualizada_em), 'chave', t.logo_chave) end)
      from plataforma.tenant t
     where t.id = p_tenant
  $$;
revoke all on function plataforma.marca_da_empresa_json(uuid) from public;
-- a coluna leva junto o SELECT por coluna do macuxi_leitura
alter table plataforma.tenant drop column if exists ocultar_marca_macuxi;
