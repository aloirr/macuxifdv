-- 0017_treinamento (up) — schema do módulo Treinamento (T-0058, PR #42; pedidos R-20261102-131733-modulo-treinamento e
-- R-20261031-105033/R-20261102-083826-modulo-treinamento da T-0011). Desenho: docs/modulos/treinamento/api-e-telas.md §4,
-- regras em docs/modulos/treinamento/regras.md e dicionário em docs/banco/treinamento.md.
-- Conteúdo (BKO, RF-TRE-01): trilha → modulo_trilha → licao → quiz → questao → alternativa. O aparelho puxa a trilha
-- inteira numa linha (entidade de sync `trilha`): alterar QUALQUER nó da árvore sobe o updated_at da trilha (gatilho
-- treinamento.tocar_trilha). Por isso todo nó guarda trilha_id (desnormalizado, preso por FK composta ao pai).
-- Público-alvo (RN-TRE-07): arrays publico_perfis/publico_equipes na própria trilha (contrato PublicoAlvoContrato da T-0058;
-- vazio = sem restrição; os dois preenchidos = interseção). Não há tabela publico_alvo (premissa em docs/banco/treinamento.md).
-- Aluno (RN-TRE-01/02/04/05/06): progresso, tentativa, xp_lancamento e medalha_usuario são APPEND-ONLY — a aplicação só lê e
-- insere (saldo de XP = soma dos lançamentos). Idempotência: id = UUID do aparelho (PK) + chave natural única:
--   progresso (tenant_id, usuario_id, licao_id); xp_lancamento (tenant_id, usuario_id, origem, referencia_id) — violação =
--   `duplicado`; medalha_usuario (tenant_id, usuario_id, medalha_codigo).
-- Desafio de vendas (RF-TRE-06, RN-TRE-08): desafio_vendas + desafio_vendas_produto (produto_id sem FK para o Catálogo/Core).
-- Medalhas (RF-TRE-03): catálogo por tenant em treinamento.medalha (o código traz MEDALHAS_PADRAO; a tabela permite ajustar).
-- Publicação (RF-TRE-01, RN-AUD-01): linha do tempo append-only em trilha_publicacao (a API também grava plataforma.auditoria).
-- Ranking (RF-TRE-04) e painel de adesão (RF-TRE-05) são CALCULADOS (domain) sobre xp_lancamento, progresso e tentativa:
--   sem tabela própria, só índices. Níveis e streak também são calculados (parâmetros em plataforma.parametro, modulo
--   'treinamento'). Licença: plataforma.tenant_modulo/perfil_modulo (seed db/seeds/demo/treinamento.ts para a demo).
-- Listas fechadas = código do Treinamento, conferidas em db/testes/treinamento.test.ts: trilha.status = StatusTrilha;
--   licao.tipo = TIPOS_LICAO ('texto','video','pdf','link'); xp_lancamento.origem = ORIGENS_XP; publico_perfis ⊆ PERFIS.
-- FRONTEIRA: nenhuma FK para core/catalogo/vendedor (usuario_id, equipe, produto_id, autor_id são validados pela API com
-- contratos do Core). FKs só dentro do schema, compostas por tenant. Dados do aluno sem FK para o conteúdo (a árvore pode
-- ser regravada pelo BKO; os ids de conteúdo são estáveis).
-- Sync: toda tabela com (tenant_id, updated_at, id); as do aluno também com (tenant_id, usuario_id, updated_at, id).
-- Escrita do aluno serializada pela API com pg_advisory_xact_lock(tenant, usuário) (regras.md §8): nada de função aqui.
-- Caminho de volta: 0017_treinamento.down.sql (drop schema treinamento cascade — APAGA trilhas, progresso, XP e medalhas;
-- a licença 'treinamento' em plataforma.tenant_modulo fica, sem efeito até um novo up).

