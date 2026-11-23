-- 0099_plataforma_zerar_empresa (up) — "Zerar dados" da empresa no portal (v1.0.30; ADR 0068; desenho
-- docs/desenho/empresa-zerar.md §4 e §5; RN-PLA-12; contrato packages/platform-sdk/src/empresa-zerar.ts). Migração em cima da
-- 0098 (sessão C da v1.0.29); o número segue a ordem de merge (provisório até o gerente confirmar). Dicionário:
-- docs/banco/plataforma.md ("Zerar dados da empresa (0099)") e docs/banco/rls.md. Teste: db/testes/empresa-zerar.db.test.ts.
-- Papéis da ADR 0024 (sem superusuário): as SECURITY DEFINER têm o migrador como dono e enxergam os tenants pela política
-- manutencao (0031); o portal só executa as 3 sa_* novas e o worker só as 5 dele. Nenhum papel da aplicação ganha grant de tabela.
--
-- O zerar apaga numa transação os dados da empresa e mantém a empresa, o plano e as licenças, os usuários, os perfis, os
-- parâmetros, as configurações e os conectores (RN-PLA-12). O conjunto é DERIVADO do catálogo: toda tabela com tenant_id (como
-- a excluir_tenant) menos as mantidas inteiras de plataforma.tabelas_mantidas_no_zerar(); três tabelas são parciais (filtro por
-- linha em plataforma.alvos_do_zerar): core.filial (fica a padrão viva), core.usuario_filial (fica a da padrão) e
-- plataforma.arquivo (fica o avatar vivo). Uma tabela nova com tenant_id entra sozinha no conjunto; o teste de banco tem a lista
-- das que saem e reprova a tabela nova sem classificação.
--
-- 1. Ordem por FK comum (extraída da 0032, sem mudar o comportamento da excluir_tenant):
--    - plataforma.tabelas_com_tenant(): o catálogo da 0024/0032 (relkind r/p, fora de partição), em ordem de nome;
--    - plataforma.passos_em_ordem_fk(oid[]): o laço da 0032 (filhas antes das mães; a cada rodada, as prontas em ordem
--      alfabética; ciclo quebrado pela FK anulável de nome menor; autorreferência fora do grafo), como passos (colunas nulo =
--      apagar; senão anular essas colunas);
--    - plataforma.apagar_em_ordem_fk(p_tenant, p_alvos jsonb, p_copia uuid): executa os passos só nas tabelas de p_alvos
--      ({"esquema.tabela": filtro SQL sobre o alias t | null}); com p_copia, cada linha apagada vai antes para a cópia
--      (to_jsonb) e o "antes" das colunas anuladas também. Devolve (tabela, quantidade) das tabelas com linhas apagadas;
--    - plataforma.excluir_tenant(uuid, text) recriada chamando a apagar_em_ordem_fk (mesma assinatura, retorno, travas e ACL).
-- 2. Tabelas novas, sem tenant_id nem FK para plataforma.tenant (sobrevivem à excluir_tenant, como as da 0072). RLS ligado e
--    FORÇADO, só a política manutencao, nenhum grant (app, worker, portal: 42501):
--    - plataforma.zerar_empresa: o job (id do portal), em_andamento -> concluido | falhou; um em andamento por empresa;
--      contagem (jsonb) por tabela do que saiu; a cópia fica até copia_expira_em (7 dias) e some no expurgo (expurgado_em) ou
--      no desfazer (desfeito_em);
--    - plataforma.zerar_empresa_copia: cada linha apagada (acao delete), o "antes" das colunas alteradas das linhas que ficam
--      (acao update, colunas) e as linhas que o zerar criou (acao insert: a (usuário, filial padrão) e a forma e o prazo semeados),
--      para o restaurar_zerar desfazer;
--    - plataforma.zerar_empresa_objeto: chaves no armazenamento (arquivos e sync_pacotes) cujos bytes saem só no expurgo.
-- 3. Funções do portal (SECURITY DEFINER; EXECUTE só ao macuxi_portal; sessão inválida 28000, admin do cliente 42501; código do
--    contrato no hint: 55000 = 409, 22023 = 422, P0002 = 404): sa_previa_zerar, sa_pedir_zerar e sa_ler_zerar. O portal passa a
--    executar 41 sa_*.
-- 4. Funções do worker (SECURITY DEFINER; EXECUTE só ao macuxi_worker; o tenant sai sempre da linha do job): pegar_zerar,
--    executar_zerar, fechar_zerar, objetos_do_expurgo_zerar e fechar_expurgo_zerar.
-- 5. Só do dono (SECURITY INVOKER, sem EXECUTE para ninguém): zerar_tenant (a regra), zerar_tenant_manual (entrada do workflow
--    producao-limpar-cadastros.yml), restaurar_zerar (desfaz em até 7 dias) e as internas tabelas_mantidas_no_zerar,
--    alvos_do_zerar, previa_do_zerar, zerar_bloqueado e zerar_empresa_json.
-- Auditoria (plataforma.auditoria_plataforma, sem dado pessoal): tenant.zerar_pedido, tenant.zerado (detalhes = payload de
-- plataforma.tenant.zerado@1, fora da outbox), tenant.zerar_falhou e tenant.zerar_desfeito.
--
-- Caminho de volta: 0099_plataforma_zerar_empresa.down.sql (excluir_tenant com o corpo da 0032; apaga as funções e as 3
-- tabelas). PERDE os registros de zerar e as cópias ainda não expurgadas: desfaça antes o que precisar (restaurar_zerar) e
-- desligue as rotas e o worker do zerar na API (eles chamam funções que somem). Os bytes listados em zerar_empresa_objeto
-- ficam no bucket.

-- 1. Ordem por FK comum ----------------------------------------------------------------------------------------------------------
create function plataforma.tabelas_com_tenant()
  returns table (nome text)
  language sql stable security invoker
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
    select ns.nspname || '.' || c.relname
      from pg_class c
      join pg_namespace ns on ns.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id' and a.attnum > 0 and not a.attisdropped
     where c.relkind in ('r', 'p') and not c.relispartition
       and ns.nspname not in ('pg_catalog', 'information_schema') and ns.nspname not like 'pg\_%'
     order by ns.nspname, c.relname
  $$;
revoke all on function plataforma.tabelas_com_tenant() from public;

-- O laço da 0032 sem executar nada: passo a passo, apagar a tabela (colunas nulo) ou anular as colunas da FK (ciclo).
create function plataforma.passos_em_ordem_fk(p_tabelas oid[])
  returns table (passo integer, rel oid, colunas text[])
  language plpgsql stable security invoker
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
#variable_conflict use_column
declare
  v_restantes oid[];
  v_prontas oid[];
  v_filha oid[];
  v_mae oid[];
  v_fk text[];
  v_cols jsonb[];
  v_ativa boolean[];
  v_rel oid;
  v_i integer;
  v_passo integer := 0;
