-- 0058_plataforma_diagnostico (up) — T-0158 (diagnóstico do aparelho na nuvem: botão "Enviar diagnóstico" na v1.0.4, queda
-- automática na v1.0.5, Portal › Diagnósticos e recado automático; ADR 0043). Desenho docs/desenho/T-0158.md §4; pedido
-- R-20261110-114603-engenheiro-software (origem R-20261110-101345-alexandre). Contrato: packages/platform-sdk/src/diagnostico.ts.
-- Dicionário: docs/banco/plataforma.md ("Diagnóstico do aparelho (0058)") e docs/banco/lgpd.md (retenção de 90 dias).
-- Migração ADITIVA em cima da 0057: 1 sequência, 1 tabela, 3 funções SECURITY DEFINER. Nada existente muda.
--
-- plataforma.diagnostico: um envio do aparelho (botão, queda ou erro de tela). SÓ dado técnico: empresa e usuário por id
--   (vindos do token na API, nunca do corpo), perfil base, versão, aparelho (fabricante/modelo/Android, nunca IMEI, série ou
--   nome do aparelho), tela (rota SEM query string: CHECK), motivo, descrição livre já mascarada pela API, detalhe técnico
--   (erro, saida_android, sync) em jsonb e o id do print (plataforma.arquivo, modulo 'plataforma', finalidade
--   'print_diagnostico'; SEM FK: o print aguardando é apagado em 7 dias e a linha fica). id = UUID do aparelho (idempotência:
--   insert ... on conflict (id) do nothing; repetição devolve o mesmo protocolo). external_id sempre nulo (fora do insert do
--   app). Fora do sync (db/src/excecoes.ts). Volume: dezenas por dia na plataforma toda; até ~100 mil linhas em 90 dias.
-- protocolo bigint: número legível GLOBAL ("nº 0042"), só da sequência plataforma.diagnostico_protocolo_seq (default; o app
--   não tem INSERT na coluna). Único global (diagnostico_protocolo_uk): nenhum tenant escolhe o valor, colisão impossível;
--   exceção nominal em INDICES_UNICOS_GLOBAIS (tests/integracao/banco/conformidade.test.ts).
-- alerta_*: estado do recado automático (worker): pendente -> enviado | agrupado | falhou | desligado.
--
-- Acesso (desenho §4):
--   macuxi_app: SELECT e INSERT só no próprio tenant (isolamento_tenant). INSERT POR COLUNA: sem protocolo, recebido_em,
--     alerta_*, created_at, updated_at, deleted_at e external_id (o banco preenche; o app nunca forja protocolo nem alerta).
--     USAGE na sequência (o default nextval roda como o app). Sem UPDATE nem DELETE.
--   macuxi_worker: SELECT POR COLUNA em todos os tenants (sem descricao e sem detalhe: o recado nunca leva texto livre nem
--     pilha) e UPDATE só das colunas alerta_* nas linhas pendente/agrupado (políticas diagnostico_alerta*, como as despacho_*
--     das outboxes). Sem DELETE direto: o expurgo de 90 dias é a plataforma.expurgar_diagnosticos (abaixo), que apaga a linha E
--     o arquivo do print na mesma transação (o worker não tem acesso a plataforma.arquivo).
--   macuxi_portal: NENHUM grant de tabela; só as 2 sa_* abaixo (super-admin).
-- Funções (SECURITY DEFINER, search_path fixo com pg_temp por último):
--   plataforma.sa_listar_diagnosticos(p_sid uuid, p_filtro jsonb) -> jsonb: só super-admin (sessão inválida/vencida = 28000;
--     admin do cliente = 42501); filtros versao, modelo, tenant_id, motivo, origem (igualdade), de (>=) e ate (<) sobre
--     recebido_em, cursor keyset (recebido_em, id) opaco "<ISO µs>Z|<uuid>"; 50 por página, do mais novo ao mais antigo;
--     tenant_nome por join em plataforma.tenant; filtro inválido = 22023. EXECUTE só ao macuxi_portal.
--   plataforma.sa_diagnostico(p_sid uuid, p_id uuid) -> jsonb: o detalhe (DiagnosticoDetalheSchema) + print_id e
--     chave_armazenamento do print recebido (nulo sem print). Não achou = P0002. EXECUTE só ao macuxi_portal.
--   As duas auditam em plataforma.auditoria_plataforma (sa.diagnostico.listar com a contagem; sa.diagnostico.ver com o id),
--   sem texto livre.
--   plataforma.expurgar_diagnosticos(p_agora timestamptz, p_limite integer) -> (diagnosticos, arquivos, chaves[]): apaga DE
--     FATO, em lote, os diagnósticos com recebido_em de mais de 90 dias e o arquivo do print deles, e os prints 'aguardando'
--     com mais de 7 dias; devolve as chaves do armazenamento para o worker remover os bytes depois do commit. EXECUTE só ao
--     macuxi_worker (agendamento diário do engenheiro-software, desenho §3).
--
-- Índices (filtros do portal com a ordem da lista; alerta; FK): (recebido_em desc, id desc), (tenant_id, recebido_em desc,
-- id desc), (versao_app, ...), (aparelho_modelo, ...), (motivo, ...), parcial (alerta_proxima_em) where pendente e
-- (tenant_id, usuario_id) da FK composta para core.usuario.
--
-- Caminho de volta: 0058_plataforma_diagnostico.down.sql (APAGA os diagnósticos e a sequência; os metadados dos prints em
-- plataforma.arquivo e os bytes no armazenamento ficam: apague antes pela finalidade 'print_diagnostico' se precisar).

