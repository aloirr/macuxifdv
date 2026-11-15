-- 0081_plataforma_tenant_logo (up) — logo do cliente e nome fantasia da empresa (T-0182, número provisório; decisões do dono
-- do produto R-20261114-223500 e R-20261114-234500; spec docs/design/telas/logo-cliente.md; desenho
-- docs/desenho/T-0182-logo-cliente.md §1.2, com a decisão do gerente: SÓ o super-admin grava, RN-CORE-33 e "cadastrado só no
-- portal config."). Contratos MarcaEmpresaSchema / EmpresaLogoSchema em packages/platform-sdk/src/empresa-logo.ts; rotas em
-- apps/api/src/empresa-logo.ts. Dicionário: docs/banco/plataforma.md ("Logo e nome fantasia da empresa (0081)") e
-- docs/banco/rls.md. Teste: db/testes/tenant-logo.db.test.ts (estático na sessão; banco e up/down no CI). Migração ADITIVA:
-- nenhuma coluna, política ou grant existente muda.
--
-- 1. plataforma.tenant ganha 9 colunas nulas. Os BYTES da logo ficam no armazenamento de arquivos da plataforma (disco em
--    dev/CI, S3 em produção), na chave <tenant_id>/plataforma/<aaaa-mm>/<logo_id>.<png|jpg>; aqui só os metadados:
--      nome_fantasia       text        sem espaço nas pontas, não vazio, até 80 (null = usa a razão social, coluna nome)
--      logo_id             uuid        gerado pela API a cada envio
--      logo_tipo           text        image/png | image/jpeg
--      logo_sha256         text        64 hex minúsculos
--      logo_tamanho_bytes  integer     1..1048576 (1 MiB)
--      logo_largura_px     integer     1..4096
--      logo_altura_px      integer     200..4096
--      logo_chave          text        <id do tenant>/plataforma/<aaaa-mm>/<logo_id>.png|.jpg (extensão do logo_tipo)
--      logo_atualizada_em  timestamptz quando a logo atual foi gravada
--    CHECK tenant_logo_completa: as 8 logo_* todas nulas ou todas preenchidas. Nenhum índice novo (lida sempre pela PK).
--    Leitura pelo app: o macuxi_app já tem select em plataforma.tenant com a política isolamento_tenant (0001; só a linha do
--    próprio tenant), então a API lê as colunas novas junto com o fuso, sem grant novo. O app NÃO grava (sem grant de update).
--    macuxi_leitura (0078): o SELECT de tabela vira SELECT por coluna, sem logo_sha256 e logo_chave (colunas sensíveis pelo
--    nome; regra 8), como a 0079 fez em catalogo.produto_midia.
-- 2. Funções do portal (SECURITY DEFINER, search_path fixo com pg_temp por último; EXECUTE só ao macuxi_portal). Todas
--    conferem a sessão (sa_sessao_valida; inválida = 28000) e o tenant (nulo = 22023; inexistente ou apagado = P0002, hint
--    TENANT_NAO_ENCONTRADO). Devolvem o jsonb MarcaEmpresa + logo.chave (só a API usa; a rota tira antes de responder):
--      { tenant_id, razao_social, nome_fantasia, logo: null | { sha256, tipo, tamanho_bytes, largura_px, altura_px,
--        atualizada_em, chave } }
--    - sa_marca_da_empresa(p_sid uuid, p_tenant uuid) -> jsonb: leitura; super-admin em qualquer empresa; admin do cliente só
--      na empresa atual da sessão (senão 42501).
--    - sa_gravar_nome_fantasia(p_sid uuid, p_tenant uuid, p_nome text) -> jsonb: SÓ super-admin (admin do cliente = 42501);
--      null apaga; fora do CHECK = 23514. Idempotente (igual não muda a linha nem audita); valor novo audita
--      'sa.empresa.nome_fantasia' { antes, depois } (dado de pessoa jurídica). Trava a linha (for update).
--    - sa_gravar_logo(p_sid uuid, p_tenant uuid, p jsonb) -> jsonb: SÓ super-admin. p com EXATAMENTE id, tipo, sha256,
--      tamanho_bytes, largura_px, altura_px e chave (chave a mais/a menos, tipo JSON errado ou id fora de UUID = 22023; valor
--      fora dos CHECKs = 23514). Idempotente pelo sha256: igual ao gravado não muda nada nem audita (a resposta traz a chave
--      GRAVADA em logo.chave: se for outra, a API apaga o objeto que acabou de enviar). Senão grava, logo_atualizada_em =
--      now() e audita 'sa.empresa.logo.gravar' { sha256_antes, sha256_depois } (sem bytes). Devolve + chave_anterior (texto
--      ou null) para a API apagar o objeto antigo.
--    - sa_remover_logo(p_sid uuid, p_tenant uuid) -> jsonb: SÓ super-admin. Zera as 8 logo_*; já sem logo = nada muda nem
--      audita; senão audita 'sa.empresa.logo.remover' { sha256_antes }. Devolve + chave_anterior.
--    Interna: plataforma.marca_da_empresa_json(uuid) (SECURITY INVOKER, sem EXECUTE para ninguém além do dono) monta o jsonb
--    num lugar só; as 4 sa_* a chamam.
--
-- Caminho de volta: 0081_plataforma_tenant_logo.down.sql (apaga as 5 funções e as 9 colunas e devolve ao macuxi_leitura o
-- SELECT de tabela da 0078; PERDE o nome fantasia e os
-- metadados das logos: anote antes com "select id, nome_fantasia, logo_chave from plataforma.tenant where nome_fantasia is
-- not null or logo_chave is not null"; os objetos ficam órfãos no armazenamento, apagáveis pela chave). As linhas de
-- auditoria 'sa.empresa.*' ficam (append-only). Antes do down, volte a API sem as rotas da marca (sem as funções elas
-- respondem 503) e sem as colunas novas no lerTenant.

-- =============================================================================================
-- 1. Colunas em plataforma.tenant
-- =============================================================================================
alter table plataforma.tenant add column nome_fantasia text;
alter table plataforma.tenant add column logo_id uuid;
alter table plataforma.tenant add column logo_tipo text;
alter table plataforma.tenant add column logo_sha256 text;
alter table plataforma.tenant add column logo_tamanho_bytes integer;
alter table plataforma.tenant add column logo_largura_px integer;
alter table plataforma.tenant add column logo_altura_px integer;
alter table plataforma.tenant add column logo_chave text;
alter table plataforma.tenant add column logo_atualizada_em timestamptz;

alter table plataforma.tenant add constraint tenant_nome_fantasia_valido check (
  nome_fantasia is null or (nome_fantasia = btrim(nome_fantasia) and nome_fantasia <> '' and char_length(nome_fantasia) <= 80));
alter table plataforma.tenant add constraint tenant_logo_tipo_valido check (logo_tipo is null or logo_tipo in ('image/png', 'image/jpeg'));
alter table plataforma.tenant add constraint tenant_logo_sha256_hex check (logo_sha256 is null or logo_sha256 ~ '^[0-9a-f]{64}$');
alter table plataforma.tenant add constraint tenant_logo_tamanho_faixa check (logo_tamanho_bytes is null or logo_tamanho_bytes between 1 and 1048576);
alter table plataforma.tenant add constraint tenant_logo_largura_faixa check (logo_largura_px is null or logo_largura_px between 1 and 4096);
alter table plataforma.tenant add constraint tenant_logo_altura_faixa check (logo_altura_px is null or logo_altura_px between 200 and 4096);
-- a chave no formato fechado do armazenamento, do PRÓPRIO tenant e da PRÓPRIA logo, com a extensão do tipo
alter table plataforma.tenant add constraint tenant_logo_chave_formato check (
  logo_chave is null
  or (logo_chave ~ ('^' || id::text || '/plataforma/[0-9]{4}-(0[1-9]|1[0-2])/' || coalesce(logo_id::text, '-') || '\.(png|jpg)$')
      and (logo_chave like '%.png') = (logo_tipo is not distinct from 'image/png')));
alter table plataforma.tenant add constraint tenant_logo_completa check (
  num_nulls(logo_id, logo_tipo, logo_sha256, logo_tamanho_bytes, logo_largura_px, logo_altura_px, logo_chave, logo_atualizada_em) in (0, 8));

-- consulta só leitura (0078): logo_sha256 e logo_chave casam com a regra da coluna sensível (db/src/papeis.ts
-- COLUNA_SENSIVEL_LEITURA) e o SELECT de tabela que a 0078 deu ao macuxi_leitura as cobriria; vira SELECT por coluna, sem elas
-- (a política leitura da 0078 fica). Mesmo padrão da 0079 em catalogo.produto_midia.
do $$
declare
  v_colunas text;
begin
  select string_agg(quote_ident(a.attname), ', ' order by a.attnum) into v_colunas
    from pg_attribute a
   where a.attrelid = 'plataforma.tenant'::regclass and a.attnum > 0 and not a.attisdropped
     and not (a.attname ~ '(hash|token|senha|segredo|chave|carga|cifrad)' and a.atttypid <> 'boolean'::regtype);
  execute 'revoke select on plataforma.tenant from macuxi_leitura';
  execute format('grant select (%s) on plataforma.tenant to macuxi_leitura', v_colunas);
end
$$;

-- =============================================================================================
-- 2. Interna: o jsonb da marca (um lugar só para a forma)
-- =============================================================================================
create function plataforma.marca_da_empresa_json(p_tenant uuid)
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

-- =============================================================================================
-- 3. Portal: leitura (super-admin em qualquer empresa; admin do cliente só na empresa atual da sessão)
-- =============================================================================================
create function plataforma.sa_marca_da_empresa(p_sid uuid, p_tenant uuid)
  returns jsonb
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_tipo text;
  v_sa uuid;
  v_tenant_sessao uuid;
begin
  select v.tipo, v.super_admin_id, v.tenant_id into v_tipo, v_sa, v_tenant_sessao from plataforma.sa_sessao_valida(p_sid) v;
  if v_tipo is null then
    raise exception 'sa_marca_da_empresa: sessão do portal inválida' using errcode = '28000';
  end if;
  if p_tenant is null then
    raise exception 'sa_marca_da_empresa: tenant obrigatório' using errcode = '22023';
  end if;
  if not ((v_tipo = 'super_admin' and v_sa is not null) or (v_tipo = 'admin_cliente' and v_tenant_sessao = p_tenant)) then
    raise exception 'sa_marca_da_empresa: só o super-admin ou o admin da própria empresa' using errcode = '42501';
  end if;
  if not exists (select 1 from plataforma.tenant t where t.id = p_tenant and t.deleted_at is null) then
    raise exception 'sa_marca_da_empresa: empresa não encontrada' using errcode = 'P0002', hint = 'TENANT_NAO_ENCONTRADO';
  end if;
  return plataforma.marca_da_empresa_json(p_tenant);
end
$$;
revoke all on function plataforma.sa_marca_da_empresa(uuid, uuid) from public, macuxi_app, macuxi_worker;
grant execute on function plataforma.sa_marca_da_empresa(uuid, uuid) to macuxi_portal;

-- =============================================================================================
-- 4. Portal: nome fantasia (só super-admin; idempotente e auditado)
-- =============================================================================================
create function plataforma.sa_gravar_nome_fantasia(p_sid uuid, p_tenant uuid, p_nome text)
  returns jsonb
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_tipo text;
  v_sa uuid;
  v_antes text;
begin
  select v.tipo, v.super_admin_id into v_tipo, v_sa from plataforma.sa_sessao_valida(p_sid) v;
  if v_tipo is null then
    raise exception 'sa_gravar_nome_fantasia: sessão do portal inválida' using errcode = '28000';
  end if;
  if v_tipo is distinct from 'super_admin' or v_sa is null then
    raise exception 'sa_gravar_nome_fantasia: só o super-admin' using errcode = '42501';
  end if;
  if p_tenant is null then
    raise exception 'sa_gravar_nome_fantasia: tenant obrigatório' using errcode = '22023';
  end if;
  select t.nome_fantasia into v_antes from plataforma.tenant t where t.id = p_tenant and t.deleted_at is null for update;
  if not found then
    raise exception 'sa_gravar_nome_fantasia: empresa não encontrada' using errcode = 'P0002', hint = 'TENANT_NAO_ENCONTRADO';
  end if;
  if v_antes is not distinct from p_nome then
    return plataforma.marca_da_empresa_json(p_tenant);
  end if;
  update plataforma.tenant set nome_fantasia = p_nome where id = p_tenant;
  perform plataforma.sa_registrar_auditoria('super_admin', v_sa, null, p_sid, p_tenant, 'sa.empresa.nome_fantasia',
    jsonb_build_object('antes', v_antes, 'depois', p_nome));
  return plataforma.marca_da_empresa_json(p_tenant);
end
$$;
revoke all on function plataforma.sa_gravar_nome_fantasia(uuid, uuid, text) from public, macuxi_app, macuxi_worker;
grant execute on function plataforma.sa_gravar_nome_fantasia(uuid, uuid, text) to macuxi_portal;

-- =============================================================================================
-- 5. Portal: gravar a logo (só super-admin; idempotente pelo sha256 e auditado, sem bytes)
-- =============================================================================================
create function plataforma.sa_gravar_logo(p_sid uuid, p_tenant uuid, p jsonb)
  returns jsonb
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_tipo text;
  v_sa uuid;
  v_atual record;
begin
  select v.tipo, v.super_admin_id into v_tipo, v_sa from plataforma.sa_sessao_valida(p_sid) v;
  if v_tipo is null then
    raise exception 'sa_gravar_logo: sessão do portal inválida' using errcode = '28000';
  end if;
  if v_tipo is distinct from 'super_admin' or v_sa is null then
    raise exception 'sa_gravar_logo: só o super-admin' using errcode = '42501';
  end if;
  if p_tenant is null then
    raise exception 'sa_gravar_logo: tenant obrigatório' using errcode = '22023';
  end if;

  -- forma (22023): exatamente as 7 chaves; textos são texto; números são inteiros de até 9 dígitos (o CHECK confere a faixa)
  if p is null or jsonb_typeof(p) is distinct from 'object'
     or (select array_agg(k order by k) from jsonb_object_keys(p) k)
        is distinct from array['altura_px', 'chave', 'id', 'largura_px', 'sha256', 'tamanho_bytes', 'tipo'] then
    raise exception 'sa_gravar_logo: a entrada deve ter exatamente id, tipo, sha256, tamanho_bytes, largura_px, altura_px e chave'
      using errcode = '22023';
  end if;
  if jsonb_typeof(p -> 'id') is distinct from 'string'
     or (p ->> 'id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or jsonb_typeof(p -> 'tipo') is distinct from 'string' or jsonb_typeof(p -> 'sha256') is distinct from 'string'
     or jsonb_typeof(p -> 'chave') is distinct from 'string'
     or exists (select 1 from unnest(array['tamanho_bytes', 'largura_px', 'altura_px']) c
                 where jsonb_typeof(p -> c) is distinct from 'number' or (p ->> c) !~ '^-?[0-9]{1,9}$') then
    raise exception 'sa_gravar_logo: id é UUID em minúsculas; tipo, sha256 e chave são texto; tamanho e dimensões são inteiros'
      using errcode = '22023';
  end if;

  select t.logo_sha256, t.logo_chave into v_atual
    from plataforma.tenant t where t.id = p_tenant and t.deleted_at is null for update;
  if not found then
    raise exception 'sa_gravar_logo: empresa não encontrada' using errcode = 'P0002', hint = 'TENANT_NAO_ENCONTRADO';
  end if;
  -- idempotente: a mesma imagem não muda nada nem audita (logo.chave da resposta = a chave gravada)
  if v_atual.logo_sha256 is not distinct from (p ->> 'sha256') then
    return plataforma.marca_da_empresa_json(p_tenant) || jsonb_build_object('chave_anterior', null);
  end if;

  update plataforma.tenant
     set logo_id = (p ->> 'id')::uuid, logo_tipo = p ->> 'tipo', logo_sha256 = p ->> 'sha256',
         logo_tamanho_bytes = (p ->> 'tamanho_bytes')::integer, logo_largura_px = (p ->> 'largura_px')::integer,
         logo_altura_px = (p ->> 'altura_px')::integer, logo_chave = p ->> 'chave', logo_atualizada_em = now()
   where id = p_tenant;
  perform plataforma.sa_registrar_auditoria('super_admin', v_sa, null, p_sid, p_tenant, 'sa.empresa.logo.gravar',
    jsonb_build_object('sha256_antes', v_atual.logo_sha256, 'sha256_depois', p ->> 'sha256'));
  return plataforma.marca_da_empresa_json(p_tenant) || jsonb_build_object('chave_anterior', v_atual.logo_chave);
end
$$;
revoke all on function plataforma.sa_gravar_logo(uuid, uuid, jsonb) from public, macuxi_app, macuxi_worker;
grant execute on function plataforma.sa_gravar_logo(uuid, uuid, jsonb) to macuxi_portal;

-- =============================================================================================
-- 6. Portal: remover a logo (só super-admin; idempotente e auditado)
-- =============================================================================================
create function plataforma.sa_remover_logo(p_sid uuid, p_tenant uuid)
  returns jsonb
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_tipo text;
  v_sa uuid;
  v_atual record;
begin
  select v.tipo, v.super_admin_id into v_tipo, v_sa from plataforma.sa_sessao_valida(p_sid) v;
  if v_tipo is null then
    raise exception 'sa_remover_logo: sessão do portal inválida' using errcode = '28000';
  end if;
  if v_tipo is distinct from 'super_admin' or v_sa is null then
    raise exception 'sa_remover_logo: só o super-admin' using errcode = '42501';
  end if;
  if p_tenant is null then
    raise exception 'sa_remover_logo: tenant obrigatório' using errcode = '22023';
  end if;
  select t.logo_sha256, t.logo_chave into v_atual
    from plataforma.tenant t where t.id = p_tenant and t.deleted_at is null for update;
  if not found then
    raise exception 'sa_remover_logo: empresa não encontrada' using errcode = 'P0002', hint = 'TENANT_NAO_ENCONTRADO';
  end if;
  if v_atual.logo_chave is null then
    return plataforma.marca_da_empresa_json(p_tenant) || jsonb_build_object('chave_anterior', null);
  end if;
  update plataforma.tenant
     set logo_id = null, logo_tipo = null, logo_sha256 = null, logo_tamanho_bytes = null, logo_largura_px = null,
         logo_altura_px = null, logo_chave = null, logo_atualizada_em = null
   where id = p_tenant;
  perform plataforma.sa_registrar_auditoria('super_admin', v_sa, null, p_sid, p_tenant, 'sa.empresa.logo.remover',
    jsonb_build_object('sha256_antes', v_atual.logo_sha256));
  return plataforma.marca_da_empresa_json(p_tenant) || jsonb_build_object('chave_anterior', v_atual.logo_chave);
end
$$;
revoke all on function plataforma.sa_remover_logo(uuid, uuid) from public, macuxi_app, macuxi_worker;
grant execute on function plataforma.sa_remover_logo(uuid, uuid) to macuxi_portal;

-- =============================================================================================
-- 7. Conferência pelo catálogo (aborta com 42501 e nada muda). Como a 0073, sem contar o total de sa_* do portal: confere as
--    suas, a regra geral (nenhuma sa_* executável pelo app, pelo worker ou por PUBLIC) e que a interna é só do dono.
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
    raise exception '0081: função executável pelo macuxi_app, macuxi_worker ou PUBLIC: %', v_f using errcode = '42501';
  end if;
  if not has_function_privilege('macuxi_portal', 'plataforma.sa_marca_da_empresa(uuid, uuid)', 'execute')
     or not has_function_privilege('macuxi_portal', 'plataforma.sa_gravar_nome_fantasia(uuid, uuid, text)', 'execute')
     or not has_function_privilege('macuxi_portal', 'plataforma.sa_gravar_logo(uuid, uuid, jsonb)', 'execute')
     or not has_function_privilege('macuxi_portal', 'plataforma.sa_remover_logo(uuid, uuid)', 'execute') then
    raise exception '0081: as 4 sa_* da marca devem ser executáveis pelo macuxi_portal' using errcode = '42501';
  end if;
  if has_function_privilege('macuxi_app', 'plataforma.marca_da_empresa_json(uuid)', 'execute')
     or has_function_privilege('macuxi_worker', 'plataforma.marca_da_empresa_json(uuid)', 'execute')
     or has_function_privilege('macuxi_portal', 'plataforma.marca_da_empresa_json(uuid)', 'execute') then
    raise exception '0081: plataforma.marca_da_empresa_json é interna (só o dono)' using errcode = '42501';
  end if;
  if has_table_privilege('macuxi_app', 'plataforma.tenant', 'INSERT, UPDATE, DELETE, TRUNCATE')
     or has_table_privilege('macuxi_portal', 'plataforma.tenant', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE') then
    raise exception '0081: privilégio de tabela fora do desenho em plataforma.tenant' using errcode = '42501';
  end if;
end
$$;