begin
  v_restantes := array(select distinct t.r from unnest(coalesce(p_tabelas, '{}'::oid[])) as t(r));

  -- FKs entre as tabelas, sem as da tabela para ela mesma; v_cols = colunas da FK menos tenant_id, só se todas aceitam nulo
  select coalesce(array_agg(k.conrelid order by k.conname, k.oid), '{}'),
         coalesce(array_agg(k.confrelid order by k.conname, k.oid), '{}'),
         coalesce(array_agg(k.conname::text order by k.conname, k.oid), '{}'),
         coalesce(array_agg(k.cols order by k.conname, k.oid), '{}'),
         coalesce(array_agg(true order by k.conname, k.oid), '{}')
    into v_filha, v_mae, v_fk, v_cols, v_ativa
    from (
      select con.oid, con.conname, con.conrelid, con.confrelid,
             (select case when count(*) > 0 and bool_and(not at.attnotnull)
                          then jsonb_agg(at.attname::text order by at.attnum) end
                from unnest(con.conkey) as kk(n)
                join pg_attribute at on at.attrelid = con.conrelid and at.attnum = kk.n
               where at.attname <> 'tenant_id') as cols
        from pg_constraint con
       where con.contype = 'f' and con.conparentid = 0
         and con.conrelid <> con.confrelid
         and con.conrelid = any (v_restantes) and con.confrelid = any (v_restantes)
    ) k;

  while cardinality(v_restantes) > 0 loop
    select array_agg(t.r order by ns.nspname, c.relname) into v_prontas
      from unnest(v_restantes) as t(r)
      join pg_class c on c.oid = t.r
      join pg_namespace ns on ns.oid = c.relnamespace
     where not exists (
       select 1 from generate_subscripts(v_mae, 1) as i
        where v_ativa[i] and v_mae[i] = t.r and v_filha[i] = any (v_restantes));

    if v_prontas is not null then
      foreach v_rel in array v_prontas loop
        v_passo := v_passo + 1;
        passo := v_passo; rel := v_rel; colunas := null;
        return next;
      end loop;
      v_restantes := array(select t.r from unnest(v_restantes) as t(r) where t.r <> all (v_prontas));
      continue;
    end if;

    v_i := null;
    select i into v_i
      from generate_subscripts(v_fk, 1) as i
     where v_ativa[i] and v_cols[i] is not null
       and v_filha[i] = any (v_restantes) and v_mae[i] = any (v_restantes)
     order by v_fk[i], i
     limit 1;
    if v_i is null then
      raise exception 'passos_em_ordem_fk: ciclo de FK sem coluna anulável entre %',
        (select string_agg(t.r::regclass::text, ', ' order by t.r::regclass::text) from unnest(v_restantes) as t(r))
        using errcode = '55000';
    end if;
    v_passo := v_passo + 1;
    passo := v_passo; rel := v_filha[v_i];
    colunas := array(select jsonb_array_elements_text(v_cols[v_i]));
    return next;
    v_ativa[v_i] := false;
  end loop;
end
$$;
revoke all on function plataforma.passos_em_ordem_fk(oid[]) from public;

-- Executa os passos nas tabelas de p_alvos ({"esquema.tabela": filtro SQL sobre o alias t, ou null = todas as linhas do
-- tenant}). Com p_copia (id do zerar), copia antes cada linha apagada e o "antes" das colunas anuladas. Filtro só de quem
-- chama de dentro do banco (sem EXECUTE para ninguém além do dono).
create function plataforma.apagar_em_ordem_fk(p_tenant uuid, p_alvos jsonb, p_copia uuid)
  returns table (tabela text, quantidade bigint)
  language plpgsql volatile security invoker
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
#variable_conflict use_column
declare
  v_p record;
  v_nome text;
  v_filtro text;
  v_n bigint;
begin
  if p_tenant is null then
    raise exception 'apagar_em_ordem_fk: p_tenant obrigatório' using errcode = '22004';
  end if;
  if p_alvos is null or jsonb_typeof(p_alvos) <> 'object' then
    raise exception 'apagar_em_ordem_fk: p_alvos deve ser um objeto JSON' using errcode = '22023';
  end if;
  for v_p in
    select p.passo, p.rel, p.colunas
      from plataforma.passos_em_ordem_fk(array(select k::regclass::oid from jsonb_object_keys(p_alvos) as k)) p
     order by p.passo
  loop
    select ns.nspname || '.' || c.relname into v_nome
      from pg_class c join pg_namespace ns on ns.oid = c.relnamespace where c.oid = v_p.rel;
    v_filtro := case when jsonb_typeof(p_alvos -> v_nome) = 'string' then ' and (' || (p_alvos ->> v_nome) || ')' else '' end;
    if v_p.colunas is null then
      if p_copia is null then
        execute format('delete from %s t where t.tenant_id = $1%s', v_p.rel::regclass, v_filtro) using p_tenant;
      else
        execute format('with d as (delete from %s t where t.tenant_id = $1%s returning t.*) '
                       'insert into plataforma.zerar_empresa_copia (zerar_id, ordem, tabela, acao, linha) '
                       'select $2, $3, $4, ''delete'', to_jsonb(d) from d', v_p.rel::regclass, v_filtro)
          using p_tenant, p_copia, v_p.passo, v_nome;
      end if;
      get diagnostics v_n = row_count;
      if v_n > 0 then
        tabela := v_nome; quantidade := v_n; return next;
      end if;
    else
      if p_copia is not null then
        execute format('insert into plataforma.zerar_empresa_copia (zerar_id, ordem, tabela, acao, colunas, linha) '
                       'select $2, $3, $4, ''update'', $5, to_jsonb(t) from %s t where t.tenant_id = $1 and (%s)%s',
                       v_p.rel::regclass,
                       (select string_agg(format('t.%I is not null', x), ' or ') from unnest(v_p.colunas) as x), v_filtro)
          using p_tenant, p_copia, v_p.passo, v_nome, v_p.colunas;
      end if;
      execute format('update %s t set %s where t.tenant_id = $1 and (%s)%s', v_p.rel::regclass,
                     (select string_agg(format('%I = null', x), ', ') from unnest(v_p.colunas) as x),
                     (select string_agg(format('t.%I is not null', x), ' or ') from unnest(v_p.colunas) as x), v_filtro)
        using p_tenant;
    end if;
  end loop;
end
$$;
revoke all on function plataforma.apagar_em_ordem_fk(uuid, jsonb, uuid) from public;

-- excluir_tenant (0032) com o laço comum: mesma assinatura, retorno, travas (P0002, 22023, 55000) e ACL.
create or replace function plataforma.excluir_tenant(p_tenant uuid, p_codigo text)
  returns table (tabela text, quantidade bigint)
  language plpgsql volatile
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_codigo text;
  v_status text;
begin
  if p_tenant is null then
    raise exception 'excluir_tenant: p_tenant obrigatório' using errcode = '22004';
  end if;
  select t.codigo, t.status into v_codigo, v_status from plataforma.tenant t where t.id = p_tenant for update;
  if not found then
    raise exception 'excluir_tenant: tenant não encontrado' using errcode = 'P0002';
  end if;
  if p_codigo is distinct from v_codigo then
    raise exception 'excluir_tenant: código de confirmação não confere com o do tenant' using errcode = '22023';
  end if;
  if v_status <> 'encerrado' then
    raise exception 'excluir_tenant: o tenant precisa estar com status encerrado (está %)', v_status using errcode = '55000';
  end if;

  -- 1 e 2. toda tabela com tenant_id, filhas antes das mães (o laço da 0032 em plataforma.apagar_em_ordem_fk)
  return query
    select a.tabela, a.quantidade
      from plataforma.apagar_em_ordem_fk(
             p_tenant,
             (select coalesce(jsonb_object_agg(x.nome, 'null'::jsonb), '{}'::jsonb) from plataforma.tabelas_com_tenant() x),
             null) a;

  -- 3. o tenant (FK de qualquer linha que tivesse sobrado = 23503)
  delete from plataforma.tenant t where t.id = p_tenant;
  tabela := 'plataforma.tenant'; quantidade := 1; return next;
end
$$;
revoke all on function plataforma.excluir_tenant(uuid, text) from public;

