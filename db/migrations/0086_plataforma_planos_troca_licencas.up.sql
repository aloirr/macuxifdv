-- 0086_plataforma_planos_troca_licencas (up) — planos e licenças, parte do banco das telas 2 a 6 do portal config.: catálogo,
-- ficha da empresa, troca de plano e a trava do cadastro de usuários (ADR 0047 §3 a §6 e §8, revista pela ADR 0049: um perfil
-- por usuário, sem multiperfil; desenho docs/desenho/planos-e-licencas.md §3; spec docs/design/telas/portal-config-enxuto.md
-- §11.3 e §11.4; decisão R-20261115-123000, item 1). Contrato: packages/platform-sdk/src/planos.ts (ListaPlanosSchema,
-- FichaAssinaturaSchema, TrocarPlanoSchema, UsoDeLicencaSchema) e apps/api/src/planos-portal.ts (fontePlanosNoBanco).
-- Dicionário: docs/banco/plataforma.md ("Troca de plano e licenças (0086)"). Teste: db/testes/planos-troca-licencas.db.test.ts
-- (estático na sessão; banco, corrida e up/down no CI). Migração ADITIVA em cima da 0085: nada existente muda de forma.
--
-- 1. plataforma.assinatura_historico — uma linha por troca de plano (RN-PLA-05): antes e depois (plano, ciclo, adicionais), os
--    módulos que a troca ligou, o super-admin e o pedido_id do portal (idempotência: único por tenant). Colunas padrão; RLS
--    ligado e forçado (isolamento_tenant: o macuxi_app só LÊ as do próprio tenant; manutencao; leitura: o macuxi_leitura, da
--    0078, lê as do próprio tenant). Escrita só pela sa_trocar_plano.
--    Fora do sync. Volume: poucas linhas por tenant.
-- 2. plataforma.plano — o macuxi_app passa a LER só a linha do plano da assinatura viva do próprio tenant (política
--    isolamento_tenant com o id do plano da assinatura; grant select). É o que deixa a licencas_do_tenant() ser SECURITY
--    INVOKER sob RLS. Escrita continua só pelas funções do dono. Sai de TABELAS_SO_POR_FUNCAO (db/src/excecoes.ts).
-- 3. plataforma.assinatura — o macuxi_app ganha UPDATE só na coluna updated_at, que é o privilégio que o Postgres exige para o
--    "select ... for no key update" da licencas_do_tenant(); o gatilho assinatura_so_trava recusa (42501) todo UPDATE feito
--    por quem tem os privilégios do macuxi_app (o próprio ou papel que o herda; nunca o dono da tabela, que roda as sa_* DEFINER,
--    nem superusuário). Travar a linha não dispara gatilho. Nada mais muda na tabela.
-- 4. Funções de apoio (SECURITY INVOKER, search_path fixo com pg_temp no fim, sem EXECUTE para PUBLIC):
--    - plataforma.plano_json(plano) -> jsonb: o PlanoSchema do SDK (licencas em objeto). Só o dono (dentro das sa_*).
--    - plataforma.contratadas_do_plano(plano, adicionais jsonb) -> (item, contratadas): gêmea de licencasContratadas do SDK
--      (RN-PLA-01): vendedor, gestor e bko = as do plano; promotor = plano + adicional; pesquisa e treinamento = incluídos no
--      plano + adicional, 0 se o plano não vende nem tem o módulo, sem limite (null) se tem o módulo sem vender. Os 6 itens na
--      ordem de ITENS_CONTADOS. IMMUTABLE. EXECUTE ao macuxi_app (dentro da licencas_do_tenant) e ao dono.
--    - plataforma.licencas_em_uso(p_tenant) -> (item, em_uso): RN-PLA-02 e RN-PLA-03 com a ADR 0049. Conta o usuário ATIVO e
--      não excluído (o bloqueado continua contando) pela BASE do seu perfil vivo e ativo (um só por usuário, usuario_perfil_um_vivo):
--      vendedor; promotor; supervisor e gerente = gestor; analista, assistente e admin = bko. Pesquisa e Treinamento: usuário
--      ativo com o módulo efetivo (perfil_modulo do perfil ∩ tenant_modulo ativo − exceção 'remover' do usuário), de qualquer
--      tipo. Sem prioridade de multiperfil. STABLE. Sob RLS para o macuxi_app (outro tenant = zeros); o dono passa o tenant.
--    - plataforma.situacao_das_licencas(plano, adicionais jsonb, p_tenant) -> (item, contratadas, em_uso, n): a junção das duas,
--      na ordem de contratadas_do_plano (n = posição). A trava e as sa_* leem daqui. STABLE. EXECUTE ao macuxi_app e ao dono.
-- 5. plataforma.licencas_do_tenant() -> (item, contratadas, em_uso, teste_ate 'AAAA-MM-DD' | null, paga): a situação que o
--    cadastro de usuários do Core lê na MESMA transação do insert ou update (RN-PLA-04; conferirNovoUsuario + usoPorItem do SDK).
--    SECURITY INVOKER, sob RLS do tenant corrente (app.tenant_id). Primeiro trava a assinatura viva (for no key update, comando
--    próprio: conflita consigo mesmo, com o for update da sa_trocar_plano e com todo UPDATE da linha, e não segura o for key
--    share das FKs que apontam para a assinatura);
--    depois conta (comando seguinte, com foto nova): dois cadastros simultâneos ficam em fila e o segundo já vê o primeiro. Exige
--    READ COMMITTED (o padrão). Sem assinatura (legado) ou sem contexto = nenhuma linha (sem trava). EXECUTE só ao macuxi_app.
-- 6. Funções do portal (SECURITY DEFINER, sessão conferida a cada chamada; SQLSTATE 28000 sessão, 42501 permissão, P0002 não
--    achou, 22023 validação com o código no hint). EXECUTE só ao macuxi_portal; o portal passa de N para N + 3 sa_* (conferido
--    abaixo pela diferença, porque as 0075 a 0085 de outros lotes também acrescentam sa_*):
--    - sa_listar_planos(p_sid) -> { itens: Plano[] }: todos os planos vivos, ativos e inativos, por ordem e código. Super-admin
--      e admin do cliente. Sem auditoria (leitura do catálogo; a API audita a requisição).
--    - sa_assinatura_da_empresa(p_sid, p_tenant) -> a ficha sem o valor (FichaAssinaturaSchema sem `valor`; a API calcula):
--      { tenant_id, plano, ciclo, adicionais, teste_ate, paga, desde, atualizada_em, licencas: 6 × { item, contratadas, em_uso } }.
--      Super-admin: qualquer empresa; admin do cliente: só a empresa escolhida na sessão (outra = 42501, antes de saber se existe).
--      Empresa sem assinatura (ou que não existe) = P0002.
--    - sa_trocar_plano(p_sid, p_tenant, p jsonb) -> { resultado: 'trocada' | 'existente', modulos_ligados }: só super-admin.
--      p = EntradaTrocaDePlano da API { plano, ciclo, adicionais, pedido_id, modulos }; chave fora ou formato errado = 22023;
--      modulos diferentes dos do plano (core e integracao + os do plano + os adicionais) = 22023 MODULOS_FORA_DO_PLANO. Em fila
--      por tenant (a mesma trava consultiva da sa_gravar_assinatura) e com a assinatura em for update (a mesma linha que a trava
--      do cadastro trava). IDEMPOTENTE por pedido_id: pedido já gravado devolve 'existente' e nada muda. Depois confere o plano
--      (PLANO_DESCONHECIDO, PLANO_INATIVO, ADICIONAL_FORA_DO_PLANO) e o uso, item a item (RN-PLA-05: abaixo do uso = 22023
--      PLANO_ABAIXO_DO_USO, nada muda e nenhum usuário é desativado). Grava a assinatura (plano, ciclo, adicionais; teste_ate e
--      paga não mudam), LIGA no tenant_modulo os módulos do plano (insere o que falta e religa o desligado) e NUNCA desliga
--      módulo: desligar é do BKO de licenças (RN-CORE-02, retenção de 90 dias), que confere quem usa. Grava o histórico e
--      audita sa.assinatura.trocar (códigos dos planos, ciclo, resultado; sem dado pessoal).
-- 7. Seed do catálogo (dado da plataforma, vale em todo ambiente, inclusive produção; por isso vai na migração, como as frases e
--    os perfis de fábrica, e não em db/seeds, que só a demo e a Fase M rodam): os 4 planos da tabela do §11.3 da spec (números
--    da ponte de 14/11, R-20261114-132600-alexandre, item 1): Light, PME, Enterprise e Corporate, ids fixos 00830000-...-00000000000N.
--    Preço mensal em centavos e licenças vendedor, gestor e bko; promotor 0; módulos core, catalogo, vendedor, gestor e
--    integracao; adicionais Promotor 8000, Pesquisa 1000 e Treinamento 1000 centavos, todos com incluidos 0; 2 meses grátis
--    no anual e 14 dias de teste. Código já vivo no catálogo não é sobrescrito (on conflict do nothing).
--
-- Caminho de volta: 0086_plataforma_planos_troca_licencas.down.sql (apaga as 3 sa_*, a licencas_do_tenant e as de apoio, o
-- gatilho e os grants novos, o histórico de trocas e os 4 planos do seed que nenhuma assinatura usa; as assinaturas, as trocas
-- já aplicadas e os módulos ligados ficam). Antes do down: desligue MACUXI_PLANOS na API e volte o Core sem a trava
-- (licencas_do_tenant some).

