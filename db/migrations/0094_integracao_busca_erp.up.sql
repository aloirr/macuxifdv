-- 0094_integracao_busca_erp (up) — integração por ERP (F2): busca na API do ERP pelo worker na nuvem, cofre da credencial do
-- ERP, assistente e painel dos 30 dias. Desenho docs/desenho/integracao-modelos-erp.md (engenheiro-software, aprovado em
-- R-20261122-005500-alexandre, item 5 A: D1–D9) §2.2, §2.3, §2.4, §2.5, §4, §5 e §6 (fatia F2). RN propostas no desenho:
-- RN-INT-16 (Conector `nuvem` e frequência com piso de 15 min), RN-INT-17 (cofre só de escrita), RN-INT-19 (classes de
-- falha), RN-INT-20 (marcos da implantação); o gerente dá o número final. Migração em cima da 0093 (número provisório: segue
-- a ordem de merge). Dicionário: docs/banco/integracao.md ("0094"). Teste: db/testes/integracao-busca-erp.db.test.ts.
--
-- Migração ADITIVA: 5 tabelas novas no schema integracao e 2 funções IMMUTABLE de CHECK. Nenhuma tabela, coluna, política,
-- grant ou função existente muda. Nenhum contrato muda de versão. Todas com os campos comuns, unique (tenant_id, id),
-- gatilho de updated_at, RLS ligado e FORÇADO, isolamento_tenant ao macuxi_app e manutencao (0031); FKs compostas só dentro
-- do schema (tenant_id, conector_id) -> integracao.conector; fora do sync (TABELAS_FORA_DO_SYNC). macuxi_app: select,
-- insert e update (nenhum DELETE: desativar = deleted_at). macuxi_worker e macuxi_portal: nada (o worker roda os trabalhos
-- em comTenant com o macuxi_app, §2.5).
--
-- 1. integracao.conector_api — configuração NÃO secreta da busca na API do ERP, uma viva por Conector (tipo `nuvem`; quem
--    confere o tipo é a API, F3): erp (ERPS_BUSCA_API, os 4 adaptadores da F4a), url_base (só https, sem usuário/senha,
--    query nem fragmento na URL; até 500), usuario_erp (não é segredo: a tela mostra), parametros (objeto até 4000 bytes,
--    ex. CompanyDB; NENHUMA chave com cara de segredo: integracao.parametros_sem_segredo), frequencias (objeto
--    {entidade: minutos}: chaves em ENTIDADES_BANCO, inteiros de 15 a 1440 — piso de 15 min, D3, RN-CORE-23; chave ausente =
--    frequência padrão do doc 06, decidida no domain), coletas_paradas_em (401/403 do ERP: as coletas param até trocarem a
--    credencial, §2.4).
-- 2. integracao.credencial_erp — o segredo do ERP cifrado (AES-256-GCM no processo, AAD tenant_id|conector_id, §2.2): cifrado,
--    iv (12 bytes), tag (16 bytes), chave_versao (versão da chave-mestra MACUXI_CHAVE_SEGREDOS_v<n>), atualizada_em,
--    atualizada_por (usuário ou super-admin, sem FK: auditoria tem o resto). Uma viva por Conector (índice único parcial).
--    O segredo só existe na linha viva: apagar (deleted_at) exige cifrado, iv e tag nulos (credencial_erp_segredo_so_viva).
--    Rotação = update da linha viva na transação do "Testar conexão" (sem convivência).
--    SÓ o macuxi_app: NENHUM grant e NENHUMA política para o macuxi_leitura (consulta só leitura/diagnóstico, cuja saída vai
--    ao log do Actions; TABELAS_SEM_LEITURA), o macuxi_worker e o macuxi_portal; revoke all de public.
-- 3. integracao.implantacao — estado do assistente (§4: passo 1..7, erp, meio, conector_id) e marcos do painel dos 30 dias
--    (§5; nulo = não cumprido): marco_primeira_completa_em (D+0), marco_primeiro_pedido_em, marco_primeiro_faturamento_em,
--    marco_reconciliacao_em (3 seguidas sem divergência), marco_sem_alerta_em (7 dias seguidos), concluida_em (D+30 ou todos
--    os marcos; exige o D+0). Uma viva por tenant.
-- 4. integracao.implantacao_dia — retrato diário do painel (tarefa de 1 em 1 dia, §5): contagens do dia (não negativas),
--    minutos fora do ar (0..1440), mediana do tempo aprovação → integrado (s) e por_entidade (objeto). Uma viva por
--    (tenant, implantacao, dia): upsert idempotente.
-- 5. integracao.coleta_execucao — cada coleta (Conector, entidade) do trabalho coletar_erp (§2.3/§2.4): modo (ModoCarga),
--    origem (agendada | buscar_agora | recarregar), estado (solicitada | executando | concluida | falhou), falha_classe só no
--    falhou (credencial_recusada | transitoria | formato_mudou), http_status e erro_codigo (nunca a resposta do ERP),
--    tentativas, contagens, instantes e trabalho_id (plataforma.trabalho, sem FK). Uma viva (solicitada/executando) por
--    (Conector, entidade) e uma executando por Conector (§2.3, "1 coleta por vez por Conector").
--
-- macuxi_leitura (0078, ADR 0055): SELECT e política leitura em conector_api, implantacao, implantacao_dia e
-- coleta_execucao (nenhuma coluna sensível); credencial_erp fora (acima).
-- Caminho de volta: 0094_integracao_busca_erp.down.sql (APAGA as 5 tabelas com tudo o que tiverem — inclusive as credenciais
-- do ERP cifradas, que o cliente precisa redigitar depois de um novo up — e as 2 funções). Volte antes o código da API e do
-- worker que lê ou grava essas tabelas (senão 42P01).

