-- 0070_plataforma_plano_assinatura (up) — planos e licenças, parte do banco que o passo "Empresa com plano" do portal grava
-- (ADR 0047 §1, §2 e §8; desenho docs/desenho/planos-e-licencas.md; R-20261114-132600-alexandre, item 1; portal config. enxuto
-- aprovado em R-20261114-170600 e R-20261114-181000). Contrato: packages/platform-sdk/src/planos.ts (PlanoSchema,
-- EscolhaNaCriacaoSchema) e apps/api/src/planos-portal.ts (fontePlanosNoBanco.gravarAssinatura). Dicionário:
-- docs/banco/plataforma.md ("Planos e assinatura (0070)"). Teste: db/testes/plano-assinatura.db.test.ts (estático na sessão;
-- banco e up/down no CI). Migração ADITIVA em cima da 0069: 2 tabelas e 1 função SECURITY DEFINER. Nada existente muda.
--
-- 1. plataforma.plano — catálogo de planos, DADO da plataforma (RN-PLA-01): uma linha por plano (ou por versão do plano: a
--    versão nova é linha nova e a antiga ganha deleted_at; a assinatura continua apontando para a linha que contratou).
--    Fora dos tenants (exceção à regra 5 como a super_admin; db/src/excecoes.ts TABELAS_SEM_TENANT_ID e TABELAS_SO_POR_FUNCAO):
--    RLS ligado e FORÇADO, só a política manutencao; nenhum grant de tabela (app, worker e portal: 42501). Leitura e escrita só
--    pelas funções sa_* (SECURITY DEFINER). Licenças por tipo em 4 colunas (null = sem limite); módulos em text[] (só os 8 do
--    contrato, MODULOS do SDK); adicionais em jsonb [{ adicional, preco_unitario_centavos, incluidos }] (a sa_* confere o
--    formato; o CHECK garante lista). Código único entre os vivos (plano_codigo_uk). Volume: poucas linhas (4 planos + versões).
--    Os números (preços, licenças, dias de teste) vêm só do recado do dono do produto, pelo seed (fora desta migração).
-- 2. plataforma.assinatura — o plano de cada tenant (ADR 0047 §2): uma VIVA por tenant (assinatura_tenant_uk), plano_id (FK
--    para a linha do plano contratada), ciclo, adicionais contratados [{ adicional, quantidade }], teste_ate (último dia do
--    teste, inclusive, no fuso do tenant; null = sem teste), paga, pedido_id (UUID do portal que gravou). CHECK: paga ou com
--    teste (o portal grava paga = sem teste). RLS: isolamento_tenant (macuxi_app lê só o próprio tenant: SELECT; a trava do
--    cadastro de usuários, RN-PLA-04, vem na migração da licencas_do_tenant) e manutencao. Escrita só pela sa_* abaixo.
--    Fora do sync (TABELAS_FORA_DO_SYNC). Volume: uma linha por tenant.
-- 3. plataforma.sa_gravar_assinatura(p_sid uuid, p_tenant uuid, p jsonb) returns jsonb — a assinatura que a API chama
--    ('select plataforma.sa_gravar_assinatura($1, $2, $3::jsonb)'). Só super-admin (sessão inválida = 28000; admin do cliente =
--    42501). p = EntradaAssinatura da API: { plano (código), ciclo, adicionais, teste_ate (AAAA-MM-DD | null), paga, pedido_id };
--    chave fora dessas ou valor fora do formato = 22023. Plano desconhecido, inativo ou adicional que o plano não vende = 22023
--    com o código no hint (PLANO_DESCONHECIDO, PLANO_INATIVO, ADICIONAL_FORA_DO_PLANO; a API devolve 422 com ele). Tenant que não
--    existe ou excluído = P0002. Idempotente: UMA por tenant; se já houver assinatura viva, nada muda e devolve 'existente' com
--    o teste_ate gravado. Retorno { resultado: 'criada' | 'existente', teste_ate: 'AAAA-MM-DD' | null }. Trava consultiva por
--    tenant (duas gravações simultâneas não criam duas). Audita sa.assinatura.gravar (plano, ciclo, com_teste, resultado; sem
--    dado pessoal). EXECUTE só ao macuxi_portal (regra da 0038): o portal passa a executar 17 sa_*.
--
-- Caminho de volta: 0070_plataforma_plano_assinatura.down.sql (apaga a função e as 2 tabelas: as ASSINATURAS e o CATÁLOGO
-- gravados se perdem; o legado tenant_modulo.plano/licencas não é tocado). Desfaça antes a 0071 (sa_listar_tenants com o
-- plano) e desligue MACUXI_PLANOS na API (as rotas dos planos chamam funções que somem).

