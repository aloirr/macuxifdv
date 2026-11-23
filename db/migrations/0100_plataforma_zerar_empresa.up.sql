-- 0100_plataforma_zerar_empresa (up) — "Zerar dados" da empresa (v1.0.31; ADR 0068; desenho docs/desenho/empresa-zerar.md §2,
-- §4 e §5; RN-PLA-12; contrato packages/platform-sdk/src/empresa-zerar.ts). Migração em cima da 0098 e 0099 (sessão C); o número segue
-- a ordem de merge (provisório até o gerente confirmar). Dicionário: docs/banco/plataforma.md ("Zerar dados da empresa (0100)")
-- e docs/banco/rls.md. Teste: db/testes/empresa-zerar.db.test.ts.
--
-- UMA regra só: plataforma.limpar_cadastros(tenant, lote, entidades, exigir_hub_parado, simular) é o corpo da
-- pg_temp.macuxi_limpar_cadastros do PR #675 (scripts/producao/limpar-cadastros-rotina.sql, f2556d68) promovido a SECURITY
-- DEFINER, com as mudanças do §4.1 do desenho: lote com o sufixo do portal; cópia em plataforma.limpeza_copia; trava do Hub SÓ
-- da empresa (o conector e os lotes dela em FOR UPDATE; o Hub das outras segue) e recusa (55000 ZERAR_HUB_PROCESSANDO) só com
-- exigir_hub_parado; rótulos = nome puro da tabela e o modo diz o que foi feito; o modo por entidade (p_entidades, mapa em
-- plataforma.mapa_limpeza_entidades()); e p_simular: as mesmas raízes e a mesma cascata, só contando (sem cópia, sem UPDATE,
-- sem DELETE, sem trava). Com p_entidades nulo, o resultado é o do #675 (o teste guarda o retrato fixo dele nos dados de
-- scripts/producao/teste/limpar-cadastros-dados.sql). Não abre nem fecha transação: quem chama decide entre COMMIT (gravar) e
-- ROLLBACK (simular). Quem chama: a executar_previa_zerar (worker, p_simular, numa subtransação desfeita), a executar_zerar
-- (worker) e o workflow producao-limpar-cadastros.yml (psql do migrador).
--
-- 1. Tabelas (RLS ligado e FORÇADO, só a política manutencao, nenhum grant: app, worker e portal 42501; só por função):
--    - plataforma.limpeza_copia: a cópia de cada linha que a limpeza muda, por lote. As 6 primeiras colunas são as da
--      public.macuxi_limpeza_backup do #675, na mesma ordem (o tenant em empresa_id, sem FK, como nas tabelas da 0072); depois
--      vêm as comuns da regra 5. A migração move para ela as linhas da public.macuxi_limpeza_backup, se existir, e apaga a public;
--    - plataforma.zerar_empresa: o job do portal (id do portal, lote, entidades), em_andamento -> concluido | falhou; um em
--      andamento por empresa; contagem = a lista LinhaLimpeza[]; no máximo 3 vezes no worker (depois falhou ZERAR_FALHOU);
--    - plataforma.zerar_previa: a prévia pedida pelo portal e contada pelo worker (fora do pool do portal, de 10 s), em_andamento
--      -> pronta | falhou; vale 1 hora; no máximo 3 vezes no worker.
--    As três sem tenant_id nem FK (sobrevivem à excluir_tenant, como as da 0072); a cópia sai pelo descarte ou pelo expurgo.
-- 2. A regra (sem EXECUTE para ninguém; só o dono): limpar_cadastros (SECURITY DEFINER), mapa_limpeza_entidades,
--    entidades_limpeza_ordenadas e entidades_afetadas_limpeza; a volta e o descarte do workflow: restaurar_limpeza e
--    descartar_limpeza (SECURITY INVOKER); as internas zerar_bloqueado e zerar_empresa_json.
-- 3. Portal (SECURITY DEFINER; EXECUTE só ao macuxi_portal; sessão inválida 28000, admin do cliente 42501; código do contrato no
--    hint: 55000 = 409, 22023 = 422, P0002 = 404): sa_pedir_previa_zerar, sa_ler_previa_zerar, sa_pedir_zerar e sa_ler_zerar
--    (42 sa_* no portal).
-- 4. Worker (SECURITY DEFINER; EXECUTE só ao macuxi_worker; o tenant sai da linha do job): pegar_previa_zerar,
--    executar_previa_zerar, pegar_zerar, executar_zerar, fechar_zerar e expurgar_zerar.
-- O bloqueio (RN-PLA-12) tem um lugar só: plataforma.zerar_bloqueado. A prévia o devolve em "bloqueio" e o zerar recusado no
-- worker o grava em erro_codigo (sa_ler_zerar).
-- Auditoria (plataforma.auditoria_plataforma, sem dado pessoal): tenant.zerar_pedido, tenant.zerado (detalhes = payload de
-- plataforma.tenant.zerado@1), tenant.zerar_falhou e tenant.zerar_desfeito. A excluir_tenant fica como na 0032.
--
-- Caminho de volta: 0100_plataforma_zerar_empresa.down.sql. Devolve as cópias para a public.macuxi_limpeza_backup (o workflow de
-- uma tag anterior restaura com elas) e PERDE os registros de zerar do portal: desligue antes as rotas e o worker do zerar na API
-- (chamam funções que somem).

-- 1. Tabelas ----------------------------------------------------------------------------------------------------------------------
create table plataforma.limpeza_copia (
  lote         text not null,
  empresa_id   uuid not null,
  tabela       text not null,
  modo         text not null,
  linha        jsonb not null,
  copiado_em   timestamptz not null default now(),
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  external_id  text,
  constraint limpeza_copia_modo_valido check (modo in ('soft', 'fisico', 'filial', 'sync_pacote')),
  constraint limpeza_copia_lote_formato check (lote ~ '^[0-9]{8}T[0-9]{6}Z(-[0-9a-f]{8})?$'),
  constraint limpeza_copia_linha_objeto check (jsonb_typeof(linha) = 'object')
);
create index limpeza_copia_lote_ix on plataforma.limpeza_copia (lote, tabela);
create index limpeza_copia_empresa_ix on plataforma.limpeza_copia (empresa_id, lote);
create trigger limpeza_copia_updated_at before update on plataforma.limpeza_copia
  for each row execute function plataforma.definir_updated_at();
alter table plataforma.limpeza_copia enable row level security;
alter table plataforma.limpeza_copia force row level security;
create policy manutencao on plataforma.limpeza_copia for all to macuxi_manutencao using (true) with check (true);
revoke all on plataforma.limpeza_copia from public, macuxi_app, macuxi_worker;

-- o workflow do #675 pode ter rodado antes da v1.0.31: as cópias dele passam para a tabela nova
do $$
begin
  if to_regclass('public.macuxi_limpeza_backup') is not null then
    insert into plataforma.limpeza_copia (lote, empresa_id, tabela, modo, linha, copiado_em)
    select b.lote, b.tenant_id, b.tabela, b.modo, b.linha, b.copiado_em from public.macuxi_limpeza_backup b;
    drop table public.macuxi_limpeza_backup;
  end if;
end
$$;

-- RN-PLA-12: as 16 entidades do Hub (ENTIDADES_ZERAR do SDK = ORDEM_CARGA_ENTIDADES), com a ordem de carga e as tabelas raiz do
-- domínio (linhas vivas COM external_id; core.usuario = os não administradores, com ou sem external_id; filial sem raiz: só perde
-- o external_id). preco leva também o item (o registro do Hub é o item de tabela).
create function plataforma.mapa_limpeza_entidades()
  returns jsonb
  language sql immutable security invoker
  set search_path = pg_catalog, pg_temp
  as $$
    select '{
      "filial": {"ordem": 1, "raizes": []},
      "vendedor": {"ordem": 2, "raizes": ["core.usuario"]},
      "catalogo_no": {"ordem": 3, "raizes": ["catalogo.catalogo_no"]},
      "forma_pagamento": {"ordem": 4, "raizes": ["vendedor.forma_pagamento"]},
      "prazo_pagamento": {"ordem": 5, "raizes": ["vendedor.prazo_pagamento"]},
      "produto": {"ordem": 6, "raizes": ["core.produto"]},
      "produto_unidade": {"ordem": 7, "raizes": ["core.produto_unidade"]},
      "preco": {"ordem": 8, "raizes": ["catalogo.tabela_preco", "catalogo.tabela_preco_item"]},
      "tabela_escalonada": {"ordem": 9, "raizes": ["catalogo.tabela_escalonada"]},
      "estoque": {"ordem": 10, "raizes": ["catalogo.estoque_saldo", "catalogo.deposito"]},
      "cliente": {"ordem": 11, "raizes": ["core.cliente"]},
      "cliente_endereco": {"ordem": 12, "raizes": ["core.cliente_endereco"]},
      "transportadora": {"ordem": 13, "raizes": ["vendedor.transportadora"]},
      "rota": {"ordem": 14, "raizes": ["core.rota"]},
      "titulo": {"ordem": 15, "raizes": ["core.titulo"]},
      "nota": {"ordem": 16, "raizes": ["core.nota_erp"]}
    }'::jsonb
  $$;