-- 2. Tabelas do zerar (sobrevivem à exclusão; só por função) ---------------------------------------------------------------------
create table plataforma.zerar_empresa (
  id               uuid primary key,
  empresa_id       uuid not null,
  codigo           text not null,
  origem           text not null,
  situacao         text not null default 'em_andamento',
  pedido_em        timestamptz not null default now(),
  concluido_em     timestamptz,
  linhas_apagadas  bigint,
  contagem         jsonb,
  copia_expira_em  timestamptz,
  expurgado_em     timestamptz,
  desfeito_em      timestamptz,
  erro_codigo      text,
  tentativas       integer not null default 0,
  bloqueado_ate    timestamptz,
  super_admin_id   uuid,
  sessao_id        uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  external_id      text,
  constraint zerar_empresa_origem_valida check (origem in ('portal', 'workflow')),
  constraint zerar_empresa_situacao_valida check (situacao in ('em_andamento', 'concluido', 'falhou')),
  constraint zerar_empresa_origem_coerente check ((origem = 'portal') = (super_admin_id is not null)),
  constraint zerar_empresa_erro_formato check (erro_codigo is null or erro_codigo ~ '^[A-Z][A-Z0-9_]{1,59}$'),
  constraint zerar_empresa_erro_so_na_falha check ((situacao = 'falhou') = (erro_codigo is not null)),
  constraint zerar_empresa_concluido_completo check (situacao <> 'concluido'
    or (concluido_em is not null and linhas_apagadas is not null and contagem is not null and copia_expira_em is not null)),
  constraint zerar_empresa_andamento_sem_fim check (situacao <> 'em_andamento' or concluido_em is null),
  constraint zerar_empresa_copia_so_concluido check ((expurgado_em is null and desfeito_em is null) or situacao = 'concluido'),
  constraint zerar_empresa_desfeito_expurgado check (desfeito_em is null or expurgado_em is not null),
  constraint zerar_empresa_contagens_positivas check ((linhas_apagadas is null or linhas_apagadas >= 0) and tentativas >= 0),
  constraint zerar_empresa_contagem_objeto check (contagem is null or jsonb_typeof(contagem) = 'object')
);
create unique index zerar_empresa_em_andamento_uk on plataforma.zerar_empresa (empresa_id) where situacao = 'em_andamento';
create index zerar_empresa_empresa_ix on plataforma.zerar_empresa (empresa_id, pedido_em desc, id);
create index zerar_empresa_fila_ix on plataforma.zerar_empresa (pedido_em, id) where situacao = 'em_andamento';
create index zerar_empresa_expurgo_ix on plataforma.zerar_empresa (copia_expira_em, id)
  where situacao = 'concluido' and expurgado_em is null;
create trigger zerar_empresa_updated_at before update on plataforma.zerar_empresa
  for each row execute function plataforma.definir_updated_at();
alter table plataforma.zerar_empresa enable row level security;
alter table plataforma.zerar_empresa force row level security;
create policy manutencao on plataforma.zerar_empresa for all to macuxi_manutencao using (true) with check (true);
revoke all on plataforma.zerar_empresa from public, macuxi_app, macuxi_worker;

create table plataforma.zerar_empresa_copia (
  id           uuid primary key default gen_random_uuid(),
  zerar_id     uuid not null references plataforma.zerar_empresa (id),
  ordem        integer not null,
  tabela       text not null,
  acao         text not null,
  colunas      text[],
  linha        jsonb not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  external_id  text,
  constraint zerar_empresa_copia_acao_valida check (acao in ('delete', 'update', 'insert')),
  constraint zerar_empresa_copia_colunas_do_update check ((acao = 'update') = (colunas is not null)),
  constraint zerar_empresa_copia_linha_objeto check (jsonb_typeof(linha) = 'object')
);
create index zerar_empresa_copia_zerar_ix on plataforma.zerar_empresa_copia (zerar_id, acao, tabela);
create trigger zerar_empresa_copia_updated_at before update on plataforma.zerar_empresa_copia
  for each row execute function plataforma.definir_updated_at();
alter table plataforma.zerar_empresa_copia enable row level security;
alter table plataforma.zerar_empresa_copia force row level security;
create policy manutencao on plataforma.zerar_empresa_copia for all to macuxi_manutencao using (true) with check (true);
revoke all on plataforma.zerar_empresa_copia from public, macuxi_app, macuxi_worker;

create table plataforma.zerar_empresa_objeto (
  id             uuid primary key default gen_random_uuid(),
  zerar_id       uuid not null references plataforma.zerar_empresa (id),
  armazenamento  text not null,
  chave          text not null,
  tipo           text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  external_id    text,
  constraint zerar_empresa_objeto_armazenamento_valido check (armazenamento in ('arquivos', 'sync_pacotes'))
);
create index zerar_empresa_objeto_zerar_ix on plataforma.zerar_empresa_objeto (zerar_id);
create trigger zerar_empresa_objeto_updated_at before update on plataforma.zerar_empresa_objeto
  for each row execute function plataforma.definir_updated_at();
alter table plataforma.zerar_empresa_objeto enable row level security;
alter table plataforma.zerar_empresa_objeto force row level security;
create policy manutencao on plataforma.zerar_empresa_objeto for all to macuxi_manutencao using (true) with check (true);
revoke all on plataforma.zerar_empresa_objeto from public, macuxi_app, macuxi_worker;

-- 5. Internas e as do dono (antes das sa_* e do worker, que as chamam) ---------------------------------------------------------
-- RN-PLA-12: o que fica. parcial = a tabela entra no conjunto com filtro por linha (alvos_do_zerar). plataforma.tenant e
-- plataforma.auditoria_plataforma não têm tenant_id (ficam fora do catálogo do zerar).
create function plataforma.tabelas_mantidas_no_zerar()
  returns table (tabela text, parcial boolean)
  language sql immutable security invoker
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
    values
      -- a empresa, o plano, as licenças, os perfis, os parâmetros e a trilha de auditoria do tenant
      ('plataforma.assinatura', false), ('plataforma.assinatura_historico', false), ('plataforma.tenant_modulo', false),
      ('plataforma.perfil', false), ('plataforma.perfil_modulo', false), ('plataforma.perfil_permissao', false),
      ('plataforma.usuario_perfil', false), ('plataforma.usuario_modulo', false), ('plataforma.parametro', false),
      ('plataforma.auditoria', false),
      -- os usuários e as configurações
      ('core.usuario', false), ('core.usuario_contato', false), ('core.usuario_avatar', false), ('core.usuario_convite', false),
      ('core.usuario_codigo_fdv_contador', false), ('core.equipe', false), ('core.sessao', false), ('core.dispositivo', false),
      ('core.ausencia_usuario', false), ('core.motivo', false), ('core.medida', false), ('core.foto_tipo', false),
      ('core.frase_dia', false), ('core.documento_tipo', false), ('core.documento_permissao', false), ('core.plano_rv', false),
      ('core.meta_produtividade', false),
      -- o número do pedido não volta (o ERP já tem os pedidos enviados)
      ('vendedor.numeracao_pedido', false),
      -- conectores, credenciais e mapeamentos
      ('integracao.conector', false), ('integracao.conector_api', false), ('integracao.credencial', false),
      ('integracao.credencial_erp', false), ('integracao.mapeamento', false), ('integracao.politica_versao', false),
      ('integracao.implantacao', false),
      ('gestor.alerta_regra', false),
      ('pesquisa.questionario', false), ('pesquisa.questionario_versao', false),
      ('treinamento.trilha', false), ('treinamento.modulo_trilha', false), ('treinamento.licao', false), ('treinamento.quiz', false),
      ('treinamento.questao', false), ('treinamento.alternativa', false), ('treinamento.trilha_publicacao', false),
      ('treinamento.medalha', false),
      -- parciais: a filial padrão viva, a (usuário, filial padrão) e o arquivo do avatar vivo
      ('core.filial', true), ('core.usuario_filial', true), ('plataforma.arquivo', true)
  $$;
revoke all on function plataforma.tabelas_mantidas_no_zerar() from public;

