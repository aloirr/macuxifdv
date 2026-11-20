-- 0091_plataforma_tenant_ocultar_marca_macuxi (up) — opção do portal de configuração para ocultar a logomarca do Macuxi e
-- mostrar só a do cliente (item 15 do teste de campo do Campo v1.0.16, R-20261120-055304-alexandre; continuação da T-0182,
-- 0083). Rota: PUT /v1/plataforma/empresas/:tenant_id/marca/ocultar-macuxi (engenheiro-software), que chama
-- plataforma.sa_gravar_ocultar_marca($1, $2, $3). Dicionário: docs/banco/plataforma.md ("Ocultar a marca do Macuxi (0091)").
-- Teste: db/testes/tenant-ocultar-marca.db.test.ts. Migração ADITIVA: nenhuma coluna, política ou grant existente muda.
--
-- 1. plataforma.tenant.ocultar_marca_macuxi boolean not null default false (false = o app e o BKO mostram a marca do Macuxi
--    com a do cliente; true = só a do cliente). Nenhum índice (lida sempre pela PK).
--    Leitura pelo app: o macuxi_app já tem SELECT de tabela em plataforma.tenant com a política isolamento_tenant (0001; só
--    a linha do próprio tenant): "select ocultar_marca_macuxi from plataforma.tenant where id = plataforma.tenant_atual()"
--    funciona sem grant novo. O app NÃO grava (sem grant de update). macuxi_leitura (0078; SELECT por coluna desde a 0083):
--    ganha SELECT na coluna nova (não é sensível).
-- 2. plataforma.marca_da_empresa_json(uuid) (interna da 0083) passa a incluir ocultar_marca_macuxi no jsonb da marca:
--      { tenant_id, razao_social, nome_fantasia, ocultar_marca_macuxi, logo: null | {...} }
--    Vale para as 5 sa_* da marca (a leitura sa_marca_da_empresa do GET, as 3 de gravação da 0083 e a nova).
-- 3. plataforma.sa_gravar_ocultar_marca(p_sid uuid, p_tenant uuid, p_ocultar boolean) -> jsonb (SECURITY DEFINER, search_path
--    fixo com pg_temp por último; EXECUTE só ao macuxi_portal). SÓ super-admin (RN-CORE-33; admin do cliente = 42501);
--    sessão inválida = 28000; tenant ou p_ocultar nulo = 22023; empresa inexistente ou apagada = P0002 (TENANT_NAO_ENCONTRADO).
--    Idempotente (igual não muda a linha nem audita); valor novo audita 'sa.empresa.ocultar_marca' { antes, depois }. Trava a
--    linha (for update). Devolve o mesmo jsonb da sa_marca_da_empresa (com logo.chave, que a rota tira).
--
-- Caminho de volta: 0091_plataforma_tenant_ocultar_marca_macuxi.down.sql (apaga a função e a coluna e volta a interna ao
-- corpo da 0083; PERDE a escolha das empresas: anote antes com "select id from plataforma.tenant where ocultar_marca_macuxi").
-- As linhas 'sa.empresa.ocultar_marca' da auditoria ficam (append-only). Antes do down, volte a API sem a rota nova e sem o
-- campo ocultar_marca_macuxi no contrato da marca.

-- =============================================================================================
-- 1. Coluna em plataforma.tenant
-- =============================================================================================
alter table plataforma.tenant add column ocultar_marca_macuxi boolean not null default false;
grant select (ocultar_marca_macuxi) on plataforma.tenant to macuxi_leitura;

-- =============================================================================================
-- 2. Interna: o jsonb da marca ganha ocultar_marca_macuxi
-- =============================================================================================
create or replace function plataforma.marca_da_empresa_json(p_tenant uuid)
  returns jsonb
  language sql stable security invoker
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
    select jsonb_build_object(
             'tenant_id', t.id, 'razao_social', t.nome, 'nome_fantasia', t.nome_fantasia,
             'ocultar_marca_macuxi', t.ocultar_marca_macuxi,
             'logo', case when t.logo_id is null then null else jsonb_build_object(
               'sha256', t.logo_sha256, 'tipo', t.logo_tipo, 'tamanho_bytes', t.logo_tamanho_bytes,
               'largura_px', t.logo_largura_px, 'altura_px', t.logo_altura_px,
               'atualizada_em', plataforma.instante_iso(t.logo_atualizada_em), 'chave', t.logo_chave) end)
      from plataforma.tenant t
     where t.id = p_tenant
  $$;