revoke all on function plataforma.mapa_limpeza_entidades() from public;

-- As entidades conhecidas de p, sem repetição, na ordem de carga (null = null). Lista válida = mesma cardinalidade.
create function plataforma.entidades_limpeza_ordenadas(p text[])
  returns text[]
  language sql immutable security invoker
  set search_path = pg_catalog, pg_temp
  as $$
    select case when p is null then null else
      array(select e.key from jsonb_each(plataforma.mapa_limpeza_entidades()) e where e.key = any (p)
             order by (e.value ->> 'ordem')::int) end
  $$;
revoke all on function plataforma.entidades_limpeza_ordenadas(text[]) from public;

-- entidades_afetadas (desenho §4.3): as pedidas e as entidades cujas raízes tiveram linhas soft no resultado (filial: linhas no
-- modo filial), na ordem de carga. p_resultado = lista LinhaLimpeza ([{tabela, modo, linhas}]).
create function plataforma.entidades_afetadas_limpeza(p_resultado jsonb, p_entidades text[])
  returns text[]
  language sql immutable security invoker
  set search_path = pg_catalog, pg_temp
  as $$
    select array(
      select e.key from jsonb_each(plataforma.mapa_limpeza_entidades()) e
       where e.key = any (coalesce(p_entidades, '{}'::text[]))
          or exists (select 1 from jsonb_array_elements(coalesce(p_resultado, '[]'::jsonb)) l
                      where (l ->> 'linhas')::bigint > 0
                        and ((l ->> 'modo' = 'soft' and e.value -> 'raizes' ? (l ->> 'tabela'))
                             or (e.key = 'filial' and l ->> 'modo' = 'filial')))
       order by (e.value ->> 'ordem')::int)
  $$;
revoke all on function plataforma.entidades_afetadas_limpeza(jsonb, text[]) from public;

create table plataforma.zerar_empresa (
  id                  uuid primary key,
  empresa_id          uuid not null,
  codigo              text not null,
  lote                text not null,
  entidades           text[],
  entidades_afetadas  text[],
  situacao            text not null default 'em_andamento',
  pedido_em           timestamptz not null default now(),
  concluido_em        timestamptz,
  linhas_apagadas     bigint,
  contagem            jsonb,
  copia_expira_em     timestamptz,
  expurgado_em        timestamptz,
  desfeito_em         timestamptz,
  erro_codigo         text,
  tentativas          integer not null default 0,
  bloqueado_ate       timestamptz,
  super_admin_id      uuid not null,
  sessao_id           uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz,
  external_id         text,
  constraint zerar_empresa_lote_uk unique (lote),
  constraint zerar_empresa_lote_formato check (lote ~ '^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}$'),
  constraint zerar_empresa_entidades_validas check (entidades is null
    or (cardinality(entidades) >= 1 and entidades = plataforma.entidades_limpeza_ordenadas(entidades))),
  constraint zerar_empresa_afetadas_validas check (entidades_afetadas is null
    or entidades_afetadas = plataforma.entidades_limpeza_ordenadas(entidades_afetadas)),
  constraint zerar_empresa_situacao_valida check (situacao in ('em_andamento', 'concluido', 'falhou')),
  constraint zerar_empresa_erro_formato check (erro_codigo is null or erro_codigo ~ '^[A-Z][A-Z0-9_]{1,59}$'),
  constraint zerar_empresa_erro_so_na_falha check ((situacao = 'falhou') = (erro_codigo is not null)),
  constraint zerar_empresa_concluido_completo check ((situacao = 'concluido') = (concluido_em is not null
    and linhas_apagadas is not null and contagem is not null and copia_expira_em is not null and entidades_afetadas is not null)),
  constraint zerar_empresa_copia_so_concluido check ((expurgado_em is null and desfeito_em is null) or situacao = 'concluido'),
  constraint zerar_empresa_contagens_positivas check ((linhas_apagadas is null or linhas_apagadas >= 0) and tentativas >= 0),
  constraint zerar_empresa_contagem_lista check (contagem is null or jsonb_typeof(contagem) = 'array')
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

-- A prévia (PreviaZerarEmpresa): pedida pelo portal (sa_pedir_previa_zerar, id do portal), contada pelo worker
-- (executar_previa_zerar: a limpar_cadastros no modo simular) e lida pelo portal (sa_ler_previa_zerar). resultado = {linhas,
-- entidades_afetadas, total}; o bloqueio é calculado na leitura (zerar_bloqueado). Vale 1 hora (o pegar_previa_zerar apaga as
-- vencidas); no máximo 3 vezes no worker.
create table plataforma.zerar_previa (
  id              uuid primary key,
  empresa_id      uuid not null,
  entidades       text[],
  situacao        text not null default 'em_andamento',
  resultado       jsonb,
  erro_codigo     text,
  tentativas      integer not null default 0,
  bloqueado_ate   timestamptz,
  expira_em       timestamptz not null default now() + interval '1 hour',
  super_admin_id  uuid not null,
  sessao_id       uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  external_id     text,
  constraint zerar_previa_entidades_validas check (entidades is null
    or (cardinality(entidades) >= 1 and entidades = plataforma.entidades_limpeza_ordenadas(entidades))),
  constraint zerar_previa_situacao_valida check (situacao in ('em_andamento', 'pronta', 'falhou')),
  constraint zerar_previa_erro_formato check (erro_codigo is null or erro_codigo ~ '^[A-Z][A-Z0-9_]{1,59}$'),
  constraint zerar_previa_erro_so_na_falha check ((situacao = 'falhou') = (erro_codigo is not null)),
  constraint zerar_previa_resultado_so_pronta check ((situacao = 'pronta') = (resultado is not null)),
  constraint zerar_previa_resultado_formato check (resultado is null or (jsonb_typeof(resultado -> 'linhas') = 'array'
    and jsonb_typeof(resultado -> 'entidades_afetadas') = 'array' and jsonb_typeof(resultado -> 'total') = 'number')),
  constraint zerar_previa_tentativas_positivas check (tentativas >= 0)
);
create index zerar_previa_empresa_ix on plataforma.zerar_previa (empresa_id, created_at desc, id);
create index zerar_previa_fila_ix on plataforma.zerar_previa (created_at, id) where situacao = 'em_andamento';
create index zerar_previa_expira_ix on plataforma.zerar_previa (expira_em, id);
create trigger zerar_previa_updated_at before update on plataforma.zerar_previa
  for each row execute function plataforma.definir_updated_at();
alter table plataforma.zerar_previa enable row level security;
alter table plataforma.zerar_previa force row level security;
create policy manutencao on plataforma.zerar_previa for all to macuxi_manutencao using (true) with check (true);
revoke all on plataforma.zerar_previa from public, macuxi_app, macuxi_worker;

-- 2. A regra ----------------------------------------------------------------------------------------------------------------------
-- Corpo da pg_temp.macuxi_limpar_cadastros do #675 (as regras do cabeçalho de scripts/producao/limpar-cadastros-rotina.sql valem
-- aqui): RAÍZES, CASCATA (FK, nome de coluna, plataforma.arquivo pelo entidade_id, posse × autoria), FICA (c_fica e o schema
-- plataforma, menos arquivo, usuario_perfil e usuario_modulo), FILIAIS (ficam sem o external_id), MODO (soft no domínio, físico
-- no Hub: c_fisico), OUTBOX, pacote de sync e geracao_base. Com p_entidades (desenho §4.3): as raízes são só as das entidades
-- (mapa_limpeza_entidades) e o Hub de toda entidade afetada, pedida ou caída pela cascata (as 8 tabelas com a coluna entidade;
-- staging, erros e recebidos pela cascata); o pedido que perde item sai inteiro; os derivados só pela cascata; as filiais
-- só com filial na lista; a outbox só pelo agregado_id. Devolve (r_ordem, r_tabela, r_modo, r_linhas): só nomes e contagens.
create function plataforma.limpar_cadastros(p_tenant uuid, p_lote text, p_entidades text[] default null,
                                            p_exigir_hub_parado boolean default true, p_simular boolean default false)
  returns table (r_ordem int, r_tabela text, r_modo text, r_linhas bigint)
  language plpgsql volatile security definer
  set search_path = pg_catalog, pg_temp
  as $$