create schema treinamento;
grant usage on schema treinamento to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- tocar_trilha — gatilho dos nós da árvore: sobe o updated_at da trilha (cursor do pull `trilha`). Uma vez por trilha
-- por transação: depois da primeira, updated_at = now() e o UPDATE não acha linha. SECURITY INVOKER (RLS vale).
create function treinamento.tocar_trilha() returns trigger
  language plpgsql
  set search_path = pg_catalog, treinamento, pg_temp
  as $$
begin
  if tg_op in ('INSERT', 'UPDATE') then
    update treinamento.trilha set updated_at = now()
     where tenant_id = new.tenant_id and id = new.trilha_id and updated_at <> now();
  end if;
  if tg_op in ('UPDATE', 'DELETE') then
    update treinamento.trilha set updated_at = now()
     where tenant_id = old.tenant_id and id = old.trilha_id and updated_at <> now();
  end if;
  return null;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- trilha — raiz do conteúdo (RF-TRE-01). id gerado no BKO (idempotente). Status: rascunho → publicada → arquivada
-- (arquivar também vale para rascunho; arquivada não volta). prazo = data civil no fuso do tenant.
-- Volume: dezenas por tenant. Consultas: lista do BKO por status; pull por (updated_at, id) incluindo removidas.
create table treinamento.trilha (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references plataforma.tenant (id),
  titulo           text not null,
  descricao        text,
  status           text not null default 'rascunho',
  obrigatoria      boolean not null default false,
  sequencial       boolean not null default true,
  prazo            date,
  publico_perfis   text[] not null default '{}',
  publico_equipes  uuid[] not null default '{}',
  publicada_em     timestamptz,
  arquivada_em     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  external_id      text,
  constraint trilha_tenant_id_uk unique (tenant_id, id),
  constraint trilha_titulo_preenchido check (btrim(titulo) <> '' and char_length(titulo) <= 200),
  constraint trilha_descricao_tamanho check (char_length(descricao) <= 2000),
  constraint trilha_status_valido check (status in ('rascunho', 'publicada', 'arquivada')),
  constraint trilha_publicada_com_data check (status <> 'publicada' or publicada_em is not null),
  constraint trilha_arquivada_com_data check (status <> 'arquivada' or arquivada_em is not null),
  constraint trilha_publico_perfis_validos check (
    cardinality(publico_perfis) <= 10
    and publico_perfis <@ array['vendedor', 'promotor', 'supervisor', 'gerente', 'analista', 'assistente', 'admin']::text[]
  ),
  constraint trilha_publico_equipes_validas check (cardinality(publico_equipes) <= 200 and array_position(publico_equipes, null) is null)
);
create index trilha_sync_ix on treinamento.trilha (tenant_id, updated_at, id);
create index trilha_status_ix on treinamento.trilha (tenant_id, status) where deleted_at is null;
create unique index trilha_external_uk on treinamento.trilha (tenant_id, external_id) where external_id is not null and deleted_at is null;
create trigger trilha_updated_at before update on treinamento.trilha
  for each row execute function plataforma.definir_updated_at();
alter table treinamento.trilha enable row level security;
alter table treinamento.trilha force row level security;
create policy isolamento_tenant on treinamento.trilha for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert, update, delete on treinamento.trilha to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- modulo_trilha — módulos da trilha (o nome evita confundir com "módulo" do produto). pre_requisitos = ids de módulos.
create table treinamento.modulo_trilha (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references plataforma.tenant (id),
  trilha_id       uuid not null,
  ordem           integer not null,
  titulo          text not null,
  pre_requisitos  uuid[] not null default '{}',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  external_id     text,
  constraint modulo_trilha_tenant_id_uk unique (tenant_id, trilha_id, id),
  constraint modulo_trilha_trilha_fk foreign key (tenant_id, trilha_id) references treinamento.trilha (tenant_id, id),
  constraint modulo_trilha_ordem_valida check (ordem >= 0),
  constraint modulo_trilha_titulo_preenchido check (btrim(titulo) <> '' and char_length(titulo) <= 200),
  constraint modulo_trilha_pre_requisitos_validos check (cardinality(pre_requisitos) <= 100 and array_position(pre_requisitos, null) is null)
);
create index modulo_trilha_sync_ix on treinamento.modulo_trilha (tenant_id, updated_at, id);
create index modulo_trilha_trilha_ix on treinamento.modulo_trilha (tenant_id, trilha_id, ordem);
create trigger modulo_trilha_updated_at before update on treinamento.modulo_trilha
  for each row execute function plataforma.definir_updated_at();
