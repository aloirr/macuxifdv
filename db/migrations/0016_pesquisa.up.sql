-- 0016_pesquisa (up) — T-0057 (Pesquisa: construtor no BKO, resposta no app e resultados); pedido
-- R-20261102-132021-modulo-pesquisa. Schema do módulo Pesquisa atrás de RepositorioPesquisa
-- (modules/pesquisa/api/repositorio.ts): questionário (cabeçalho estável), versões (conteúdo: perguntas dos 9 tipos,
-- regras condicionais, público-alvo, vigência, frequência, modo), respostas (só inserção) e as tabelas normalizadas
-- resposta_item e resposta_foto, preenchidas pelo PRÓPRIO banco a partir de resposta.itens (gatilho), para os
-- resultados e a galeria por SQL.
-- Listas fechadas = contratos da Pesquisa (fonte da verdade), conferidas em db/testes/pesquisa.test.ts:
--   status = STATUS_VERSAO; modo = MODOS; frequencia = FREQUENCIAS (contracts/questionario.ts e publico.ts);
--   resposta_item.tipo = TIPOS_PERGUNTA (contracts/pergunta.ts); motivos_suspeita = RespostaPesquisa.motivos_suspeita.
-- Regras no banco (defesa em profundidade; o domain decide e a API revalida):
--   RN-PES-01 versão publicada é imutável (gatilho; só updated_at e deleted_at mudam) e no máximo UM rascunho vivo por
--     questionário (índice único parcial); número único por questionário; resposta só para versão PUBLICADA do MESMO
--     questionário (FK composta + gatilho).
--   RF-PES-04 resposta só inserção, idempotente pelo UUID do aparelho: macuxi_app tem só SELECT e INSERT em resposta,
--     resposta_item e resposta_foto (sem UPDATE/DELETE).
--   RF-PES-05 arquivar o questionário toca updated_at das versões publicadas (gatilho), para descerem de novo no pull
--     com arquivado_em.
--   RN-PES-04 suspeita: motivo de suspeita implica suspeita = true.
-- Auditoria de publicação e arquivamento: plataforma.auditoria (tx.auditar da API, RN-AUD-01); a versão guarda
-- publicada_em/publicada_por e o questionário arquivado_em.
-- FRONTEIRA: nenhuma FK para core/vendedor/catalogo... (usuario_id, equipe_id, cliente_id, visita_id e publicada_por
-- são validados pela API via contexto/contratos, ADR 0012). FKs só dentro do schema, compostas por tenant, mais
-- tenant_id -> plataforma.tenant e resposta_foto.arquivo_id -> plataforma.arquivo (ADR 0010, como core.visita).
-- Papéis: macuxi_app (RLS por tenant em toda tabela). macuxi_worker: nenhum privilégio (não há tarefa entre tenants).
-- Volume (pedido do módulo): ~50 perguntas por versão; até ~100 mil respostas/mês por tenant (~1–2 M itens/mês).
-- Caminho de volta: 0016_pesquisa.down.sql (DROP SCHEMA pesquisa CASCADE — APAGA questionários e respostas).

create schema pesquisa;
grant usage on schema pesquisa to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- questionario — cabeçalho estável (contrato Questionario). criado_em = instante de negócio (o do contrato);
-- arquivado_em null = ativo. Fora do pull próprio (o cabeçalho viaja na linha da versão), mas com o índice de sync
-- (o manifesto declara a entidade). Volume baixo (dezenas a centenas por tenant).
create table pesquisa.questionario (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references plataforma.tenant (id),
  criado_em     timestamptz not null default now(),
  arquivado_em  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  external_id   text,
  constraint questionario_tenant_id_uk unique (tenant_id, id),
  constraint questionario_arquivado_depois_de_criado check (arquivado_em is null or arquivado_em >= criado_em)
);
create index questionario_sync_ix on pesquisa.questionario (tenant_id, updated_at, id);
create index questionario_ativo_ix on pesquisa.questionario (tenant_id, criado_em desc) where arquivado_em is null and deleted_at is null;
create unique index questionario_external_uk on pesquisa.questionario (tenant_id, external_id) where external_id is not null and deleted_at is null;
create trigger questionario_updated_at before update on pesquisa.questionario
  for each row execute function plataforma.definir_updated_at();