declare
  -- todas as linhas da empresa, DELETE físico, filhos antes dos pais (FKs)
  c_hub constant text[] := array['integracao.inativacao_auditoria', 'integracao.pendencia_inativacao',
    'integracao.lote_linha_erro', 'integracao.lote_staging', 'integracao.lote', 'integracao.sessao_carga_recebido',
    'integracao.sessao_carga', 'integracao.registro_atual', 'integracao.cursor_entidade', 'integracao.reconciliacao',
    'integracao.coleta_execucao', 'gestor.projecao_fato'];
  -- filas do Hub que só saem com o cliente ou o pedido (cascata), DELETE físico, filhos antes dos pais
  c_filas constant text[] := array['integracao.cliente_fila_erp', 'integracao.pedido_retorno_erro',
    'integracao.pedido_retorno', 'integracao.pedido_fila_erp'];
  c_fisico constant text[] := c_hub || c_filas;
  -- todas as linhas vivas da empresa, soft
  c_derivados constant text[] := array['gestor.alerta', 'core.indicador_diario'];
  -- nunca entram na cascata
  c_fica constant text[] := array['core.filial', 'core.usuario_codigo_fdv_contador', 'core.equipe', 'core.medida',
    'core.foto_tipo', 'core.motivo', 'core.frase_dia', 'core.documento_tipo', 'core.documento_permissao',
    'core.documento_excecao', 'core.plano_rv', 'integracao.conector', 'integracao.conector_api', 'integracao.credencial',
    'integracao.credencial_erp', 'integracao.mapeamento', 'integracao.implantacao', 'integracao.implantacao_dia',
    'integracao.politica_versao', 'vendedor.numeracao_pedido', 'vendedor.condicao_pagamento'];
  -- referência entre módulos sem FK: nome da coluna (uuid) -> tabela
  c_nome constant jsonb := '{"cliente_id": "core.cliente", "cliente_uuid": "core.cliente", "produto_id": "core.produto",
    "relacionado_id": "core.produto", "pedido_id": "vendedor.pedido", "pedido_uuid": "vendedor.pedido",
    "orcamento_id": "vendedor.pedido", "visita_id": "core.visita", "deposito_id": "catalogo.deposito",
    "tabela_preco_id": "catalogo.tabela_preco", "rota_id": "core.rota", "rota_parada_id": "core.rota_parada",
    "no_id": "catalogo.catalogo_no", "usuario_id": "core.usuario", "vendedor_id": "core.usuario",
    "promotor_id": "core.usuario"}';
  -- colunas de posse: as únicas que levam a linha junto com o usuário (as de autoria ficam como histórico)
  c_posse constant text[] := array['usuario_id', 'vendedor_id', 'promotor_id'];
  -- do schema plataforma, só estas entram na cascata
  c_plataforma constant text[] := array['arquivo', 'usuario_perfil', 'usuario_modulo'];
  c_schemas constant text[] := array['core', 'catalogo', 'vendedor', 'promotor', 'pesquisa', 'treinamento', 'gestor', 'integracao', 'plataforma'];
  -- por entidade: as tabelas do Hub com a coluna entidade (as demais do Hub saem pela cascata das FKs)
  c_hub_entidade constant text[] := array['integracao.inativacao_auditoria', 'integracao.pendencia_inativacao',
    'integracao.lote', 'integracao.sessao_carga', 'integracao.registro_atual', 'integracao.cursor_entidade',
    'integracao.reconciliacao', 'integracao.coleta_execucao'];
  c_mapa constant jsonb := plataforma.mapa_limpeza_entidades();
  v_inteira constant boolean := p_entidades is null;
  v_entidades text[];
  v_afetadas text[];
  r record;
  n bigint;
  v_novos bigint;
  v_volta int := 0;
  t text;
