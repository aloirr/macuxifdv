-- 0073_plataforma_dados_legais (up) — dados legais do rodapé das telas Entrar (Campo, Gestão, BKO e portal config.): razão
-- social, CNPJ e site da Macuxi, um cadastro da PLATAFORMA editado pelo super-admin no portal ("Dados da Macuxi"). Pedido do
-- dono do produto R-20261114-221000-alexandre; spec docs/design/telas/rodape-legal.md §3.2 (tabela) e §3.3 (contrato
-- DadosLegaisSchema / GravarDadosLegaisSchema em packages/platform-sdk/src/plataforma.ts); rotas em apps/api/src/dados-legais.ts.
-- Dicionário: docs/banco/plataforma.md ("Dados legais da Macuxi (0073)") e docs/banco/rls.md. Teste:
-- db/testes/dados-legais.db.test.ts (estático na sessão; banco e up/down no CI). Migração ADITIVA: nada existente muda.
--
-- 1. plataforma.dados_legais: UMA linha só (índice único sobre a constante, dados_legais_uma_linha_uk); a migração já cria a
--    linha com razão social e CNPJ vazios (nulos) e o site padrão. Dado de pessoa jurídica (não é dado pessoal). Sem
--    tenant_id (dado da plataforma, fora dos tenants, como plataforma.super_admin): exceção nominal em TABELAS_SEM_TENANT_ID e
--    TABELAS_SO_POR_FUNCAO (db/src/excecoes.ts). RLS ligado e FORÇADO, só a política manutencao, NENHUM grant de tabela
--    (app, worker e portal: 42501). CHECKs iguais ao contrato: razao_social sem espaços nas pontas, não vazia, até 120;
--    cnpj só os 14 dígitos (o dígito verificador é conferido no contrato e na API); site só o domínio em minúsculas (o
--    DOMINIO_RE do SDK). atualizado_por = plataforma.super_admin.id (FK; nulo na linha da migração).
-- 2. Funções (SECURITY DEFINER, search_path fixo com pg_temp por último; o dono é o migrador, que enxerga a linha pela
--    política manutencao). Todas devolvem o jsonb { razao_social, cnpj, site } (DadosLegaisSchema), sem nenhum outro campo:
--    - plataforma.dados_legais_publicos() -> jsonb: SEM sessão (a tela Entrar vem antes do login); só os 3 campos públicos;
--      sem a linha (ou apagada) devolve { null, null, 'macuxifdv.com.br' }. EXECUTE só ao macuxi_app (a rota pública
--      GET /v1/publico/dados-legais usa a conexão do app, sem contexto de tenant). STABLE.
--    - plataforma.sa_dados_legais(p_sid uuid) -> jsonb: só o super-admin (sessão inválida/vencida = 28000; admin do cliente =
--      42501). EXECUTE só ao macuxi_portal.
--    - plataforma.sa_gravar_dados_legais(p_sid uuid, p jsonb) -> jsonb: só o super-admin (28000/42501). Entrada = a saída do
--      GravarDadosLegaisSchema: objeto com EXATAMENTE as chaves razao_social (texto ou null), cnpj (texto ou null) e site
--      (texto); chave a mais ou a menos, ou tipo errado = 22023; valor fora das regras = 23514 (CHECK). IDEMPOTENTE: valores
--      iguais aos gravados não mudam a linha (nem updated_at) e não auditam; valores novos gravam e auditam
--      'sa.dados_legais.gravar' em plataforma.auditoria_plataforma com o antes e o depois (dado de pessoa jurídica). Trava a
--      linha (for update): dois PUTs simultâneos ficam em fila. Devolve o que ficou gravado. EXECUTE só ao macuxi_portal.
--
-- Caminho de volta: 0073_plataforma_dados_legais.down.sql (apaga as 3 funções e a tabela; PERDE a razão social, o CNPJ e o
-- site gravados: anote antes com "select razao_social, cnpj, site from plataforma.dados_legais"). As linhas de auditoria
-- 'sa.dados_legais.gravar' ficam (append-only). Antes do down, volte a API sem as rotas de dados legais (sem elas existirem a
-- API responde 503, o rodapé usa o cache e o site padrão).