-- 0. Quantas sa_* o portal executa antes desta migração (a conferência do fim exige exatamente mais 3) --------------------------
select set_config('macuxi.sa_portal_antes_0086', (
  select count(*)::text
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'plataforma' and p.proname like 'sa\_%' and has_function_privilege('macuxi_portal', p.oid, 'execute')
), true);

-- 1. plataforma.assinatura_historico -----------------------------------------------------------------------------------------
-- alvo da FK composta (tenant_id, assinatura_id): a linha do histórico nunca aponta para a assinatura de outro tenant
alter table plataforma.assinatura add constraint assinatura_tenant_id_uk unique (tenant_id, id);
create table plataforma.assinatura_historico (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references plataforma.tenant (id),
  assinatura_id          uuid not null,
  pedido_id              uuid not null,
  plano_anterior_id      uuid not null references plataforma.plano (id),
  plano_id               uuid not null references plataforma.plano (id),
  ciclo_anterior         text not null,
  ciclo                  text not null,
  adicionais_anteriores  jsonb not null default '[]'::jsonb,
  adicionais             jsonb not null default '[]'::jsonb,
  modulos_ligados        text[] not null default '{}',
  super_admin_id         uuid,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  deleted_at             timestamptz,
  external_id            text,
  constraint assinatura_historico_assinatura_fk foreign key (tenant_id, assinatura_id) references plataforma.assinatura (tenant_id, id),
  constraint assinatura_historico_ciclos_validos check (ciclo_anterior in ('mensal', 'anual') and ciclo in ('mensal', 'anual')),
  constraint assinatura_historico_adicionais_lista check (
    jsonb_typeof(adicionais_anteriores) = 'array' and jsonb_array_length(adicionais_anteriores) <= 3
    and jsonb_typeof(adicionais) = 'array' and jsonb_array_length(adicionais) <= 3
  ),
  constraint assinatura_historico_modulos_validos check (
    modulos_ligados <@ array['core', 'catalogo', 'vendedor', 'promotor', 'gestor', 'pesquisa', 'treinamento', 'integracao']::text[]
  )
);
create unique index assinatura_historico_pedido_uk on plataforma.assinatura_historico (tenant_id, pedido_id);
create index assinatura_historico_assinatura_ix on plataforma.assinatura_historico (tenant_id, assinatura_id, created_at);
create trigger assinatura_historico_updated_at before update on plataforma.assinatura_historico
  for each row execute function plataforma.definir_updated_at();