create trigger modulo_trilha_toca_trilha after insert or update or delete on treinamento.modulo_trilha
  for each row execute function treinamento.tocar_trilha();
alter table treinamento.modulo_trilha enable row level security;
alter table treinamento.modulo_trilha force row level security;
create policy isolamento_tenant on treinamento.modulo_trilha for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert, update, delete on treinamento.modulo_trilha to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- licao — lição do módulo (texto, vídeo curto, PDF ou link; RF-TRE-01/02). duracao_estimada_seg = base do tempo mínimo
-- proporcional (RN-TRE-04). midia_url: vídeo baixa só no Wi-Fi (app). pre_requisitos = ids de lições.
create table treinamento.licao (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references plataforma.tenant (id),
  trilha_id             uuid not null,
  modulo_id             uuid not null,
  ordem                 integer not null,
  titulo                text not null,
  tipo                  text not null default 'texto',
  texto                 text,
  midia_url             text,
  duracao_estimada_seg  integer,
  pre_requisitos        uuid[] not null default '{}',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz,
  external_id           text,
  constraint licao_tenant_id_uk unique (tenant_id, trilha_id, id),
  constraint licao_modulo_fk foreign key (tenant_id, trilha_id, modulo_id) references treinamento.modulo_trilha (tenant_id, trilha_id, id),
  constraint licao_ordem_valida check (ordem >= 0),
  constraint licao_titulo_preenchido check (btrim(titulo) <> '' and char_length(titulo) <= 200),
  constraint licao_tipo_valido check (tipo in ('texto', 'video', 'pdf', 'link')),
  constraint licao_texto_tamanho check (char_length(texto) <= 20000),
  constraint licao_midia_url_tamanho check (char_length(midia_url) <= 2000),
  constraint licao_duracao_faixa check (duracao_estimada_seg between 1 and 36000),
  constraint licao_pre_requisitos_validos check (cardinality(pre_requisitos) <= 100 and array_position(pre_requisitos, null) is null)
);
create index licao_sync_ix on treinamento.licao (tenant_id, updated_at, id);
create index licao_trilha_ix on treinamento.licao (tenant_id, trilha_id, modulo_id, ordem);
create trigger licao_updated_at before update on treinamento.licao
  for each row execute function plataforma.definir_updated_at();
create trigger licao_toca_trilha after insert or update or delete on treinamento.licao
  for each row execute function treinamento.tocar_trilha();
alter table treinamento.licao enable row level security;
alter table treinamento.licao force row level security;
create policy isolamento_tenant on treinamento.licao for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert, update, delete on treinamento.licao to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- quiz — no máximo um quiz vivo por lição (RN-TRE-02). As alternativas corretas vão ao aparelho (correção offline); a
-- API sempre recorrige (RN-TRE-04).
create table treinamento.quiz (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references plataforma.tenant (id),
  trilha_id    uuid not null,
  licao_id     uuid not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  external_id  text,
  constraint quiz_tenant_id_uk unique (tenant_id, trilha_id, id),
  constraint quiz_licao_fk foreign key (tenant_id, trilha_id, licao_id) references treinamento.licao (tenant_id, trilha_id, id)
);
create index quiz_sync_ix on treinamento.quiz (tenant_id, updated_at, id);
create unique index quiz_licao_uk on treinamento.quiz (tenant_id, licao_id) where deleted_at is null;
create index quiz_trilha_ix on treinamento.quiz (tenant_id, trilha_id);
create trigger quiz_updated_at before update on treinamento.quiz
  for each row execute function plataforma.definir_updated_at();