-- =============================================================================================
-- Funções dos CHECKs (IMMUTABLE, sem acesso a tabela; nulo = o CHECK deixa passar, como integracao.sem_repeticao)
-- =============================================================================================
-- frequencias: objeto {entidade: minutos}, entidade em ENTIDADES_BANCO, minutos inteiro de 15 (piso, D3) a 1440 (1 por dia).
create function integracao.frequencias_validas(p jsonb) returns boolean
  language sql immutable parallel safe
  set search_path = pg_catalog, pg_temp
  as $$
    select jsonb_typeof(p) = 'object'
       and not exists (
         select 1 from jsonb_each(p) as e
          where case
                  when e.key <> all (array['vendedor', 'cliente', 'produto', 'preco', 'estoque', 'titulo', 'nota', 'rota', 'catalogo_no', 'produto_unidade', 'cliente_endereco', 'transportadora', 'forma_pagamento', 'prazo_pagamento', 'tabela_escalonada', 'filial']) then true
                  when jsonb_typeof(e.value) <> 'number' then true
                  else e.value::numeric <> trunc(e.value::numeric) or e.value::numeric < 15 or e.value::numeric > 1440
                end)
  $$;

-- parametros: objeto sem chave (em qualquer caixa) que pareça segredo; o segredo vai cifrado em credencial_erp.
create function integracao.parametros_sem_segredo(p jsonb) returns boolean
  language sql immutable parallel safe
  set search_path = pg_catalog, pg_temp
  as $$
    select jsonb_typeof(p) = 'object'
       and not exists (
         select 1 from jsonb_object_keys(p) as k
          where k ~* '(senha|password|passwd|pwd|segredo|secret|token|chave|key|cookie|authorization|sessao|session)')
  $$;

-- =============================================================================================
-- integracao.conector_api — configuração não secreta da busca na API do ERP (§2.3, §2.5)
-- =============================================================================================
create table integracao.conector_api (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references plataforma.tenant (id),
  conector_id         uuid not null,
  erp                 text not null,
  url_base            text not null,
  usuario_erp         text,
  parametros          jsonb not null default '{}'::jsonb,
  frequencias         jsonb not null default '{}'::jsonb,
  coletas_paradas_em  timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz,
  external_id         text,
  constraint conector_api_tenant_id_uk unique (tenant_id, id),
  constraint conector_api_conector_fk foreign key (tenant_id, conector_id) references integracao.conector (tenant_id, id),
  constraint conector_api_erp_valido check (erp in ('protheus', 'sap_b1', 'sankhya', 'senior')),
  constraint conector_api_url_https check (char_length(url_base) <= 500 and url_base ~ '^https://[A-Za-z0-9.:\[\]-]+(/[^\s?#@]*)?$'),
  constraint conector_api_usuario_tamanho check (usuario_erp is null or (btrim(usuario_erp) <> '' and char_length(usuario_erp) <= 200)),
  constraint conector_api_parametros_validos check (octet_length(parametros::text) <= 4000 and integracao.parametros_sem_segredo(parametros)),
  constraint conector_api_frequencias_validas check (integracao.frequencias_validas(frequencias))
);
create unique index conector_api_conector_uk on integracao.conector_api (tenant_id, conector_id) where deleted_at is null;
create trigger conector_api_updated_at before update on integracao.conector_api
  for each row execute function plataforma.definir_updated_at();