alter table plataforma.assinatura_historico enable row level security;
alter table plataforma.assinatura_historico force row level security;
create policy isolamento_tenant on plataforma.assinatura_historico for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
create policy manutencao on plataforma.assinatura_historico for all to macuxi_manutencao using (true) with check (true);
revoke all on plataforma.assinatura_historico from public, macuxi_app, macuxi_worker;
grant select on plataforma.assinatura_historico to macuxi_app;
-- consulta só leitura (0078, ADR 0055): sem coluna sensível, SELECT na tabela e a política leitura do próprio tenant
grant select on plataforma.assinatura_historico to macuxi_leitura;
create policy leitura on plataforma.assinatura_historico for select to macuxi_leitura using (tenant_id = plataforma.tenant_atual());

-- 2. plataforma.plano: o app lê só o plano da assinatura viva do próprio tenant ----------------------------------------------
create policy isolamento_tenant on plataforma.plano for select to macuxi_app
  using (id in (select a.plano_id from plataforma.assinatura a where a.tenant_id = plataforma.tenant_atual() and a.deleted_at is null));
grant select on plataforma.plano to macuxi_app;

-- 3. plataforma.assinatura: o app só trava a linha (for no key update), nunca grava -----------------------------------------
grant update (updated_at) on plataforma.assinatura to macuxi_app;
create function plataforma.assinatura_so_trava()
  returns trigger
  language plpgsql
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
begin
  -- 'usage' = tem os privilégios do macuxi_app (ele mesmo ou papel que o herda). Não 'member': o admin é membro com SET e sem
  -- INHERIT (db/src/papeis.ts) e é o dono que roda as sa_* DEFINER. O dono da tabela (e o superusuário) nunca é recusado.
  if pg_has_role(current_user, 'macuxi_app', 'usage')
     and not pg_has_role(current_user, (select c.relowner from pg_catalog.pg_class c where c.oid = tg_relid), 'usage') then
    raise exception 'plataforma.assinatura: o app só trava a linha (licencas_do_tenant); quem grava é o portal' using errcode = '42501';
  end if;
  return new;
end
$$;
revoke all on function plataforma.assinatura_so_trava() from public;
create trigger assinatura_so_trava before update on plataforma.assinatura
  for each row execute function plataforma.assinatura_so_trava();

-- 4. Funções de apoio ----------------------------------------------------------------------------------------------------------
create function plataforma.plano_json(p plataforma.plano)
  returns jsonb
  language sql immutable
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
    select jsonb_build_object(
      'id', p.id, 'codigo', p.codigo, 'nome', p.nome, 'ordem', p.ordem, 'preco_mensal_centavos', p.preco_mensal_centavos,
      'licencas', jsonb_build_object('vendedor', p.licenca_vendedor, 'gestor', p.licenca_gestor, 'bko', p.licenca_bko,
                                     'promotor', p.licenca_promotor),
      'modulos', to_jsonb(p.modulos), 'adicionais', p.adicionais,
      'meses_gratis_anual', p.meses_gratis_anual, 'dias_teste', p.dias_teste, 'ativo', p.ativo)
  $$;
revoke all on function plataforma.plano_json(plataforma.plano) from public, macuxi_app, macuxi_worker, macuxi_portal;

