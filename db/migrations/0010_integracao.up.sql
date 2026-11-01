-- 0010_integracao (up) — T-0032 (Hub /integracao/v1: rotas e banco), desenho docs/desenho/T-0032.md §8 e ADR 0013.
-- Origem: especificação R-20261101-013336-banco-dados (revisão do banco da T-0025, "0008" renumerada para 0010), mais os
-- acréscimos da T-0027 (PR #24) e da T-0031 (PR #25) pedidos em R-20261101-154937-engenheiro-software,
-- R-20261101-115656-3-modulo-integracao e R-20261101-150202-alexandre. Campos de negócio: docs/modulos/integracao/hub-api.md §17b.
-- Regras: RN-INT-01 (lote), RN-INT-03 (linha inválida), RN-INT-06 (carga completa, trava de inativação, guarda monotônica),
-- RN-INT-07 (reconciliação), RN-INT-08 (pedido para o ERP e retorno), RN-INT-10 (chave por Conector só como hash),
-- RN-INT-11 (política de versão), RN-INT-12 (idempotência do lote), RN-INT-13 (um Conector por entidade por empresa).
-- Listas fechadas = código da Integração (fonte da verdade), conferidas em db/testes/estatico.test.ts:
--   entidade / conector.entidades = ENTIDADES (contracts/entidades.ts); lote.modo = ModoCarga; lote.status = ESTADOS_LOTE;
--   lote_linha_erro.codigo = CODIGOS_ERRO_LINHA; conector.tipo = TIPOS_CONECTOR; pendencia.estado = ESTADOS_PENDENCIA_INATIVACAO;
--   mapeamento.tipo = TIPOS_MAPEAMENTO; pedido_fila_erp.estado = ESTADOS_PEDIDO_ERP; pedido_retorno.status = StatusRetornoErp;
--   pedido_retorno_erro.codigo/codigos = CODIGOS_ITEM_DESCARTADO + 'sequencia_repetida' (decisão do gerente R-20261101-160012:
--   sequência repetida em itens_faturados vira descarte; o código entra no contrato na onda 2 da T-0032).
-- external_id do ERP: até 200 caracteres (EXTERNAL_ID_MAX, T-0027) em registro_atual, lote_linha_erro, sessao_carga_recebido,
--   cursor_entidade.cursor_external_id e pedido_retorno_erro.produto_external_id.
-- A regra "uma entidade por Conector ativo" (RN-INT-13) fica na API (pg_advisory_xact_lock por tenant), sem constraint de array;
--   o banco guarda só o P-7: no máximo UM Conector ativo com recebe_pedidos por tenant.
-- FRONTEIRA: nenhuma FK para schema de módulo; FKs só dentro do schema, compostas por tenant, e tenant_id -> plataforma.tenant.
-- Todas as tabelas ficam fora do sync (db/src/excecoes.ts): nada daqui vai ao aparelho.
-- Funções SECURITY DEFINER (dono = migrador, que ignora RLS; premissa em docs/banco/rls.md): autenticar_chave (única leitura
--   sem tenant, só macuxi_app) e expurgar_retencao (só macuxi_worker).
-- Caminho de volta: 0010_integracao.down.sql (drop schema integracao cascade — APAGA Conectores, chaves, lotes, espelho dos
-- registros, fila de pedidos do ERP e trilhas; o Conector precisa de chave nova depois de um up).

create schema integracao;
grant usage on schema integracao to macuxi_app;
-- o worker só chama integracao.expurgar_retencao (nenhum grant de tabela)
grant usage on schema integracao to macuxi_worker;

-- Lista de texto sem repetição (usada nos CHECKs de conector.entidades). Imutável; nulo = verdadeiro (o CHECK deixa passar).
create function integracao.sem_repeticao(p_lista text[]) returns boolean
  language sql immutable parallel safe
  as $$ select cardinality(p_lista) = (select count(distinct x) from unnest(p_lista) as x) $$;

-- ---------------------------------------------------------------------------------------------
-- conector — cada programa Conector instalado no cliente (RN-INT-10/13). Sinal a cada minuto: fillfactor 90.
-- identificador = valor de X-Macuxi-Conector-Id / hub.conectorId (não é segredo). entidades = as que ESTE Conector alimenta
-- (P-6; padrão as 8). ips_permitidos vazio = qualquer IP com chave válida (inet aceita IP ou CIDR).
create table integracao.conector (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references plataforma.tenant (id),
  identificador      text not null,
  nome               text not null,
  tipo               text not null default 'conector',
  ativo              boolean not null default true,
  recebe_pedidos     boolean not null default true,
  entidades          text[] not null default array['vendedor', 'cliente', 'produto', 'preco', 'estoque', 'titulo', 'nota', 'rota']::text[],
  ips_permitidos     inet[] not null default '{}',
  versao_conector    text,
  versao_contrato    text,
  ultimo_sinal_em    timestamptz,
  parado_por_versao  boolean not null default false,
  sinal_resumo       jsonb,
  deriva_relogio_s   integer,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  external_id        text,
  constraint conector_tenant_id_uk unique (tenant_id, id),
  constraint conector_identificador_formato check (identificador ~ '^[A-Za-z0-9._-]{1,100}$'),
  constraint conector_nome_preenchido check (btrim(nome) <> '' and char_length(nome) <= 120),
  constraint conector_tipo_valido check (tipo in ('conector', 'nuvem', 'arquivo')),
  constraint conector_entidades_validas check (cardinality(entidades) >= 1 and entidades <@ array['vendedor', 'cliente', 'produto', 'preco', 'estoque', 'titulo', 'nota', 'rota']::text[] and integracao.sem_repeticao(entidades)),
  constraint conector_ips_maximo check (cardinality(ips_permitidos) <= 20),
  constraint conector_versao_tamanho check (char_length(versao_conector) <= 40 and char_length(versao_contrato) <= 10),
  constraint conector_sinal_resumo_objeto check (sinal_resumo is null or jsonb_typeof(sinal_resumo) = 'object')
);
alter table integracao.conector set (fillfactor = 90);
create unique index conector_identificador_uk on integracao.conector (tenant_id, identificador) where deleted_at is null;
-- P-7 (guarda final): no máximo um Conector ativo que recebe pedidos por empresa
create unique index conector_recebe_pedidos_uk on integracao.conector (tenant_id) where recebe_pedidos and ativo and deleted_at is null;
create trigger conector_updated_at before update on integracao.conector
  for each row execute function plataforma.definir_updated_at();
alter table integracao.conector enable row level security;
alter table integracao.conector force row level security;
create policy isolamento_tenant on integracao.conector for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert, update on integracao.conector to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- credencial — chave de API do Conector, guardada SÓ como HMAC-SHA256(pepper, chave) em hex (RN-INT-10). Rotação nunca
-- sobrescreve: a nova vira 'atual' e a antiga 'anterior' (convivência até anterior_valida_ate). hash_chave é único GLOBAL
-- (a autenticação ainda não tem tenant: integracao.autenticar_chave). Sem DELETE para a aplicação (revogar = revogada_em).
create table integracao.credencial (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references plataforma.tenant (id),
  conector_id          uuid not null,
  prefixo              text not null,
  hash_chave           text not null,
  versao_pepper        smallint not null default 1,
  escopo               text not null default 'integracao.v1',
  papel                text not null default 'atual',
  expira_em            timestamptz,
  anterior_valida_ate  timestamptz,
  revogada_em          timestamptz,
  revogada_por         uuid,
  motivo_revogacao     text,
  ultimo_uso_em        timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  deleted_at           timestamptz,
  external_id          text,
  constraint credencial_conector_fk foreign key (tenant_id, conector_id) references integracao.conector (tenant_id, id),
  constraint credencial_hash_formato check (hash_chave ~ '^[0-9a-f]{64}$'),
  constraint credencial_prefixo_formato check (prefixo ~ '^[A-Za-z0-9_-]{4,12}$'),
  constraint credencial_versao_pepper_positiva check (versao_pepper >= 1),
  constraint credencial_escopo_formato check (escopo ~ '^[a-z][a-z0-9_]*\.v[1-9][0-9]*$'),
  constraint credencial_papel_valido check (papel in ('atual', 'anterior')),
  constraint credencial_motivo_tamanho check (char_length(motivo_revogacao) <= 200),
  constraint credencial_revogacao_coerente check (revogada_por is null or revogada_em is not null)
);
create unique index credencial_hash_uk on integracao.credencial (hash_chave);
-- no máximo 1 'atual' e 1 'anterior' não revogadas por Conector
create unique index credencial_papel_uk on integracao.credencial (tenant_id, conector_id, papel) where revogada_em is null and deleted_at is null;
create trigger credencial_updated_at before update on integracao.credencial
  for each row execute function plataforma.definir_updated_at();
alter table integracao.credencial enable row level security;
alter table integracao.credencial force row level security;
create policy isolamento_tenant on integracao.credencial for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert, update on integracao.credencial to macuxi_app;

-- autenticar_chave — ÚNICA leitura sem tenant (ADR 0013 §3, etapa 3). Recebe o hash (a API calcula com o pepper do .env) e
-- devolve no máximo 1 linha: a credencial SEM o hash + tenant_id + dados do Conector (inclui entidades e recebe_pedidos, que o
-- validarEnvelope usa sem outra consulta). Não decide nada: revogada/expirada/convivência/inativo é do avaliarChaveConector.
-- Credencial ou Conector apagados (deleted_at) = nenhuma linha (401 genérico).
create function integracao.autenticar_chave(p_hash text)
  returns table (
    credencial_id uuid, tenant_id uuid, conector_id uuid, prefixo text, escopo text, papel text, versao_pepper smallint,
    criada_em timestamptz, expira_em timestamptz, anterior_valida_ate timestamptz, revogada_em timestamptz, ultimo_uso_em timestamptz,
    conector_identificador text, conector_tipo text, conector_ativo boolean, ips_permitidos inet[], recebe_pedidos boolean, entidades text[]
  )
  language sql stable security definer
  set search_path = pg_catalog, integracao
  as $$
    select k.id, k.tenant_id, k.conector_id, k.prefixo, k.escopo, k.papel, k.versao_pepper,
           k.created_at, k.expira_em, k.anterior_valida_ate, k.revogada_em, k.ultimo_uso_em,
           c.identificador, c.tipo, c.ativo, c.ips_permitidos, c.recebe_pedidos, c.entidades
      from integracao.credencial k
      join integracao.conector c on c.tenant_id = k.tenant_id and c.id = k.conector_id
     where k.hash_chave = p_hash and k.deleted_at is null and c.deleted_at is null
     limit 1
  $$;
revoke all on function integracao.autenticar_chave(text) from public;
grant execute on function integracao.autenticar_chave(text) to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- politica_versao — política de versão do Conector por tenant (RN-INT-11). Sem linha = sem política.
create table integracao.politica_versao (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references plataforma.tenant (id),
  versao_minima       text not null,
  versao_recomendada  text not null,
  mensagem            text,
  pacote              jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz,
  external_id         text,
  constraint politica_versao_minima_semver check (versao_minima ~ '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$'),
  constraint politica_versao_recomendada_semver check (versao_recomendada ~ '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$'),
  constraint politica_versao_mensagem_tamanho check (char_length(mensagem) <= 300),
  constraint politica_versao_pacote_objeto check (pacote is null or jsonb_typeof(pacote) = 'object')
);
create unique index politica_versao_tenant_uk on integracao.politica_versao (tenant_id) where deleted_at is null;
create trigger politica_versao_updated_at before update on integracao.politica_versao
  for each row execute function plataforma.definir_updated_at();
alter table integracao.politica_versao enable row level security;
alter table integracao.politica_versao force row level security;
create policy isolamento_tenant on integracao.politica_versao for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert, update on integracao.politica_versao to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- sessao_carga — carga completa em partes (RN-INT-06). id gerado no Hub; sessao_uuid = o UUID que o Conector manda.
-- linhas_sem_identificacao e invalidas_omitidas (T-0027): somadas a cada parte; > 0 impede a inativação da sessão.
create table integracao.sessao_carga (
  id                        uuid primary key default gen_random_uuid(),
  tenant_id                 uuid not null references plataforma.tenant (id),
  sessao_uuid               uuid not null,
  conector_id               uuid not null,
  entidade                  text not null,
  iniciada_em               timestamptz not null default now(),
  ultima_parte              integer,
  fechada_em                timestamptz,
  situacao                  text not null default 'aberta',
  inativadas                integer not null default 0,
  linhas_sem_identificacao  integer not null default 0,
  invalidas_omitidas        integer not null default 0,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  deleted_at                timestamptz,
  external_id               text,
  constraint sessao_carga_tenant_id_uk unique (tenant_id, id),
  constraint sessao_carga_uuid_uk unique (tenant_id, conector_id, sessao_uuid),
  constraint sessao_carga_conector_fk foreign key (tenant_id, conector_id) references integracao.conector (tenant_id, id),
  constraint sessao_carga_entidade_valida check (entidade in ('vendedor', 'cliente', 'produto', 'preco', 'estoque', 'titulo', 'nota', 'rota')),
  constraint sessao_carga_situacao_valida check (situacao in ('aberta', 'completa', 'expirada')),
  constraint sessao_carga_contagens_nao_negativas check (inativadas >= 0 and linhas_sem_identificacao >= 0 and invalidas_omitidas >= 0 and ultima_parte >= 1),
  constraint sessao_carga_fechada_coerente check ((situacao = 'aberta') = (fechada_em is null))
);
create index sessao_carga_entidade_ix on integracao.sessao_carga (tenant_id, entidade, situacao);
create trigger sessao_carga_updated_at before update on integracao.sessao_carga
  for each row execute function plataforma.definir_updated_at();
alter table integracao.sessao_carga enable row level security;
alter table integracao.sessao_carga force row level security;
create policy isolamento_tenant on integracao.sessao_carga for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert, update on integracao.sessao_carga to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- sessao_carga_recebido — ids do ERP que vieram na sessão mas NÃO foram aplicados (idsDaSessaoNoLote(...).invalidos: erros
-- do Hub e linhas inválidas do Conector com id). Nunca são inativados (RN-INT-06, 🔴 da T-0027). Apagados pelo expurgo 7 dias
-- depois de a sessão fechar (sem pendência aguardando).
create table integracao.sessao_carga_recebido (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references plataforma.tenant (id),
  sessao_id    uuid not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  external_id  text not null,
  constraint sessao_carga_recebido_sessao_fk foreign key (tenant_id, sessao_id) references integracao.sessao_carga (tenant_id, id) on delete cascade,
  constraint sessao_carga_recebido_uk unique (tenant_id, sessao_id, external_id),
  constraint sessao_carga_recebido_external_id_tamanho check (char_length(external_id) between 1 and 200)
);
create trigger sessao_carga_recebido_updated_at before update on integracao.sessao_carga_recebido
  for each row execute function plataforma.definir_updated_at();
alter table integracao.sessao_carga_recebido enable row level security;
alter table integracao.sessao_carga_recebido force row level security;
create policy isolamento_tenant on integracao.sessao_carga_recebido for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert, delete on integracao.sessao_carga_recebido to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- lote — cada POST /lotes aceito (RN-INT-01/12). Idempotência por (Conector, Idempotency-Key); hash_conteudo = sha256 do
-- conteúdo canônico (mesma chave + outro conteúdo = 409). aplicado_ate_indice = checkpoint da aplicação em blocos (null =
-- nada aplicado). Retenção 12 meses (expurgo; cascata em lote_staging e lote_linha_erro).
create table integracao.lote (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references plataforma.tenant (id),
  conector_id          uuid not null,
  entidade             text not null,
  modo                 text not null,
  versao_contrato      text not null,
  sessao_id            uuid,
  sessao_parte         integer,
  sessao_ultimo        boolean,
  chave_idempotencia   text not null,
  hash_conteudo        text not null,
  status               text not null default 'recebido',
  recebidas            integer not null,
  duplicadas_no_lote   integer not null default 0,
  com_erro             integer not null default 0,
  novas                integer not null default 0,
  atualizadas          integer not null default 0,
  inalteradas          integer not null default 0,
  obsoletas            integer not null default 0,
  inativadas           integer not null default 0,
  invalidas_omitidas   integer not null default 0,
  aplicado_ate_indice  integer,
  cursor_declarado     jsonb,
  cursor_resultante    jsonb,
  versao_conector      text,
  bytes                integer not null default 0,
  avisos               jsonb,
  tentativas           integer not null default 0,
  ultimo_erro          text,
  recebido_em          timestamptz not null default now(),
  iniciado_em          timestamptz,
  concluido_em         timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  deleted_at           timestamptz,
  external_id          text,
  constraint lote_tenant_id_uk unique (tenant_id, id),
  constraint lote_idempotencia_uk unique (tenant_id, conector_id, chave_idempotencia),
  constraint lote_conector_fk foreign key (tenant_id, conector_id) references integracao.conector (tenant_id, id),
  constraint lote_sessao_fk foreign key (tenant_id, sessao_id) references integracao.sessao_carga (tenant_id, id),
  constraint lote_entidade_valida check (entidade in ('vendedor', 'cliente', 'produto', 'preco', 'estoque', 'titulo', 'nota', 'rota')),
  constraint lote_modo_valido check (modo in ('completo', 'delta')),
  constraint lote_status_valido check (status in ('recebido', 'processando', 'concluido', 'concluido_com_erros', 'falhou')),
  constraint lote_sessao_so_no_completo check ((modo = 'completo') = (sessao_id is not null)),
  constraint lote_sessao_parte_coerente check (sessao_id is not null or (sessao_parte is null and sessao_ultimo is null)),
  constraint lote_chave_formato check (chave_idempotencia ~ '^[A-Za-z0-9._:-]{16,128}$'),
  constraint lote_hash_formato check (hash_conteudo ~ '^[0-9a-f]{64}$'),
  constraint lote_recebidas_positivas check (recebidas >= 1),
  constraint lote_contagens_nao_negativas check (duplicadas_no_lote >= 0 and com_erro >= 0 and novas >= 0 and atualizadas >= 0 and inalteradas >= 0 and obsoletas >= 0 and inativadas >= 0 and invalidas_omitidas >= 0 and tentativas >= 0 and bytes >= 0 and sessao_parte >= 1 and aplicado_ate_indice >= -1),
  constraint lote_ultimo_erro_tamanho check (char_length(ultimo_erro) <= 1000),
  constraint lote_versao_tamanho check (char_length(versao_contrato) <= 10 and char_length(versao_conector) <= 40)
);
-- um lote 'processando' por Conector+entidade (quem perde a corrida leva 23505 e a outbox repete)
create unique index lote_processando_uk on integracao.lote (tenant_id, conector_id, entidade) where status = 'processando';
create index lote_fila_ix on integracao.lote (tenant_id, status, recebido_em) where status in ('recebido', 'processando');
create index lote_recebido_ix on integracao.lote (tenant_id, recebido_em desc);
create index lote_com_erro_ix on integracao.lote (tenant_id, recebido_em desc) where com_erro > 0;
create index lote_conector_ix on integracao.lote (tenant_id, conector_id, recebido_em desc);
create index lote_entidade_ix on integracao.lote (tenant_id, entidade, recebido_em desc);
create index lote_sessao_ix on integracao.lote (tenant_id, sessao_id, sessao_parte, recebido_em desc) where sessao_id is not null;
create trigger lote_updated_at before update on integracao.lote
  for each row execute function plataforma.definir_updated_at();
alter table integracao.lote enable row level security;
alter table integracao.lote force row level security;
create policy isolamento_tenant on integracao.lote for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert, update on integracao.lote to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- lote_staging — corpo do lote (registros + linhas_invalidas) até ser aplicado; 1:1 com lote. Até 8 MiB por linha (TOAST lz4).
-- corpo anulado pelo expurgo 7 dias depois de concluído (30 dias em 'falhou').
create table integracao.lote_staging (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references plataforma.tenant (id),
  lote_id      uuid not null,
  corpo        jsonb compression lz4,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  external_id  text,
  constraint lote_staging_lote_uk unique (tenant_id, lote_id),
  constraint lote_staging_lote_fk foreign key (tenant_id, lote_id) references integracao.lote (tenant_id, id) on delete cascade,
  constraint lote_staging_corpo_objeto check (corpo is null or jsonb_typeof(corpo) = 'object')
);
create trigger lote_staging_updated_at before update on integracao.lote_staging
  for each row execute function plataforma.definir_updated_at();
alter table integracao.lote_staging enable row level security;
alter table integracao.lote_staging force row level security;
create policy isolamento_tenant on integracao.lote_staging for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert, update, delete on integracao.lote_staging to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- lote_linha_erro — linha com erro do lote (RN-INT-03): validada pelo Hub (origem hub, com payload para reprocessar) ou
-- informada pelo Conector em linhas_invalidas (origem conector, sem payload). external_id = chave do ERP da linha (nulo =
-- ilegível; até 200). Até 5.500 por lote. payload expurgado em 30 dias. resolvido_no_lote_id sem FK (o lote expira).
create table integracao.lote_linha_erro (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references plataforma.tenant (id),
  lote_id               uuid not null,
  indice                integer not null,
  origem                text not null,
  codigo                text not null,
  campo                 text,
  mensagem              text not null,
  reprocessavel         boolean not null default false,
  payload               jsonb,
  resolvido_em          timestamptz,
  resolvido_no_lote_id  uuid,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz,
  external_id           text,
  constraint lote_linha_erro_lote_fk foreign key (tenant_id, lote_id) references integracao.lote (tenant_id, id) on delete cascade,
  constraint lote_linha_erro_uk unique (tenant_id, lote_id, origem, indice),
  constraint lote_linha_erro_indice_nao_negativo check (indice >= 0),
  constraint lote_linha_erro_origem_valida check (origem in ('hub', 'conector')),
  constraint lote_linha_erro_codigo_valido check (codigo in ('registro_invalido', 'external_id_invalido', 'campo_obrigatorio', 'tipo_invalido', 'formato_invalido', 'valor_fora_da_faixa', 'valor_nao_permitido', 'campo_desconhecido', 'regra_invalida', 'referencia_ausente', 'falha_processamento')),
  constraint lote_linha_erro_payload_so_do_hub check (origem = 'hub' or payload is null),
  constraint lote_linha_erro_external_id_tamanho check (external_id is null or char_length(external_id) between 1 and 200),
  constraint lote_linha_erro_textos_tamanho check (char_length(campo) <= 100 and char_length(mensagem) between 1 and 1000)
);
create index lote_linha_erro_codigo_ix on integracao.lote_linha_erro (tenant_id, codigo, resolvido_em);
create index lote_linha_erro_expurgo_ix on integracao.lote_linha_erro (tenant_id, created_at) where payload is not null;
create trigger lote_linha_erro_updated_at before update on integracao.lote_linha_erro
  for each row execute function plataforma.definir_updated_at();
alter table integracao.lote_linha_erro enable row level security;
alter table integracao.lote_linha_erro force row level security;
create policy isolamento_tenant on integracao.lote_linha_erro for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert, update, delete on integracao.lote_linha_erro to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- registro_atual — espelho do último registro aceito por (tenant, entidade, external_id do ERP). Tabela única, sem partição
-- (v1; reavaliar acima de 50 milhões de linhas ou p95 > 300 ms). "Ativo" = ativo and deleted_at is null; deleted_at =
-- inativado pela carga completa (hash esquecido). UPSERT MONOTÔNICO (🔴 V1, RN-INT-06):
--   insert ... on conflict (tenant_id, entidade, external_id) do update set ... where excluded.alterado_em >= registro_atual.alterado_em
-- lote_id e sessao_id sem FK (informativos; o lote expira em 12 meses). Sinal de "visto" a cada carga: fillfactor 90.
create table integracao.registro_atual (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references plataforma.tenant (id),
  entidade        text not null,
  conector_id     uuid not null,
  hash            text,
  payload         jsonb,
  valor_controle  bigint,
  alterado_em     timestamptz(3) not null,
  ativo           boolean not null default true,
  lote_id         uuid,
  sessao_id       uuid,
  visto_em        timestamptz not null default now(),
  aplicado_em     timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  external_id     text not null,
  constraint registro_atual_conector_fk foreign key (tenant_id, conector_id) references integracao.conector (tenant_id, id),
  constraint registro_atual_entidade_valida check (entidade in ('vendedor', 'cliente', 'produto', 'preco', 'estoque', 'titulo', 'nota', 'rota')),
  constraint registro_atual_external_id_tamanho check (char_length(external_id) between 1 and 200),
  constraint registro_atual_hash_formato check (hash ~ '^[0-9a-f]{64}$'),
  constraint registro_atual_hash_se_vivo check (hash is not null or deleted_at is not null)
);
alter table integracao.registro_atual set (fillfactor = 90);
create unique index registro_atual_chave_uk on integracao.registro_atual (tenant_id, entidade, external_id) include (hash, alterado_em);
-- candidatos à inativação, contagem da sessão e reconciliação (contagem_macuxi / soma de controle)
create index registro_atual_ativos_ix on integracao.registro_atual (tenant_id, entidade, conector_id, visto_em) include (valor_controle) where ativo and deleted_at is null;
create trigger registro_atual_updated_at before update on integracao.registro_atual
  for each row execute function plataforma.definir_updated_at();
alter table integracao.registro_atual enable row level security;
alter table integracao.registro_atual force row level security;
create policy isolamento_tenant on integracao.registro_atual for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert, update on integracao.registro_atual to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- pendencia_inativacao — trava de inativação em massa (RN-INT-06): a carga completa que inativaria acima do limite espera
-- confirmação de admin ou analista no BKO por 7 dias. Decisão: update ... where estado = 'aguardando' returning (P-3).
-- decidida_por / decidida_por_perfil = autor da sessão do usuário (nunca do corpo). lote_id sem FK (o lote expira).
create table integracao.pendencia_inativacao (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references plataforma.tenant (id),
  sessao_id            uuid not null,
  entidade             text not null,
  conector_id          uuid not null,
  lote_id              uuid not null,
  estado               text not null default 'aguardando',
  candidatos           integer not null,
  total_ativos         integer not null,
  percentual           numeric(5,2) not null,
  limite_pct           numeric(5,2) not null,
  amostra              jsonb not null default '[]'::jsonb,
  expira_em            timestamptz not null,
  decidida_em          timestamptz,
  decidida_por         uuid,
  decidida_por_perfil  text,
  motivo_decisao       text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  deleted_at           timestamptz,
  external_id          text,
  constraint pendencia_inativacao_tenant_id_uk unique (tenant_id, id),
  constraint pendencia_inativacao_sessao_uk unique (tenant_id, sessao_id),
  constraint pendencia_inativacao_sessao_fk foreign key (tenant_id, sessao_id) references integracao.sessao_carga (tenant_id, id),
  constraint pendencia_inativacao_conector_fk foreign key (tenant_id, conector_id) references integracao.conector (tenant_id, id),
  constraint pendencia_inativacao_entidade_valida check (entidade in ('vendedor', 'cliente', 'produto', 'preco', 'estoque', 'titulo', 'nota', 'rota')),
  constraint pendencia_inativacao_estado_valido check (estado in ('aguardando', 'confirmada', 'recusada', 'expirada')),
  constraint pendencia_inativacao_perfil_valido check (decidida_por_perfil is null or decidida_por_perfil in ('admin', 'analista')),
  constraint pendencia_inativacao_numeros_validos check (candidatos >= 0 and total_ativos >= 0 and percentual >= 0 and limite_pct > 0 and limite_pct <= 100),
  constraint pendencia_inativacao_amostra_lista check (jsonb_typeof(amostra) = 'array' and jsonb_array_length(amostra) <= 50),
  constraint pendencia_inativacao_motivo_tamanho check (char_length(motivo_decisao) <= 300),
  constraint pendencia_inativacao_decisao_coerente check (estado not in ('confirmada', 'recusada') or (decidida_em is not null and decidida_por is not null and decidida_por_perfil is not null)),
  constraint pendencia_inativacao_aguardando_sem_decisao check (estado <> 'aguardando' or (decidida_em is null and decidida_por is null and decidida_por_perfil is null))
);
create unique index pendencia_inativacao_aguardando_uk on integracao.pendencia_inativacao (tenant_id, conector_id, entidade) where estado = 'aguardando';
create index pendencia_inativacao_estado_ix on integracao.pendencia_inativacao (tenant_id, estado, entidade);
create trigger pendencia_inativacao_updated_at before update on integracao.pendencia_inativacao
  for each row execute function plataforma.definir_updated_at();
alter table integracao.pendencia_inativacao enable row level security;
alter table integracao.pendencia_inativacao force row level security;
create policy isolamento_tenant on integracao.pendencia_inativacao for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert, update on integracao.pendencia_inativacao to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- inativacao_auditoria — trilha APPEND-ONLY de cada confirmação/recusa (P-3, T-0031): quem (uuid + perfil), quando, lote e
-- quantidade. Gravada na MESMA transação da decisão (sem auditoria não há decisão). quantidade = o que a pendência previa;
-- inativadas = quantos foram de fato inativados ao confirmar (a reavaliação pode inativar menos); nulo na recusa.
-- Sem UPDATE/DELETE para a aplicação e sem gatilho de updated_at (como plataforma.auditoria).
create table integracao.inativacao_auditoria (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references plataforma.tenant (id),
  pendencia_id  uuid not null,
  sessao_id     uuid not null,
  lote_id       uuid not null,
  entidade      text not null,
  conector_id   uuid not null,
  acao          text not null,
  decidida_por  uuid not null,
  perfil        text not null,
  decidida_em   timestamptz not null,
  quantidade    integer not null,
  total_ativos  integer not null,
  percentual    numeric(5,2) not null,
  motivo        text,
  inativadas    integer,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  external_id   text,
  constraint inativacao_auditoria_pendencia_fk foreign key (tenant_id, pendencia_id) references integracao.pendencia_inativacao (tenant_id, id),
  constraint inativacao_auditoria_conector_fk foreign key (tenant_id, conector_id) references integracao.conector (tenant_id, id),
  constraint inativacao_auditoria_entidade_valida check (entidade in ('vendedor', 'cliente', 'produto', 'preco', 'estoque', 'titulo', 'nota', 'rota')),
  constraint inativacao_auditoria_acao_valida check (acao in ('confirmar', 'recusar')),
  constraint inativacao_auditoria_perfil_valido check (perfil in ('admin', 'analista')),
  constraint inativacao_auditoria_numeros_validos check (quantidade >= 0 and total_ativos >= 0 and percentual >= 0 and inativadas >= 0),
  constraint inativacao_auditoria_inativadas_so_ao_confirmar check (acao = 'confirmar' or inativadas is null),
  constraint inativacao_auditoria_motivo_tamanho check (char_length(motivo) <= 300)
);
create index inativacao_auditoria_decidida_ix on integracao.inativacao_auditoria (tenant_id, decidida_em desc);
create index inativacao_auditoria_pendencia_ix on integracao.inativacao_auditoria (tenant_id, pendencia_id);
alter table integracao.inativacao_auditoria enable row level security;
alter table integracao.inativacao_auditoria force row level security;
create policy isolamento_tenant on integracao.inativacao_auditoria for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert on integracao.inativacao_auditoria to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- cursor_entidade — de onde o Conector continua o delta, por (Conector, entidade). cursor_external_id em collation "C"
-- (ordem ordinal, igual à do Conector). Escrita MONOTÔNICA:
--   insert ... on conflict (tenant_id, conector_id, entidade) do update set ...
--     where (cursor_entidade.cursor_alterado_em, cursor_entidade.cursor_external_id) < (excluded.cursor_alterado_em, excluded.cursor_external_id)
create table integracao.cursor_entidade (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references plataforma.tenant (id),
  conector_id         uuid not null,
  entidade            text not null,
  cursor_alterado_em  timestamptz(3),
  cursor_external_id  text collate "C",
  atualizado_em       timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz,
  external_id         text,
  constraint cursor_entidade_uk unique (tenant_id, conector_id, entidade),
  constraint cursor_entidade_conector_fk foreign key (tenant_id, conector_id) references integracao.conector (tenant_id, id),
  constraint cursor_entidade_entidade_valida check (entidade in ('vendedor', 'cliente', 'produto', 'preco', 'estoque', 'titulo', 'nota', 'rota')),
  constraint cursor_entidade_external_id_tamanho check (cursor_external_id is null or char_length(cursor_external_id) between 1 and 200),
  constraint cursor_entidade_par_completo check ((cursor_alterado_em is null) = (cursor_external_id is null))
);
create trigger cursor_entidade_updated_at before update on integracao.cursor_entidade
  for each row execute function plataforma.definir_updated_at();
alter table integracao.cursor_entidade enable row level security;
alter table integracao.cursor_entidade force row level security;
create policy isolamento_tenant on integracao.cursor_entidade for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert, update on integracao.cursor_entidade to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- reconciliacao — contagem e soma do dia, ERP x Macuxi (RN-INT-07). Reenviar o mesmo dia substitui (upsert pela chave).
-- Contagens e somas em bigint (soma em centavos/milésimos, conforme a entidade).
create table integracao.reconciliacao (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references plataforma.tenant (id),
  conector_id         uuid not null,
  entidade            text not null,
  data_referencia     date not null,
  contagem_erp        bigint not null,
  soma_erp            bigint,
  contagem_macuxi     bigint not null default 0,
  soma_macuxi         bigint,
  diferenca_contagem  bigint not null default 0,
  diferenca_soma      bigint,
  diferenca_pct       numeric(12,2),
  divergente          boolean not null default false,
  motivos             text[] not null default '{}',
  situacao            text not null default 'comparada',
  evento_publicado    boolean not null default false,
  calculada_em        timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz,
  external_id         text,
  constraint reconciliacao_uk unique (tenant_id, conector_id, entidade, data_referencia),
  constraint reconciliacao_conector_fk foreign key (tenant_id, conector_id) references integracao.conector (tenant_id, id),
  constraint reconciliacao_entidade_valida check (entidade in ('vendedor', 'cliente', 'produto', 'preco', 'estoque', 'titulo', 'nota', 'rota')),
  constraint reconciliacao_situacao_valida check (situacao in ('comparada', 'pendente')),
  constraint reconciliacao_motivos_validos check (motivos <@ array['contagem_divergente', 'soma_divergente', 'soma_ausente']::text[]),
  constraint reconciliacao_contagens_nao_negativas check (contagem_erp >= 0 and contagem_macuxi >= 0)
);
create index reconciliacao_divergente_ix on integracao.reconciliacao (tenant_id, data_referencia desc) where divergente;
create trigger reconciliacao_updated_at before update on integracao.reconciliacao
  for each row execute function plataforma.definir_updated_at();
alter table integracao.reconciliacao enable row level security;
alter table integracao.reconciliacao force row level security;
create policy isolamento_tenant on integracao.reconciliacao for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert, update on integracao.reconciliacao to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- mapeamento — de-para de códigos ERP x Macuxi (condição de pagamento vai Macuxi -> ERP; depósito e status, ERP -> Macuxi).
-- Único por codigo_erp entre os vivos; para condicao_pagamento, um correspondente ATIVO por codigo_macuxi.
create table integracao.mapeamento (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references plataforma.tenant (id),
  tipo           text not null,
  codigo_erp     text not null,
  codigo_macuxi  text not null,
  descricao      text,
  ativo          boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  external_id    text,
  constraint mapeamento_tipo_valido check (tipo in ('condicao_pagamento', 'deposito', 'status')),
  constraint mapeamento_codigos_preenchidos check (btrim(codigo_erp) <> '' and char_length(codigo_erp) <= 60 and btrim(codigo_macuxi) <> '' and char_length(codigo_macuxi) <= 60),
  constraint mapeamento_descricao_tamanho check (char_length(descricao) <= 200)
);
create unique index mapeamento_codigo_erp_uk on integracao.mapeamento (tenant_id, tipo, codigo_erp) where deleted_at is null;
create unique index mapeamento_codigo_macuxi_uk on integracao.mapeamento (tenant_id, tipo, codigo_macuxi) where tipo = 'condicao_pagamento' and ativo and deleted_at is null;
create trigger mapeamento_updated_at before update on integracao.mapeamento
  for each row execute function plataforma.definir_updated_at();
alter table integracao.mapeamento enable row level security;
alter table integracao.mapeamento force row level security;
create policy isolamento_tenant on integracao.mapeamento for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert, update, delete on integracao.mapeamento to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- pedido_fila_erp — pedido aprovado esperando o ERP (RN-INT-08). Entra pelo evento vendedor.pedido.aprovado@1 (o Hub não lê
-- tabela do Vendedor). payload = PedidoParaErp (nulo enquanto retido por de-para); payload_origem = o que veio do evento.
-- Remoção só por deleted_at: o único TOTAL por pedido continua garantindo a idempotência. Poll: for update skip locked;
-- retorno: select ... for update na linha antes de validar o saldo de itens_faturados_acumulados.
create table integracao.pedido_fila_erp (
  id                          uuid primary key default gen_random_uuid(),
  tenant_id                   uuid not null references plataforma.tenant (id),
  pedido_uuid                 uuid not null,
  estado                      text not null default 'pendente',
  payload                     jsonb,
  payload_origem              jsonb not null,
  retencao_codigo             text,
  retencao_mensagem           text,
  conector_id                 uuid,
  enviado_em                  timestamptz,
  tentativas                  integer not null default 0,
  numero_erp                  text,
  motivo                      text,
  nota_numero                 text,
  nota_serie                  text,
  nota_emitida_em             timestamptz,
  nota_total_cents            bigint,
  notas_aplicadas             jsonb not null default '[]'::jsonb,
  itens_faturados_acumulados  jsonb not null default '{}'::jsonb,
  ultimo_retorno_em           timestamptz,
  aprovado_em                 timestamptz not null,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  deleted_at                  timestamptz,
  external_id                 text,
  constraint pedido_fila_erp_tenant_id_uk unique (tenant_id, id),
  constraint pedido_fila_erp_pedido_uk unique (tenant_id, pedido_uuid),
  constraint pedido_fila_erp_conector_fk foreign key (tenant_id, conector_id) references integracao.conector (tenant_id, id),
  constraint pedido_fila_erp_estado_valido check (estado in ('pendente', 'enviado', 'integrado', 'rejeitado_erp', 'faturado_parcial', 'faturado_total', 'cancelado')),
  constraint pedido_fila_erp_retencao_valida check (retencao_codigo is null or retencao_codigo in ('mapeamento_ausente', 'mapeamento_ambiguo', 'sequencia_repetida')),
  constraint pedido_fila_erp_retido_sem_payload check (retencao_codigo is null or payload is null),
  constraint pedido_fila_erp_json_validos check (jsonb_typeof(payload_origem) = 'object' and (payload is null or jsonb_typeof(payload) = 'object') and jsonb_typeof(notas_aplicadas) = 'array' and jsonb_typeof(itens_faturados_acumulados) = 'object'),
  constraint pedido_fila_erp_numeros_validos check (tentativas >= 0 and nota_total_cents >= 0)
);
-- poll do Conector (1–2 min)
create index pedido_fila_erp_poll_ix on integracao.pedido_fila_erp (tenant_id, aprovado_em) where estado = 'pendente' and retencao_codigo is null and deleted_at is null;
-- reentrega após o timeout sem confirmação
create index pedido_fila_erp_enviado_ix on integracao.pedido_fila_erp (tenant_id, enviado_em) where estado = 'enviado';
-- retidos (reprocessar ao salvar mapeamento)
create index pedido_fila_erp_retido_ix on integracao.pedido_fila_erp (tenant_id) where retencao_codigo is not null and deleted_at is null;
-- lista do BKO por estado
create index pedido_fila_erp_estado_ix on integracao.pedido_fila_erp (tenant_id, estado, aprovado_em desc);
create trigger pedido_fila_erp_updated_at before update on integracao.pedido_fila_erp
  for each row execute function plataforma.definir_updated_at();
alter table integracao.pedido_fila_erp enable row level security;
alter table integracao.pedido_fila_erp force row level security;
create policy isolamento_tenant on integracao.pedido_fila_erp for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert, update on integracao.pedido_fila_erp to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- pedido_retorno — trilha de cada retorno do ERP ACEITO e não repetido (RN-INT-08). Segunda guarda da idempotência:
-- único (tenant, pedido, status, nota_numero, nota_serie) com nulos iguais (nota nula = mesma chave). Só leitura e inserção.
create table integracao.pedido_retorno (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references plataforma.tenant (id),
  pedido_uuid       uuid not null,
  status            text not null,
  numero_erp        text,
  motivo            text,
  nota_numero       text,
  nota_serie        text,
  nota_emitida_em   timestamptz,
  nota_total_cents  bigint,
  itens_faturados   jsonb,
  ocorrido_em       timestamptz not null,
  conector_id       uuid not null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  external_id       text,
  constraint pedido_retorno_tenant_id_uk unique (tenant_id, id),
  constraint pedido_retorno_fila_fk foreign key (tenant_id, pedido_uuid) references integracao.pedido_fila_erp (tenant_id, pedido_uuid),
  constraint pedido_retorno_conector_fk foreign key (tenant_id, conector_id) references integracao.conector (tenant_id, id),
  constraint pedido_retorno_status_valido check (status in ('integrado', 'rejeitado_erp', 'faturado_parcial', 'faturado_total', 'cancelado')),
  constraint pedido_retorno_itens_lista check (itens_faturados is null or jsonb_typeof(itens_faturados) = 'array'),
  constraint pedido_retorno_total_nao_negativo check (nota_total_cents >= 0)
);
create unique index pedido_retorno_uk on integracao.pedido_retorno (tenant_id, pedido_uuid, status, nota_numero, nota_serie) nulls not distinct;
create index pedido_retorno_pedido_ix on integracao.pedido_retorno (tenant_id, pedido_uuid, ocorrido_em);
create trigger pedido_retorno_updated_at before update on integracao.pedido_retorno
  for each row execute function plataforma.definir_updated_at();
alter table integracao.pedido_retorno enable row level security;
alter table integracao.pedido_retorno force row level security;
create policy isolamento_tenant on integracao.pedido_retorno for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert on integracao.pedido_retorno to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- pedido_retorno_erro — item faturado DESCARTADO de um retorno aceito (P-4, T-0031): o status valeu, o item não. Um por
-- item (erros_monitor), gravado na mesma transação do retorno. pedido_retorno_id = a trilha gravada junto (nulo quando o
-- retorno é repetido e não gera trilha nova). codigo = o primeiro problema; codigos = todos. Alerta do monitor: created_at
-- das últimas 24 h. resolvido_em = marcado no BKO.
create table integracao.pedido_retorno_erro (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references plataforma.tenant (id),
  pedido_uuid          uuid not null,
  pedido_retorno_id    uuid,
  status               text not null,
  numero_erp           text,
  nota_numero          text,
  nota_serie           text,
  ocorrido_em          timestamptz not null,
  indice               integer not null,
  sequencia            integer not null,
  produto_external_id  text not null,
  quantidade           integer not null,
  codigo               text not null,
  codigos              text[] not null,
  campo                text not null,
  motivo               text not null,
  conector_id          uuid not null,
  resolvido_em         timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  deleted_at           timestamptz,
  external_id          text,
  constraint pedido_retorno_erro_fila_fk foreign key (tenant_id, pedido_uuid) references integracao.pedido_fila_erp (tenant_id, pedido_uuid),
  constraint pedido_retorno_erro_retorno_fk foreign key (tenant_id, pedido_retorno_id) references integracao.pedido_retorno (tenant_id, id),
  constraint pedido_retorno_erro_conector_fk foreign key (tenant_id, conector_id) references integracao.conector (tenant_id, id),
  constraint pedido_retorno_erro_status_valido check (status in ('integrado', 'rejeitado_erp', 'faturado_parcial', 'faturado_total', 'cancelado')),
  constraint pedido_retorno_erro_codigo_valido check (codigo in ('sequencia_inexistente', 'produto_divergente', 'quantidade_acima_do_saldo', 'sequencia_repetida')),
  constraint pedido_retorno_erro_codigos_validos check (cardinality(codigos) >= 1 and codigos <@ array['sequencia_inexistente', 'produto_divergente', 'quantidade_acima_do_saldo', 'sequencia_repetida']::text[]),
  constraint pedido_retorno_erro_produto_tamanho check (char_length(produto_external_id) between 1 and 200),
  constraint pedido_retorno_erro_numeros_validos check (indice >= 0 and sequencia >= 1 and quantidade >= 1),
  constraint pedido_retorno_erro_textos_tamanho check (char_length(campo) between 1 and 200 and char_length(motivo) between 1 and 1000)
);
-- alerta das últimas 24 h e lista "Erros de retorno" do monitor
create index pedido_retorno_erro_criado_ix on integracao.pedido_retorno_erro (tenant_id, created_at desc);
create index pedido_retorno_erro_pedido_ix on integracao.pedido_retorno_erro (tenant_id, pedido_uuid);
create trigger pedido_retorno_erro_updated_at before update on integracao.pedido_retorno_erro
  for each row execute function plataforma.definir_updated_at();
alter table integracao.pedido_retorno_erro enable row level security;
alter table integracao.pedido_retorno_erro force row level security;
create policy isolamento_tenant on integracao.pedido_retorno_erro for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert, update on integracao.pedido_retorno_erro to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- expurgar_retencao — retenção do Hub (hub-api §14), chamada pelo worker (agendamento do engenheiro-software) em blocos de
-- até p_limite linhas por item; devolve as contagens por item. SECURITY DEFINER (todos os tenants), só macuxi_worker.
--   lote:                   concluído/falhou recebido há mais de 12 meses (cascata em lote_staging e lote_linha_erro);
--   credencial:             revogada há mais de 12 meses;
--   lote_linha_erro.payload: anulado 30 dias depois de criado;
--   lote_staging.corpo:      anulado 7 dias depois do lote concluído (30 dias em 'falhou');
--   sessao_carga_recebido:  da sessão fechada há mais de 7 dias, sem pendência aguardando e ainda válida;
--   registro_atual.payload: anulado 30 dias depois da inativação.
create function integracao.expurgar_retencao(p_agora timestamptz default now(), p_limite integer default 5000)
  returns table (item text, quantidade bigint)
  language plpgsql volatile security definer
  set search_path = pg_catalog, integracao
  as $$
#variable_conflict use_column
declare
  n bigint;
begin
  if p_agora is null or p_limite is null or p_limite < 1 then
    raise exception 'expurgar_retencao: p_agora obrigatório e p_limite >= 1';
  end if;

  delete from integracao.lote l
   where l.id in (select x.id from integracao.lote x
                   where x.status in ('concluido', 'concluido_com_erros', 'falhou') and x.recebido_em < p_agora - interval '12 months'
                   order by x.recebido_em limit p_limite);
  get diagnostics n = row_count;
  item := 'lote'; quantidade := n; return next;

  delete from integracao.credencial k
   where k.id in (select x.id from integracao.credencial x
                   where x.revogada_em < p_agora - interval '12 months'
                   order by x.revogada_em limit p_limite);
  get diagnostics n = row_count;
  item := 'credencial'; quantidade := n; return next;

  update integracao.lote_linha_erro e set payload = null
   where e.id in (select x.id from integracao.lote_linha_erro x
                   where x.payload is not null and x.created_at < p_agora - interval '30 days'
                   limit p_limite);
  get diagnostics n = row_count;
  item := 'lote_linha_erro.payload'; quantidade := n; return next;

  update integracao.lote_staging s set corpo = null
   where s.id in (select x.id from integracao.lote_staging x
                    join integracao.lote l on l.tenant_id = x.tenant_id and l.id = x.lote_id
                   where x.corpo is not null
                     and ((l.status in ('concluido', 'concluido_com_erros') and coalesce(l.concluido_em, l.recebido_em) < p_agora - interval '7 days')
                       or (l.status = 'falhou' and coalesce(l.concluido_em, l.recebido_em) < p_agora - interval '30 days'))
                   limit p_limite);
  get diagnostics n = row_count;
  item := 'lote_staging.corpo'; quantidade := n; return next;

  delete from integracao.sessao_carga_recebido r
   where r.id in (select x.id from integracao.sessao_carga_recebido x
                    join integracao.sessao_carga s on s.tenant_id = x.tenant_id and s.id = x.sessao_id
                   where s.situacao <> 'aberta' and coalesce(s.fechada_em, s.iniciada_em) < p_agora - interval '7 days'
                     and not exists (select 1 from integracao.pendencia_inativacao p
                                      where p.tenant_id = s.tenant_id and p.sessao_id = s.id
                                        and p.estado = 'aguardando' and p.expira_em > p_agora)
                   limit p_limite);
  get diagnostics n = row_count;
  item := 'sessao_carga_recebido'; quantidade := n; return next;

  update integracao.registro_atual r set payload = null
   where r.id in (select x.id from integracao.registro_atual x
                   where x.payload is not null and x.deleted_at < p_agora - interval '30 days'
                   limit p_limite);
  get diagnostics n = row_count;
  item := 'registro_atual.payload'; quantidade := n; return next;
end
$$;
revoke all on function integracao.expurgar_retencao(timestamptz, integer) from public;
grant execute on function integracao.expurgar_retencao(timestamptz, integer) to macuxi_worker;