-- =============================================================================================
-- Sequência do protocolo (global, começa em 1)
-- =============================================================================================
create sequence plataforma.diagnostico_protocolo_seq as bigint start with 1 minvalue 1 no cycle;
revoke all on sequence plataforma.diagnostico_protocolo_seq from public;

-- =============================================================================================
-- plataforma.diagnostico
-- =============================================================================================
create table plataforma.diagnostico (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references plataforma.tenant (id),
  protocolo            bigint not null default nextval('plataforma.diagnostico_protocolo_seq'),
  usuario_id           uuid not null,
  perfil               text not null,
  origem               text not null,
  app                  text not null,
  versao_app           text not null,
  build                text,
  aparelho_fabricante  text,
  aparelho_modelo      text,
  android              text,
  android_api          integer,
  tela                 text,
  motivo               text,
  descricao            text,
  detalhe              jsonb not null default '{}'::jsonb,
  print_id             uuid,
  ocorrido_em          timestamptz not null,
  recebido_em          timestamptz not null default now(),
  alerta_situacao      text not null default 'pendente',
  alerta_tentativas    integer not null default 0,
  alerta_proxima_em    timestamptz,
  alerta_recado_id     text,
  alerta_em            timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  deleted_at           timestamptz,
  external_id          text,
  constraint diagnostico_usuario_fk foreign key (tenant_id, usuario_id) references core.usuario (tenant_id, id),
  constraint diagnostico_protocolo_positivo check (protocolo >= 1),
  constraint diagnostico_perfil_valido check (perfil in ('vendedor', 'promotor', 'supervisor', 'gerente', 'analista', 'assistente', 'admin')),
  constraint diagnostico_origem_valida check (origem in ('botao', 'queda', 'erro_tela')),
  constraint diagnostico_app_valido check (app in ('campo', 'gestao')),
  constraint diagnostico_versao_app_faixa check (char_length(btrim(versao_app)) between 1 and 20),
  constraint diagnostico_textos_curtos check (
    (build is null or char_length(build) <= 60)
    and (aparelho_fabricante is null or char_length(aparelho_fabricante) <= 60)
    and (aparelho_modelo is null or char_length(aparelho_modelo) <= 80)
    and (android is null or char_length(android) <= 20)
    and (motivo is null or char_length(motivo) <= 60)
    and (descricao is null or char_length(descricao) <= 1000)
  ),
  constraint diagnostico_android_api_faixa check (android_api is null or android_api between 0 and 1000),
  constraint diagnostico_tela_rota check (tela is null or (char_length(tela) <= 200 and position('?' in tela) = 0 and position('#' in tela) = 0)),
  constraint diagnostico_detalhe_objeto check (
    jsonb_typeof(detalhe) = 'object'
    and octet_length(detalhe::text) <= 32768
    and detalhe - array['erro', 'saida_android', 'sync'] = '{}'::jsonb
  ),
  constraint diagnostico_alerta_situacao_valida check (alerta_situacao in ('pendente', 'enviado', 'agrupado', 'falhou', 'desligado')),
  constraint diagnostico_alerta_tentativas_faixa check (alerta_tentativas between 0 and 100),
  constraint diagnostico_alerta_recado_id_formato check (alerta_recado_id is null or alerta_recado_id ~ '^R-[0-9]{8}-[0-9]{6}-[a-z0-9-]{1,60}$')
);
alter sequence plataforma.diagnostico_protocolo_seq owned by plataforma.diagnostico.protocolo;
create unique index diagnostico_protocolo_uk on plataforma.diagnostico (protocolo);
create index diagnostico_recebido_ix on plataforma.diagnostico (recebido_em desc, id desc);
create index diagnostico_tenant_ix on plataforma.diagnostico (tenant_id, recebido_em desc, id desc);
create index diagnostico_versao_ix on plataforma.diagnostico (versao_app, recebido_em desc, id desc);
create index diagnostico_modelo_ix on plataforma.diagnostico (aparelho_modelo, recebido_em desc, id desc);
create index diagnostico_motivo_ix on plataforma.diagnostico (motivo, recebido_em desc, id desc);
create index diagnostico_alerta_pendente_ix on plataforma.diagnostico (alerta_proxima_em) where alerta_situacao = 'pendente';
create index diagnostico_usuario_ix on plataforma.diagnostico (tenant_id, usuario_id);
create trigger diagnostico_updated_at before update on plataforma.diagnostico
  for each row execute function plataforma.definir_updated_at();