create trigger quiz_toca_trilha after insert or update or delete on treinamento.quiz
  for each row execute function treinamento.tocar_trilha();
alter table treinamento.quiz enable row level security;
alter table treinamento.quiz force row level security;
create policy isolamento_tenant on treinamento.quiz for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert, update, delete on treinamento.quiz to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- questao — questões do quiz (até 50, LIMITES_CONTEUDO; o limite é da API).
create table treinamento.questao (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references plataforma.tenant (id),
  trilha_id    uuid not null,
  quiz_id      uuid not null,
  ordem        integer not null,
  enunciado    text not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  external_id  text,
  constraint questao_tenant_id_uk unique (tenant_id, trilha_id, id),
  constraint questao_quiz_fk foreign key (tenant_id, trilha_id, quiz_id) references treinamento.quiz (tenant_id, trilha_id, id),
  constraint questao_ordem_valida check (ordem >= 0),
  constraint questao_enunciado_preenchido check (btrim(enunciado) <> '' and char_length(enunciado) <= 1000)
);
create index questao_sync_ix on treinamento.questao (tenant_id, updated_at, id);
create index questao_quiz_ix on treinamento.questao (tenant_id, trilha_id, quiz_id, ordem);
create trigger questao_updated_at before update on treinamento.questao
  for each row execute function plataforma.definir_updated_at();
create trigger questao_toca_trilha after insert or update or delete on treinamento.questao
  for each row execute function treinamento.tocar_trilha();
alter table treinamento.questao enable row level security;
alter table treinamento.questao force row level security;
create policy isolamento_tenant on treinamento.questao for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert, update, delete on treinamento.questao to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- alternativa — alternativas da questão (até 20); correta marca a(s) certa(s) (publicar exige ao menos uma: API).
create table treinamento.alternativa (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references plataforma.tenant (id),
  trilha_id    uuid not null,
  questao_id   uuid not null,
  ordem        integer not null,
  texto        text not null,
  correta      boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  external_id  text,
  constraint alternativa_questao_fk foreign key (tenant_id, trilha_id, questao_id) references treinamento.questao (tenant_id, trilha_id, id),
  constraint alternativa_ordem_valida check (ordem >= 0),
  constraint alternativa_texto_preenchido check (btrim(texto) <> '' and char_length(texto) <= 500)
);
create index alternativa_sync_ix on treinamento.alternativa (tenant_id, updated_at, id);
create index alternativa_questao_ix on treinamento.alternativa (tenant_id, trilha_id, questao_id, ordem);
create trigger alternativa_updated_at before update on treinamento.alternativa
  for each row execute function plataforma.definir_updated_at();
create trigger alternativa_toca_trilha after insert or update or delete on treinamento.alternativa
  for each row execute function treinamento.tocar_trilha();