create function plataforma.contratadas_do_plano(p_plano plataforma.plano, p_adicionais jsonb)
  returns table (item text, contratadas integer)
  language sql immutable
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
    with pedidos as (
      select x.value ->> 'adicional' as adicional, sum((x.value ->> 'quantidade')::integer)::integer as quantidade
        from jsonb_array_elements(coalesce(p_adicionais, '[]'::jsonb)) x
       group by 1
    ),
    vendidos as (
      select x.value ->> 'adicional' as adicional,
             case when jsonb_typeof(x.value -> 'incluidos') = 'number' then (x.value ->> 'incluidos')::integer
                  when x.value ? 'incluidos' then null
                  else 0 end as incluidos
        from jsonb_array_elements(coalesce(p_plano.adicionais, '[]'::jsonb)) x
    ),
    por_usuario (adicional, limite) as (
      select m.adicional,
             case when exists (select 1 from vendidos v where v.adicional = m.adicional)
                    then (select v.incluidos from vendidos v where v.adicional = m.adicional limit 1)
                  when m.adicional = any (p_plano.modulos) then null
                  else 0 end
        from unnest(array['pesquisa', 'treinamento']) as m (adicional)
    ),
    base (n, item, limite) as (
      values (1, 'vendedor', p_plano.licenca_vendedor),
             (2, 'gestor', p_plano.licenca_gestor),
             (3, 'bko', p_plano.licenca_bko),
             (4, 'promotor', p_plano.licenca_promotor),
             (5, 'pesquisa', (select pu.limite from por_usuario pu where pu.adicional = 'pesquisa')),
             (6, 'treinamento', (select pu.limite from por_usuario pu where pu.adicional = 'treinamento'))
    )
    select b.item, (b.limite + coalesce((select pe.quantidade from pedidos pe where pe.adicional = b.item and b.n >= 4), 0))::integer
      from base b
     order by b.n
  $$;
revoke all on function plataforma.contratadas_do_plano(plataforma.plano, jsonb) from public, macuxi_worker, macuxi_portal;
grant execute on function plataforma.contratadas_do_plano(plataforma.plano, jsonb) to macuxi_app;