alter table plataforma.diagnostico enable row level security;
alter table plataforma.diagnostico force row level security;
create policy isolamento_tenant on plataforma.diagnostico for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
create policy manutencao on plataforma.diagnostico for all to macuxi_manutencao using (true) with check (true);
-- alerta (worker, desenho §3; como as despacho_* da 0003/0040): lê todos os tenants; marca só linha pendente ou agrupada
create policy diagnostico_alerta on plataforma.diagnostico for select to macuxi_worker
  using (true);
create policy diagnostico_alerta_marcar on plataforma.diagnostico for update to macuxi_worker
  using (alerta_situacao in ('pendente', 'agrupado')) with check (true);
revoke all on plataforma.diagnostico from public;
grant select on plataforma.diagnostico to macuxi_app;
grant insert (id, tenant_id, usuario_id, perfil, origem, app, versao_app, build, aparelho_fabricante, aparelho_modelo, android,
              android_api, tela, motivo, descricao, detalhe, print_id, ocorrido_em) on plataforma.diagnostico to macuxi_app;
grant usage on sequence plataforma.diagnostico_protocolo_seq to macuxi_app;
grant select (id, tenant_id, protocolo, usuario_id, perfil, origem, app, versao_app, build, aparelho_fabricante, aparelho_modelo, android, android_api, tela, motivo, print_id, ocorrido_em, recebido_em, alerta_situacao, alerta_tentativas, alerta_proxima_em, alerta_recado_id, alerta_em) on plataforma.diagnostico to macuxi_worker;
grant update (alerta_situacao, alerta_tentativas, alerta_proxima_em, alerta_recado_id, alerta_em) on plataforma.diagnostico to macuxi_worker;

-- =============================================================================================
-- Portal: lista (só super-admin; keyset por (recebido_em, id), 50 por página)
-- =============================================================================================
create function plataforma.sa_listar_diagnosticos(p_sid uuid, p_filtro jsonb)
  returns jsonb
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_tipo text;
  v_sa uuid;
  v_f jsonb := coalesce(p_filtro, '{}'::jsonb);
  v_versao text;
  v_modelo text;
  v_motivo text;
  v_origem text;
  v_tenant uuid;
  v_de timestamptz;
  v_ate timestamptz;
  v_cursor text;
  v_cur_em timestamptz;
  v_cur_id uuid;
  v_itens jsonb;
  v_total integer;
  v_ultimo text;