alter table integracao.conector_api enable row level security;
alter table integracao.conector_api force row level security;
create policy isolamento_tenant on integracao.conector_api for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
create policy manutencao on integracao.conector_api for all to macuxi_manutencao using (true) with check (true);
grant select, insert, update on integracao.conector_api to macuxi_app;
grant select on integracao.conector_api to macuxi_leitura;
create policy leitura on integracao.conector_api for select to macuxi_leitura using (tenant_id = plataforma.tenant_atual());

-- =============================================================================================
-- integracao.credencial_erp — segredo do ERP cifrado, só escrita pela API (§2.2)
-- =============================================================================================
create table integracao.credencial_erp (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references plataforma.tenant (id),
  conector_id     uuid not null,
  cifrado         bytea,
  iv              bytea,
  tag             bytea,
  chave_versao    smallint not null,
  atualizada_em   timestamptz not null default now(),
  atualizada_por  uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  external_id     text,
  constraint credencial_erp_tenant_id_uk unique (tenant_id, id),
  constraint credencial_erp_conector_fk foreign key (tenant_id, conector_id) references integracao.conector (tenant_id, id),
  constraint credencial_erp_segredo_tudo_ou_nada check ((cifrado is null) = (iv is null) and (iv is null) = (tag is null)),
  constraint credencial_erp_segredo_so_viva check ((deleted_at is null) = (cifrado is not null)),
  constraint credencial_erp_formato check (
    cifrado is null or (octet_length(cifrado) between 1 and 8192 and octet_length(iv) = 12 and octet_length(tag) = 16)),
  constraint credencial_erp_chave_versao_positiva check (chave_versao >= 1)
);
create unique index credencial_erp_conector_uk on integracao.credencial_erp (tenant_id, conector_id) where deleted_at is null;
create trigger credencial_erp_updated_at before update on integracao.credencial_erp
  for each row execute function plataforma.definir_updated_at();
alter table integracao.credencial_erp enable row level security;
alter table integracao.credencial_erp force row level security;
create policy isolamento_tenant on integracao.credencial_erp for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
create policy manutencao on integracao.credencial_erp for all to macuxi_manutencao using (true) with check (true);
revoke all on integracao.credencial_erp from public;
grant select, insert, update on integracao.credencial_erp to macuxi_app;

-- =============================================================================================
-- integracao.implantacao — assistente (§4) e marcos do painel dos 30 dias (§5)
-- =============================================================================================
create table integracao.implantacao (
  id                             uuid primary key default gen_random_uuid(),
  tenant_id                      uuid not null references plataforma.tenant (id),
  passo                          smallint not null default 1,
  erp                            text,
  meio                           text,
  conector_id                    uuid,
  iniciada_em                    timestamptz not null default now(),
  marco_primeira_completa_em     timestamptz,
  marco_primeiro_pedido_em       timestamptz,
  marco_primeiro_faturamento_em  timestamptz,
  marco_reconciliacao_em         timestamptz,
  marco_sem_alerta_em            timestamptz,
  concluida_em                   timestamptz,
  created_at                     timestamptz not null default now(),
  updated_at                     timestamptz not null default now(),
  deleted_at                     timestamptz,
  external_id                    text,
  constraint implantacao_tenant_id_uk unique (tenant_id, id),
  constraint implantacao_conector_fk foreign key (tenant_id, conector_id) references integracao.conector (tenant_id, id),
  constraint implantacao_passo_faixa check (passo between 1 and 7),
  constraint implantacao_erp_valido check (erp is null or erp in ('protheus', 'winthor', 'sap_b1', 'sankhya', 'senior', 'outro')),
  constraint implantacao_meio_valido check (meio is null or meio in ('conector', 'api_busca', 'api_envia')),
  constraint implantacao_concluida_depois_da_completa check (
    concluida_em is null or (marco_primeira_completa_em is not null and concluida_em >= marco_primeira_completa_em))
);
create unique index implantacao_viva_uk on integracao.implantacao (tenant_id) where deleted_at is null;
create trigger implantacao_updated_at before update on integracao.implantacao
  for each row execute function plataforma.definir_updated_at();