-- O conjunto do zerar ({"esquema.tabela": filtro | null}): toda tabela com tenant_id menos as mantidas inteiras; as parciais
-- com o filtro das linhas que SAEM.
create function plataforma.alvos_do_zerar(p_tenant uuid)
  returns jsonb
  language plpgsql stable security invoker
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_padrao uuid;
begin
  select f.id into v_padrao from core.filial f where f.tenant_id = p_tenant and f.padrao and f.deleted_at is null;
  return (
    select coalesce(jsonb_object_agg(x.nome, case x.nome
             when 'core.filial' then to_jsonb('not (t.padrao and t.deleted_at is null)'::text)
             when 'core.usuario_filial' then
               case when v_padrao is null then 'null'::jsonb else to_jsonb(format('t.filial_id <> %L::uuid', v_padrao)) end
             when 'plataforma.arquivo' then to_jsonb(
               'not exists (select 1 from core.usuario_avatar a where a.tenant_id = t.tenant_id and a.arquivo_id = t.id and a.deleted_at is null)'::text)
             else 'null'::jsonb end), '{}'::jsonb)
      from plataforma.tabelas_com_tenant() x
     where x.nome not in (select m.tabela from plataforma.tabelas_mantidas_no_zerar() m where not m.parcial));
end
$$;
revoke all on function plataforma.alvos_do_zerar(uuid) from public;

-- Prévia: linhas que sairiam, por tabela, na ordem em que o zerar apaga (só as com linhas). Mesmo conjunto e mesmos filtros.
create function plataforma.previa_do_zerar(p_tenant uuid)
  returns table (ordem integer, tabela text, linhas bigint)
  language plpgsql stable security invoker
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
#variable_conflict use_column
declare
  v_alvos jsonb := plataforma.alvos_do_zerar(p_tenant);
  v_p record;
  v_nome text;
  v_n bigint;
begin
  for v_p in
    select p.passo, p.rel
      from plataforma.passos_em_ordem_fk(array(select k::regclass::oid from jsonb_object_keys(v_alvos) as k)) p
     where p.colunas is null
     order by p.passo
  loop
    select ns.nspname || '.' || c.relname into v_nome
      from pg_class c join pg_namespace ns on ns.oid = c.relnamespace where c.oid = v_p.rel;
    execute format('select count(*) from %s t where t.tenant_id = $1%s', v_p.rel::regclass,
                   case when jsonb_typeof(v_alvos -> v_nome) = 'string' then ' and (' || (v_alvos ->> v_nome) || ')' else '' end)
      into v_n using p_tenant;
    if v_n > 0 then
      ordem := v_p.passo; tabela := v_nome; linhas := v_n; return next;
    end if;
  end loop;
end
$$;
revoke all on function plataforma.previa_do_zerar(uuid) from public;

-- RN-PLA-12: a conferirZerar do SDK, na mesma ordem (null = liberado). p_zerar = o zerar que está sendo executado (não conta
-- como "outro em andamento"); p_total null = sem conferir o volume (workflow).
create function plataforma.zerar_bloqueado(p_tenant uuid, p_zerar uuid, p_total bigint)
  returns text
  language plpgsql stable security invoker
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_status text;
begin
  select t.status into v_status from plataforma.tenant t where t.id = p_tenant and t.deleted_at is null;
  if not found then
    return 'TENANT_NAO_ENCONTRADO';
  end if;
  if v_status = 'encerrado'
     or exists (select 1 from plataforma.exclusao_empresa x where x.empresa_id = p_tenant and x.situacao = 'em_andamento') then
    return 'EXCLUSAO_EM_ANDAMENTO';
  end if;
  if exists (select 1 from plataforma.zerar_empresa z
              where z.empresa_id = p_tenant and z.situacao = 'em_andamento' and z.id is distinct from p_zerar) then
    return 'ZERAR_EM_ANDAMENTO';
  end if;
  if exists (select 1 from plataforma.backup_empresa b where b.empresa_id = p_tenant and b.situacao = 'em_andamento') then
    return 'BACKUP_EM_ANDAMENTO';
  end if;
  if p_total > 2000000 then
    return 'ZERAR_VOLUME_ALTO';
  end if;
  return null;
end
$$;
revoke all on function plataforma.zerar_bloqueado(uuid, uuid, bigint) from public;

-- ZerarEmpresaSchema do SDK (tenant_id = empresa_id)
create function plataforma.zerar_empresa_json(z plataforma.zerar_empresa)
  returns jsonb
  language sql stable security invoker
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
    select jsonb_build_object(
      'id', z.id, 'tenant_id', z.empresa_id, 'codigo', z.codigo, 'origem', z.origem, 'situacao', z.situacao,
      'pedido_em', plataforma.instante_iso(z.pedido_em), 'concluido_em', plataforma.instante_iso(z.concluido_em),
      'linhas_apagadas', z.linhas_apagadas, 'contagem', z.contagem,
      'copia_expira_em', plataforma.instante_iso(z.copia_expira_em), 'erro_codigo', z.erro_codigo)
  $$;
revoke all on function plataforma.zerar_empresa_json(plataforma.zerar_empresa) from public;

-- A regra (RN-PLA-12), na transação de quem chama (executar_zerar): usuários na filial padrão (RN-CORE-39), apaga em ordem de FK
-- com a cópia de cada linha, guarda as chaves dos bytes para o expurgo, devolve a forma e o prazo padrão, gira a geração da
-- base. Devolve (tabela, quantidade) das tabelas com linhas apagadas, na ordem em que apagou. Erro no meio = nada muda.
create function plataforma.zerar_tenant(p_zerar uuid)
  returns table (tabela text, quantidade bigint)
  language plpgsql volatile security invoker
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
#variable_conflict use_column
declare
  v_z plataforma.zerar_empresa;
  v_tenant uuid;
  v_padrao uuid;
  v_alvos jsonb;
  v_nome text;