begin
  select v.tipo, v.super_admin_id into v_tipo, v_sa from plataforma.sa_sessao_valida(p_sid) v;
  if v_tipo is null then
    raise exception 'sa_listar_diagnosticos: sessão do portal inválida' using errcode = '28000';
  end if;
  if v_tipo is distinct from 'super_admin' or v_sa is null then
    raise exception 'sa_listar_diagnosticos: só o super-admin' using errcode = '42501';
  end if;

  -- filtro (a API confere pelo DiagnosticoFiltroSchema; o banco revalida): só as chaves do contrato, valores texto
  if jsonb_typeof(v_f) is distinct from 'object' then
    raise exception 'sa_listar_diagnosticos: p_filtro deve ser objeto' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_each(v_f) e
              where e.key not in ('versao', 'modelo', 'tenant_id', 'motivo', 'origem', 'de', 'ate', 'cursor')
                 or jsonb_typeof(e.value) <> 'string') then
    raise exception 'sa_listar_diagnosticos: filtro com chave fora do contrato ou valor que não é texto' using errcode = '22023';
  end if;
  v_versao := nullif(v_f ->> 'versao', '');
  v_modelo := nullif(v_f ->> 'modelo', '');
  v_motivo := nullif(v_f ->> 'motivo', '');
  v_origem := nullif(v_f ->> 'origem', '');
  v_cursor := nullif(v_f ->> 'cursor', '');
  if char_length(v_versao) > 20 or char_length(v_modelo) > 80 or char_length(v_motivo) > 60 or char_length(v_cursor) > 200
     or (v_origem is not null and v_origem not in ('botao', 'queda', 'erro_tela')) then
    raise exception 'sa_listar_diagnosticos: filtro fora da faixa' using errcode = '22023';
  end if;
  begin
    v_tenant := nullif(v_f ->> 'tenant_id', '')::uuid;
    v_de := nullif(v_f ->> 'de', '')::timestamptz;
    v_ate := nullif(v_f ->> 'ate', '')::timestamptz;
    if v_cursor is not null then
      if v_cursor !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z\|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'cursor';
      end if;
      v_cur_em := split_part(v_cursor, '|', 1)::timestamptz;
      v_cur_id := split_part(v_cursor, '|', 2)::uuid;
    end if;
  exception when others then
    raise exception 'sa_listar_diagnosticos: tenant_id, de, ate ou cursor inválido' using errcode = '22023';
  end;

  with pagina as (
    select d.id, d.protocolo, d.recebido_em, d.ocorrido_em, d.origem, d.app, d.versao_app, d.aparelho_modelo, d.android, d.motivo,
           d.tenant_id, d.print_id
      from plataforma.diagnostico d
     where d.deleted_at is null
       and (v_versao is null or d.versao_app = v_versao)
       and (v_modelo is null or d.aparelho_modelo = v_modelo)
       and (v_tenant is null or d.tenant_id = v_tenant)
       and (v_motivo is null or d.motivo = v_motivo)
       and (v_origem is null or d.origem = v_origem)
       and (v_de is null or d.recebido_em >= v_de)
       and (v_ate is null or d.recebido_em < v_ate)
       and (v_cur_em is null or (d.recebido_em, d.id) < (v_cur_em, v_cur_id))
     order by d.recebido_em desc, d.id desc
     limit 51
  ), numerada as (
    select p.*, row_number() over (order by p.recebido_em desc, p.id desc) as n from pagina p
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', x.id,
           'protocolo', x.protocolo,
           'recebido_em', to_char(x.recebido_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           'ocorrido_em', to_char(x.ocorrido_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           'origem', x.origem, 'app', x.app, 'versao_app', x.versao_app, 'aparelho_modelo', x.aparelho_modelo,
           'android', x.android, 'motivo', x.motivo, 'tenant_id', x.tenant_id, 'tenant_nome', t.nome,
           'tem_print', exists (select 1 from plataforma.arquivo a
                                 where a.tenant_id = x.tenant_id and a.id = x.print_id and a.modulo = 'plataforma'
                                   and a.finalidade = 'print_diagnostico' and a.situacao = 'recebido' and a.deleted_at is null)
         ) order by x.n) filter (where x.n <= 50), '[]'::jsonb),
         count(*)::integer,
         max(case when x.n = 50 then to_char(x.recebido_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') || '|' || x.id::text end)
    into v_itens, v_total, v_ultimo
    from numerada x
    left join plataforma.tenant t on t.id = x.tenant_id;

  perform plataforma.sa_registrar_auditoria('super_admin', v_sa, null, p_sid, v_tenant, 'sa.diagnostico.listar',
    jsonb_build_object('itens', least(v_total, 50)));
  return jsonb_build_object('itens', v_itens, 'cursor', case when v_total > 50 then v_ultimo end);
end
$$;
revoke all on function plataforma.sa_listar_diagnosticos(uuid, jsonb) from public, macuxi_app, macuxi_worker;
grant execute on function plataforma.sa_listar_diagnosticos(uuid, jsonb) to macuxi_portal;

-- =============================================================================================
-- Portal: detalhe (só super-admin; com a chave do print recebido para a API ler os bytes)
-- =============================================================================================
create function plataforma.sa_diagnostico(p_sid uuid, p_id uuid)
  returns jsonb
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_tipo text;
  v_sa uuid;
  v_d record;
  v_chave text;
begin
  select v.tipo, v.super_admin_id into v_tipo, v_sa from plataforma.sa_sessao_valida(p_sid) v;
  if v_tipo is null then
    raise exception 'sa_diagnostico: sessão do portal inválida' using errcode = '28000';
  end if;
  if v_tipo is distinct from 'super_admin' or v_sa is null then
    raise exception 'sa_diagnostico: só o super-admin' using errcode = '42501';
  end if;
  if p_id is null then
    raise exception 'sa_diagnostico: p_id obrigatório' using errcode = '22023';
  end if;

  select d.*, t.nome as tenant_nome into v_d
    from plataforma.diagnostico d
    left join plataforma.tenant t on t.id = d.tenant_id
   where d.id = p_id and d.deleted_at is null;
  if not found then
    raise exception 'sa_diagnostico: diagnóstico não encontrado' using errcode = 'P0002';
  end if;
  select a.chave_armazenamento into v_chave
    from plataforma.arquivo a
   where a.tenant_id = v_d.tenant_id and a.id = v_d.print_id and a.modulo = 'plataforma' and a.finalidade = 'print_diagnostico'
     and a.situacao = 'recebido' and a.deleted_at is null;

  perform plataforma.sa_registrar_auditoria('super_admin', v_sa, null, p_sid, v_d.tenant_id, 'sa.diagnostico.ver',
    jsonb_build_object('diagnostico_id', v_d.id, 'protocolo', v_d.protocolo));
  return jsonb_build_object(
    'id', v_d.id,
    'protocolo', v_d.protocolo,
    'recebido_em', to_char(v_d.recebido_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'ocorrido_em', to_char(v_d.ocorrido_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'origem', v_d.origem, 'app', v_d.app, 'versao_app', v_d.versao_app, 'build', v_d.build,
    'aparelho_fabricante', v_d.aparelho_fabricante, 'aparelho_modelo', v_d.aparelho_modelo, 'android', v_d.android,
    'android_api', v_d.android_api, 'tela', v_d.tela, 'motivo', v_d.motivo,
    'tenant_id', v_d.tenant_id, 'tenant_nome', v_d.tenant_nome, 'usuario_id', v_d.usuario_id, 'perfil', v_d.perfil,
    'descricao', v_d.descricao,
    'erro', v_d.detalhe -> 'erro', 'saida_android', v_d.detalhe -> 'saida_android', 'sync', v_d.detalhe -> 'sync',
    'tem_print', v_chave is not null, 'print_id', v_d.print_id, 'chave_armazenamento', v_chave,
    'alerta', jsonb_build_object(
      'situacao', v_d.alerta_situacao, 'recado_id', v_d.alerta_recado_id,
      'em', to_char(v_d.alerta_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
  );
end
$$;
revoke all on function plataforma.sa_diagnostico(uuid, uuid) from public, macuxi_app, macuxi_worker;
grant execute on function plataforma.sa_diagnostico(uuid, uuid) to macuxi_portal;

-- =============================================================================================
-- Expurgo (LGPD, 90 dias; prints aguardando, 7 dias): só o worker
-- =============================================================================================
create function plataforma.expurgar_diagnosticos(p_agora timestamptz default now(), p_limite integer default 500)
  returns table (diagnosticos integer, arquivos integer, chaves text[])
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_velhos record;
  v_ids uuid[];
  v_prints uuid[];
  v_tenants uuid[];
  v_chaves text[];
  v_chaves_ag text[];
  v_n_arq integer;
  v_n_ag integer;
begin
  if p_agora is null or p_limite is null or p_limite < 1 or p_limite > 5000 then
    raise exception 'expurgar_diagnosticos: p_agora obrigatório e p_limite entre 1 e 5000' using errcode = '22023';
  end if;

  -- 1. diagnósticos recebidos há mais de 90 dias (o mais antigo primeiro; linha travada pelo alerta fica para o próximo ciclo)
  select array_agg(d.id), array_agg(d.print_id), array_agg(d.tenant_id) into v_ids, v_prints, v_tenants
    from (select x.id, x.print_id, x.tenant_id from plataforma.diagnostico x
           where x.recebido_em < p_agora - interval '90 days'
           order by x.recebido_em, x.id
           limit p_limite
             for update skip locked) d;
  diagnosticos := 0;
  if v_ids is not null then
    delete from plataforma.diagnostico x where x.id = any (v_ids);
    get diagnostics diagnosticos = row_count;
  end if;

  -- 2. o print desses diagnósticos (mesma transação)
  with apagados as (
    delete from plataforma.arquivo a
     using unnest(v_tenants, v_prints) as p(tenant_id, print_id)
     where p.print_id is not null and a.tenant_id = p.tenant_id and a.id = p.print_id
       and a.modulo = 'plataforma' and a.finalidade = 'print_diagnostico'
    returning a.chave_armazenamento
  )
  select count(*)::integer, array_agg(ap.chave_armazenamento) filter (where ap.chave_armazenamento is not null)
    into v_n_arq, v_chaves
    from apagados ap;

  -- 3. prints que nunca chegaram (aguardando há mais de 7 dias)
  with apagados as (
    delete from plataforma.arquivo a
     where a.id in (select y.id from plataforma.arquivo y
                     where y.modulo = 'plataforma' and y.finalidade = 'print_diagnostico' and y.situacao = 'aguardando'
                       and y.created_at < p_agora - interval '7 days'
                     order by y.created_at, y.id
                     limit p_limite)
    returning a.chave_armazenamento
  )
  select count(*)::integer, array_agg(ap.chave_armazenamento) filter (where ap.chave_armazenamento is not null)
    into v_n_ag, v_chaves_ag
    from apagados ap;

  arquivos := v_n_arq + v_n_ag;
  chaves := coalesce(v_chaves, '{}'::text[]) || coalesce(v_chaves_ag, '{}'::text[]);
  return next;
end
$$;
revoke all on function plataforma.expurgar_diagnosticos(timestamptz, integer) from public;
grant execute on function plataforma.expurgar_diagnosticos(timestamptz, integer) to macuxi_worker;

-- =============================================================================================
-- Conferência pelo catálogo (a da 0047, agora com 16 sa_* do portal; aborta com 42501 e nada muda)
-- =============================================================================================
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
    raise exception '0058: função executável pelo macuxi_app, macuxi_worker ou PUBLIC: %', v_f using errcode = '42501';
  end if;
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'plataforma' and p.proname like 'sa\_%' and has_function_privilege('macuxi_portal', p.oid, 'execute');
  if v_n <> 16 then
    raise exception '0058: esperadas 16 funções sa_* executáveis pelo macuxi_portal, há %', v_n using errcode = '42501';
  end if;
  if has_function_privilege('macuxi_app', 'plataforma.expurgar_diagnosticos(timestamptz, integer)', 'execute')
     or has_function_privilege('macuxi_portal', 'plataforma.expurgar_diagnosticos(timestamptz, integer)', 'execute') then
    raise exception '0058: plataforma.expurgar_diagnosticos executável pelo app ou pelo portal' using errcode = '42501';
  end if;
  if has_table_privilege('macuxi_portal', 'plataforma.diagnostico', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
     or has_table_privilege('macuxi_app', 'plataforma.diagnostico', 'UPDATE, DELETE, TRUNCATE')
     or has_table_privilege('macuxi_worker', 'plataforma.diagnostico', 'INSERT, DELETE, TRUNCATE') then
    raise exception '0058: privilégio de tabela fora do desenho em plataforma.diagnostico' using errcode = '42501';
  end if;
end
$$;