alter table integracao.implantacao enable row level security;
alter table integracao.implantacao force row level security;
create policy isolamento_tenant on integracao.implantacao for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
create policy manutencao on integracao.implantacao for all to macuxi_manutencao using (true) with check (true);
grant select, insert, update on integracao.implantacao to macuxi_app;
grant select on integracao.implantacao to macuxi_leitura;
create policy leitura on integracao.implantacao for select to macuxi_leitura using (tenant_id = plataforma.tenant_atual());

-- =============================================================================================
-- integracao.implantacao_dia — retrato diário do painel dos 30 dias (§5)
-- =============================================================================================
create table integracao.implantacao_dia (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references plataforma.tenant (id),
  implantacao_id      uuid not null,
  dia                 date not null,
  minutos_fora_do_ar  smallint not null default 0,
  lotes_concluidos    integer not null default 0,
  lotes_com_erro      integer not null default 0,
  divergencias        integer not null default 0,
  alertas             integer not null default 0,
  pedidos_integrados  integer not null default 0,
  pedidos_rejeitados  integer not null default 0,
  pedidos_presos      integer not null default 0,
  pedidos_retidos     integer not null default 0,
  mediana_pedido_s    integer,
  por_entidade        jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz,
  external_id         text,
  constraint implantacao_dia_tenant_id_uk unique (tenant_id, id),
  constraint implantacao_dia_implantacao_fk foreign key (tenant_id, implantacao_id) references integracao.implantacao (tenant_id, id),
  constraint implantacao_dia_minutos_faixa check (minutos_fora_do_ar between 0 and 1440),
  constraint implantacao_dia_contagens_nao_negativas check (
    lotes_concluidos >= 0 and lotes_com_erro >= 0 and divergencias >= 0 and alertas >= 0
    and pedidos_integrados >= 0 and pedidos_rejeitados >= 0 and pedidos_presos >= 0 and pedidos_retidos >= 0),
  constraint implantacao_dia_mediana_nao_negativa check (mediana_pedido_s is null or mediana_pedido_s >= 0),
  constraint implantacao_dia_por_entidade_objeto check (jsonb_typeof(por_entidade) = 'object' and octet_length(por_entidade::text) <= 16000)
);
create unique index implantacao_dia_uk on integracao.implantacao_dia (tenant_id, implantacao_id, dia) where deleted_at is null;
create trigger implantacao_dia_updated_at before update on integracao.implantacao_dia
  for each row execute function plataforma.definir_updated_at();
alter table integracao.implantacao_dia enable row level security;
alter table integracao.implantacao_dia force row level security;
create policy isolamento_tenant on integracao.implantacao_dia for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
create policy manutencao on integracao.implantacao_dia for all to macuxi_manutencao using (true) with check (true);
grant select, insert, update on integracao.implantacao_dia to macuxi_app;
grant select on integracao.implantacao_dia to macuxi_leitura;
create policy leitura on integracao.implantacao_dia for select to macuxi_leitura using (tenant_id = plataforma.tenant_atual());