begin
  if p_tenant is null or p_lote is null or p_lote !~ '^[0-9]{8}T[0-9]{6}Z(-[0-9a-f]{8})?$' then
    raise exception 'tenant ou lote inválido' using errcode = '22023';
  end if;
  if not v_inteira then
    v_entidades := plataforma.entidades_limpeza_ordenadas(p_entidades);
    if cardinality(p_entidades) = 0 or cardinality(v_entidades) <> cardinality(p_entidades) then
      raise exception 'entidades inválidas: vazia, repetida ou fora da lista' using errcode = '22023';
    end if;
  end if;
  perform set_config('app.tenant_id', p_tenant::text, true);
  if p_exigir_hub_parado then
    -- trava do Hub SÓ desta empresa (o das outras segue; antes era um lock table para todas): o conector dela em FOR UPDATE
    -- barra lote, sessão de carga e registro novos (as FKs para integracao.conector tomam FOR KEY SHARE); os lotes dela em FOR
    -- UPDATE barram a troca de situação (recebido -> processando, reprocessar). Com o lock_timeout do worker: 55P03 e nova
    -- tentativa. O simular não trava nada.
    if not p_simular then
      perform 1 from integracao.conector c where c.tenant_id = p_tenant for update;
      perform 1 from integracao.lote l where l.tenant_id = p_tenant for update;
    end if;
    if exists (select 1 from integracao.lote l where l.tenant_id = p_tenant and l.status = 'processando') then
      raise exception 'lote do Hub em processamento nesta empresa: espere terminar (nada mudou)'
        using errcode = '55000', hint = 'ZERAR_HUB_PROCESSANDO';
    end if;
  end if;

  drop table if exists pg_temp._limpeza_alvo, pg_temp._limpeza_ref, pg_temp._limpeza_resumo;
  create temp table _limpeza_alvo (tabela text not null, id uuid not null, primary key (tabela, id)) on commit drop;
  create temp table _limpeza_resumo (ordem int, tabela text, modo text, linhas bigint) on commit drop;

  -- 1. raízes
  if v_inteira then
    insert into _limpeza_alvo select 'core.cliente', x.id from core.cliente x where x.tenant_id = p_tenant and x.deleted_at is null and x.external_id is not null;
    insert into _limpeza_alvo select 'core.produto', x.id from core.produto x where x.tenant_id = p_tenant and x.deleted_at is null and x.external_id is not null;
    insert into _limpeza_alvo select 'catalogo.catalogo_no', x.id from catalogo.catalogo_no x where x.tenant_id = p_tenant and x.deleted_at is null and x.external_id is not null;
    insert into _limpeza_alvo select 'catalogo.tabela_preco', x.id from catalogo.tabela_preco x where x.tenant_id = p_tenant and x.deleted_at is null and x.external_id is not null;
    insert into _limpeza_alvo select 'catalogo.deposito', x.id from catalogo.deposito x where x.tenant_id = p_tenant and x.deleted_at is null and x.external_id is not null;
    insert into _limpeza_alvo select 'vendedor.forma_pagamento', x.id from vendedor.forma_pagamento x where x.tenant_id = p_tenant and x.deleted_at is null and x.external_id is not null;
    insert into _limpeza_alvo select 'vendedor.prazo_pagamento', x.id from vendedor.prazo_pagamento x where x.tenant_id = p_tenant and x.deleted_at is null and x.external_id is not null;
    insert into _limpeza_alvo select 'vendedor.transportadora', x.id from vendedor.transportadora x where x.tenant_id = p_tenant and x.deleted_at is null and x.external_id is not null;
    insert into _limpeza_alvo select 'core.rota', x.id from core.rota x where x.tenant_id = p_tenant and x.deleted_at is null and x.external_id is not null;
    insert into _limpeza_alvo select 'core.titulo', x.id from core.titulo x where x.tenant_id = p_tenant and x.deleted_at is null and x.external_id is not null;
    insert into _limpeza_alvo select 'core.nota_erp', x.id from core.nota_erp x where x.tenant_id = p_tenant and x.deleted_at is null and x.external_id is not null;
    insert into _limpeza_alvo select 'vendedor.pedido', x.id from vendedor.pedido x where x.tenant_id = p_tenant and x.deleted_at is null;
  end if;
  if v_inteira or 'vendedor' = any (v_entidades) then
    insert into _limpeza_alvo select 'core.usuario', u.id from core.usuario u
     where u.tenant_id = p_tenant and u.deleted_at is null and u.perfil <> 'admin'
       and not exists (select 1 from plataforma.usuario_perfil up join plataforma.perfil pf on pf.tenant_id = up.tenant_id and pf.id = up.perfil_id
                        where up.tenant_id = u.tenant_id and up.usuario_id = u.id and up.deleted_at is null and pf.base = 'admin');
  end if;
  if v_inteira then
    foreach t in array c_hub loop
      execute format('insert into _limpeza_alvo select %L, x.id from %s x where x.tenant_id = %L', t, t, p_tenant);
    end loop;
    foreach t in array c_derivados loop
      execute format('insert into _limpeza_alvo select %L, x.id from %s x where x.tenant_id = %L and x.deleted_at is null', t, t, p_tenant);
    end loop;
  else
    for r in select distinct x.tabela from jsonb_each(c_mapa) e cross join lateral jsonb_array_elements_text(e.value -> 'raizes') x(tabela)
              where e.key = any (v_entidades) and x.tabela <> 'core.usuario' order by 1 loop
      execute format('insert into _limpeza_alvo select %L, x.id from %s x where x.tenant_id = %L and x.deleted_at is null and x.external_id is not null on conflict do nothing',
                     r.tabela, r.tabela, p_tenant);
    end loop;
  end if;

  -- 2. cascata: referências (FK para o id, ou nome de coluna entre módulos) de tabelas do domínio com tenant_id, id e deleted_at
  create temp table _limpeza_ref on commit drop as
  with tabelas as (
    select c.oid, n.nspname || '.' || c.relname as nome
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where c.relkind in ('r', 'p') and n.nspname = any (c_schemas)
       and (n.nspname <> 'plataforma' or c.relname = any (c_plataforma))
       and not (n.nspname || '.' || c.relname) = any (c_fica)
       and (select count(*) from pg_attribute a where a.attrelid = c.oid and not a.attisdropped
             and a.attname in ('tenant_id', 'id', 'deleted_at')) = 3),
  por_fk as (
    select tb.nome as tabela, a.attname::text as coluna, fn.nspname || '.' || fc.relname as alvo
      from pg_constraint k
      join tabelas tb on tb.oid = k.conrelid
      join pg_class fc on fc.oid = k.confrelid join pg_namespace fn on fn.oid = fc.relnamespace
      cross join lateral unnest(k.conkey, k.confkey) as u(ck, fk)
      join pg_attribute a on a.attrelid = k.conrelid and a.attnum = u.ck
      join pg_attribute fa on fa.attrelid = k.confrelid and fa.attnum = u.fk
     where k.contype = 'f' and fa.attname = 'id' and a.attname <> 'tenant_id'),
  por_nome as (
    select tb.nome as tabela, a.attname::text as coluna, c_nome ->> a.attname::text as alvo
      from tabelas tb join pg_attribute a on a.attrelid = tb.oid and not a.attisdropped
     where c_nome ? a.attname::text and a.atttypid = 'uuid'::regtype)
  select distinct x.tabela, x.coluna, x.alvo from (select * from por_fk union all select * from por_nome) x
   where x.alvo <> 'core.usuario' or x.coluna = any (c_posse);

  <<cascata>> loop
    v_volta := 0;
    loop
      v_volta := v_volta + 1;
      v_novos := 0;
      for r in select f.tabela, f.coluna, f.alvo from _limpeza_ref f
                where exists (select 1 from _limpeza_alvo a where a.tabela = f.alvo) order by 1, 2 loop
        execute format('insert into _limpeza_alvo select %L, x.id from %s x where x.tenant_id = %L and x.%I in (select a.id from _limpeza_alvo a where a.tabela = %L) %s on conflict do nothing',
                       r.tabela, r.tabela, p_tenant, r.coluna, r.alvo,
                       case when r.tabela = any (c_fisico) then '' else 'and x.deleted_at is null' end);
        get diagnostics n = row_count;
        v_novos := v_novos + n;
      end loop;
      -- arquivo ligado a qualquer registro que sai (foto de visita, pedido, tarefa)
      insert into _limpeza_alvo select 'plataforma.arquivo', x.id from plataforma.arquivo x
       where x.tenant_id = p_tenant and x.deleted_at is null and x.entidade_id in (select a.id from _limpeza_alvo a)
      on conflict do nothing;
      get diagnostics n = row_count;
      v_novos := v_novos + n;
      -- por entidade: o pedido que perde item sai inteiro (na empresa inteira todos os pedidos já são raiz)
      if not v_inteira then
        insert into _limpeza_alvo select 'vendedor.pedido', x.id from vendedor.pedido x
         where x.tenant_id = p_tenant and x.deleted_at is null
           and x.id in (select i.pedido_id from vendedor.pedido_item i
                         where i.tenant_id = p_tenant and i.id in (select a.id from _limpeza_alvo a where a.tabela = 'vendedor.pedido_item'))
        on conflict do nothing;
        get diagnostics n = row_count;
        v_novos := v_novos + n;
      end if;
      exit when v_novos = 0;
      if v_volta > 30 then raise exception 'cascata sem fim (mais de 30 voltas)'; end if;
    end loop;
    exit cascata when v_inteira;
    -- por entidade: o Hub (as 8 tabelas com a coluna entidade) de TODA entidade afetada, a pedida e a que caiu pela cascata
    -- (título, nota e endereço ao zerar cliente), mesma regra da entidades_afetadas_limpeza. Sem isso o lote e o cursor da
    -- dependente ficavam e o reenvio com a mesma chave voltava repetido, sem recriar nada. Staging, erros e recebidos saem
    -- pela cascata da volta seguinte; as entidades não afetadas não mudam.
    v_afetadas := array(select e.key from jsonb_each(c_mapa) e
                         where e.key = any (v_entidades)
                            or exists (select 1 from _limpeza_alvo a where e.value -> 'raizes' ? a.tabela));
    v_novos := 0;
    foreach t in array c_hub_entidade loop
      execute format('insert into _limpeza_alvo select %L, x.id from %s x where x.tenant_id = %L and x.entidade = any (%L::text[]) on conflict do nothing',
                     t, t, p_tenant, v_afetadas);
      get diagnostics n = row_count;
      v_novos := v_novos + n;
    end loop;
    exit cascata when v_novos = 0;
  end loop cascata;
  if exists (select 1 from _limpeza_alvo a where a.tabela like 'integracao.%' and not a.tabela = any (c_fisico)) then
    raise exception 'tabela do Hub fora de c_fisico: %',
      (select string_agg(distinct a.tabela, ', ') from _limpeza_alvo a where a.tabela like 'integracao.%' and not a.tabela = any (c_fisico));
  end if;

  -- 3. cópia (mesma transação) e execução; no simular, só a contagem do que o UPDATE e o DELETE pegariam
  if not p_simular and exists (select 1 from plataforma.limpeza_copia b where b.lote = p_lote) then
    raise exception 'lote % já existe na cópia', p_lote using errcode = '23505';
  end if;
  for r in select x.tabela, case when x.tabela = any (c_fisico) then 'fisico' else 'soft' end as modo,
                  coalesce(array_position(c_fisico, x.tabela), 100) as ordem
             from (select distinct a.tabela from _limpeza_alvo a) x order by 3, 1 loop
    if p_simular then
      execute format('select count(*) from %s x where x.tenant_id = %L %s and x.id in (select a.id from _limpeza_alvo a where a.tabela = %L)',
                     r.tabela, p_tenant, case when r.modo = 'soft' then 'and x.deleted_at is null' else '' end, r.tabela)
        into n;
      insert into _limpeza_resumo values (r.ordem, r.tabela, r.modo, n);
      continue;
    end if;
    execute format('insert into plataforma.limpeza_copia (lote, empresa_id, tabela, modo, linha)
                    select %L, %L, %L, %L, to_jsonb(x) from %s x
                     where x.tenant_id = %L and x.id in (select a.id from _limpeza_alvo a where a.tabela = %L)',
                   p_lote, p_tenant, r.tabela, r.modo, r.tabela, p_tenant, r.tabela);
    if r.modo = 'fisico' then
      execute format('delete from %s x where x.tenant_id = %L and x.id in (select a.id from _limpeza_alvo a where a.tabela = %L)', r.tabela, p_tenant, r.tabela);
    else
      execute format('update %s x set deleted_at = now(), updated_at = now()
                       where x.tenant_id = %L and x.deleted_at is null and x.id in (select a.id from _limpeza_alvo a where a.tabela = %L)', r.tabela, p_tenant, r.tabela);
    end if;
    get diagnostics n = row_count;
    insert into _limpeza_resumo values (r.ordem, r.tabela, r.modo, n);
  end loop;

  -- usuários que saem: o token de acesso cai na próxima requisição (autenticacao.ts confere a sessao_versao)
  if not p_simular then
    update core.usuario u set sessao_versao = u.sessao_versao + 1
     where u.tenant_id = p_tenant and u.id in (select a.id from _limpeza_alvo a where a.tabela = 'core.usuario');
  end if;

  -- 4. outbox: não publicado de registro que sai e, na empresa inteira, todo o do Hub
  if p_simular then
    select count(*) into n from plataforma.evento e
     where e.tenant_id = p_tenant and e.publicado_em is null and e.deleted_at is null
       and ((v_inteira and e.nome like 'integracao.%') or e.agregado_id in (select a.id from _limpeza_alvo a));
  else
    insert into plataforma.limpeza_copia (lote, empresa_id, tabela, modo, linha)
    select p_lote, p_tenant, 'plataforma.evento', 'soft', to_jsonb(e) from plataforma.evento e
     where e.tenant_id = p_tenant and e.publicado_em is null and e.deleted_at is null
       and ((v_inteira and e.nome like 'integracao.%') or e.agregado_id in (select a.id from _limpeza_alvo a));
    update plataforma.evento e set deleted_at = now(), updated_at = now()
     where e.tenant_id = p_tenant and e.publicado_em is null and e.deleted_at is null
       and ((v_inteira and e.nome like 'integracao.%') or e.agregado_id in (select a.id from _limpeza_alvo a));
    get diagnostics n = row_count;
  end if;
  insert into _limpeza_resumo values (200, 'plataforma.evento', 'soft', n);
  -- 5. filiais: ficam, sem a chave do ERP (empresa inteira ou filial na lista)
  if v_inteira or 'filial' = any (v_entidades) then
    if p_simular then
      select count(*) into n from core.filial f where f.tenant_id = p_tenant and f.deleted_at is null and f.external_id is not null;
    else
      insert into plataforma.limpeza_copia (lote, empresa_id, tabela, modo, linha)
      select p_lote, p_tenant, 'core.filial', 'filial', to_jsonb(f) from core.filial f
       where f.tenant_id = p_tenant and f.deleted_at is null and f.external_id is not null;
      update core.filial f set external_id = null where f.tenant_id = p_tenant and f.deleted_at is null and f.external_id is not null;
      get diagnostics n = row_count;
    end if;
    insert into _limpeza_resumo values (201, 'core.filial', 'filial', n);
  end if;
  -- 6. pacote de sync pronto -> substituido
  if p_simular then
    select count(*) into n from plataforma.sync_pacote s where s.tenant_id = p_tenant and s.situacao = 'pronto' and s.deleted_at is null;
  else
    insert into plataforma.limpeza_copia (lote, empresa_id, tabela, modo, linha)
    select p_lote, p_tenant, 'plataforma.sync_pacote', 'sync_pacote', to_jsonb(s) from plataforma.sync_pacote s
     where s.tenant_id = p_tenant and s.situacao = 'pronto' and s.deleted_at is null;
    update plataforma.sync_pacote s set situacao = 'substituido', substituido_em = now()
     where s.tenant_id = p_tenant and s.situacao = 'pronto' and s.deleted_at is null;
    get diagnostics n = row_count;
  end if;
  insert into _limpeza_resumo values (202, 'plataforma.sync_pacote', 'sync_pacote', n);
  -- 7. geração da base (0022)
  if not p_simular then
    perform plataforma.girar_geracao_base(p_tenant);
  end if;
  insert into _limpeza_resumo values (203, 'plataforma.tenant', 'girar', 1);

  return query select s.ordem, s.tabela, s.modo, s.linhas from _limpeza_resumo s order by s.ordem, s.tabela;
end
$$;
revoke all on function plataforma.limpar_cadastros(uuid, text, text[], boolean, boolean) from public;

-- Volta de UM lote pela cópia (o limpar-cadastros-restaurar.sql do #675 promovido; workflow, modo restaurar). Na transação de
-- quem chama: tudo volta ou nada volta. Só serve ANTES do reenvio do ERP (a linha nova com o mesmo external_id bate no índice
-- único parcial e a transação aborta). fisico -> a linha volta inteira, pais antes dos filhos · soft -> deleted_at volta ao
-- valor copiado · filial -> o external_id volta · sync_pacote não volta (cache) · a geracao_base gira de novo. Lote de um zerar
-- do portal: desfeito_em e auditoria tenant.zerar_desfeito. A cópia fica (descartar_limpeza ou o expurgo do portal).
create function plataforma.restaurar_limpeza(p_tenant uuid, p_lote text)
  returns table (r_tabela text, r_modo text, r_linhas bigint)
  language plpgsql volatile security invoker
  set search_path = pg_catalog, pg_temp
  as $$
declare
  r record;
  n bigint;
  -- o mesmo conjunto de c_fisico da limpar_cadastros, pais antes dos filhos
  v_fisico constant text[] := array['integracao.coleta_execucao', 'integracao.reconciliacao', 'integracao.cursor_entidade',
    'integracao.sessao_carga', 'integracao.sessao_carga_recebido', 'integracao.lote', 'integracao.lote_staging',
    'integracao.lote_linha_erro', 'integracao.registro_atual', 'integracao.pendencia_inativacao',
    'integracao.inativacao_auditoria', 'integracao.cliente_fila_erp', 'integracao.pedido_fila_erp',
    'integracao.pedido_retorno', 'integracao.pedido_retorno_erro', 'gestor.projecao_fato'];
  t text;
  v_zerar uuid;
begin
  if p_tenant is null or p_lote is null then
    raise exception 'restaurar_limpeza: tenant e lote obrigatórios' using errcode = '22023';
  end if;
  perform set_config('app.tenant_id', p_tenant::text, true);
  if not exists (select 1 from plataforma.limpeza_copia b where b.lote = p_lote and b.empresa_id = p_tenant) then
    raise exception 'lote % sem cópia para esta empresa', p_lote using errcode = 'P0002';
  end if;
  for r in select distinct b.tabela from plataforma.limpeza_copia b
            where b.lote = p_lote and b.empresa_id = p_tenant and b.modo = 'fisico' loop
    if not r.tabela = any (v_fisico) then raise exception 'tabela física fora da lista: %', r.tabela; end if;
  end loop;
  foreach t in array v_fisico loop
    execute format('insert into %1$s select (jsonb_populate_record(null::%1$s, b.linha)).* from plataforma.limpeza_copia b
                     where b.lote = %2$L and b.empresa_id = %3$L and b.tabela = %4$L and b.modo = ''fisico''', t, p_lote, p_tenant, t);
    get diagnostics n = row_count;
    if n > 0 then r_tabela := t; r_modo := 'fisico'; r_linhas := n; return next; end if;
  end loop;
  for r in select distinct b.tabela from plataforma.limpeza_copia b
            where b.lote = p_lote and b.empresa_id = p_tenant and b.modo = 'soft' order by 1 loop
    execute format('update %1$s t set deleted_at = (b.linha->>''deleted_at'')::timestamptz, updated_at = now()
                      from plataforma.limpeza_copia b
                     where b.lote = %2$L and b.empresa_id = %3$L and b.tabela = %4$L and b.modo = ''soft''
                       and t.tenant_id = b.empresa_id and t.id = (b.linha->>''id'')::uuid', r.tabela, p_lote, p_tenant, r.tabela);
    get diagnostics n = row_count;
    r_tabela := r.tabela; r_modo := 'soft'; r_linhas := n; return next;
  end loop;
  update core.filial f set external_id = b.linha->>'external_id', updated_at = now()
    from plataforma.limpeza_copia b
   where b.lote = p_lote and b.empresa_id = p_tenant and b.modo = 'filial'
     and f.tenant_id = b.empresa_id and f.id = (b.linha->>'id')::uuid;
  get diagnostics n = row_count;
  r_tabela := 'core.filial'; r_modo := 'filial'; r_linhas := n; return next;
  perform plataforma.girar_geracao_base(p_tenant);
  r_tabela := 'plataforma.tenant'; r_modo := 'girar'; r_linhas := 1; return next;
  update plataforma.zerar_empresa z set desfeito_em = now()
   where z.lote = p_lote and z.empresa_id = p_tenant and z.situacao = 'concluido' and z.desfeito_em is null
  returning z.id into v_zerar;
  if v_zerar is not null then
    perform plataforma.sa_registrar_auditoria(null, null, null, null, p_tenant, 'tenant.zerar_desfeito',
      jsonb_build_object('zerar_id', v_zerar, 'lote', p_lote));
  end if;
end
$$;
revoke all on function plataforma.restaurar_limpeza(uuid, text) from public;

-- Descarte da cópia de UM lote (LGPD; o limpar-cadastros-descartar.sql do #675 promovido). Devolve as linhas descartadas; lote de
-- um zerar do portal ganha expurgado_em.
create function plataforma.descartar_limpeza(p_tenant uuid, p_lote text)
  returns bigint
  language plpgsql volatile security invoker
  set search_path = pg_catalog, pg_temp
  as $$
declare
  n bigint;
begin
  if p_tenant is null or p_lote is null then
    raise exception 'descartar_limpeza: tenant e lote obrigatórios' using errcode = '22023';
  end if;
  delete from plataforma.limpeza_copia b where b.lote = p_lote and b.empresa_id = p_tenant;
  get diagnostics n = row_count;
  update plataforma.zerar_empresa z set expurgado_em = now()
   where z.lote = p_lote and z.empresa_id = p_tenant and z.situacao = 'concluido' and z.expurgado_em is null;
  return n;
end
$$;
revoke all on function plataforma.descartar_limpeza(uuid, text) from public;

-- RN-PLA-12: a conferirZerar do SDK, na mesma ordem (null = liberado). p_zerar = o zerar que está sendo executado (não conta
-- como "outro em andamento"); p_total null = sem conferir o volume (pedido e worker antes da limpeza).
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
  if exists (select 1 from integracao.lote l where l.tenant_id = p_tenant and l.status = 'processando') then
    return 'ZERAR_HUB_PROCESSANDO';
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
      'id', z.id, 'tenant_id', z.empresa_id, 'codigo', z.codigo, 'entidades', to_jsonb(z.entidades),
      'entidades_afetadas', to_jsonb(z.entidades_afetadas), 'lote', z.lote, 'situacao', z.situacao,
      'pedido_em', plataforma.instante_iso(z.pedido_em), 'concluido_em', plataforma.instante_iso(z.concluido_em),
      'linhas_apagadas', z.linhas_apagadas, 'contagem', z.contagem,
      'copia_expira_em', plataforma.instante_iso(z.copia_expira_em), 'erro_codigo', z.erro_codigo)
  $$;
revoke all on function plataforma.zerar_empresa_json(plataforma.zerar_empresa) from public;

-- PreviaZerarEmpresa: { id, situacao, entidades, linhas: [{ordem, tabela, linhas}], entidades_afetadas, total, bloqueio,
-- erro_codigo, criado_em }. linhas, entidades_afetadas e total só na pronta; bloqueio = zerar_bloqueado agora (com o total, se
-- houver), em qualquer situação.
create function plataforma.zerar_previa_json(p plataforma.zerar_previa)
  returns jsonb
  language sql stable security invoker
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
    select jsonb_build_object(
      'id', p.id, 'situacao', p.situacao, 'entidades', to_jsonb(p.entidades), 'linhas', p.resultado -> 'linhas',
      'entidades_afetadas', p.resultado -> 'entidades_afetadas', 'total', p.resultado -> 'total',
      'bloqueio', plataforma.zerar_bloqueado(p.empresa_id, null, (p.resultado ->> 'total')::bigint),
      'erro_codigo', p.erro_codigo, 'criado_em', plataforma.instante_iso(p.created_at))
  $$;
revoke all on function plataforma.zerar_previa_json(plataforma.zerar_previa) from public;

-- 4. Worker -----------------------------------------------------------------------------------------------------------------------
-- Próximo zerar em andamento sem concessão viva (skip locked; concessão de 10 min); conta a tentativa. Nenhum = nenhuma linha.
-- Teto: o pegado 3 vezes sem fechar (o processo caiu no meio: OOM, deploy) fecha falhou ZERAR_FALHOU, com auditoria; a
-- transação do executar_zerar caiu inteira, então nada foi apagado.
create function plataforma.pegar_zerar()
  returns table (id uuid, empresa_id uuid)
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
#variable_conflict use_column
declare
  v_id uuid;
  v_z record;
begin
  for v_z in select z.id, z.empresa_id, z.super_admin_id, z.sessao_id from plataforma.zerar_empresa z
              where z.situacao = 'em_andamento' and z.tentativas >= 3 and (z.bloqueado_ate is null or z.bloqueado_ate < now())
              for update skip locked loop
    update plataforma.zerar_empresa z set situacao = 'falhou', erro_codigo = 'ZERAR_FALHOU', bloqueado_ate = null where z.id = v_z.id;
    perform plataforma.sa_registrar_auditoria('super_admin', v_z.super_admin_id, null, v_z.sessao_id, v_z.empresa_id,
      'tenant.zerar_falhou', jsonb_build_object('zerar_id', v_z.id, 'erro_codigo', 'ZERAR_FALHOU'));
  end loop;
  select z.id into v_id
    from plataforma.zerar_empresa z
   where z.situacao = 'em_andamento' and z.tentativas < 3 and (z.bloqueado_ate is null or z.bloqueado_ate < now())
   order by z.pedido_em, z.id
   limit 1
   for update skip locked;
  if v_id is null then
    return;
  end if;
  return query
    update plataforma.zerar_empresa z set bloqueado_ate = now() + interval '10 minutes', tentativas = z.tentativas + 1
     where z.id = v_id
    returning z.id, z.empresa_id;
end
$$;
revoke all on function plataforma.pegar_zerar() from public;
grant execute on function plataforma.pegar_zerar() to macuxi_worker;

-- Na transação do worker: confere de novo (exclusão, zerar, backup e Hub: falhou com o código, nada muda, sem erro), roda a
-- limpar_cadastros (lote e entidades do job) e fecha concluido com a contagem, as entidades_afetadas e a cópia por 7 dias;
-- auditoria tenant.zerado (detalhes = payload de plataforma.tenant.zerado@1). Mais de 2 milhões de linhas: 22023
-- ZERAR_VOLUME_ALTO; lote do Hub entrando no meio: 55000 ZERAR_HUB_PROCESSANDO (o worker desfaz e fecha com o código). Zerar que
-- não está em andamento: devolve o zerar (idempotente).
create function plataforma.executar_zerar(p_zerar uuid)
  returns jsonb
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_z plataforma.zerar_empresa;
  v_bloqueio text;
  v_contagem jsonb;
  v_total bigint;
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
  v_bloqueio := plataforma.zerar_bloqueado(v_z.empresa_id, v_z.id, null);
  if v_bloqueio is not null then
    update plataforma.zerar_empresa set situacao = 'falhou', erro_codigo = v_bloqueio, bloqueado_ate = null where id = p_zerar
    returning * into v_z;
    perform plataforma.sa_registrar_auditoria('super_admin', v_z.super_admin_id, null, v_z.sessao_id, v_z.empresa_id,
      'tenant.zerar_falhou', jsonb_build_object('zerar_id', v_z.id, 'erro_codigo', v_bloqueio));
    return plataforma.zerar_empresa_json(v_z);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('tabela', l.r_tabela, 'modo', l.r_modo, 'linhas', l.r_linhas)
                            order by l.r_ordem, l.r_tabela) filter (where l.r_linhas > 0), '[]'::jsonb),
         coalesce(sum(l.r_linhas) filter (where l.r_modo in ('soft', 'fisico')), 0)::bigint
    into v_contagem, v_total
    from plataforma.limpar_cadastros(v_z.empresa_id, v_z.lote, v_z.entidades, true, false) l;
  if v_total > 2000000 then
    raise exception 'executar_zerar: mais linhas que o limite do portal (nada mudou)' using errcode = '22023', hint = 'ZERAR_VOLUME_ALTO';
  end if;
  update plataforma.zerar_empresa
     set situacao = 'concluido', concluido_em = v_agora, linhas_apagadas = v_total, contagem = v_contagem,
         entidades_afetadas = plataforma.entidades_afetadas_limpeza(v_contagem, v_z.entidades),
         copia_expira_em = v_agora + interval '7 days', bloqueado_ate = null
   where id = p_zerar
  returning * into v_z;
  -- detalhes = o payload de plataforma.tenant.zerado@1, inteiro (a sa_registrar_auditoria trocaria o "origem" por "banco")
  insert into plataforma.auditoria_plataforma (ator_tipo, super_admin_id, sessao_id, tenant_alvo_id, acao, detalhes)
  values ('super_admin', v_z.super_admin_id, v_z.sessao_id, v_z.empresa_id, 'tenant.zerado',
          jsonb_build_object('tenant_id', v_z.empresa_id, 'codigo', v_z.codigo, 'zerar_id', v_z.id, 'lote', v_z.lote,
                             'entidades', to_jsonb(v_z.entidades), 'linhas_apagadas', v_total,
                             'copia_expira_em', plataforma.instante_iso(v_z.copia_expira_em),
                             'zerado_em', plataforma.instante_iso(v_agora)));
  return plataforma.zerar_empresa_json(v_z);
end
$$;
revoke all on function plataforma.executar_zerar(uuid) from public;
grant execute on function plataforma.executar_zerar(uuid) to macuxi_worker;

-- Fecha como falhou com o código (ERROS_WORKER_ZERAR ou a recusa do hint), numa transação nova depois do ROLLBACK do worker: a
-- empresa está intacta. Já falhou = devolve (idempotente); concluido = 55000.
create function plataforma.fechar_zerar(p_zerar uuid, p_erro_codigo text)
  returns jsonb
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_z plataforma.zerar_empresa;
begin
  if p_erro_codigo is null or p_erro_codigo !~ '^[A-Z][A-Z0-9_]{1,59}$' then
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
  update plataforma.zerar_empresa set situacao = 'falhou', erro_codigo = p_erro_codigo, bloqueado_ate = null where id = p_zerar
  returning * into v_z;
  perform plataforma.sa_registrar_auditoria('super_admin', v_z.super_admin_id, null, v_z.sessao_id, v_z.empresa_id,
    'tenant.zerar_falhou', jsonb_build_object('zerar_id', v_z.id, 'erro_codigo', p_erro_codigo));
  return plataforma.zerar_empresa_json(v_z);
end
$$;
revoke all on function plataforma.fechar_zerar(uuid, text) from public;
grant execute on function plataforma.fechar_zerar(uuid, text) to macuxi_worker;

-- Descarte (a cada hora): a cópia dos zerar concluídos vencidos (7 dias; até p_limite zerar, 1..500) sai da limpeza_copia e o
-- zerar ganha expurgado_em. Devolve quantos zerar tiveram a cópia descartada. Os lotes do workflow (sem zerar) não entram.
create function plataforma.expurgar_zerar(p_limite integer)
  returns integer
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_z record;
  v_n integer := 0;
begin
  if p_limite is null or p_limite < 1 or p_limite > 500 then
    raise exception 'expurgar_zerar: p_limite de 1 a 500' using errcode = '22023';
  end if;
  for v_z in select z.id, z.empresa_id, z.lote from plataforma.zerar_empresa z
               where z.situacao = 'concluido' and z.expurgado_em is null and z.copia_expira_em <= now()
               order by z.copia_expira_em, z.id
               limit p_limite
               for update skip locked loop
    delete from plataforma.limpeza_copia c where c.lote = v_z.lote and c.empresa_id = v_z.empresa_id;
    update plataforma.zerar_empresa set expurgado_em = now() where id = v_z.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end
$$;
revoke all on function plataforma.expurgar_zerar(integer) from public;
grant execute on function plataforma.expurgar_zerar(integer) to macuxi_worker;

-- Próxima prévia em andamento, viva e sem concessão (skip locked; concessão de 2 min); conta a tentativa. Antes: apaga as
-- vencidas (até 500) e fecha falhou ZERAR_FALHOU a pegada 3 vezes sem fechar. Nenhuma = nenhuma linha.
create function plataforma.pegar_previa_zerar()
  returns table (id uuid, empresa_id uuid)
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
#variable_conflict use_column
declare
  v_id uuid;
begin
  delete from plataforma.zerar_previa z
   where z.id in (select x.id from plataforma.zerar_previa x where x.expira_em <= now() order by x.expira_em, x.id limit 500
                   for update skip locked);
  update plataforma.zerar_previa z set situacao = 'falhou', erro_codigo = 'ZERAR_FALHOU', bloqueado_ate = null
   where z.id in (select x.id from plataforma.zerar_previa x
                   where x.situacao = 'em_andamento' and x.tentativas >= 3 and (x.bloqueado_ate is null or x.bloqueado_ate < now())
                   for update skip locked);
  select z.id into v_id
    from plataforma.zerar_previa z
   where z.situacao = 'em_andamento' and z.tentativas < 3 and z.expira_em > now()
     and (z.bloqueado_ate is null or z.bloqueado_ate < now())
   order by z.created_at, z.id
   limit 1
   for update skip locked;
  if v_id is null then
    return;
  end if;
  return query
    update plataforma.zerar_previa z set bloqueado_ate = now() + interval '2 minutes', tentativas = z.tentativas + 1
     where z.id = v_id
    returning z.id, z.empresa_id;
end
$$;
revoke all on function plataforma.pegar_previa_zerar() from public;
grant execute on function plataforma.pegar_previa_zerar() to macuxi_worker;

-- Conta a prévia: a MESMA limpar_cadastros no modo simular (só conta: sem cópia, sem UPDATE, sem DELETE e sem a trava do Hub),
-- numa subtransação desfeita, e grava pronta com {linhas, entidades_afetadas, total} (linhas = as com contagem, na ordem do
-- executar; total = soft + físico, o linhas_apagadas do executar). Erro na contagem = falhou ZERAR_FALHOU (nada mudou); empresa
-- que saiu = falhou TENANT_NAO_ENCONTRADO. Prévia que não está em andamento: devolve (idempotente).
create function plataforma.executar_previa_zerar(p_previa uuid)
  returns jsonb
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_p plataforma.zerar_previa;
  v_lista jsonb;
  v_linhas jsonb;
  v_total bigint;
begin
  select z.* into v_p from plataforma.zerar_previa z where z.id = p_previa for update;
  if not found then
    raise exception 'executar_previa_zerar: prévia não encontrada' using errcode = 'P0002';
  end if;
  if v_p.situacao <> 'em_andamento' then
    return plataforma.zerar_previa_json(v_p);
  end if;
  if not exists (select 1 from plataforma.tenant t where t.id = v_p.empresa_id and t.deleted_at is null) then
    update plataforma.zerar_previa set situacao = 'falhou', erro_codigo = 'TENANT_NAO_ENCONTRADO', bloqueado_ate = null
     where id = p_previa returning * into v_p;
    return plataforma.zerar_previa_json(v_p);
  end if;
  -- subtransação: conta e desfaz (as tabelas temporárias saem; as variáveis ficam)
  begin
    select coalesce(jsonb_agg(jsonb_build_object('tabela', l.r_tabela, 'modo', l.r_modo, 'linhas', l.r_linhas)
                              order by l.r_ordem, l.r_tabela) filter (where l.r_linhas > 0), '[]'::jsonb),
           coalesce(jsonb_agg(jsonb_build_object('ordem', l.r_ordem, 'tabela', l.r_tabela, 'linhas', l.r_linhas)
                              order by l.r_ordem, l.r_tabela) filter (where l.r_linhas > 0), '[]'::jsonb),
           coalesce(sum(l.r_linhas) filter (where l.r_modo in ('soft', 'fisico')), 0)::bigint
      into v_lista, v_linhas, v_total
      from plataforma.limpar_cadastros(v_p.empresa_id, to_char(now() at time zone 'UTC', 'YYYYMMDD"T"HH24MISS"Z"') || '-'
                                       || left(v_p.id::text, 8), v_p.entidades, false, true) l;
    raise exception 'prévia desfeita' using errcode = 'MXZ99';
  exception
    when sqlstate 'MXZ99' then
      null;
    when others then
      update plataforma.zerar_previa set situacao = 'falhou', erro_codigo = 'ZERAR_FALHOU', bloqueado_ate = null
       where id = p_previa returning * into v_p;
      return plataforma.zerar_previa_json(v_p);
  end;
  update plataforma.zerar_previa
     set situacao = 'pronta', bloqueado_ate = null,
         resultado = jsonb_build_object('linhas', v_linhas, 'total', v_total,
                                        'entidades_afetadas', to_jsonb(plataforma.entidades_afetadas_limpeza(v_lista, v_p.entidades)))
   where id = p_previa
  returning * into v_p;
  return plataforma.zerar_previa_json(v_p);
end
$$;
revoke all on function plataforma.executar_previa_zerar(uuid) from public;
grant execute on function plataforma.executar_previa_zerar(uuid) to macuxi_worker;

-- 3. Portal (só super-admin) ------------------------------------------------------------------------------------------------------
-- Pede a prévia (id do portal; o mesmo id devolve a mesma prévia, id de outra empresa = 23505). Quem conta é o worker
-- (executar_previa_zerar), fora do pool do portal. Empresa inexistente = P0002 TENANT_NAO_ENCONTRADO; entidades inválidas = 22023.
create function plataforma.sa_pedir_previa_zerar(p_sid uuid, p_tenant uuid, p_id uuid, p_entidades text[] default null)
  returns jsonb
  language plpgsql volatile security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_tipo text;
  v_sa uuid;
  v_p plataforma.zerar_previa;
  v_entidades text[] := plataforma.entidades_limpeza_ordenadas(p_entidades);
begin
  select v.tipo, v.super_admin_id into v_tipo, v_sa from plataforma.sa_sessao_valida(p_sid) v;
  if v_tipo is null then
    raise exception 'sa_pedir_previa_zerar: sessão do portal inválida' using errcode = '28000';
  end if;
  if v_tipo is distinct from 'super_admin' or v_sa is null then
    raise exception 'sa_pedir_previa_zerar: só o super-admin' using errcode = '42501';
  end if;
  if p_tenant is null or p_id is null then
    raise exception 'sa_pedir_previa_zerar: tenant e id obrigatórios' using errcode = '22023';
  end if;
  if p_entidades is not null and (cardinality(p_entidades) = 0 or cardinality(v_entidades) <> cardinality(p_entidades)) then
    raise exception 'sa_pedir_previa_zerar: entidades inválidas: vazia, repetida ou fora da lista' using errcode = '22023';
  end if;
  select z.* into v_p from plataforma.zerar_previa z where z.id = p_id;
  if not found then
    if not exists (select 1 from plataforma.tenant t where t.id = p_tenant and t.deleted_at is null) then
      raise exception 'sa_pedir_previa_zerar: empresa não encontrada' using errcode = 'P0002', hint = 'TENANT_NAO_ENCONTRADO';
    end if;
    insert into plataforma.zerar_previa (id, empresa_id, entidades, super_admin_id, sessao_id)
    values (p_id, p_tenant, v_entidades, v_sa, p_sid)
    on conflict (id) do nothing;
    select z.* into v_p from plataforma.zerar_previa z where z.id = p_id;
  end if;
  if v_p.empresa_id <> p_tenant then
    raise exception 'sa_pedir_previa_zerar: o id é de uma prévia de outra empresa' using errcode = '23505';
  end if;
  return plataforma.zerar_previa_json(v_p);
end
$$;
revoke all on function plataforma.sa_pedir_previa_zerar(uuid, uuid, uuid, text[]) from public, macuxi_app, macuxi_worker;
grant execute on function plataforma.sa_pedir_previa_zerar(uuid, uuid, uuid, text[]) to macuxi_portal;

-- A prévia da empresa pelo id (null = nenhuma, vencida ou de outra empresa: 404 na API).
create function plataforma.sa_ler_previa_zerar(p_sid uuid, p_tenant uuid, p_id uuid)
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
    raise exception 'sa_ler_previa_zerar: sessão do portal inválida' using errcode = '28000';
  end if;
  if v_tipo is distinct from 'super_admin' or v_sa is null then
    raise exception 'sa_ler_previa_zerar: só o super-admin' using errcode = '42501';
  end if;
  return (select plataforma.zerar_previa_json(z) from plataforma.zerar_previa z
           where z.id = p_id and z.empresa_id = p_tenant and z.expira_em > now());
end
$$;
revoke all on function plataforma.sa_ler_previa_zerar(uuid, uuid, uuid) from public, macuxi_app, macuxi_worker;
grant execute on function plataforma.sa_ler_previa_zerar(uuid, uuid, uuid) to macuxi_portal;

-- RN-PLA-12: pede o zerar (id do portal; o mesmo id devolve o mesmo zerar), sem recontar. A API confere antes a senha
-- (sa_reautenticar). Recusas com o código no hint: 55000 EXCLUSAO_EM_ANDAMENTO, ZERAR_EM_ANDAMENTO, BACKUP_EM_ANDAMENTO e
-- ZERAR_HUB_PROCESSANDO (409); 22023 ZERAR_CODIGO_NAO_CONFERE (422); entidades inválidas 22023. Lote = carimbo UTC do pedido +
-- os 8 primeiros dígitos do id.
create function plataforma.sa_pedir_zerar(p_sid uuid, p_tenant uuid, p_id uuid, p_codigo text, p_entidades text[] default null)
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
  v_entidades text[] := plataforma.entidades_limpeza_ordenadas(p_entidades);
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
  if p_entidades is not null and (cardinality(p_entidades) = 0 or cardinality(v_entidades) <> cardinality(p_entidades)) then
    raise exception 'sa_pedir_zerar: entidades inválidas: vazia, repetida ou fora da lista' using errcode = '22023';
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
  v_bloqueio := plataforma.zerar_bloqueado(p_tenant, null, null);
  if v_bloqueio is not null then
    raise exception 'sa_pedir_zerar: a empresa está ocupada' using errcode = '55000', hint = v_bloqueio;
  end if;
  if btrim(p_codigo) = '' or lower(btrim(p_codigo)) <> lower(btrim(v_codigo)) then
    raise exception 'sa_pedir_zerar: o código digitado não é o da empresa' using errcode = '22023',
      hint = 'ZERAR_CODIGO_NAO_CONFERE';
  end if;
  insert into plataforma.zerar_empresa (id, empresa_id, codigo, lote, entidades, super_admin_id, sessao_id)
  values (p_id, p_tenant, v_codigo,
          to_char(now() at time zone 'UTC', 'YYYYMMDD"T"HH24MISS"Z"') || '-' || left(p_id::text, 8),
          v_entidades, v_sa, p_sid)
  returning * into v_z;
  perform plataforma.sa_registrar_auditoria('super_admin', v_sa, null, p_sid, p_tenant, 'tenant.zerar_pedido',
    jsonb_build_object('zerar_id', p_id, 'lote', v_z.lote, 'entidades', to_jsonb(v_entidades)));
  return plataforma.zerar_empresa_json(v_z);
end
$$;
revoke all on function plataforma.sa_pedir_zerar(uuid, uuid, uuid, text, text[]) from public, macuxi_app, macuxi_worker;
grant execute on function plataforma.sa_pedir_zerar(uuid, uuid, uuid, text, text[]) to macuxi_portal;

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

-- Conferência pelo catálogo (aborta com 42501 e nada muda): 42 sa_* só do portal; as do worker só do worker; a regra e as
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
    raise exception '0100: função sa_* executável pelo macuxi_app, macuxi_worker ou PUBLIC: %', v_f using errcode = '42501';
  end if;
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'plataforma' and p.proname like 'sa\_%' and has_function_privilege('macuxi_portal', p.oid, 'execute');
  if v_n <> 42 then
    raise exception '0100: esperadas 42 funções sa_* executáveis pelo macuxi_portal, há %', v_n using errcode = '42501';
  end if;
  select string_agg(p.oid::regprocedure::text, ', ' order by 1) into v_f
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'plataforma'
     and p.proname in ('pegar_zerar', 'executar_zerar', 'fechar_zerar', 'expurgar_zerar', 'pegar_previa_zerar',
                       'executar_previa_zerar', 'limpar_cadastros', 'mapa_limpeza_entidades', 'entidades_limpeza_ordenadas',
                       'entidades_afetadas_limpeza', 'restaurar_limpeza', 'descartar_limpeza', 'zerar_bloqueado',
                       'zerar_empresa_json', 'zerar_previa_json')
     and (has_function_privilege('macuxi_app', p.oid, 'execute') or has_function_privilege('macuxi_portal', p.oid, 'execute')
          or exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                      where a.grantee = 0 and a.privilege_type = 'EXECUTE')
          or (p.proname not in ('pegar_zerar', 'executar_zerar', 'fechar_zerar', 'expurgar_zerar', 'pegar_previa_zerar',
                                'executar_previa_zerar')
              and has_function_privilege('macuxi_worker', p.oid, 'execute')));
  if v_f is not null then
    raise exception '0100: função do worker, da regra ou interna executável por papel errado: %', v_f using errcode = '42501';
  end if;
end
$$;