begin
  select z.* into v_z from plataforma.zerar_empresa z where z.id = p_zerar for update;
  if not found then
    raise exception 'zerar_tenant: zerar não encontrado' using errcode = 'P0002';
  end if;
  if v_z.situacao <> 'em_andamento' then
    raise exception 'zerar_tenant: o zerar não está em andamento' using errcode = '55000';
  end if;
  v_tenant := v_z.empresa_id;
  perform 1 from plataforma.tenant t where t.id = v_tenant and t.deleted_at is null for update;
  if not found then
    raise exception 'zerar_tenant: empresa não encontrada' using errcode = 'P0002', hint = 'TENANT_NAO_ENCONTRADO';
  end if;
  select f.id into v_padrao from core.filial f where f.tenant_id = v_tenant and f.padrao and f.deleted_at is null;
  if v_padrao is null then
    raise exception 'zerar_tenant: a empresa não tem filial padrão viva (RN-CORE-39)' using errcode = '55000';
  end if;

  -- RN-CORE-39: a (usuário, padrão) onde faltar, depois todo usuário de outra filial passa à padrão (o antes vai à cópia)
  with novas as (
    insert into core.usuario_filial (tenant_id, usuario_id, filial_id)
    select u.tenant_id, u.id, v_padrao
      from core.usuario u
     where u.tenant_id = v_tenant and u.filial_cadastro_id is not null and u.deleted_at is null
       and not exists (select 1 from core.usuario_filial uf
                        where uf.tenant_id = u.tenant_id and uf.usuario_id = u.id and uf.filial_id = v_padrao and uf.deleted_at is null)
    returning *
  )
  insert into plataforma.zerar_empresa_copia (zerar_id, ordem, tabela, acao, linha)
  select p_zerar, 0, 'core.usuario_filial', 'insert', to_jsonb(n) from novas n;
  insert into plataforma.zerar_empresa_copia (zerar_id, ordem, tabela, acao, colunas, linha)
  select p_zerar, 0, 'core.usuario', 'update', array['filial_cadastro_id'], to_jsonb(u)
    from core.usuario u
   where u.tenant_id = v_tenant and u.filial_cadastro_id <> v_padrao;
  update core.usuario u set filial_cadastro_id = v_padrao where u.tenant_id = v_tenant and u.filial_cadastro_id <> v_padrao;

  -- o conjunto, em ordem de FK, com a cópia
  v_alvos := plataforma.alvos_do_zerar(v_tenant);
  return query select a.tabela, a.quantidade from plataforma.apagar_em_ordem_fk(v_tenant, v_alvos, p_zerar) a;

  -- os bytes das fotos e dos pacotes saem só no expurgo (o desfazer volta completo)
  insert into plataforma.zerar_empresa_objeto (zerar_id, armazenamento, chave, tipo)
  select p_zerar, 'arquivos', c.linha ->> 'chave_armazenamento', c.linha ->> 'tipo'
    from plataforma.zerar_empresa_copia c
   where c.zerar_id = p_zerar and c.acao = 'delete' and c.tabela = 'plataforma.arquivo'
     and c.linha ->> 'chave_armazenamento' is not null
  union all
  select p_zerar, 'sync_pacotes', c.linha ->> 'chave_armazenamento', null
    from plataforma.zerar_empresa_copia c
   where c.zerar_id = p_zerar and c.acao = 'delete' and c.tabela = 'plataforma.sync_pacote'
     and c.linha ->> 'arquivo_apagado_em' is null;

  -- a forma e o prazo padrão, como na empresa nova; o que nasceu nas tabelas do conjunto vai à cópia (o desfazer apaga antes)
  perform vendedor.semear_pagamento(v_tenant);
  for v_nome in select k from jsonb_object_keys(v_alvos) as k order by k loop
    execute format('insert into plataforma.zerar_empresa_copia (zerar_id, ordem, tabela, acao, linha) '
                   'select $2, 0, $3, ''insert'', to_jsonb(t) from %s t where t.tenant_id = $1%s', v_nome::regclass,
                   case when jsonb_typeof(v_alvos -> v_nome) = 'string' then ' and (' || (v_alvos ->> v_nome) || ')' else '' end)
      using v_tenant, p_zerar, v_nome;
  end loop;

  -- o aparelho limpa a cópia local e puxa tudo
  perform plataforma.girar_geracao_base(v_tenant);
end
$$;
revoke all on function plataforma.zerar_tenant(uuid) from public;

-- 4. Funções do worker -----------------------------------------------------------------------------------------------------------
-- Próximo zerar em andamento sem concessão viva (skip locked; concessão de 10 min); conta a tentativa.
create function plataforma.pegar_zerar()
  returns jsonb
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_z plataforma.zerar_empresa;
begin
  select z.* into v_z
    from plataforma.zerar_empresa z
   where z.situacao = 'em_andamento' and (z.bloqueado_ate is null or z.bloqueado_ate < now())
   order by z.pedido_em, z.id
   limit 1
   for update skip locked;
  if not found then
    return null;
  end if;
  update plataforma.zerar_empresa set bloqueado_ate = now() + interval '10 minutes', tentativas = tentativas + 1 where id = v_z.id
  returning * into v_z;
  return plataforma.zerar_empresa_json(v_z);
end
$$;
revoke all on function plataforma.pegar_zerar() from public;
grant execute on function plataforma.pegar_zerar() to macuxi_worker;

-- Na transação do worker: confere de novo (RN-PLA-12; o volume só na origem portal), zerar_tenant, concluido com a contagem e
-- a cópia por 7 dias, auditoria tenant.zerado (detalhes = payload de plataforma.tenant.zerado@1). Conferência que não passa:
-- falhou com o código, nada apagado (sem erro). Erro no meio: a transação desfaz tudo (o worker tenta de novo ou chama
-- fechar_zerar com falhou numa nova). Zerar que não está em andamento: devolve o zerar (idempotente).
create function plataforma.executar_zerar(p_zerar uuid)
  returns jsonb
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_z plataforma.zerar_empresa;
  v_bloqueio text;
  v_r record;
  v_total bigint := 0;
  v_contagem jsonb := '{}'::jsonb;
  v_agora timestamptz := now();
begin
  select z.* into v_z from plataforma.zerar_empresa z where z.id = p_zerar for update;
  if not found then
    raise exception 'executar_zerar: zerar não encontrado' using errcode = 'P0002';
  end if;
  if v_z.situacao <> 'em_andamento' then
    return plataforma.zerar_empresa_json(v_z);
  end if;
  perform 1 from plataforma.tenant t where t.id = v_z.empresa_id for update;
  v_bloqueio := plataforma.zerar_bloqueado(v_z.empresa_id, v_z.id,
    case when v_z.origem = 'portal' then (select coalesce(sum(p.linhas), 0)::bigint from plataforma.previa_do_zerar(v_z.empresa_id) p) end);
  if v_bloqueio is not null then
    update plataforma.zerar_empresa set situacao = 'falhou', erro_codigo = v_bloqueio, bloqueado_ate = null where id = p_zerar
    returning * into v_z;
    perform plataforma.sa_registrar_auditoria(case when v_z.super_admin_id is null then null else 'super_admin' end,
      v_z.super_admin_id, null, v_z.sessao_id, v_z.empresa_id, 'tenant.zerar_falhou',
      jsonb_build_object('zerar_id', v_z.id, 'erro_codigo', v_bloqueio));
    return plataforma.zerar_empresa_json(v_z);
  end if;

  for v_r in select a.tabela, a.quantidade from plataforma.zerar_tenant(p_zerar) a loop
    v_total := v_total + v_r.quantidade;
    v_contagem := v_contagem || jsonb_build_object(v_r.tabela, v_r.quantidade);
  end loop;
  update plataforma.zerar_empresa
     set situacao = 'concluido', concluido_em = v_agora, linhas_apagadas = v_total, contagem = v_contagem,
         copia_expira_em = v_agora + interval '7 days', bloqueado_ate = null
   where id = p_zerar
  returning * into v_z;
  -- detalhes = o payload de plataforma.tenant.zerado@1, inteiro (a sa_registrar_auditoria trocaria o "origem" por "banco")
  insert into plataforma.auditoria_plataforma (ator_tipo, super_admin_id, sessao_id, tenant_alvo_id, acao, detalhes)
  values (case when v_z.super_admin_id is null then null else 'super_admin' end, v_z.super_admin_id, v_z.sessao_id, v_z.empresa_id,
          'tenant.zerado',
          jsonb_build_object('tenant_id', v_z.empresa_id, 'codigo', v_z.codigo, 'zerar_id', v_z.id, 'origem', v_z.origem,
                             'linhas_apagadas', v_total, 'copia_expira_em', plataforma.instante_iso(v_z.copia_expira_em),
                             'zerado_em', plataforma.instante_iso(v_agora)));
  return plataforma.zerar_empresa_json(v_z);
end
$$;
revoke all on function plataforma.executar_zerar(uuid) from public;
grant execute on function plataforma.executar_zerar(uuid) to macuxi_worker;

-- Fecha como falhou ({ "situacao": "falhou", "erro_codigo": "X" }), numa transação nova depois do ROLLBACK do worker: a
-- empresa está intacta. Já falhou = devolve (idempotente); concluido = 55000.
create function plataforma.fechar_zerar(p_zerar uuid, p_resultado jsonb)
  returns jsonb
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_z plataforma.zerar_empresa;
  v_erro text;
