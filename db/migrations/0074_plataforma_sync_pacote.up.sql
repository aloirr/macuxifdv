-- 0074_plataforma_sync_pacote (up) — pacote pronto da primeira carga (solução 4 do catálogo; R-20261115-070200-alexandre,
-- ADR 0054 proposta). Desenho docs/desenho/T-catalogo-pacote.md §1.4 (gerador e gatilhos), §1.6 (manifesto) e §5 tarefa B.
-- Migração em cima da 0073. Dicionário: docs/banco/sync-pacote.md. Teste: db/testes/sync-pacote.db.test.ts (estático na
-- sessão; banco e up/down no CI).
--
-- Migração ADITIVA: 2 tabelas novas em plataforma e 1 índice em catalogo.tabela_preco_item. Nada existente muda.
--
-- plataforma.sync_pacote: um arquivo .sqlite.gz gerado pelo worker para (tenant, módulo, partição). particao 'tenant' ou
--   'filial:<uuid>' (filial_id preenchido só e sempre na de filial, igual ao uuid do texto: CHECK). formato (1 =
--   FORMATO_PACOTE_SYNC do SDK), horizonte (relógio do banco na geração: watermark do pacote, ADR 0006), geracao_base (a do
--   tenant na geração, ADR 0021), chave_armazenamento = 'sync-pacotes/<tenant_id>/<modulo>/<particao>/<id>.sqlite.gz' (CHECK:
--   o tenant da chave é sempre o da linha), bytes (> 0), md5 (32 hex), entidades (objeto { nome: linhas }).
--   Ciclo: pronto -> substituido (substituido_em; quando a geração seguinte da partição fica pronta) -> apagado
--   (arquivo_apagado_em; o worker apaga o arquivo 1 h depois de substituído). Uma só linha 'pronto' viva por partição
--   (sync_pacote_pronto_uk). Sem FK para core.filial (cache da plataforma; a partição sai da lista quando a filial some).
--   Volume: 1 + nº de filiais pacotes prontos por (tenant, módulo); retenção curta das substituídas.
-- plataforma.sync_pacote_pedido: pedido de geração de uma partição (gatilhos do §1.4): origem 'lote' (integracao.lote.concluido@1
--   na outbox; gerar_apos empurrado 5 min a cada lote novo), 'manifesto' (GET /v1/sync/pacotes sem pacote pronto) ou 'agendado'
--   (pacote com mais de 24 h e com mudança). Idempotente por partição: um só pendente vivo (sync_pacote_pedido_pendente_uk;
--   insert ... on conflict (tenant_id, modulo, particao) where situacao = 'pendente' and deleted_at is null do nothing).
--   pendente -> atendido (atendido_em) | descartado (atendido_em; ex.: módulo sem licença, partição que saiu da lista).
--   ultimo_erro só código curto (sem dado pessoal). Volume: no máximo 1 pendente por partição.
-- Fora do sync (db/src/excecoes.ts): nenhuma das duas vai ao aparelho (o manifesto é montado pela API).
--
-- Acesso (desenho §5 B: macuxi_app leitura + pedido, macuxi_worker escrita):
--   macuxi_app: sync_pacote só SELECT no próprio tenant (o manifesto e a rota /arquivo); sync_pacote_pedido SELECT e INSERT por
--     coluna (id, tenant_id, modulo, particao, filial_id, origem) no próprio tenant (isolamento_tenant). Sem UPDATE nem DELETE.
--   macuxi_worker (gerador, todos os tenants, como as despacho_* das outboxes): sync_pacote SELECT, INSERT por coluna (sem
--     situacao, substituido_em, arquivo_apagado_em e colunas comuns de controle), UPDATE só de situacao, substituido_em,
--     arquivo_apagado_em e deleted_at em linha que não está 'apagado', DELETE só de linha 'apagado' (retenção);
--     sync_pacote_pedido SELECT, INSERT por coluna (+ gerar_apos), UPDATE só de situacao, gerar_apos, tentativas, ultimo_erro,
--     atendido_em e deleted_at em linha pendente, DELETE só de linha que não está pendente (retenção).
--   macuxi_portal e PUBLIC: nada.
--
-- Índices: sync_pacote_pronto_uk (tenant_id, modulo, particao) único parcial do pronto vivo (manifesto); sync_pacote_filial_ix
-- (tenant_id, filial_id) parcial (por filial); sync_pacote_substituido_ix (substituido_em) parcial do substituído (retenção do
-- worker). sync_pacote_pedido_pendente_uk (tenant_id, modulo, particao) único parcial do pendente vivo (idempotência);
-- sync_pacote_pedido_fila_ix (gerar_apos) parcial do pendente (fila do worker); sync_pacote_pedido_filial_ix (tenant_id,
-- filial_id) parcial. catalogo.tabela_preco_item_filial_sync_ix (tenant_id, filial_id, updated_at, id): leitura por filial do
-- pull (filtroFilial do Catálogo) e do pacote.puxar (páginas de 5.000 até o horizonte), pedido no desenho §5 B.
--
-- Caminho de volta: 0074_plataforma_sync_pacote.down.sql (APAGA as 2 tabelas e o índice). Os arquivos no armazenamento
-- (sync-pacotes/<tenant_id>/...) FICAM: liste antes as chaves com
--   select chave_armazenamento from plataforma.sync_pacote where situacao <> 'apagado';
-- e apague os objetos. Pré-condição: a API e o worker sem as rotas e o gerador de pacotes (MACUXI_SYNC_PACOTES desligado);
-- o aparelho sem pacote segue no pull paginado.