alter table treinamento.alternativa enable row level security;
alter table treinamento.alternativa force row level security;
create policy isolamento_tenant on treinamento.alternativa for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert, update, delete on treinamento.alternativa to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- trilha_publicacao — linha do tempo da publicação/arquivamento (RF-TRE-01, RN-AUD-01). Append-only: a aplicação só lê e
-- insere (sem gatilho de updated_at). Repetir a ação sem mudar o status (idempotente) não grava linha (API).
create table treinamento.trilha_publicacao (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references plataforma.tenant (id),
  trilha_id    uuid not null,
  acao         text not null,
  de           text not null,
  para         text not null,
  autor_id     uuid not null,
  autor_nome   text,
  ocorrido_em  timestamptz not null default now(),
  request_id   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  external_id  text,
  constraint trilha_publicacao_trilha_fk foreign key (tenant_id, trilha_id) references treinamento.trilha (tenant_id, id),
  constraint trilha_publicacao_acao_valida check (acao in ('publicar', 'arquivar')),
  constraint trilha_publicacao_de_valido check (de in ('rascunho', 'publicada', 'arquivada')),
  constraint trilha_publicacao_para_valido check (para in ('rascunho', 'publicada', 'arquivada')),
  constraint trilha_publicacao_transicao_valida check (
    de <> para
    and ((acao = 'publicar' and para = 'publicada' and de = 'rascunho') or (acao = 'arquivar' and para = 'arquivada'))
  ),
  constraint trilha_publicacao_autor_nome_tamanho check (char_length(autor_nome) <= 200),
  constraint trilha_publicacao_request_id_tamanho check (char_length(request_id) <= 128)
);
create index trilha_publicacao_sync_ix on treinamento.trilha_publicacao (tenant_id, updated_at, id);
create index trilha_publicacao_trilha_ix on treinamento.trilha_publicacao (tenant_id, trilha_id, ocorrido_em);
alter table treinamento.trilha_publicacao enable row level security;
alter table treinamento.trilha_publicacao force row level security;
create policy isolamento_tenant on treinamento.trilha_publicacao for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert on treinamento.trilha_publicacao to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- progresso — conclusão de lição pelo aluno (RN-TRE-04). Append-only; uma por (usuário, lição): reenvio = `duplicado`.
-- Pull `progresso` (escopo próprio) por (tenant_id, usuario_id, updated_at, id); painel de adesão por trilha.
create table treinamento.progresso (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references plataforma.tenant (id),
  usuario_id       uuid not null,
  trilha_id        uuid not null,
  licao_id         uuid not null,
  concluida_em     timestamptz not null,
  tempo_gasto_seg  integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  external_id      text,
  constraint progresso_usuario_licao_uk unique (tenant_id, usuario_id, licao_id),
  constraint progresso_tempo_nao_negativo check (tempo_gasto_seg >= 0)
);
create index progresso_sync_ix on treinamento.progresso (tenant_id, updated_at, id);
create index progresso_usuario_sync_ix on treinamento.progresso (tenant_id, usuario_id, updated_at, id);
create index progresso_trilha_ix on treinamento.progresso (tenant_id, trilha_id, usuario_id);
alter table treinamento.progresso enable row level security;
alter table treinamento.progresso force row level security;
create policy isolamento_tenant on treinamento.progresso for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert on treinamento.progresso to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- tentativa — tentativa de quiz (RN-TRE-02, RN-TRE-05). Append-only; id = UUID do aparelho. respostas = array jsonb
-- [{questao_id, alternativa_ids}] como o aparelho enviou. finalizada = respondida até o fim (conta para o streak).
-- Consultas: tentativas do dia por (usuário, quiz) para o limite diário; notas do painel por quiz.
create table treinamento.tentativa (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references plataforma.tenant (id),
  usuario_id          uuid not null,
  quiz_id             uuid not null,
  realizada_em        timestamptz not null,
  respostas           jsonb not null default '[]'::jsonb,
  acertos             integer not null,
  total_questoes      integer not null,
  nota_pct            numeric(5, 2) not null,
  aprovada            boolean not null,
  primeira_tentativa  boolean not null,
  finalizada          boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz,
  external_id         text,
  constraint tentativa_respostas_array check (jsonb_typeof(respostas) = 'array'),
  constraint tentativa_acertos_faixa check (total_questoes >= 0 and acertos between 0 and total_questoes),
  constraint tentativa_nota_faixa check (nota_pct between 0 and 100)
);
create index tentativa_sync_ix on treinamento.tentativa (tenant_id, updated_at, id);
create index tentativa_usuario_sync_ix on treinamento.tentativa (tenant_id, usuario_id, updated_at, id);
create index tentativa_usuario_quiz_ix on treinamento.tentativa (tenant_id, usuario_id, quiz_id, realizada_em);
create index tentativa_quiz_ix on treinamento.tentativa (tenant_id, quiz_id);
alter table treinamento.tentativa enable row level security;
alter table treinamento.tentativa force row level security;
create policy isolamento_tenant on treinamento.tentativa for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert on treinamento.tentativa to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- xp_lancamento — XP append-only (RN-TRE-01, RN-TRE-02, RN-TRE-04, RN-TRE-08): saldo = soma; nível e ranking derivam daqui.
-- referencia_id: lição/quiz/trilha, data do streak (AAAA-MM-DD) ou `desafio_id:pedido_id:evento_id` / `desafio_id:pedido_id:total`.
-- pontos = concedido (já com teto); limitado_pelo_teto <=> pontos < pontos_base (lançamento de 0 ponto é válido). dia = data
-- civil no fuso do tenant. Consultas: teto diário (usuário, dia); ranking semanal/mensal/acumulado (tenant, dia).
create table treinamento.xp_lancamento (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references plataforma.tenant (id),
  usuario_id          uuid not null,
  origem              text not null,
  referencia_id       text not null,
  pontos              integer not null,
  pontos_base         integer not null,
  limitado_pelo_teto  boolean not null default false,
  ocorrido_em         timestamptz not null,
  dia                 date not null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz,
  external_id         text,
  constraint xp_lancamento_chave_uk unique (tenant_id, usuario_id, origem, referencia_id),
  constraint xp_lancamento_origem_valida check (origem in ('licao', 'quiz', 'trilha', 'streak', 'desafio_vendas')),
  constraint xp_lancamento_referencia_tamanho check (char_length(referencia_id) between 1 and 128),
  constraint xp_lancamento_pontos_validos check (pontos >= 0 and pontos_base >= 0 and pontos <= pontos_base),
  constraint xp_lancamento_teto_coerente check (limitado_pelo_teto = (pontos < pontos_base))
);
create index xp_lancamento_sync_ix on treinamento.xp_lancamento (tenant_id, updated_at, id);
create index xp_lancamento_usuario_sync_ix on treinamento.xp_lancamento (tenant_id, usuario_id, updated_at, id);
create index xp_lancamento_usuario_dia_ix on treinamento.xp_lancamento (tenant_id, usuario_id, dia);
create index xp_lancamento_ranking_ix on treinamento.xp_lancamento (tenant_id, dia) include (usuario_id, pontos);
alter table treinamento.xp_lancamento enable row level security;
alter table treinamento.xp_lancamento force row level security;
create policy isolamento_tenant on treinamento.xp_lancamento for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert on treinamento.xp_lancamento to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- medalha — catálogo de medalhas do tenant (RF-TRE-03, contrato Medalha). regra = {tipo: trilhas_concluidas|nota_maxima|
-- sequencia_dias, ...}. Sem linha = catálogo padrão do código (MEDALHAS_PADRAO).
create table treinamento.medalha (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references plataforma.tenant (id),
  codigo       text not null,
  nome         text not null,
  regra        jsonb not null,
  ativa        boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  external_id  text,
  constraint medalha_codigo_formato check (codigo ~ '^[a-z0-9_]{1,60}$'),
  constraint medalha_nome_preenchido check (btrim(nome) <> '' and char_length(nome) <= 200),
  constraint medalha_regra_valida check (
    jsonb_typeof(regra) = 'object' and regra ->> 'tipo' in ('trilhas_concluidas', 'nota_maxima', 'sequencia_dias')
  )
);
create index medalha_sync_ix on treinamento.medalha (tenant_id, updated_at, id);
create unique index medalha_codigo_uk on treinamento.medalha (tenant_id, codigo) where deleted_at is null;
create trigger medalha_updated_at before update on treinamento.medalha
  for each row execute function plataforma.definir_updated_at();