begin
  if p_resultado is null or jsonb_typeof(p_resultado) <> 'object' or p_resultado ->> 'situacao' is distinct from 'falhou' then
    raise exception 'fechar_zerar: resultado deve ser {"situacao": "falhou", "erro_codigo": ...}' using errcode = '22023';
  end if;
  v_erro := p_resultado ->> 'erro_codigo';
  if v_erro is null or v_erro !~ '^[A-Z][A-Z0-9_]{1,59}$' then
    raise exception 'fechar_zerar: erro_codigo fora do formato' using errcode = '22023';
  end if;
  select z.* into v_z from plataforma.zerar_empresa z where z.id = p_zerar for update;
  if not found then
    raise exception 'fechar_zerar: zerar não encontrado' using errcode = 'P0002';
  end if;
  if v_z.situacao = 'falhou' then
    return plataforma.zerar_empresa_json(v_z);
  end if;
  if v_z.situacao <> 'em_andamento' then
    raise exception 'fechar_zerar: o zerar já foi concluído' using errcode = '55000';
  end if;
  update plataforma.zerar_empresa set situacao = 'falhou', erro_codigo = v_erro, bloqueado_ate = null where id = p_zerar
  returning * into v_z;
  perform plataforma.sa_registrar_auditoria(case when v_z.super_admin_id is null then null else 'super_admin' end,
    v_z.super_admin_id, null, v_z.sessao_id, v_z.empresa_id, 'tenant.zerar_falhou',
    jsonb_build_object('zerar_id', v_z.id, 'erro_codigo', v_erro));
  return plataforma.zerar_empresa_json(v_z);
end
$$;
revoke all on function plataforma.fechar_zerar(uuid, jsonb) from public;
grant execute on function plataforma.fechar_zerar(uuid, jsonb) to macuxi_worker;

-- Expurgo (a cada hora): os zerar concluídos com a cópia vencida (até p_limite zerar, 1..50) e TODAS as chaves de cada um. Zerar
-- sem objeto vem numa linha com armazenamento e chave nulos (só fechar). O worker remove os bytes e chama fechar_expurgo_zerar.
create function plataforma.objetos_do_expurgo_zerar(p_limite integer)
  returns table (zerar_id uuid, armazenamento text, chave text, tipo text)
  language plpgsql stable security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
#variable_conflict use_column
begin
  if p_limite is null or p_limite < 1 or p_limite > 50 then
    raise exception 'objetos_do_expurgo_zerar: p_limite de 1 a 50' using errcode = '22023';
  end if;
  return query
    with vencidos as (
      select z.id, z.copia_expira_em
        from plataforma.zerar_empresa z
       where z.situacao = 'concluido' and z.expurgado_em is null and z.copia_expira_em <= now()
       order by z.copia_expira_em, z.id
       limit p_limite
    )
    select v.id, o.armazenamento, o.chave, o.tipo
      from vencidos v
      left join plataforma.zerar_empresa_objeto o on o.zerar_id = v.id
     order by v.copia_expira_em, v.id, o.armazenamento, o.chave;
end
$$;
revoke all on function plataforma.objetos_do_expurgo_zerar(integer) from public;
grant execute on function plataforma.objetos_do_expurgo_zerar(integer) to macuxi_worker;

-- Depois de remover os bytes: apaga a cópia e as chaves e marca expurgado_em. Só com a cópia vencida (55000); já expurgado =
-- devolve (idempotente).
create function plataforma.fechar_expurgo_zerar(p_zerar uuid)
  returns jsonb
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_z plataforma.zerar_empresa;
begin
  select z.* into v_z from plataforma.zerar_empresa z where z.id = p_zerar for update;
  if not found then
    raise exception 'fechar_expurgo_zerar: zerar não encontrado' using errcode = 'P0002';
  end if;
  if v_z.expurgado_em is not null then
    return plataforma.zerar_empresa_json(v_z);
  end if;
  if v_z.situacao <> 'concluido' or v_z.copia_expira_em > now() then
    raise exception 'fechar_expurgo_zerar: a cópia ainda não venceu' using errcode = '55000';
  end if;
  delete from plataforma.zerar_empresa_copia c where c.zerar_id = p_zerar;
  delete from plataforma.zerar_empresa_objeto o where o.zerar_id = p_zerar;
  update plataforma.zerar_empresa set expurgado_em = now() where id = p_zerar
  returning * into v_z;
  return plataforma.zerar_empresa_json(v_z);
end
$$;
revoke all on function plataforma.fechar_expurgo_zerar(uuid) from public;
grant execute on function plataforma.fechar_expurgo_zerar(uuid) to macuxi_worker;

-- 3. Funções do portal (só super-admin) ------------------------------------------------------------------------------------------
-- PreviaZerarEmpresaSchema: o que vai sair, por tabela, e o bloqueio atual (null = liberado). Empresa inexistente = P0002.
create function plataforma.sa_previa_zerar(p_sid uuid, p_tenant uuid)
  returns jsonb
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_tipo text;
  v_sa uuid;
  v_codigo text;
  v_tabelas jsonb;
  v_total bigint;
begin
  select v.tipo, v.super_admin_id into v_tipo, v_sa from plataforma.sa_sessao_valida(p_sid) v;
  if v_tipo is null then
    raise exception 'sa_previa_zerar: sessão do portal inválida' using errcode = '28000';
  end if;
  if v_tipo is distinct from 'super_admin' or v_sa is null then
    raise exception 'sa_previa_zerar: só o super-admin' using errcode = '42501';
  end if;
  if p_tenant is null then
    raise exception 'sa_previa_zerar: tenant obrigatório' using errcode = '22023';
  end if;
  select t.codigo into v_codigo from plataforma.tenant t where t.id = p_tenant and t.deleted_at is null;
  if not found then
    raise exception 'sa_previa_zerar: empresa não encontrada' using errcode = 'P0002', hint = 'TENANT_NAO_ENCONTRADO';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('tabela', p.tabela, 'linhas', p.linhas) order by p.ordem), '[]'::jsonb),
         coalesce(sum(p.linhas), 0)
    into v_tabelas, v_total
    from plataforma.previa_do_zerar(p_tenant) p;
  return jsonb_build_object('tenant_id', p_tenant, 'codigo', v_codigo, 'contado_em', plataforma.instante_iso(now()),
                            'total_linhas', v_total, 'tabelas', v_tabelas,
                            'bloqueio', plataforma.zerar_bloqueado(p_tenant, null, v_total));
end
$$;
revoke all on function plataforma.sa_previa_zerar(uuid, uuid) from public, macuxi_app, macuxi_worker;
grant execute on function plataforma.sa_previa_zerar(uuid, uuid) to macuxi_portal;

-- RN-PLA-12: pede o zerar (id do portal; o mesmo id devolve o mesmo zerar). A API confere antes a senha (sa_reautenticar).
-- Recusas da conferirZerar com o código no hint: 55000 EXCLUSAO_EM_ANDAMENTO, ZERAR_EM_ANDAMENTO e BACKUP_EM_ANDAMENTO (409);
-- 22023 ZERAR_VOLUME_ALTO e ZERAR_CODIGO_NAO_CONFERE (422).
create function plataforma.sa_pedir_zerar(p_sid uuid, p_tenant uuid, p_id uuid, p_codigo text)
  returns jsonb
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_tipo text;
  v_sa uuid;
  v_codigo text;
  v_z plataforma.zerar_empresa;
  v_bloqueio text;