-- =============================================================================================
-- plataforma.sync_pacote — o pacote gerado (desenho §1.4 e §1.6)
-- =============================================================================================
create table plataforma.sync_pacote (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references plataforma.tenant (id),
  modulo               text not null,
  particao             text not null,
  filial_id            uuid,
  formato              integer not null default 1,
  situacao             text not null default 'pronto',
  horizonte            timestamptz not null,
  geracao_base         uuid not null,
  chave_armazenamento  text not null,
  bytes                bigint not null,
  md5                  text not null,
  entidades            jsonb not null,
  substituido_em       timestamptz,
  arquivo_apagado_em   timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  deleted_at           timestamptz,
  external_id          text,
  constraint sync_pacote_modulo_formato check (modulo ~ '^[a-z][a-z0-9-]*$'),
  constraint sync_pacote_particao_valida check (
    (particao = 'tenant' and filial_id is null)
    or (filial_id is not null and particao = 'filial:' || filial_id::text)
  ),
  constraint sync_pacote_formato_positivo check (formato >= 1),
  constraint sync_pacote_situacao_valida check (situacao in ('pronto', 'substituido', 'apagado')),
  constraint sync_pacote_chave_do_tenant check (
    chave_armazenamento = 'sync-pacotes/' || tenant_id::text || '/' || modulo || '/' || particao || '/' || id::text || '.sqlite.gz'
  ),
  constraint sync_pacote_bytes_positivo check (bytes > 0),
  constraint sync_pacote_md5_formato check (md5 ~ '^[0-9a-f]{32}$'),
  constraint sync_pacote_entidades_objeto check (jsonb_typeof(entidades) = 'object' and octet_length(entidades::text) <= 8192),
  constraint sync_pacote_substituido_coerente check ((situacao = 'pronto') = (substituido_em is null)),
  constraint sync_pacote_apagado_coerente check ((situacao = 'apagado') = (arquivo_apagado_em is not null))
);
create unique index sync_pacote_pronto_uk on plataforma.sync_pacote (tenant_id, modulo, particao)
  where situacao = 'pronto' and deleted_at is null;
create index sync_pacote_filial_ix on plataforma.sync_pacote (tenant_id, filial_id) where filial_id is not null;
create index sync_pacote_substituido_ix on plataforma.sync_pacote (substituido_em) where situacao = 'substituido';
create trigger sync_pacote_updated_at before update on plataforma.sync_pacote
  for each row execute function plataforma.definir_updated_at();
alter table plataforma.sync_pacote enable row level security;
alter table plataforma.sync_pacote force row level security;
create policy isolamento_tenant on plataforma.sync_pacote for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
create policy manutencao on plataforma.sync_pacote for all to macuxi_manutencao using (true) with check (true);
-- gerador (worker, desenho §1.4; como as despacho_* da 0003/0040): todos os tenants; marca só o que não foi apagado; apaga só o apagado
create policy sync_pacote_gerador on plataforma.sync_pacote for select to macuxi_worker
  using (true);
create policy sync_pacote_gerador_gravar on plataforma.sync_pacote for insert to macuxi_worker
  with check (true);
create policy sync_pacote_gerador_marcar on plataforma.sync_pacote for update to macuxi_worker
  using (situacao <> 'apagado') with check (true);
create policy sync_pacote_gerador_expurgar on plataforma.sync_pacote for delete to macuxi_worker
  using (situacao = 'apagado');