create function plataforma.licencas_em_uso(p_tenant uuid)
  returns table (item text, em_uso integer)
  language sql stable
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
    with ativos as (
      select u.id as usuario_id, pf.base, pf.codigo
        from core.usuario u
        join plataforma.usuario_perfil up on up.tenant_id = u.tenant_id and up.usuario_id = u.id and up.deleted_at is null
        join plataforma.perfil pf on pf.tenant_id = up.tenant_id and pf.id = up.perfil_id and pf.deleted_at is null and pf.ativo
       where u.tenant_id = p_tenant and u.ativo and u.deleted_at is null
    ),
    ocupa (usuario_id, item) as (
      select a.usuario_id,
             case a.base when 'vendedor' then 'vendedor' when 'promotor' then 'promotor'
                         when 'supervisor' then 'gestor' when 'gerente' then 'gestor'
                         when 'analista' then 'bko' when 'assistente' then 'bko' when 'admin' then 'bko' end
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
revoke all on function plataforma.licencas_em_uso(uuid) from public, macuxi_worker, macuxi_portal;
grant execute on function plataforma.licencas_em_uso(uuid) to macuxi_app;

-- contratadas × em uso, item a item, na ordem de contratadas_do_plano (vendedor, gestor, bko, promotor, pesquisa, treinamento):
-- a única junção das duas; a trava e as sa_* leem daqui (n = a posição, para o order by de quem agrega)
create function plataforma.situacao_das_licencas(p_plano plataforma.plano, p_adicionais jsonb, p_tenant uuid)
  returns table (item text, contratadas integer, em_uso integer, n bigint)
  language sql stable
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
    select c.item, c.contratadas, u.em_uso, c.n
      from plataforma.contratadas_do_plano(p_plano, p_adicionais) with ordinality as c (item, contratadas, n)
      join plataforma.licencas_em_uso(p_tenant) u on u.item = c.item
     order by c.n
  $$;
revoke all on function plataforma.situacao_das_licencas(plataforma.plano, jsonb, uuid) from public, macuxi_worker, macuxi_portal;
grant execute on function plataforma.situacao_das_licencas(plataforma.plano, jsonb, uuid) to macuxi_app;

-- 5. licencas_do_tenant (a trava do cadastro de usuários; SECURITY INVOKER, sob RLS) ---------------------------------------
create function plataforma.licencas_do_tenant()
  returns table (item text, contratadas integer, em_uso integer, teste_ate text, paga boolean)
  language plpgsql volatile security invoker
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_a record;
begin
  -- 1º comando: trava a assinatura viva do tenant corrente (a RLS limita ao app.tenant_id)
  select a.id, a.tenant_id, a.plano_id, a.adicionais, a.teste_ate, a.paga into v_a
    from plataforma.assinatura a
   where a.tenant_id = plataforma.tenant_atual() and a.deleted_at is null
   for no key update;
  if not found then
    return;
  end if;
  -- 2º comando (foto nova): conta já vendo o que a transação que segurava a trava gravou
  return query
    select l.item, l.contratadas, l.em_uso, to_char(v_a.teste_ate, 'YYYY-MM-DD'), v_a.paga
      from plataforma.plano pl
      cross join lateral plataforma.situacao_das_licencas(pl, v_a.adicionais, v_a.tenant_id) l
     where pl.id = v_a.plano_id
     order by l.n;
end
$$;
revoke all on function plataforma.licencas_do_tenant() from public, macuxi_worker, macuxi_portal;
grant execute on function plataforma.licencas_do_tenant() to macuxi_app;

-- 6. Funções do portal ---------------------------------------------------------------------------------------------------------
create function plataforma.sa_listar_planos(p_sid uuid)
  returns jsonb
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_tipo text;
begin
  select v.tipo into v_tipo from plataforma.sa_sessao_valida(p_sid) v;
  if v_tipo is null then
    raise exception 'sa_listar_planos: sessão do portal inválida' using errcode = '28000';
  end if;
  return jsonb_build_object('itens', coalesce((
    select jsonb_agg(plataforma.plano_json(pl) order by pl.ordem, pl.codigo)
      from plataforma.plano pl
     where pl.deleted_at is null
  ), '[]'::jsonb));
end
$$;
revoke all on function plataforma.sa_listar_planos(uuid) from public, macuxi_app, macuxi_worker;
grant execute on function plataforma.sa_listar_planos(uuid) to macuxi_portal;

create function plataforma.sa_assinatura_da_empresa(p_sid uuid, p_tenant uuid)
  returns jsonb
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_tipo text;
  v_sa uuid;
  v_t uuid;
  v_a record;
  v_pl plataforma.plano;
  v_lic jsonb;
begin
  select v.tipo, v.super_admin_id, v.tenant_id into v_tipo, v_sa, v_t from plataforma.sa_sessao_valida(p_sid) v;
  if v_tipo is null then
    raise exception 'sa_assinatura_da_empresa: sessão do portal inválida' using errcode = '28000';
  end if;
  if p_tenant is null then
    raise exception 'sa_assinatura_da_empresa: tenant obrigatório' using errcode = '22023';
  end if;
  -- super-admin: qualquer empresa; admin do cliente: só a escolhida na sessão (antes de dizer se a outra existe)
  if not ((v_tipo = 'super_admin' and v_sa is not null) or (v_tipo = 'admin_cliente' and v_t is not null and v_t = p_tenant)) then
    raise exception 'sa_assinatura_da_empresa: só a empresa da sessão' using errcode = '42501';
  end if;

  select a.tenant_id, a.plano_id, a.ciclo, a.adicionais, a.teste_ate, a.paga, a.created_at, a.updated_at into v_a
    from plataforma.assinatura a
    join plataforma.tenant t on t.id = a.tenant_id and t.deleted_at is null
   where a.tenant_id = p_tenant and a.deleted_at is null;
  if not found then
    raise exception 'sa_assinatura_da_empresa: a empresa não tem assinatura' using errcode = 'P0002';
  end if;
  select pl.* into v_pl from plataforma.plano pl where pl.id = v_a.plano_id;

  select jsonb_agg(jsonb_build_object('item', l.item, 'contratadas', l.contratadas, 'em_uso', l.em_uso) order by l.n)
    into v_lic
    from plataforma.situacao_das_licencas(v_pl, v_a.adicionais, p_tenant) l;

  return jsonb_build_object(
    'tenant_id', p_tenant,
    'plano', plataforma.plano_json(v_pl),
    'ciclo', v_a.ciclo,
    'adicionais', v_a.adicionais,
    'teste_ate', to_char(v_a.teste_ate, 'YYYY-MM-DD'),
    'paga', v_a.paga,
    'desde', to_char(v_a.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'atualizada_em', to_char(v_a.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'licencas', v_lic
  );
end
$$;
revoke all on function plataforma.sa_assinatura_da_empresa(uuid, uuid) from public, macuxi_app, macuxi_worker;
grant execute on function plataforma.sa_assinatura_da_empresa(uuid, uuid) to macuxi_portal;

create function plataforma.sa_trocar_plano(p_sid uuid, p_tenant uuid, p jsonb)
  returns jsonb
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_tipo text;
  v_sa uuid;
  v_codigo text;
  v_ciclo text;
  v_pedido uuid;
  v_a jsonb;
  v_vistos text[] := '{}';
  v_pedidos_mod text[] := '{}';
  v_vendidos text[];
  v_atual record;
  v_novo plataforma.plano;
  v_anterior text;
  v_mods text[];
  v_m text;
  v_n int;
  v_ligados text[] := '{}';
  v_problemas text;
begin
  select v.tipo, v.super_admin_id into v_tipo, v_sa from plataforma.sa_sessao_valida(p_sid) v;
  if v_tipo is null then
    raise exception 'sa_trocar_plano: sessão do portal inválida' using errcode = '28000';
  end if;
  if v_tipo is distinct from 'super_admin' or v_sa is null then
    raise exception 'sa_trocar_plano: só o super-admin' using errcode = '42501';
  end if;

  -- entrada (a API confere pelo contrato; o banco revalida): só as chaves da EntradaTrocaDePlano
  if p_tenant is null then
    raise exception 'sa_trocar_plano: tenant obrigatório' using errcode = '22023';
  end if;
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'sa_trocar_plano: a entrada deve ser um objeto JSON' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_object_keys(p) k where k not in ('plano', 'ciclo', 'adicionais', 'pedido_id', 'modulos')) then
    raise exception 'sa_trocar_plano: chave fora do contrato' using errcode = '22023';
  end if;
  if jsonb_typeof(p -> 'plano') is distinct from 'string' or (p ->> 'plano') !~ '^[a-z][a-z0-9_]{1,29}$' then
    raise exception 'sa_trocar_plano: plano inválido (código do plano)' using errcode = '22023';
  end if;
  v_codigo := p ->> 'plano';
  if jsonb_typeof(p -> 'ciclo') is distinct from 'string' or (p ->> 'ciclo') not in ('mensal', 'anual') then
    raise exception 'sa_trocar_plano: ciclo deve ser mensal ou anual' using errcode = '22023';
  end if;
  v_ciclo := p ->> 'ciclo';
  if jsonb_typeof(p -> 'pedido_id') is distinct from 'string'
     or (p ->> 'pedido_id') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    raise exception 'sa_trocar_plano: pedido_id deve ser UUID' using errcode = '22023';
  end if;
  v_pedido := (p ->> 'pedido_id')::uuid;
  if coalesce(jsonb_typeof(p -> 'adicionais'), 'null') <> 'array' or jsonb_array_length(p -> 'adicionais') > 3 then
    raise exception 'sa_trocar_plano: adicionais deve ser uma lista de até 3' using errcode = '22023';
  end if;
  for v_a in select x.value from jsonb_array_elements(p -> 'adicionais') x loop
    if jsonb_typeof(v_a) <> 'object'
       or exists (select 1 from jsonb_object_keys(v_a) k where k not in ('adicional', 'quantidade'))
       or coalesce(v_a ->> 'adicional', '') not in ('promotor', 'pesquisa', 'treinamento')
       or jsonb_typeof(v_a -> 'quantidade') is distinct from 'number'
       or (v_a ->> 'quantidade') !~ '^[0-9]{1,6}$'
       or (v_a ->> 'quantidade')::integer not between 1 and 100000 then
      raise exception 'sa_trocar_plano: adicional inválido ({ adicional: promotor | pesquisa | treinamento, quantidade: 1..100000 })'
        using errcode = '22023';
    end if;
    if (v_a ->> 'adicional') = any (v_vistos) then
      raise exception 'sa_trocar_plano: adicional repetido: %', v_a ->> 'adicional' using errcode = '22023';
    end if;
    v_vistos := v_vistos || (v_a ->> 'adicional');
  end loop;
  if coalesce(jsonb_typeof(p -> 'modulos'), 'null') <> 'array' or jsonb_array_length(p -> 'modulos') > 8 then
    raise exception 'sa_trocar_plano: modulos deve ser uma lista de até 8' using errcode = '22023';
  end if;
  for v_a in select x.value from jsonb_array_elements(p -> 'modulos') x loop
    if jsonb_typeof(v_a) <> 'string'
       or (v_a #>> '{}') not in ('core', 'catalogo', 'vendedor', 'promotor', 'gestor', 'pesquisa', 'treinamento', 'integracao') then
      raise exception 'sa_trocar_plano: módulo fora do contrato' using errcode = '22023';
    end if;
    if (v_a #>> '{}') = any (v_pedidos_mod) then
      raise exception 'sa_trocar_plano: módulo repetido: %', v_a #>> '{}' using errcode = '22023';
    end if;
    v_pedidos_mod := v_pedidos_mod || (v_a #>> '{}');
  end loop;

  -- em fila por tenant (a mesma chave da sa_gravar_assinatura) e a assinatura travada (a mesma linha da trava do cadastro)
  perform pg_advisory_xact_lock(hashtextextended('plataforma.assinatura:' || p_tenant::text, 0));
  if not exists (select 1 from plataforma.tenant t where t.id = p_tenant and t.deleted_at is null) then
    raise exception 'sa_trocar_plano: empresa não encontrada' using errcode = 'P0002';
  end if;
  select a.id, a.plano_id, a.ciclo, a.adicionais into v_atual
    from plataforma.assinatura a
   where a.tenant_id = p_tenant and a.deleted_at is null
   for update;
  if not found then
    raise exception 'sa_trocar_plano: a empresa não tem assinatura' using errcode = 'P0002';
  end if;
  select pl.codigo into v_anterior from plataforma.plano pl where pl.id = v_atual.plano_id;

  -- idempotente por pedido_id: o pedido já gravado não muda nada
  if exists (select 1 from plataforma.assinatura_historico h where h.tenant_id = p_tenant and h.pedido_id = v_pedido) then
    perform plataforma.sa_registrar_auditoria('super_admin', v_sa, null, p_sid, p_tenant, 'sa.assinatura.trocar',
      jsonb_build_object('plano', v_codigo, 'plano_anterior', v_anterior, 'ciclo', v_ciclo, 'resultado', 'existente'));
    return jsonb_build_object('resultado', 'existente', 'modulos_ligados', '[]'::jsonb);
  end if;

  -- plano do catálogo (RN-PLA-01): vivo, ativo e vende cada adicional pedido
  select pl.* into v_novo from plataforma.plano pl where pl.codigo = v_codigo and pl.deleted_at is null;
  if not found then
    raise exception 'sa_trocar_plano: plano não encontrado no catálogo' using errcode = '22023', hint = 'PLANO_DESCONHECIDO';
  end if;
  if not v_novo.ativo then
    raise exception 'sa_trocar_plano: o plano não está mais à venda' using errcode = '22023', hint = 'PLANO_INATIVO';
  end if;
  select coalesce(array_agg(x.value ->> 'adicional'), '{}') into v_vendidos from jsonb_array_elements(v_novo.adicionais) x;
  if not (v_vistos <@ v_vendidos) then
    raise exception 'sa_trocar_plano: o plano não vende um dos adicionais pedidos' using errcode = '22023', hint = 'ADICIONAL_FORA_DO_PLANO';
  end if;

  -- os módulos da assinatura (modulosDaAssinatura do SDK): core e integracao sempre, os do plano e os adicionais
  select coalesce(array_agg(m.modulo order by m.n), '{}') into v_mods
    from unnest(array['core', 'catalogo', 'vendedor', 'promotor', 'gestor', 'pesquisa', 'treinamento', 'integracao'])
         with ordinality as m (modulo, n)
   where m.modulo in ('core', 'integracao') or m.modulo = any (v_novo.modulos) or m.modulo = any (v_vistos);
  if not (v_mods <@ v_pedidos_mod and v_pedidos_mod <@ v_mods) then
    raise exception 'sa_trocar_plano: os módulos pedidos não são os do plano e dos adicionais' using errcode = '22023', hint = 'MODULOS_FORA_DO_PLANO';
  end if;

  -- RN-PLA-05: o plano novo cobre o que está em uso, item a item (nunca desativa usuário)
  select string_agg(format('%s: %s em uso, %s contratadas', l.item, l.em_uso, l.contratadas), '; ' order by l.n)
    into v_problemas
    from plataforma.situacao_das_licencas(v_novo, p -> 'adicionais', p_tenant) l
   where l.contratadas is not null and l.em_uso > l.contratadas;
  if v_problemas is not null then
    raise exception 'sa_trocar_plano: o plano fica abaixo do uso (%)', v_problemas using errcode = '22023', hint = 'PLANO_ABAIXO_DO_USO';
  end if;

  update plataforma.assinatura
     set plano_id = v_novo.id, ciclo = v_ciclo, adicionais = p -> 'adicionais'
   where id = v_atual.id;

  -- liga os módulos do plano no tenant (insere o que falta, religa o desligado); nunca desliga
  foreach v_m in array v_mods loop
    insert into plataforma.tenant_modulo (tenant_id, modulo, ativo, licencas, ativado_em)
    values (p_tenant, v_m, true, null, now())
    on conflict (tenant_id, modulo) where deleted_at is null do nothing;
    get diagnostics v_n = row_count;
    if v_n = 0 then
      update plataforma.tenant_modulo tm
         set ativo = true, ativado_em = now(), desativado_em = null
       where tm.tenant_id = p_tenant and tm.modulo = v_m and tm.deleted_at is null and not tm.ativo;
      get diagnostics v_n = row_count;
    end if;
    if v_n > 0 then
      v_ligados := v_ligados || v_m;
    end if;
  end loop;

  insert into plataforma.assinatura_historico (tenant_id, assinatura_id, pedido_id, plano_anterior_id, plano_id, ciclo_anterior,
                                               ciclo, adicionais_anteriores, adicionais, modulos_ligados, super_admin_id)
  values (p_tenant, v_atual.id, v_pedido, v_atual.plano_id, v_novo.id, v_atual.ciclo, v_ciclo, v_atual.adicionais,
          p -> 'adicionais', v_ligados, v_sa);

  perform plataforma.sa_registrar_auditoria('super_admin', v_sa, null, p_sid, p_tenant, 'sa.assinatura.trocar',
    jsonb_build_object('plano', v_codigo, 'plano_anterior', v_anterior, 'ciclo', v_ciclo, 'resultado', 'trocada',
                       'modulos_ligados', to_jsonb(v_ligados)));
  return jsonb_build_object('resultado', 'trocada', 'modulos_ligados', to_jsonb(v_ligados));
end
$$;
revoke all on function plataforma.sa_trocar_plano(uuid, uuid, jsonb) from public, macuxi_app, macuxi_worker;
grant execute on function plataforma.sa_trocar_plano(uuid, uuid, jsonb) to macuxi_portal;

-- 7. Seed do catálogo (os 4 planos do §11.3; números da ponte de 14/11, R-20261114-132600-alexandre, item 1) --------------------
insert into plataforma.plano (id, codigo, nome, ordem, preco_mensal_centavos, licenca_vendedor, licenca_gestor, licenca_bko,
                              licenca_promotor, modulos, adicionais, meses_gratis_anual, dias_teste, ativo)
select v.id::uuid, v.codigo, v.nome, v.ordem, v.preco, v.vendedor, v.gestor, v.bko, 0,
       array['core', 'catalogo', 'vendedor', 'gestor', 'integracao'],
       '[{"adicional": "promotor", "preco_unitario_centavos": 8000, "incluidos": 0},
         {"adicional": "pesquisa", "preco_unitario_centavos": 1000, "incluidos": 0},
         {"adicional": "treinamento", "preco_unitario_centavos": 1000, "incluidos": 0}]'::jsonb,
       2, 14, true
  from (values
    ('00830000-0000-4000-8000-000000000001', 'light',      'Light',      1,  61000, 10, 1, 1),
    ('00830000-0000-4000-8000-000000000002', 'pme',        'PME',        2, 119700, 20, 2, 3),
    ('00830000-0000-4000-8000-000000000003', 'enterprise', 'Enterprise', 3, 171900, 30, 3, 5),
    ('00830000-0000-4000-8000-000000000004', 'corporate',  'Corporate',  4, 259250, 50, 5, 5)
  ) as v (id, codigo, nome, ordem, preco, vendedor, gestor, bko)
on conflict (codigo) where deleted_at is null do nothing;

-- Conferência pelo catálogo (aborta com 42501 e nada muda) --------------------------------------------------------------------
do $$
declare
  v_f text;
  v_n int;
  v_antes int := nullif(current_setting('macuxi.sa_portal_antes_0086', true), '')::int;
begin
  select string_agg(p.oid::regprocedure::text, ', ' order by 1) into v_f
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'plataforma' and (p.proname like 'sa\_%' or p.proname = 'criar_super_admin')
     and (has_function_privilege('macuxi_app', p.oid, 'execute') or has_function_privilege('macuxi_worker', p.oid, 'execute')
          or exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                      where a.grantee = 0 and a.privilege_type = 'EXECUTE'));
  if v_f is not null then
    raise exception '0086: função executável pelo macuxi_app, macuxi_worker ou PUBLIC: %', v_f using errcode = '42501';
  end if;
  if not has_function_privilege('macuxi_portal', 'plataforma.sa_listar_planos(uuid)', 'execute')
     or not has_function_privilege('macuxi_portal', 'plataforma.sa_assinatura_da_empresa(uuid, uuid)', 'execute')
     or not has_function_privilege('macuxi_portal', 'plataforma.sa_trocar_plano(uuid, uuid, jsonb)', 'execute') then
    raise exception '0086: as 3 sa_* dos planos devem ser executáveis pelo macuxi_portal' using errcode = '42501';
  end if;
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'plataforma' and p.proname like 'sa\_%' and has_function_privilege('macuxi_portal', p.oid, 'execute');
  if v_antes is null or v_n <> v_antes + 3 then
    raise exception '0086: esperadas % + 3 funções sa_* executáveis pelo macuxi_portal, há %', v_antes, v_n using errcode = '42501';
  end if;
  -- a trava e as de apoio: só o app (e o dono); nenhuma ao worker, ao portal ou a PUBLIC
  select string_agg(f, ', ') into v_f
    from unnest(array['plataforma.licencas_do_tenant()', 'plataforma.licencas_em_uso(uuid)',
                      'plataforma.contratadas_do_plano(plataforma.plano, jsonb)',
                      'plataforma.situacao_das_licencas(plataforma.plano, jsonb, uuid)']) f
   where not has_function_privilege('macuxi_app', f, 'execute')
      or has_function_privilege('macuxi_worker', f, 'execute') or has_function_privilege('macuxi_portal', f, 'execute')
      or exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                  where p.oid = f::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE');
  if v_f is not null then
    raise exception '0086: EXECUTE fora do desenho em %', v_f using errcode = '42501';
  end if;
  if has_function_privilege('macuxi_app', 'plataforma.plano_json(plataforma.plano)', 'execute')
     or has_function_privilege('macuxi_portal', 'plataforma.plano_json(plataforma.plano)', 'execute')
     or has_function_privilege('macuxi_app', 'plataforma.assinatura_so_trava()', 'execute') then
    raise exception '0086: plano_json e assinatura_so_trava só do dono' using errcode = '42501';
  end if;
  if has_table_privilege('macuxi_app', 'plataforma.plano', 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
     or has_table_privilege('macuxi_worker', 'plataforma.plano', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
     or has_table_privilege('macuxi_portal', 'plataforma.plano', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
     or has_table_privilege('macuxi_app', 'plataforma.assinatura', 'INSERT, DELETE, TRUNCATE, REFERENCES, TRIGGER')
     or has_column_privilege('macuxi_app', 'plataforma.assinatura', 'paga', 'UPDATE')
     or has_table_privilege('macuxi_app', 'plataforma.assinatura_historico', 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
     or has_table_privilege('macuxi_portal', 'plataforma.assinatura_historico', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') then
    raise exception '0086: privilégio de tabela fora do desenho' using errcode = '42501';
  end if;
end
$$;