begin
  select v.tipo, v.super_admin_id into v_tipo, v_sa from plataforma.sa_sessao_valida(p_sid) v;
  if v_tipo is null then
    raise exception 'sa_pedir_zerar: sessão do portal inválida' using errcode = '28000';
  end if;
  if v_tipo is distinct from 'super_admin' or v_sa is null then
    raise exception 'sa_pedir_zerar: só o super-admin' using errcode = '42501';
  end if;
  if p_tenant is null or p_id is null or p_codigo is null then
    raise exception 'sa_pedir_zerar: tenant, id e código obrigatórios' using errcode = '22023';
  end if;
  -- pedidos da mesma empresa em fila (o 2º vê o 1º)
  perform pg_advisory_xact_lock(hashtextextended('plataforma.zerar_empresa:' || p_tenant::text, 0));
  select z.* into v_z from plataforma.zerar_empresa z where z.id = p_id;
  if found then
    if v_z.empresa_id <> p_tenant then
      raise exception 'sa_pedir_zerar: o id é de um zerar de outra empresa' using errcode = '23505';
    end if;
    return plataforma.zerar_empresa_json(v_z);
  end if;
  select t.codigo into v_codigo from plataforma.tenant t where t.id = p_tenant and t.deleted_at is null for update;
  if not found then
    raise exception 'sa_pedir_zerar: empresa não encontrada' using errcode = 'P0002', hint = 'TENANT_NAO_ENCONTRADO';
  end if;
  v_bloqueio := plataforma.zerar_bloqueado(p_tenant, null,
                                           (select coalesce(sum(p.linhas), 0)::bigint from plataforma.previa_do_zerar(p_tenant) p));
  if v_bloqueio in ('EXCLUSAO_EM_ANDAMENTO', 'ZERAR_EM_ANDAMENTO', 'BACKUP_EM_ANDAMENTO') then
    raise exception 'sa_pedir_zerar: a empresa está ocupada' using errcode = '55000', hint = v_bloqueio;
  end if;
  if v_bloqueio is not null then
    raise exception 'sa_pedir_zerar: zerar recusado (RN-PLA-12)' using errcode = '22023', hint = v_bloqueio;
  end if;
  if btrim(p_codigo) = '' or lower(btrim(p_codigo)) <> lower(btrim(v_codigo)) then
    raise exception 'sa_pedir_zerar: o código digitado não é o da empresa' using errcode = '22023',
      hint = 'ZERAR_CODIGO_NAO_CONFERE';
  end if;
  insert into plataforma.zerar_empresa (id, empresa_id, codigo, origem, super_admin_id, sessao_id)
  values (p_id, p_tenant, v_codigo, 'portal', v_sa, p_sid)
  returning * into v_z;
  perform plataforma.sa_registrar_auditoria('super_admin', v_sa, null, p_sid, p_tenant, 'tenant.zerar_pedido',
    jsonb_build_object('zerar_id', p_id));
  return plataforma.zerar_empresa_json(v_z);
end
$$;
revoke all on function plataforma.sa_pedir_zerar(uuid, uuid, uuid, text) from public, macuxi_app, macuxi_worker;
grant execute on function plataforma.sa_pedir_zerar(uuid, uuid, uuid, text) to macuxi_portal;

-- O zerar mais recente da empresa (null = nenhum: 404 ZERAR_NAO_ENCONTRADO na API).
create function plataforma.sa_ler_zerar(p_sid uuid, p_tenant uuid)
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
    raise exception 'sa_ler_zerar: sessão do portal inválida' using errcode = '28000';
  end if;
  if v_tipo is distinct from 'super_admin' or v_sa is null then
    raise exception 'sa_ler_zerar: só o super-admin' using errcode = '42501';
  end if;
  return (select plataforma.zerar_empresa_json(z)
            from plataforma.zerar_empresa z
           where z.empresa_id = p_tenant
           order by z.pedido_em desc, z.id desc
           limit 1);
end
$$;
revoke all on function plataforma.sa_ler_zerar(uuid, uuid) from public, macuxi_app, macuxi_worker;
grant execute on function plataforma.sa_ler_zerar(uuid, uuid) to macuxi_portal;

-- 5 (cont.). Só do dono -----------------------------------------------------------------------------------------------------------
-- Entrada do workflow producao-limpar-cadastros.yml (psql do migrador): mesmo executar_zerar, origem workflow, sem o limite de
-- volume do portal. Código errado 22023, empresa ocupada 55000 (código no hint), inexistente P0002.
create function plataforma.zerar_tenant_manual(p_tenant uuid, p_codigo text)
  returns jsonb
  language plpgsql volatile security invoker
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_codigo text;
  v_bloqueio text;
  v_id uuid := gen_random_uuid();
begin
  if p_tenant is null or p_codigo is null then
    raise exception 'zerar_tenant_manual: tenant e código obrigatórios' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('plataforma.zerar_empresa:' || p_tenant::text, 0));
  select t.codigo into v_codigo from plataforma.tenant t where t.id = p_tenant and t.deleted_at is null for update;
  if not found then
    raise exception 'zerar_tenant_manual: empresa não encontrada' using errcode = 'P0002', hint = 'TENANT_NAO_ENCONTRADO';
  end if;
  if btrim(p_codigo) = '' or lower(btrim(p_codigo)) <> lower(btrim(v_codigo)) then
    raise exception 'zerar_tenant_manual: o código não é o da empresa' using errcode = '22023', hint = 'ZERAR_CODIGO_NAO_CONFERE';
  end if;
  v_bloqueio := plataforma.zerar_bloqueado(p_tenant, null, null);
  if v_bloqueio is not null then
    raise exception 'zerar_tenant_manual: a empresa está ocupada' using errcode = '55000', hint = v_bloqueio;
  end if;
  insert into plataforma.zerar_empresa (id, empresa_id, codigo, origem) values (v_id, p_tenant, v_codigo, 'workflow');
  return plataforma.executar_zerar(v_id);
end
$$;
revoke all on function plataforma.zerar_tenant_manual(uuid, text) from public;

-- Desfaz um zerar concluído enquanto a cópia existe (7 dias), numa transação: apaga o que o zerar criou (em ordem de FK),
-- recusa (55000 ZERAR_DADOS_NOVOS) se há linha nova nas tabelas do conjunto, devolve as linhas apagadas (mães antes das
-- filhas, jsonb_populate_record; a linha que o gatilho da mãe já refez não duplica, e toda linha da cópia tem de voltar, senão
-- 55000 ZERAR_RESTAURO_INCOMPLETO), reaplica o "antes" das colunas alteradas, apaga a cópia e as chaves (os bytes ficam), gira a
-- geração e audita tenant.zerar_desfeito. Sem cópia (expurgada ou desfeita) ou zerar não concluído: 55000 ZERAR_SEM_COPIA.
create function plataforma.restaurar_zerar(p_zerar uuid)
  returns jsonb
  language plpgsql volatile security invoker
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_z plataforma.zerar_empresa;
  v_tenant uuid;
  v_alvos jsonb;
  v_p record;
  v_nome text;
  v_cols text;
  v_cols_r text;
  v_n bigint;
  v_faltam bigint;
  v_total bigint := 0;
  v_contagem jsonb := '{}'::jsonb;