-- =============================================================================================
-- integracao.coleta_execucao — cada coleta (Conector, entidade) do trabalho coletar_erp (§2.3, §2.4)
-- =============================================================================================
create table integracao.coleta_execucao (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references plataforma.tenant (id),
  conector_id           uuid not null,
  entidade              text not null,
  modo                  text not null,
  origem                text not null,
  estado                text not null default 'solicitada',
  falha_classe          text,
  http_status           smallint,
  erro_codigo           text,
  tentativas            smallint not null default 0,
  paginas               integer not null default 0,
  linhas                integer not null default 0,
  lotes                 integer not null default 0,
  solicitada_em         timestamptz not null default now(),
  iniciada_em           timestamptz,
  concluida_em          timestamptz,
  proxima_tentativa_em  timestamptz,
  trabalho_id           uuid,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz,
  external_id           text,
  constraint coleta_execucao_tenant_id_uk unique (tenant_id, id),
  constraint coleta_execucao_conector_fk foreign key (tenant_id, conector_id) references integracao.conector (tenant_id, id),
  constraint coleta_execucao_entidade_valida check (entidade in ('vendedor', 'cliente', 'produto', 'preco', 'estoque', 'titulo', 'nota', 'rota', 'catalogo_no', 'produto_unidade', 'cliente_endereco', 'transportadora', 'forma_pagamento', 'prazo_pagamento', 'tabela_escalonada', 'filial')),
  constraint coleta_execucao_modo_valido check (modo in ('completo', 'delta')),
  constraint coleta_execucao_origem_valida check (origem in ('agendada', 'buscar_agora', 'recarregar')),
  constraint coleta_execucao_estado_valido check (estado in ('solicitada', 'executando', 'concluida', 'falhou')),
  constraint coleta_execucao_falha_classe_valida check (falha_classe is null or falha_classe in ('credencial_recusada', 'transitoria', 'formato_mudou')),
  constraint coleta_execucao_falha_so_no_falhou check ((estado = 'falhou') = (falha_classe is not null)),
  constraint coleta_execucao_iniciada_coerente check ((estado = 'solicitada') = (iniciada_em is null)),
  constraint coleta_execucao_concluida_coerente check ((estado in ('concluida', 'falhou')) = (concluida_em is not null)),
  constraint coleta_execucao_http_status_faixa check (http_status is null or http_status between 100 and 599),
  constraint coleta_execucao_erro_codigo_tamanho check (erro_codigo is null or char_length(erro_codigo) between 1 and 100),
  constraint coleta_execucao_contagens_nao_negativas check (tentativas between 0 and 100 and paginas >= 0 and linhas >= 0 and lotes >= 0)
);
-- um trabalho vivo por alvo (Conector, entidade) e uma coleta por vez por Conector (§2.3)
create unique index coleta_execucao_viva_uk on integracao.coleta_execucao (tenant_id, conector_id, entidade)
  where estado in ('solicitada', 'executando') and deleted_at is null;
create unique index coleta_execucao_executando_uk on integracao.coleta_execucao (tenant_id, conector_id)
  where estado = 'executando' and deleted_at is null;
-- última coleta por entidade (Monitor, painel e agendar_coletas)
create index coleta_execucao_ultima_ix on integracao.coleta_execucao (tenant_id, conector_id, entidade, solicitada_em desc);
create trigger coleta_execucao_updated_at before update on integracao.coleta_execucao
  for each row execute function plataforma.definir_updated_at();
alter table integracao.coleta_execucao enable row level security;
alter table integracao.coleta_execucao force row level security;
create policy isolamento_tenant on integracao.coleta_execucao for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
create policy manutencao on integracao.coleta_execucao for all to macuxi_manutencao using (true) with check (true);
grant select, insert, update on integracao.coleta_execucao to macuxi_app;
grant select on integracao.coleta_execucao to macuxi_leitura;
create policy leitura on integracao.coleta_execucao for select to macuxi_leitura using (tenant_id = plataforma.tenant_atual());

-- =============================================================================================
-- Conferência pelo catálogo (aborta com 42501 e nada muda): a credencial do ERP só para o macuxi_app, sem DELETE
-- =============================================================================================
do $$
begin
  if has_any_column_privilege('macuxi_leitura', 'integracao.credencial_erp', 'SELECT, INSERT, UPDATE, REFERENCES')
     or has_table_privilege('macuxi_leitura', 'integracao.credencial_erp', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
     or has_table_privilege('macuxi_worker', 'integracao.credencial_erp', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
     or has_table_privilege('macuxi_portal', 'integracao.credencial_erp', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
     or has_table_privilege('macuxi_app', 'integracao.credencial_erp', 'DELETE, TRUNCATE, REFERENCES, TRIGGER') then
    raise exception '0094: privilégio fora do desenho em integracao.credencial_erp' using errcode = '42501';
  end if;
end
$$;