revoke all on plataforma.sync_pacote from public;
grant select on plataforma.sync_pacote to macuxi_app;
grant select on plataforma.sync_pacote to macuxi_worker;
grant insert (id, tenant_id, modulo, particao, filial_id, formato, horizonte, geracao_base, chave_armazenamento, bytes, md5,
              entidades) on plataforma.sync_pacote to macuxi_worker;
grant update (situacao, substituido_em, arquivo_apagado_em, deleted_at) on plataforma.sync_pacote to macuxi_worker;
grant delete on plataforma.sync_pacote to macuxi_worker;

-- =============================================================================================
-- plataforma.sync_pacote_pedido — o pedido de geração (gatilhos do desenho §1.4)
-- =============================================================================================
create table plataforma.sync_pacote_pedido (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references plataforma.tenant (id),
  modulo               text not null,
  particao             text not null,
  filial_id            uuid,
  origem               text not null,
  situacao             text not null default 'pendente',
  gerar_apos           timestamptz not null default now(),
  tentativas           integer not null default 0,
  ultimo_erro          text,
  atendido_em          timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  deleted_at           timestamptz,
  external_id          text,
  constraint sync_pacote_pedido_modulo_formato check (modulo ~ '^[a-z][a-z0-9-]*$'),
  constraint sync_pacote_pedido_particao_valida check (
    (particao = 'tenant' and filial_id is null)
    or (filial_id is not null and particao = 'filial:' || filial_id::text)
  ),
  constraint sync_pacote_pedido_origem_valida check (origem in ('lote', 'manifesto', 'agendado')),
  constraint sync_pacote_pedido_situacao_valida check (situacao in ('pendente', 'atendido', 'descartado')),
  constraint sync_pacote_pedido_tentativas_faixa check (tentativas between 0 and 100),
  constraint sync_pacote_pedido_ultimo_erro_curto check (ultimo_erro is null or char_length(ultimo_erro) between 1 and 200),
  constraint sync_pacote_pedido_atendido_coerente check ((situacao = 'pendente') = (atendido_em is null))
);
create unique index sync_pacote_pedido_pendente_uk on plataforma.sync_pacote_pedido (tenant_id, modulo, particao)
  where situacao = 'pendente' and deleted_at is null;
create index sync_pacote_pedido_fila_ix on plataforma.sync_pacote_pedido (gerar_apos) where situacao = 'pendente';
create index sync_pacote_pedido_filial_ix on plataforma.sync_pacote_pedido (tenant_id, filial_id) where filial_id is not null;
create trigger sync_pacote_pedido_updated_at before update on plataforma.sync_pacote_pedido
  for each row execute function plataforma.definir_updated_at();
alter table plataforma.sync_pacote_pedido enable row level security;
alter table plataforma.sync_pacote_pedido force row level security;
create policy isolamento_tenant on plataforma.sync_pacote_pedido for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
create policy manutencao on plataforma.sync_pacote_pedido for all to macuxi_manutencao using (true) with check (true);
-- gerador (worker): lê e grava pedidos de todos os tenants; marca só o pendente; apaga só o que já saiu da fila
create policy sync_pacote_pedido_gerador on plataforma.sync_pacote_pedido for select to macuxi_worker
  using (true);
create policy sync_pacote_pedido_gerador_gravar on plataforma.sync_pacote_pedido for insert to macuxi_worker
  with check (true);
create policy sync_pacote_pedido_gerador_marcar on plataforma.sync_pacote_pedido for update to macuxi_worker
  using (situacao = 'pendente') with check (true);
create policy sync_pacote_pedido_gerador_expurgar on plataforma.sync_pacote_pedido for delete to macuxi_worker
  using (situacao <> 'pendente');
revoke all on plataforma.sync_pacote_pedido from public;
grant select on plataforma.sync_pacote_pedido to macuxi_app;
grant insert (id, tenant_id, modulo, particao, filial_id, origem) on plataforma.sync_pacote_pedido to macuxi_app;
grant select on plataforma.sync_pacote_pedido to macuxi_worker;
grant insert (id, tenant_id, modulo, particao, filial_id, origem, gerar_apos) on plataforma.sync_pacote_pedido to macuxi_worker;
grant update (situacao, gerar_apos, tentativas, ultimo_erro, atendido_em, deleted_at) on plataforma.sync_pacote_pedido to macuxi_worker;
grant delete on plataforma.sync_pacote_pedido to macuxi_worker;

-- =============================================================================================
-- catalogo.tabela_preco_item — leitura por filial (pull e pacote.puxar; desenho §5 B)
-- =============================================================================================
create index tabela_preco_item_filial_sync_ix on catalogo.tabela_preco_item (tenant_id, filial_id, updated_at, id);