alter table pesquisa.questionario enable row level security;
alter table pesquisa.questionario force row level security;
create policy isolamento_tenant on pesquisa.questionario for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert, update on pesquisa.questionario to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- questionario_versao — conteúdo que o respondente vê (contrato QuestionarioVersao). Vigência em UTC, ambos inclusivos,
-- fim null = sem prazo. perguntas/regras/publico_alvo em jsonb, exatamente como no contrato (o Zod valida a forma).
-- Pull (entidade questionario_versao, escopo tenant): só publicadas, por (updated_at, id). Volume: poucas por
-- questionário; linha grande (~50 perguntas).
create table pesquisa.questionario_versao (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references plataforma.tenant (id),
  questionario_id  uuid not null,
  numero           integer not null,
  status           text not null default 'rascunho',
  titulo           text not null,
  descricao        text,
  modo             text not null default 'avulsa',
  frequencia       text not null default 'a_cada_visita',
  publico_alvo     jsonb not null default '{}'::jsonb,
  vigencia_inicio  timestamptz not null,
  vigencia_fim     timestamptz,
  perguntas        jsonb not null default '[]'::jsonb,
  regras           jsonb not null default '[]'::jsonb,
  criada_em        timestamptz not null default now(),
  publicada_em     timestamptz,
  publicada_por    uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  external_id      text,
  constraint questionario_versao_tenant_id_uk unique (tenant_id, id),
  constraint questionario_versao_questionario_id_uk unique (tenant_id, questionario_id, id),
  constraint questionario_versao_numero_uk unique (tenant_id, questionario_id, numero),
  constraint questionario_versao_questionario_fk foreign key (tenant_id, questionario_id) references pesquisa.questionario (tenant_id, id),
  constraint questionario_versao_numero_positivo check (numero >= 1),
  constraint questionario_versao_status_valido check (status in ('rascunho', 'publicada')),
  constraint questionario_versao_modo_valido check (modo in ('avulsa', 'checkout_obrigatoria')),
  constraint questionario_versao_frequencia_valida check (frequencia in ('uma_vez_por_cliente', 'a_cada_visita', 'semanal', 'mensal')),
  constraint questionario_versao_titulo_tamanho check (btrim(titulo) <> '' and char_length(titulo) <= 200),
  constraint questionario_versao_descricao_tamanho check (descricao is null or char_length(descricao) <= 1000),
  constraint questionario_versao_publico_objeto check (jsonb_typeof(publico_alvo) = 'object'),
  constraint questionario_versao_perguntas_lista check (jsonb_typeof(perguntas) = 'array'),
  constraint questionario_versao_regras_lista check (jsonb_typeof(regras) = 'array'),
  constraint questionario_versao_vigencia_ordem check (vigencia_fim is null or vigencia_fim >= vigencia_inicio),
  -- publicada: quando e por quem, e ao menos uma pergunta; rascunho: nada de publicação (contrato QuestionarioVersao)
  constraint questionario_versao_publicacao check (
    (status = 'publicada' and publicada_em is not null and publicada_por is not null
     and case when jsonb_typeof(perguntas) = 'array' then jsonb_array_length(perguntas) else 0 end >= 1)
    or (status = 'rascunho' and publicada_em is null and publicada_por is null)
  )
);
-- RN-PES-01: no máximo um rascunho vivo por questionário (editar uma publicada abre a próxima versão em rascunho)
create unique index questionario_versao_rascunho_uk on pesquisa.questionario_versao (tenant_id, questionario_id) where status = 'rascunho' and deleted_at is null;
create index questionario_versao_sync_ix on pesquisa.questionario_versao (tenant_id, updated_at, id);
create unique index questionario_versao_external_uk on pesquisa.questionario_versao (tenant_id, external_id) where external_id is not null and deleted_at is null;
create trigger questionario_versao_updated_at before update on pesquisa.questionario_versao
  for each row execute function plataforma.definir_updated_at();

-- RN-PES-01: versão publicada é imutável. Só updated_at (toque do arquivamento) e deleted_at podem mudar; trocar o
-- tenant cai na política de RLS (42501), não aqui. SQLSTATE 23514 (check_violation) com a RN na mensagem.
-- AFTER UPDATE (não BEFORE): roda depois das FKs (gatilhos da mesma fase disparam em ordem alfabética e os de FK,
-- "RI_ConstraintTrigger_*", vêm antes), então apontar a versão para um questionário que não existe no tenant dá 23503
-- (integridade) e não 23514; o UPDATE recusado aqui é desfeito inteiro do mesmo jeito.
create function pesquisa.versao_publicada_imutavel() returns trigger
  language plpgsql
  as $$