-- 1. plataforma.plano --------------------------------------------------------------------------------------------------------
create table plataforma.plano (
  id                     uuid primary key default gen_random_uuid(),
  codigo                 text not null,
  nome                   text not null,
  ordem                  integer not null default 0,
  preco_mensal_centavos  bigint not null,
  licenca_vendedor       integer,
  licenca_gestor         integer,
  licenca_bko            integer,
  licenca_promotor       integer,
  modulos                text[] not null default '{}',
  adicionais             jsonb not null default '[]'::jsonb,
  meses_gratis_anual     integer not null default 0,
  dias_teste             integer not null default 0,
  ativo                  boolean not null default true,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  deleted_at             timestamptz,
  external_id            text,
  constraint plano_codigo_formato check (codigo ~ '^[a-z][a-z0-9_]{1,29}$'),
  constraint plano_nome_faixa check (char_length(btrim(nome)) between 1 and 60),
  constraint plano_ordem_positiva check (ordem >= 0),
  constraint plano_preco_positivo check (preco_mensal_centavos >= 0),
  constraint plano_licencas_positivas check (
    (licenca_vendedor is null or licenca_vendedor >= 0) and (licenca_gestor is null or licenca_gestor >= 0)
    and (licenca_bko is null or licenca_bko >= 0) and (licenca_promotor is null or licenca_promotor >= 0)
  ),
  constraint plano_modulos_validos check (
    modulos <@ array['core', 'catalogo', 'vendedor', 'promotor', 'gestor', 'pesquisa', 'treinamento', 'integracao']::text[]
  ),
  constraint plano_adicionais_lista check (jsonb_typeof(adicionais) = 'array' and jsonb_array_length(adicionais) <= 3),
  constraint plano_meses_gratis_faixa check (meses_gratis_anual between 0 and 11),
  constraint plano_dias_teste_faixa check (dias_teste between 0 and 90)
);
create unique index plano_codigo_uk on plataforma.plano (codigo) where deleted_at is null;
create trigger plano_updated_at before update on plataforma.plano
  for each row execute function plataforma.definir_updated_at();
alter table plataforma.plano enable row level security;
alter table plataforma.plano force row level security;
create policy manutencao on plataforma.plano for all to macuxi_manutencao using (true) with check (true);
revoke all on plataforma.plano from public, macuxi_app, macuxi_worker;

-- 2. plataforma.assinatura ---------------------------------------------------------------------------------------------------
create table plataforma.assinatura (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references plataforma.tenant (id),
  plano_id     uuid not null references plataforma.plano (id),
  ciclo        text not null default 'mensal',
  adicionais   jsonb not null default '[]'::jsonb,
  teste_ate    date,
  paga         boolean not null default false,
  pedido_id    uuid not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  external_id  text,
  constraint assinatura_ciclo_valido check (ciclo in ('mensal', 'anual')),
  constraint assinatura_adicionais_lista check (jsonb_typeof(adicionais) = 'array' and jsonb_array_length(adicionais) <= 3),
  constraint assinatura_paga_ou_teste check (paga or teste_ate is not null)
);
create unique index assinatura_tenant_uk on plataforma.assinatura (tenant_id) where deleted_at is null;
create index assinatura_plano_ix on plataforma.assinatura (plano_id);
create trigger assinatura_updated_at before update on plataforma.assinatura
  for each row execute function plataforma.definir_updated_at();
alter table plataforma.assinatura enable row level security;
alter table plataforma.assinatura force row level security;
create policy isolamento_tenant on plataforma.assinatura for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
create policy manutencao on plataforma.assinatura for all to macuxi_manutencao using (true) with check (true);
revoke all on plataforma.assinatura from public, macuxi_app, macuxi_worker;
grant select on plataforma.assinatura to macuxi_app;

-- 3. sa_gravar_assinatura (portal, só super-admin) ---------------------------------------------------------------------------
create function plataforma.sa_gravar_assinatura(p_sid uuid, p_tenant uuid, p jsonb)
  returns jsonb
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_tipo text;
  v_sa uuid;
  v_codigo text;
  v_ciclo text;
  v_teste date;
  v_paga boolean;
  v_pedido uuid;
  v_plano record;
  v_a jsonb;
  v_vistos text[] := '{}';
  v_vendidos text[];
  v_existente record;
  v_resultado text;