alter table treinamento.medalha enable row level security;
alter table treinamento.medalha force row level security;
create policy isolamento_tenant on treinamento.medalha for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert, update, delete on treinamento.medalha to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- medalha_usuario — conquista (RF-TRE-03, RN-TRE-06). Append-only; nunca em duplicidade por (usuário, medalha).
create table treinamento.medalha_usuario (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references plataforma.tenant (id),
  usuario_id      uuid not null,
  medalha_codigo  text not null,
  conquistada_em  timestamptz not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  external_id     text,
  constraint medalha_usuario_uk unique (tenant_id, usuario_id, medalha_codigo),
  constraint medalha_usuario_codigo_formato check (medalha_codigo ~ '^[a-z0-9_]{1,60}$')
);
create index medalha_usuario_sync_ix on treinamento.medalha_usuario (tenant_id, updated_at, id);
create index medalha_usuario_usuario_sync_ix on treinamento.medalha_usuario (tenant_id, usuario_id, updated_at, id);
alter table treinamento.medalha_usuario enable row level security;
alter table treinamento.medalha_usuario force row level security;
create policy isolamento_tenant on treinamento.medalha_usuario for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert on treinamento.medalha_usuario to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- desafio_vendas — campanha com XP por unidade faturada (RF-TRE-06, RN-TRE-08; contrato DesafioVendasContrato).
-- xp_max_por_desafio: teto próprio por vendedor (fora do teto diário); nulo = padrão do tenant; 0 = sem teto.
-- Consulta: desafios ativos numa data. Sincroniza para o app (somente leitura).
create table treinamento.desafio_vendas (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references plataforma.tenant (id),
  nome                text not null,
  ativo               boolean not null default true,
  vigencia_inicio     date not null,
  vigencia_fim        date not null,
  xp_por_unidade      integer not null,
  xp_max_por_pedido   integer not null,
  xp_max_por_desafio  integer,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz,
  external_id         text,
  constraint desafio_vendas_tenant_id_uk unique (tenant_id, id),
  constraint desafio_vendas_nome_preenchido check (btrim(nome) <> '' and char_length(nome) <= 200),
  constraint desafio_vendas_vigencia_valida check (vigencia_fim >= vigencia_inicio),
  constraint desafio_vendas_xp_positivo check (xp_por_unidade > 0 and xp_max_por_pedido > 0),
  constraint desafio_vendas_teto_valido check (xp_max_por_desafio >= 0)
);
create index desafio_vendas_sync_ix on treinamento.desafio_vendas (tenant_id, updated_at, id);
create index desafio_vendas_vigentes_ix on treinamento.desafio_vendas (tenant_id, vigencia_inicio, vigencia_fim) where ativo and deleted_at is null;
create unique index desafio_vendas_external_uk on treinamento.desafio_vendas (tenant_id, external_id) where external_id is not null and deleted_at is null;
create trigger desafio_vendas_updated_at before update on treinamento.desafio_vendas
  for each row execute function plataforma.definir_updated_at();