begin
  if old.status = 'publicada' and (
       new.id, new.questionario_id, new.numero, new.status, new.titulo, new.descricao, new.modo, new.frequencia,
       new.publico_alvo, new.vigencia_inicio, new.vigencia_fim, new.perguntas, new.regras, new.criada_em,
       new.publicada_em, new.publicada_por, new.external_id
     ) is distinct from (
       old.id, old.questionario_id, old.numero, old.status, old.titulo, old.descricao, old.modo, old.frequencia,
       old.publico_alvo, old.vigencia_inicio, old.vigencia_fim, old.perguntas, old.regras, old.criada_em,
       old.publicada_em, old.publicada_por, old.external_id
     ) then
    raise exception 'RN-PES-01: a versão publicada % não pode ser alterada; edite criando uma nova versão.', old.id
      using errcode = 'check_violation', constraint = 'questionario_versao_publicada_imutavel';
  end if;
  return null;
end
$$;
create trigger questionario_versao_publicada_imutavel after update on pesquisa.questionario_versao
  for each row execute function pesquisa.versao_publicada_imutavel();

alter table pesquisa.questionario_versao enable row level security;
alter table pesquisa.questionario_versao force row level security;
create policy isolamento_tenant on pesquisa.questionario_versao for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert, update on pesquisa.questionario_versao to macuxi_app;

-- RF-PES-05: ao arquivar (arquivado_em muda), as versões publicadas são tocadas para descerem de novo no pull com o
-- arquivado_em do questionário. SECURITY INVOKER: roda com a RLS do tenant do contexto (mesmo tenant da linha).
create function pesquisa.tocar_versoes_ao_arquivar() returns trigger
  language plpgsql
  as $$
begin
  update pesquisa.questionario_versao
     set updated_at = now()
   where tenant_id = new.tenant_id and questionario_id = new.id and status = 'publicada';
  return null;
end
$$;
create trigger questionario_arquivado_toca_versoes after update of arquivado_em on pesquisa.questionario
  for each row when (old.arquivado_em is distinct from new.arquivado_em)
  execute function pesquisa.tocar_versoes_ao_arquivar();

-- ---------------------------------------------------------------------------------------------
-- resposta — contrato RespostaPesquisa. id = UUID gerado no aparelho (idempotência do push, RF-PES-04); versao_id =
-- versão que o respondente VIU (RN-PES-01); respondida_em = hora do aparelho, recebida_em = hora do servidor
-- (RN-PES-04). itens = lista do contrato (ItemResposta[]), fonte da verdade da resposta. Só inserção.
-- Consultas: pull por (updated_at, id) no escopo (usuário/carteira); resultados por questionário + período;
-- frequência por cliente/questionário (RN-PES-02); contagem por questionário. Volume alto (ver cabeçalho).
create table pesquisa.resposta (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references plataforma.tenant (id),
  questionario_id   uuid not null,
  versao_id         uuid not null,
  usuario_id        uuid not null,
  equipe_id         uuid,
  cliente_id        uuid,
  visita_id         uuid,
  respondida_em     timestamptz not null,
  recebida_em       timestamptz not null default now(),
  suspeita          boolean not null default false,
  motivos_suspeita  text[] not null default '{}',
  itens             jsonb not null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  external_id       text,
  constraint resposta_tenant_id_uk unique (tenant_id, id),
  constraint resposta_versao_fk foreign key (tenant_id, questionario_id, versao_id) references pesquisa.questionario_versao (tenant_id, questionario_id, id),
  constraint resposta_questionario_fk foreign key (tenant_id, questionario_id) references pesquisa.questionario (tenant_id, id),
  constraint resposta_motivos_validos check (motivos_suspeita <@ array['RELOGIO_ADIANTADO', 'ANTES_DA_VIGENCIA', 'APOS_A_VIGENCIA']::text[]),
  constraint resposta_motivo_implica_suspeita check (suspeita or cardinality(motivos_suspeita) = 0),
  constraint resposta_itens_lista check (case when jsonb_typeof(itens) = 'array' then jsonb_array_length(itens) >= 1 else false end)
);
create index resposta_sync_ix on pesquisa.resposta (tenant_id, updated_at, id);
create index resposta_questionario_ix on pesquisa.resposta (tenant_id, questionario_id, respondida_em desc);
create index resposta_versao_ix on pesquisa.resposta (tenant_id, versao_id);
create index resposta_cliente_ix on pesquisa.resposta (tenant_id, cliente_id, questionario_id, respondida_em desc) where cliente_id is not null;
create index resposta_usuario_ix on pesquisa.resposta (tenant_id, usuario_id, respondida_em desc);
create index resposta_visita_ix on pesquisa.resposta (tenant_id, visita_id) where visita_id is not null;
create unique index resposta_external_uk on pesquisa.resposta (tenant_id, external_id) where external_id is not null and deleted_at is null;
create trigger resposta_updated_at before update on pesquisa.resposta
  for each row execute function plataforma.definir_updated_at();