begin
  select v.tipo, v.super_admin_id into v_tipo, v_sa from plataforma.sa_sessao_valida(p_sid) v;
  if v_tipo is null then
    raise exception 'sa_gravar_assinatura: sessão do portal inválida' using errcode = '28000';
  end if;
  if v_tipo is distinct from 'super_admin' or v_sa is null then
    raise exception 'sa_gravar_assinatura: só o super-admin' using errcode = '42501';
  end if;

  -- entrada (a API confere pelo contrato; o banco revalida): só as chaves da EntradaAssinatura
  if p_tenant is null then
    raise exception 'sa_gravar_assinatura: tenant obrigatório' using errcode = '22023';
  end if;
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'sa_gravar_assinatura: a entrada deve ser um objeto JSON' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_object_keys(p) k where k not in ('plano', 'ciclo', 'adicionais', 'teste_ate', 'paga', 'pedido_id')) then
    raise exception 'sa_gravar_assinatura: chave fora do contrato' using errcode = '22023';
  end if;
  if jsonb_typeof(p -> 'plano') is distinct from 'string' or (p ->> 'plano') !~ '^[a-z][a-z0-9_]{1,29}$' then
    raise exception 'sa_gravar_assinatura: plano inválido (código do plano)' using errcode = '22023';
  end if;
  v_codigo := p ->> 'plano';
  if jsonb_typeof(p -> 'ciclo') is distinct from 'string' or (p ->> 'ciclo') not in ('mensal', 'anual') then
    raise exception 'sa_gravar_assinatura: ciclo deve ser mensal ou anual' using errcode = '22023';
  end if;
  v_ciclo := p ->> 'ciclo';
  if jsonb_typeof(p -> 'paga') is distinct from 'boolean' then
    raise exception 'sa_gravar_assinatura: paga deve ser booleano' using errcode = '22023';
  end if;
  v_paga := (p ->> 'paga')::boolean;
  if jsonb_typeof(p -> 'pedido_id') is distinct from 'string'
     or (p ->> 'pedido_id') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    raise exception 'sa_gravar_assinatura: pedido_id deve ser UUID' using errcode = '22023';
  end if;
  v_pedido := (p ->> 'pedido_id')::uuid;
  if coalesce(jsonb_typeof(p -> 'teste_ate'), 'null') <> 'null' then
    if jsonb_typeof(p -> 'teste_ate') <> 'string' or (p ->> 'teste_ate') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception 'sa_gravar_assinatura: teste_ate deve ser AAAA-MM-DD' using errcode = '22023';
    end if;
    begin
      v_teste := to_date(p ->> 'teste_ate', 'YYYY-MM-DD');
    exception when others then
      raise exception 'sa_gravar_assinatura: teste_ate deve ser AAAA-MM-DD' using errcode = '22023';
    end;
    if to_char(v_teste, 'YYYY-MM-DD') <> (p ->> 'teste_ate') then
      raise exception 'sa_gravar_assinatura: teste_ate deve ser uma data válida' using errcode = '22023';
    end if;
  end if;
  if not v_paga and v_teste is null then
    raise exception 'sa_gravar_assinatura: sem teste, a assinatura nasce paga' using errcode = '22023';
  end if;
  if coalesce(jsonb_typeof(p -> 'adicionais'), 'null') <> 'array' or jsonb_array_length(p -> 'adicionais') > 3 then
    raise exception 'sa_gravar_assinatura: adicionais deve ser uma lista de até 3' using errcode = '22023';
  end if;
  for v_a in select x.value from jsonb_array_elements(p -> 'adicionais') x loop
    if jsonb_typeof(v_a) <> 'object'
       or exists (select 1 from jsonb_object_keys(v_a) k where k not in ('adicional', 'quantidade'))
       or coalesce(v_a ->> 'adicional', '') not in ('promotor', 'pesquisa', 'treinamento')
       or jsonb_typeof(v_a -> 'quantidade') is distinct from 'number'
       or (v_a ->> 'quantidade') !~ '^[0-9]{1,6}$'
       or (v_a ->> 'quantidade')::integer not between 1 and 100000 then
      raise exception 'sa_gravar_assinatura: adicional inválido ({ adicional: promotor | pesquisa | treinamento, quantidade: 1..100000 })'
        using errcode = '22023';
    end if;
    if (v_a ->> 'adicional') = any (v_vistos) then
      raise exception 'sa_gravar_assinatura: adicional repetido: %', v_a ->> 'adicional' using errcode = '22023';
    end if;
    v_vistos := v_vistos || (v_a ->> 'adicional');
  end loop;

  -- tenant vivo; gravações do mesmo tenant em fila (a 2ª vê a 1ª)
  perform pg_advisory_xact_lock(hashtextextended('plataforma.assinatura:' || p_tenant::text, 0));
  if not exists (select 1 from plataforma.tenant t where t.id = p_tenant and t.deleted_at is null) then
    raise exception 'sa_gravar_assinatura: empresa não encontrada' using errcode = 'P0002';
  end if;

  -- idempotente: uma assinatura viva por tenant; a que existe não muda (a troca é pela sa_trocar_plano)
  select a.id, a.teste_ate into v_existente
    from plataforma.assinatura a
   where a.tenant_id = p_tenant and a.deleted_at is null;
  if found then
    v_resultado := 'existente';
    perform plataforma.sa_registrar_auditoria('super_admin', v_sa, null, p_sid, p_tenant, 'sa.assinatura.gravar',
      jsonb_build_object('plano', v_codigo, 'ciclo', v_ciclo, 'com_teste', v_teste is not null, 'resultado', v_resultado));
    return jsonb_build_object('resultado', v_resultado, 'teste_ate', to_char(v_existente.teste_ate, 'YYYY-MM-DD'));
  end if;

  -- plano do catálogo (RN-PLA-01): vivo, ativo e vende cada adicional pedido
  select pl.id, pl.ativo, pl.adicionais into v_plano
    from plataforma.plano pl
   where pl.codigo = v_codigo and pl.deleted_at is null;
  if not found then
    raise exception 'sa_gravar_assinatura: plano não encontrado no catálogo' using errcode = '22023', hint = 'PLANO_DESCONHECIDO';
  end if;
  if not v_plano.ativo then
    raise exception 'sa_gravar_assinatura: o plano não está mais à venda' using errcode = '22023', hint = 'PLANO_INATIVO';
  end if;
  select coalesce(array_agg(x.value ->> 'adicional'), '{}') into v_vendidos
    from jsonb_array_elements(v_plano.adicionais) x;
  if not (v_vistos <@ v_vendidos) then
    raise exception 'sa_gravar_assinatura: o plano não vende um dos adicionais pedidos' using errcode = '22023', hint = 'ADICIONAL_FORA_DO_PLANO';
  end if;

  insert into plataforma.assinatura (tenant_id, plano_id, ciclo, adicionais, teste_ate, paga, pedido_id)
  values (p_tenant, v_plano.id, v_ciclo, p -> 'adicionais', v_teste, v_paga, v_pedido);
  v_resultado := 'criada';
  perform plataforma.sa_registrar_auditoria('super_admin', v_sa, null, p_sid, p_tenant, 'sa.assinatura.gravar',
    jsonb_build_object('plano', v_codigo, 'ciclo', v_ciclo, 'com_teste', v_teste is not null, 'resultado', v_resultado));
  return jsonb_build_object('resultado', v_resultado, 'teste_ate', to_char(v_teste, 'YYYY-MM-DD'));