alter table treinamento.desafio_vendas enable row level security;
alter table treinamento.desafio_vendas force row level security;
create policy isolamento_tenant on treinamento.desafio_vendas for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert, update, delete on treinamento.desafio_vendas to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- desafio_vendas_produto — produtos do desafio (mínimo 1 por desafio: API). produto_id = id do produto, sem FK (fronteira).
create table treinamento.desafio_vendas_produto (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references plataforma.tenant (id),
  desafio_id   uuid not null,
  produto_id   uuid not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  external_id  text,
  constraint desafio_vendas_produto_desafio_fk foreign key (tenant_id, desafio_id) references treinamento.desafio_vendas (tenant_id, id)
);
create index desafio_vendas_produto_sync_ix on treinamento.desafio_vendas_produto (tenant_id, updated_at, id);
create unique index desafio_vendas_produto_uk on treinamento.desafio_vendas_produto (tenant_id, desafio_id, produto_id) where deleted_at is null;
create index desafio_vendas_produto_produto_ix on treinamento.desafio_vendas_produto (tenant_id, produto_id) where deleted_at is null;
create trigger desafio_vendas_produto_updated_at before update on treinamento.desafio_vendas_produto
  for each row execute function plataforma.definir_updated_at();
alter table treinamento.desafio_vendas_produto enable row level security;
alter table treinamento.desafio_vendas_produto force row level security;
create policy isolamento_tenant on treinamento.desafio_vendas_produto for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert, update, delete on treinamento.desafio_vendas_produto to macuxi_app;