-- RN-PES-01: resposta só para versão publicada (rascunho nunca chega ao aparelho). Procura a versão no tenant da linha
-- com a RLS do contexto: se a linha é de outro tenant, não acha nada e quem recusa é a política (42501).
create function pesquisa.resposta_so_versao_publicada() returns trigger
  language plpgsql
  as $$
begin
  if exists (
    select 1 from pesquisa.questionario_versao v
     where v.tenant_id = new.tenant_id and v.id = new.versao_id and v.status <> 'publicada'
  ) then
    raise exception 'RN-PES-01: a versão % ainda não foi publicada; não recebe resposta.', new.versao_id
      using errcode = 'check_violation', constraint = 'resposta_versao_publicada';
  end if;
  return new;
end
$$;
create trigger resposta_versao_publicada before insert on pesquisa.resposta
  for each row execute function pesquisa.resposta_so_versao_publicada();

alter table pesquisa.resposta enable row level security;
alter table pesquisa.resposta force row level security;
create policy isolamento_tenant on pesquisa.resposta for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert on pesquisa.resposta to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- resposta_item — um valor normalizado por pergunta respondida (resultados por SQL, RF-PES-06). Gerado pelo gatilho
-- da resposta (nunca pela aplicação): id = plataforma.uuid_de_chave('<resposta_id>:pesquisa.resposta_item:<pergunta_id>').
-- Colunas por tipo: sim_nao -> valor_bool; numero/escala -> valor_num; foto -> valor_num = quantidade de fotos;
-- texto -> valor_texto; codigo_barras -> valor_texto (o código); data -> valor_data; unica/multipla -> opcao_ids.
create table pesquisa.resposta_item (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references plataforma.tenant (id),
  resposta_id   uuid not null,
  pergunta_id   uuid not null,
  tipo          text not null,
  valor_bool    boolean,
  valor_num     numeric,
  valor_texto   text,
  valor_data    date,
  opcao_ids     uuid[],
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  external_id   text,
  constraint resposta_item_pergunta_uk unique (tenant_id, resposta_id, pergunta_id),
  constraint resposta_item_resposta_fk foreign key (tenant_id, resposta_id) references pesquisa.resposta (tenant_id, id) on delete cascade,
  constraint resposta_item_tipo_valido check (tipo in ('sim_nao', 'unica', 'multipla', 'numero', 'texto', 'escala', 'data', 'foto', 'codigo_barras')),
  constraint resposta_item_valor_do_tipo check (
    case tipo
      when 'sim_nao' then valor_bool is not null
      when 'numero' then valor_num is not null
      when 'escala' then valor_num is not null
      when 'foto' then valor_num is not null
      when 'texto' then valor_texto is not null
      when 'codigo_barras' then valor_texto is not null
      when 'data' then valor_data is not null
      when 'unica' then cardinality(opcao_ids) = 1
      when 'multipla' then opcao_ids is not null
    end
  )
);
create index resposta_item_pergunta_ix on pesquisa.resposta_item (tenant_id, pergunta_id);
create index resposta_item_sync_ix on pesquisa.resposta_item (tenant_id, updated_at, id);
create unique index resposta_item_external_uk on pesquisa.resposta_item (tenant_id, external_id) where external_id is not null and deleted_at is null;
create trigger resposta_item_updated_at before update on pesquisa.resposta_item
  for each row execute function plataforma.definir_updated_at();