revoke all on function plataforma.marca_da_empresa_json(uuid) from public;

-- =============================================================================================
-- 3. Portal: ocultar a marca do Macuxi (só super-admin; idempotente e auditado)
-- =============================================================================================
create function plataforma.sa_gravar_ocultar_marca(p_sid uuid, p_tenant uuid, p_ocultar boolean)
  returns jsonb
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_tipo text;
  v_sa uuid;
  v_antes boolean;
begin
  select v.tipo, v.super_admin_id into v_tipo, v_sa from plataforma.sa_sessao_valida(p_sid) v;
  if v_tipo is null then
    raise exception 'sa_gravar_ocultar_marca: sessão do portal inválida' using errcode = '28000';
  end if;
  if v_tipo is distinct from 'super_admin' or v_sa is null then
    raise exception 'sa_gravar_ocultar_marca: só o super-admin' using errcode = '42501';
  end if;
  if p_tenant is null then
    raise exception 'sa_gravar_ocultar_marca: tenant obrigatório' using errcode = '22023';
  end if;
  if p_ocultar is null then
    raise exception 'sa_gravar_ocultar_marca: ocultar é true ou false' using errcode = '22023';
  end if;
  select t.ocultar_marca_macuxi into v_antes from plataforma.tenant t where t.id = p_tenant and t.deleted_at is null for update;
  if not found then
    raise exception 'sa_gravar_ocultar_marca: empresa não encontrada' using errcode = 'P0002', hint = 'TENANT_NAO_ENCONTRADO';
  end if;
  if v_antes = p_ocultar then
    return plataforma.marca_da_empresa_json(p_tenant);
  end if;
  update plataforma.tenant set ocultar_marca_macuxi = p_ocultar where id = p_tenant;
  perform plataforma.sa_registrar_auditoria('super_admin', v_sa, null, p_sid, p_tenant, 'sa.empresa.ocultar_marca',
    jsonb_build_object('antes', v_antes, 'depois', p_ocultar));
  return plataforma.marca_da_empresa_json(p_tenant);
end
$$;
revoke all on function plataforma.sa_gravar_ocultar_marca(uuid, uuid, boolean) from public, macuxi_app, macuxi_worker;
grant execute on function plataforma.sa_gravar_ocultar_marca(uuid, uuid, boolean) to macuxi_portal;

-- =============================================================================================
-- 4. Conferência pelo catálogo (aborta com 42501 e nada muda), como a 0083
-- =============================================================================================
do $$
declare
  v_f text;
begin
  select string_agg(p.oid::regprocedure::text, ', ' order by 1) into v_f
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'plataforma' and (p.proname like 'sa\_%' or p.proname = 'criar_super_admin')
     and (has_function_privilege('macuxi_app', p.oid, 'execute') or has_function_privilege('macuxi_worker', p.oid, 'execute')
          or exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                      where a.grantee = 0 and a.privilege_type = 'EXECUTE'));
  if v_f is not null then
    raise exception '0091: função executável pelo macuxi_app, macuxi_worker ou PUBLIC: %', v_f using errcode = '42501';
  end if;
  if not has_function_privilege('macuxi_portal', 'plataforma.sa_gravar_ocultar_marca(uuid, uuid, boolean)', 'execute') then
    raise exception '0091: sa_gravar_ocultar_marca deve ser executável pelo macuxi_portal' using errcode = '42501';
  end if;
  if has_function_privilege('macuxi_app', 'plataforma.marca_da_empresa_json(uuid)', 'execute')
     or has_function_privilege('macuxi_worker', 'plataforma.marca_da_empresa_json(uuid)', 'execute')
     or has_function_privilege('macuxi_portal', 'plataforma.marca_da_empresa_json(uuid)', 'execute') then
    raise exception '0091: plataforma.marca_da_empresa_json é interna (só o dono)' using errcode = '42501';
  end if;
  if not has_column_privilege('macuxi_app', 'plataforma.tenant', 'ocultar_marca_macuxi', 'SELECT')
     or has_column_privilege('macuxi_app', 'plataforma.tenant', 'ocultar_marca_macuxi', 'UPDATE')
     or has_table_privilege('macuxi_portal', 'plataforma.tenant', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE') then
    raise exception '0091: privilégio fora do desenho em plataforma.tenant.ocultar_marca_macuxi' using errcode = '42501';
  end if;
end
$$;