end
$$;
revoke all on function plataforma.sa_gravar_assinatura(uuid, uuid, jsonb) from public, macuxi_app, macuxi_worker;
grant execute on function plataforma.sa_gravar_assinatura(uuid, uuid, jsonb) to macuxi_portal;

-- Conferência pelo catálogo (a da 0058, agora com 17 sa_* do portal; aborta com 42501 e nada muda) ---------------------------
do $$
declare
  v_f text;
  v_n int;
begin
  select string_agg(p.oid::regprocedure::text, ', ' order by 1) into v_f
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'plataforma' and (p.proname like 'sa\_%' or p.proname = 'criar_super_admin')
     and (has_function_privilege('macuxi_app', p.oid, 'execute') or has_function_privilege('macuxi_worker', p.oid, 'execute')
          or exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                      where a.grantee = 0 and a.privilege_type = 'EXECUTE'));
  if v_f is not null then
    raise exception '0070: função executável pelo macuxi_app, macuxi_worker ou PUBLIC: %', v_f using errcode = '42501';
  end if;
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'plataforma' and p.proname like 'sa\_%' and has_function_privilege('macuxi_portal', p.oid, 'execute');
  if v_n <> 17 then
    raise exception '0070: esperadas 17 funções sa_* executáveis pelo macuxi_portal, há %', v_n using errcode = '42501';
  end if;
end
$$;