begin
  select z.* into v_z from plataforma.zerar_empresa z where z.id = p_zerar for update;
  if not found then
    raise exception 'restaurar_zerar: zerar não encontrado' using errcode = 'P0002';
  end if;
  if v_z.situacao <> 'concluido' or v_z.expurgado_em is not null then
    raise exception 'restaurar_zerar: não há cópia para desfazer (zerar não concluído, expurgado ou já desfeito)'
      using errcode = '55000', hint = 'ZERAR_SEM_COPIA';
  end if;
  v_tenant := v_z.empresa_id;
  perform 1 from plataforma.tenant t where t.id = v_tenant and t.deleted_at is null for update;
  if not found then
    raise exception 'restaurar_zerar: empresa não encontrada' using errcode = 'P0002', hint = 'TENANT_NAO_ENCONTRADO';
  end if;

  -- 1. o que o zerar criou (a (usuário, padrão), a forma e o prazo semeados), filhas antes das mães
  for v_p in
    select p.rel
      from plataforma.passos_em_ordem_fk(array(
             select distinct c.tabela::regclass::oid from plataforma.zerar_empresa_copia c
              where c.zerar_id = p_zerar and c.acao = 'insert')) p
     where p.colunas is null
     order by p.passo
  loop
    select ns.nspname || '.' || c.relname into v_nome
      from pg_class c join pg_namespace ns on ns.oid = c.relnamespace where c.oid = v_p.rel;
    execute format('delete from %s t using plataforma.zerar_empresa_copia c '
                   'where c.zerar_id = $1 and c.acao = ''insert'' and c.tabela = $2 and t.tenant_id = $3 '
                   'and t.id = (c.linha ->> ''id'')::uuid', v_p.rel::regclass)
      using p_zerar, v_nome, v_tenant;
  end loop;

  -- 2. nada novo nas tabelas do conjunto desde o zerar (senão a devolução misturaria dados)
  v_alvos := plataforma.alvos_do_zerar(v_tenant);
  for v_nome in select k from jsonb_object_keys(v_alvos) as k order by k loop
    execute format('select count(*) from %s t where t.tenant_id = $1%s', v_nome::regclass,
                   case when jsonb_typeof(v_alvos -> v_nome) = 'string' then ' and (' || (v_alvos ->> v_nome) || ')' else '' end)
      into v_n using v_tenant;
    if v_n > 0 then
      raise exception 'restaurar_zerar: % tem linhas novas desde o zerar', v_nome using errcode = '55000', hint = 'ZERAR_DADOS_NOVOS';
    end if;
  end loop;

  -- 3. as linhas apagadas, mães antes das filhas (ordem inversa à do zerar)
  for v_p in
    select c.tabela, max(c.ordem) as ordem
      from plataforma.zerar_empresa_copia c
     where c.zerar_id = p_zerar and c.acao = 'delete'
     group by c.tabela
     order by max(c.ordem) desc, c.tabela
  loop
    select string_agg(quote_ident(a.attname), ', ' order by a.attnum),
           string_agg('r.' || quote_ident(a.attname), ', ' order by a.attnum)
      into v_cols, v_cols_r
      from pg_attribute a
     where a.attrelid = v_p.tabela::regclass and a.attnum > 0 and not a.attisdropped and a.attgenerated = '';
    -- a linha que um gatilho da mãe já refez com o mesmo id (ex.: os itens da pesquisa.resposta) não duplica
    execute format('insert into %1$s (%2$s) select %3$s from plataforma.zerar_empresa_copia c '
                   'cross join lateral jsonb_populate_record(null::%1$s, c.linha) r '
                   'where c.zerar_id = $1 and c.acao = ''delete'' and c.tabela = $2 '
                   'and not exists (select 1 from %1$s x where x.id = r.id)',
                   v_p.tabela::regclass, v_cols, v_cols_r)
      using p_zerar, v_p.tabela;
    -- toda linha da cópia de volta (pelo id), senão nada muda
    execute format('select count(*), count(*) filter (where not exists (select 1 from %s t where t.id = (c.linha ->> ''id'')::uuid)) '
                   'from plataforma.zerar_empresa_copia c where c.zerar_id = $1 and c.acao = ''delete'' and c.tabela = $2',
                   v_p.tabela::regclass)
      into v_n, v_faltam using p_zerar, v_p.tabela;
    if v_faltam > 0 then
      raise exception 'restaurar_zerar: % linhas de % não voltaram', v_faltam, v_p.tabela
        using errcode = '55000', hint = 'ZERAR_RESTAURO_INCOMPLETO';
    end if;
    v_total := v_total + v_n;
    v_contagem := v_contagem || jsonb_build_object(v_p.tabela, v_n);
  end loop;

  -- 4. o "antes" das colunas alteradas (usuários de volta à filial de cadastro; FKs anuladas em ciclo), na ordem inversa
  for v_p in
    select c.tabela, c.colunas, c.ordem
      from plataforma.zerar_empresa_copia c
     where c.zerar_id = p_zerar and c.acao = 'update'
     group by c.tabela, c.colunas, c.ordem
     order by c.ordem desc, c.tabela
  loop
    execute format('update %1$s t set %2$s from plataforma.zerar_empresa_copia c '
                   'cross join lateral jsonb_populate_record(null::%1$s, c.linha) r '
                   'where c.zerar_id = $1 and c.acao = ''update'' and c.tabela = $2 and c.colunas = $3 and c.ordem = $4 '
                   'and t.tenant_id = $5 and t.id = r.id',
                   v_p.tabela::regclass,
                   (select string_agg(format('%1$I = r.%1$I', x), ', ') from unnest(v_p.colunas) as x))
      using p_zerar, v_p.tabela, v_p.colunas, v_p.ordem, v_tenant;
  end loop;

  -- 5. a cópia e as chaves somem (os bytes voltam a ser usados e não são expurgados)
  delete from plataforma.zerar_empresa_copia c where c.zerar_id = p_zerar;
  delete from plataforma.zerar_empresa_objeto o where o.zerar_id = p_zerar;
  update plataforma.zerar_empresa set desfeito_em = now(), expurgado_em = now() where id = p_zerar;
  perform plataforma.girar_geracao_base(v_tenant);
  perform plataforma.sa_registrar_auditoria(null, null, null, null, v_tenant, 'tenant.zerar_desfeito',
    jsonb_build_object('zerar_id', p_zerar, 'linhas_restauradas', v_total));
  return jsonb_build_object('zerar_id', p_zerar, 'tenant_id', v_tenant, 'linhas_restauradas', v_total, 'contagem', v_contagem);
end
$$;
revoke all on function plataforma.restaurar_zerar(uuid) from public;

-- Conferência pelo catálogo (aborta com 42501 e nada muda): 41 sa_* só do portal; as do worker só do worker; as do dono e as
-- internas de ninguém
do $$
declare
  v_f text;
  v_n int;
begin
  select string_agg(p.oid::regprocedure::text, ', ' order by 1) into v_f
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'plataforma' and p.proname like 'sa\_%'
     and (has_function_privilege('macuxi_app', p.oid, 'execute') or has_function_privilege('macuxi_worker', p.oid, 'execute')
          or exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                      where a.grantee = 0 and a.privilege_type = 'EXECUTE'));
  if v_f is not null then
    raise exception '0099: função sa_* executável pelo macuxi_app, macuxi_worker ou PUBLIC: %', v_f using errcode = '42501';
  end if;
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'plataforma' and p.proname like 'sa\_%' and has_function_privilege('macuxi_portal', p.oid, 'execute');
  if v_n <> 41 then
    raise exception '0099: esperadas 41 funções sa_* executáveis pelo macuxi_portal, há %', v_n using errcode = '42501';
  end if;
  select string_agg(p.oid::regprocedure::text, ', ' order by 1) into v_f
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'plataforma'
     and p.proname in ('pegar_zerar', 'executar_zerar', 'fechar_zerar', 'objetos_do_expurgo_zerar', 'fechar_expurgo_zerar',
                       'zerar_tenant', 'zerar_tenant_manual', 'restaurar_zerar', 'tabelas_mantidas_no_zerar', 'alvos_do_zerar',
                       'previa_do_zerar', 'zerar_bloqueado', 'zerar_empresa_json', 'tabelas_com_tenant', 'passos_em_ordem_fk',
                       'apagar_em_ordem_fk', 'excluir_tenant')
     and (has_function_privilege('macuxi_app', p.oid, 'execute') or has_function_privilege('macuxi_portal', p.oid, 'execute')
          or exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                      where a.grantee = 0 and a.privilege_type = 'EXECUTE')
          or (p.proname not in ('pegar_zerar', 'executar_zerar', 'fechar_zerar', 'objetos_do_expurgo_zerar', 'fechar_expurgo_zerar')
              and has_function_privilege('macuxi_worker', p.oid, 'execute')));
  if v_f is not null then
    raise exception '0099: função do worker, do dono ou interna executável por papel errado: %', v_f using errcode = '42501';
  end if;
end
$$;