-- =============================================================================================
-- 1. plataforma.dados_legais (uma linha só)
-- =============================================================================================
create table plataforma.dados_legais (
  id              uuid primary key default gen_random_uuid(),
  razao_social    text,
  cnpj            text,
  site            text not null default 'macuxifdv.com.br',
  atualizado_por  uuid references plataforma.super_admin (id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  external_id     text,
  constraint dados_legais_razao_social_valida check (
    razao_social is null or (razao_social = btrim(razao_social) and razao_social <> '' and char_length(razao_social) <= 120)),
  constraint dados_legais_cnpj_digitos check (cnpj is null or cnpj ~ '^[0-9]{14}$'),
  constraint dados_legais_site_dominio check (
    char_length(site) between 1 and 253
    and site ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$')
);
-- uma linha só: o índice único sobre a constante recusa a 2ª (23505)
create unique index dados_legais_uma_linha_uk on plataforma.dados_legais ((true));
create index dados_legais_atualizado_por_ix on plataforma.dados_legais (atualizado_por) where atualizado_por is not null;
create trigger dados_legais_updated_at before update on plataforma.dados_legais
  for each row execute function plataforma.definir_updated_at();
alter table plataforma.dados_legais enable row level security;
alter table plataforma.dados_legais force row level security;
create policy manutencao on plataforma.dados_legais for all to macuxi_manutencao using (true) with check (true);
revoke all on plataforma.dados_legais from public, macuxi_app, macuxi_worker;
revoke all on plataforma.dados_legais from macuxi_portal;

-- a linha única, com razão social e CNPJ vazios e o site padrão (spec §3.2; o default da coluna)
insert into plataforma.dados_legais default values;

-- =============================================================================================
-- 2. Leitura pública (rota sem login): só razao_social, cnpj e site
-- =============================================================================================
create function plataforma.dados_legais_publicos()
  returns jsonb
  language sql stable security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
    select coalesce(
      (select jsonb_build_object('razao_social', d.razao_social, 'cnpj', d.cnpj, 'site', d.site)
         from plataforma.dados_legais d
        where d.deleted_at is null
        limit 1),
      jsonb_build_object('razao_social', null, 'cnpj', null, 'site', 'macuxifdv.com.br'))
  $$;
revoke all on function plataforma.dados_legais_publicos() from public, macuxi_worker, macuxi_portal;
grant execute on function plataforma.dados_legais_publicos() to macuxi_app;

-- =============================================================================================
-- 3. Portal: leitura (só super-admin)
-- =============================================================================================
create function plataforma.sa_dados_legais(p_sid uuid)
  returns jsonb
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_tipo text;
  v_sa uuid;
begin
  select v.tipo, v.super_admin_id into v_tipo, v_sa from plataforma.sa_sessao_valida(p_sid) v;
  if v_tipo is null then
    raise exception 'sa_dados_legais: sessão do portal inválida' using errcode = '28000';
  end if;
  if v_tipo is distinct from 'super_admin' or v_sa is null then
    raise exception 'sa_dados_legais: só o super-admin' using errcode = '42501';
  end if;
  return plataforma.dados_legais_publicos();
end
$$;
revoke all on function plataforma.sa_dados_legais(uuid) from public, macuxi_app, macuxi_worker;
grant execute on function plataforma.sa_dados_legais(uuid) to macuxi_portal;

-- =============================================================================================
-- 4. Portal: gravação idempotente e auditada (só super-admin)
-- =============================================================================================
create function plataforma.sa_gravar_dados_legais(p_sid uuid, p jsonb)
  returns jsonb
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_tipo text;
  v_sa uuid;
  v_razao text;
  v_cnpj text;
  v_site text;
  v_atual record;
  v_antes jsonb;
  v_depois jsonb;
begin
  select v.tipo, v.super_admin_id into v_tipo, v_sa from plataforma.sa_sessao_valida(p_sid) v;
  if v_tipo is null then
    raise exception 'sa_gravar_dados_legais: sessão do portal inválida' using errcode = '28000';
  end if;
  if v_tipo is distinct from 'super_admin' or v_sa is null then
    raise exception 'sa_gravar_dados_legais: só o super-admin' using errcode = '42501';
  end if;

  -- entrada = saída do GravarDadosLegaisSchema (a API já normalizou e conferiu; o banco revalida a forma e os CHECKs, o resto)
  if p is null or jsonb_typeof(p) is distinct from 'object'
     or (select array_agg(k order by k) from jsonb_object_keys(p) k) is distinct from array['cnpj', 'razao_social', 'site'] then
    raise exception 'sa_gravar_dados_legais: a entrada deve ter exatamente razao_social, cnpj e site' using errcode = '22023';
  end if;
  if jsonb_typeof(p -> 'razao_social') not in ('string', 'null') or jsonb_typeof(p -> 'cnpj') not in ('string', 'null')
     or jsonb_typeof(p -> 'site') is distinct from 'string' then
    raise exception 'sa_gravar_dados_legais: razao_social e cnpj são texto ou null; site é texto' using errcode = '22023';
  end if;
  v_razao := p ->> 'razao_social';
  v_cnpj := p ->> 'cnpj';
  v_site := p ->> 'site';

  -- a linha única, travada (dois PUTs simultâneos em fila); sem ela (apagada à mão), nasce de novo. O "antes" da auditoria é
  -- o que a leitura pública mostrava (sem a linha ou com ela apagada, o padrão de lá): um lugar só para o "sem dados".
  select d.id, d.razao_social, d.cnpj, d.site, d.deleted_at into v_atual from plataforma.dados_legais d limit 1 for update;
  v_antes := plataforma.dados_legais_publicos();
  if not found then
    insert into plataforma.dados_legais (razao_social, cnpj, site, atualizado_por) values (v_razao, v_cnpj, v_site, v_sa);
  elsif v_atual.deleted_at is null and v_atual.razao_social is not distinct from v_razao and v_atual.cnpj is not distinct from v_cnpj
        and v_atual.site = v_site then
    -- idempotente: o mesmo conteúdo não muda a linha nem audita
    return plataforma.dados_legais_publicos();
  else
    update plataforma.dados_legais
       set razao_social = v_razao, cnpj = v_cnpj, site = v_site, atualizado_por = v_sa, deleted_at = null
     where id = v_atual.id;
  end if;

  v_depois := plataforma.dados_legais_publicos();
  perform plataforma.sa_registrar_auditoria('super_admin', v_sa, null, p_sid, null, 'sa.dados_legais.gravar',
    jsonb_build_object('antes', v_antes, 'depois', v_depois));
  return v_depois;
end
$$;
revoke all on function plataforma.sa_gravar_dados_legais(uuid, jsonb) from public, macuxi_app, macuxi_worker;
grant execute on function plataforma.sa_gravar_dados_legais(uuid, jsonb) to macuxi_portal;

-- =============================================================================================
-- 5. Conferência pelo catálogo (aborta com 42501 e nada muda). Sem contar o total de sa_* do portal: a 0073 só confere as
--    suas e a regra geral (nenhuma sa_* executável pelo app, pelo worker ou por PUBLIC).
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
    raise exception '0073: função executável pelo macuxi_app, macuxi_worker ou PUBLIC: %', v_f using errcode = '42501';
  end if;
  if not has_function_privilege('macuxi_portal', 'plataforma.sa_dados_legais(uuid)', 'execute')
     or not has_function_privilege('macuxi_portal', 'plataforma.sa_gravar_dados_legais(uuid, jsonb)', 'execute') then
    raise exception '0073: as 2 sa_* dos dados legais devem ser executáveis pelo macuxi_portal' using errcode = '42501';
  end if;
  if not has_function_privilege('macuxi_app', 'plataforma.dados_legais_publicos()', 'execute')
     or has_function_privilege('macuxi_worker', 'plataforma.dados_legais_publicos()', 'execute')
     or has_function_privilege('macuxi_portal', 'plataforma.dados_legais_publicos()', 'execute')
     or exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                 where p.oid = 'plataforma.dados_legais_publicos()'::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE') then
    raise exception '0073: plataforma.dados_legais_publicos executável só pelo macuxi_app' using errcode = '42501';
  end if;
  if has_table_privilege('macuxi_app', 'plataforma.dados_legais', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
     or has_table_privilege('macuxi_worker', 'plataforma.dados_legais', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
     or has_table_privilege('macuxi_portal', 'plataforma.dados_legais', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') then
    raise exception '0073: privilégio de tabela fora do desenho em plataforma.dados_legais' using errcode = '42501';
  end if;
end
$$;