alter table pesquisa.resposta_item enable row level security;
alter table pesquisa.resposta_item force row level security;
create policy isolamento_tenant on pesquisa.resposta_item for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert on pesquisa.resposta_item to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- resposta_foto — uma linha por foto da resposta (galeria, RF-PES-06). Gerada pelo gatilho da resposta:
-- id = plataforma.uuid_de_chave('<resposta_id>:pesquisa.resposta_foto:<foto.id>'); arquivo_id = foto.id, o mesmo id
-- que a API registra em plataforma.arquivo (tx.registrarArquivo, finalidade pesquisa_foto) ANTES de inserir a resposta.
-- FK composta adiável (inicialmente imediata), como core.visita.foto_fachada_id.
create table pesquisa.resposta_foto (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references plataforma.tenant (id),
  resposta_id   uuid not null,
  pergunta_id   uuid not null,
  arquivo_id    uuid not null,
  capturada_em  timestamptz not null,
  largura_px    integer,
  altura_px     integer,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  external_id   text,
  constraint resposta_foto_arquivo_uk unique (tenant_id, resposta_id, arquivo_id),
  constraint resposta_foto_resposta_fk foreign key (tenant_id, resposta_id) references pesquisa.resposta (tenant_id, id) on delete cascade,
  constraint resposta_foto_arquivo_fk foreign key (tenant_id, arquivo_id) references plataforma.arquivo (tenant_id, id)
    deferrable initially immediate,
  constraint resposta_foto_dimensoes_positivas check ((largura_px is null or largura_px > 0) and (altura_px is null or altura_px > 0))
);
create index resposta_foto_pergunta_ix on pesquisa.resposta_foto (tenant_id, pergunta_id);
create index resposta_foto_arquivo_ix on pesquisa.resposta_foto (tenant_id, arquivo_id);
create index resposta_foto_sync_ix on pesquisa.resposta_foto (tenant_id, updated_at, id);
create unique index resposta_foto_external_uk on pesquisa.resposta_foto (tenant_id, external_id) where external_id is not null and deleted_at is null;
create trigger resposta_foto_updated_at before update on pesquisa.resposta_foto
  for each row execute function plataforma.definir_updated_at();
alter table pesquisa.resposta_foto enable row level security;
alter table pesquisa.resposta_foto force row level security;
create policy isolamento_tenant on pesquisa.resposta_foto for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert on pesquisa.resposta_foto to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- Normalização da resposta: ao inserir, o banco desdobra resposta.itens em resposta_item (um por pergunta) e
-- resposta_foto (uma por foto). SECURITY INVOKER: grava com a RLS do contexto (mesmo tenant da resposta). Rodar o
-- upsert de um seed de novo cai no UPDATE da resposta, não aqui (sem duplicar). Item com forma inválida aborta a
-- inserção (o Zod da API já barrou antes; aqui é a última linha de defesa).
create function pesquisa.normalizar_resposta() returns trigger
  language plpgsql
  as $$
begin
  insert into pesquisa.resposta_item (id, tenant_id, resposta_id, pergunta_id, tipo, valor_bool, valor_num, valor_texto, valor_data, opcao_ids)
  select plataforma.uuid_de_chave(new.id::text || ':pesquisa.resposta_item:' || (i ->> 'pergunta_id')),
         new.tenant_id,
         new.id,
         (i ->> 'pergunta_id')::uuid,
         i ->> 'tipo',
         case when i ->> 'tipo' = 'sim_nao' then (i ->> 'valor')::boolean end,
         case i ->> 'tipo'
           when 'numero' then (i ->> 'numero')::numeric
           when 'escala' then (i ->> 'valor')::numeric
           when 'foto' then jsonb_array_length(coalesce(i -> 'fotos', '[]'::jsonb))
         end,
         case i ->> 'tipo' when 'texto' then i ->> 'texto' when 'codigo_barras' then i ->> 'codigo' end,
         case when i ->> 'tipo' = 'data' then (i ->> 'data')::date end,
         case i ->> 'tipo'
           when 'unica' then array[(i ->> 'opcao_id')::uuid]
           when 'multipla' then array(select x::uuid from jsonb_array_elements_text(coalesce(i -> 'opcao_ids', '[]'::jsonb)) as x)
         end
    from jsonb_array_elements(new.itens) as i;

  insert into pesquisa.resposta_foto (id, tenant_id, resposta_id, pergunta_id, arquivo_id, capturada_em, largura_px, altura_px)
  select plataforma.uuid_de_chave(new.id::text || ':pesquisa.resposta_foto:' || (f ->> 'id')),
         new.tenant_id,
         new.id,
         (i ->> 'pergunta_id')::uuid,
         (f ->> 'id')::uuid,
         (f ->> 'capturada_em')::timestamptz,
         (f ->> 'largura_px')::integer,
         (f ->> 'altura_px')::integer
    from jsonb_array_elements(new.itens) as i
    cross join lateral jsonb_array_elements(coalesce(i -> 'fotos', '[]'::jsonb)) as f
   where i ->> 'tipo' = 'foto';
  return null;
end
$$;
create trigger resposta_normalizar after insert on pesquisa.resposta
  for each row execute function pesquisa.normalizar_resposta();
