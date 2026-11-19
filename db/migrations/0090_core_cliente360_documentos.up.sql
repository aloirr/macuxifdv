-- 0090_core_cliente360_documentos (up) — T-0186 (Cliente 360 v2: Histórico com NF e Documentação; v1.0.15). Spec da
-- simulação §5, §7, §8 e §9 (D1–D6), decisões P1–P17 (R-20261119-045810-alexandre, R-20261119-0458 e R-20261119-0530).
-- Vem em cima da 0089_core_rastreamento (T-0156, PR #498); o número segue a ordem de merge (R-20261115-140000). Dicionário:
-- docs/banco/core.md ("0090"). Teste: db/testes/cliente360-documentos.db.test.ts.
--
-- Migração ADITIVA: colunas novas opcionais (nulas, sem default, sem backfill, sem andar o updated_at), 4 tabelas novas e
-- índices. Nenhuma coluna, CHECK, RLS ou grant existente muda. As colunas novas de nota_erp e titulo herdam RLS e grants da
-- tabela (o macuxi_leitura tem SELECT de tabela nas duas, 0078: nenhuma coluna sensível).
--
-- 1. core.nota_erp (0019) — D2 e D3:
--      forma_pagamento   text null  forma de pagamento da NF, como o ERP manda (E1); CHECK 1..120 depois do btrim
--      nf_origem_numero  text null  NF original da devolução: só quando tipo = 'devolucao' (nota_erp_nf_origem_so_devolucao)
--      nf_origem_serie   text null  série da NF original: só com o número (nota_erp_nf_origem_serie_com_numero)
--    Número 1..40 e série 1..10 depois do btrim, os limites do contrato do Hub (o CHECK de numero da 0019 só pede não vazio).
--    Índices (D4/P17: a consulta online por período ao tocar, sem pull de 12 meses):
--      nota_erp_cliente_emitida_ix (tenant_id, cliente_id, emitida_em desc, id desc) where deleted_at is null — a lista do
--        Histórico além dos 90 dias: "where cliente_id = $1 and emitida_em >= $2 and emitida_em < $3 order by emitida_em desc,
--        id desc limit N", com paginação por (emitida_em, id). O (tenant_id, cliente_id, ano_mes) da 0019 não serve: ano_mes é
--        o mês no fuso do tenant, o filtro "Escolher datas" é por dia e a ordem é pelo instante.
--      nota_erp_nf_origem_ix (tenant_id, cliente_id, nf_origem_numero, nf_origem_serie) where nf_origem_numero is not null and
--        deleted_at is null — o status "Devolvido" / "Devolvido parcial" de cada NF da página soma as devoluções que apontam
--        para ela (uma sonda por NF; o índice só tem as devoluções).
--    NÃO criado: (tenant_id, numero, serie) para achar a NF original. A busca é sempre dentro do cliente (a devolução e o título
--    trazem cliente_id) e cai no prefixo (tenant_id, cliente_id) do nota_erp_cliente_emitida_ix: ~30 notas/ano por cliente.
--    nota_erp segue FORA do sync (TABELAS_FORA_DO_SYNC): o pull das linhas de 90 dias (D1) é contrato do modulo-core; quando
--    ele definir o pull, a migração seguinte cria o índice de sync e tira a tabela da lista.
-- 2. core.titulo (0006) — D2 e D3:
--      forma_pagamento  text null  mesmo CHECK 1..120 (titulo_forma_pagamento_tamanho)
--      nf_numero        text null  NF do título (junta as parcelas à nota); 1..40
--      nf_serie         text null  série da NF; só com o número (titulo_nf_serie_com_numero); 1..10
--    titulo_nf_ix (tenant_id, cliente_id, nf_numero, nf_serie) where nf_numero is not null and deleted_at is null — as parcelas
--    do detalhe da NF ("Baixar a NF …?", P17) e o "Em aberto"/"Em atraso" de cada linha do Histórico.
-- 3. Documentação do cliente (D5; P1, P10, P11, P15, P16). Dono: Core. As 4 tabelas com os campos comuns, unique (tenant_id,
--    id), external_uk parcial, gatilho updated_at, RLS ligado e forçado, isolamento_tenant (macuxi_app), manutencao (0031) e a
--    regra da 0078 (grant select e política leitura ao macuxi_leitura; nenhuma coluna sensível). macuxi_app: select, insert,
--    update; SEM delete (soft delete por deleted_at). A Documentação é SÓ ONLINE (P15): nada vai ao aparelho, nem a linha nem o
--    arquivo; o app consulta pela API ao abrir, que revalida a permissão (perfil, carteira e licença). As 4 tabelas ficam em
--    TABELAS_FORA_DO_SYNC, sem índice (tenant_id, updated_at, id).
--    core.documento_tipo: tipo de documento do tenant (BKO › Parâmetros › Documentos). nome 1..80, único vivo sem diferenciar
--      maiúsculas; grupo 1..60 (a faixa da tabela: "Fotos do PDV", "Cadastro", "Contratos"); ordem; origem erp|escritorio|app
--      (P1: cada tipo tem UMA origem); tem_validade; ativo. Volume: dezenas por tenant.
--    core.documento_cliente: o documento de um cliente. cliente_id, tipo_id e enviado_por com FK composta; nome 1..120;
--      arquivo_id = plataforma.arquivo.id SEM FK (outro schema, ADR 0010; o padrão da 0057), único vivo no tenant quando há;
--      nulo = documento sem arquivo ainda (a linha "Falta" com a câmera). data_documento; valido_ate >= data_documento quando
--      há ("Vencido em …" é cálculo do app, P16). Consulta por cliente: (tenant_id, cliente_id). Volume: ~5–15 por cliente.
--    core.documento_permissao: a matriz tipo × perfil (§7). tipo_id com FK composta; perfil_id = plataforma.perfil.id (0041)
--      SEM FK (outro schema, ADR 0010: a API do Core confere o perfil); nivel nao_ve|ve|ve_envia; única viva por (tipo,
--      perfil). Sem linha = o padrão que o domain do Core define. "ve_envia só nos tipos de origem app" é regra do domain e da
--      API (o CHECK cruzado entre tabelas não cabe no banco). Volume: tipos × perfis (centenas por tenant).
--    core.documento_excecao: exceção por documento que SÓ TIRA acesso (P11): a linha quer dizer "este perfil NÃO vê este
--      documento". documento_id com FK composta; perfil_id SEM FK (como acima); única viva por (documento, perfil). Apagar a
--      exceção = deleted_at. Volume: poucas por tenant.
--
-- Caminho de volta: 0090_core_cliente360_documentos.down.sql (APAGA as 4 tabelas com os dados — tipos, documentos, matriz e
-- exceções; os metadados em plataforma.arquivo e os bytes no armazenamento ficam — e as 6 colunas com os índices e CHECKs:
-- forma de pagamento e o vínculo NF/devolução se perdem e voltam na próxima carga do ERP). Volte antes o código do Core e da
-- Integração que lê ou grava. Idempotente.

-- =============================================================================================
-- core.nota_erp: forma de pagamento e NF original da devolução (D2, D3)
-- =============================================================================================
alter table core.nota_erp add column forma_pagamento text;
alter table core.nota_erp add column nf_origem_numero text;
alter table core.nota_erp add column nf_origem_serie text;
alter table core.nota_erp add constraint nota_erp_forma_pagamento_tamanho
  check (forma_pagamento is null or (btrim(forma_pagamento) <> '' and char_length(forma_pagamento) <= 120));
alter table core.nota_erp add constraint nota_erp_nf_origem_tamanho
  check ((nf_origem_numero is null or (btrim(nf_origem_numero) <> '' and char_length(nf_origem_numero) <= 40))
     and (nf_origem_serie is null or (btrim(nf_origem_serie) <> '' and char_length(nf_origem_serie) <= 10)));
alter table core.nota_erp add constraint nota_erp_nf_origem_so_devolucao
  check (nf_origem_numero is null or tipo = 'devolucao');
alter table core.nota_erp add constraint nota_erp_nf_origem_serie_com_numero
  check (nf_origem_serie is null or nf_origem_numero is not null);
create index nota_erp_cliente_emitida_ix on core.nota_erp (tenant_id, cliente_id, emitida_em desc, id desc) where deleted_at is null;
create index nota_erp_nf_origem_ix on core.nota_erp (tenant_id, cliente_id, nf_origem_numero, nf_origem_serie)
  where nf_origem_numero is not null and deleted_at is null;

-- =============================================================================================
-- core.titulo: forma de pagamento e NF do título (D2, D3)
-- =============================================================================================
alter table core.titulo add column forma_pagamento text;
alter table core.titulo add column nf_numero text;
alter table core.titulo add column nf_serie text;
alter table core.titulo add constraint titulo_forma_pagamento_tamanho
  check (forma_pagamento is null or (btrim(forma_pagamento) <> '' and char_length(forma_pagamento) <= 120));
alter table core.titulo add constraint titulo_nf_tamanho
  check ((nf_numero is null or (btrim(nf_numero) <> '' and char_length(nf_numero) <= 40))
     and (nf_serie is null or (btrim(nf_serie) <> '' and char_length(nf_serie) <= 10)));
alter table core.titulo add constraint titulo_nf_serie_com_numero
  check (nf_serie is null or nf_numero is not null);
create index titulo_nf_ix on core.titulo (tenant_id, cliente_id, nf_numero, nf_serie) where nf_numero is not null and deleted_at is null;

-- =============================================================================================
-- core.documento_tipo — tipos de documento (§7, P1)
-- =============================================================================================
create table core.documento_tipo (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references plataforma.tenant (id),
  nome          text not null,
  grupo         text not null,
  ordem         integer not null default 0,
  origem        text not null,
  tem_validade  boolean not null default false,
  ativo         boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  external_id   text,
  constraint documento_tipo_tenant_id_uk unique (tenant_id, id),
  constraint documento_tipo_nome_tamanho check (btrim(nome) <> '' and char_length(nome) <= 80),
  constraint documento_tipo_grupo_tamanho check (btrim(grupo) <> '' and char_length(grupo) <= 60),
  constraint documento_tipo_origem_valida check (origem in ('erp', 'escritorio', 'app'))
);
create unique index documento_tipo_nome_uk on core.documento_tipo (tenant_id, lower(nome)) where deleted_at is null;
create unique index documento_tipo_external_uk on core.documento_tipo (tenant_id, external_id) where external_id is not null and deleted_at is null;
create trigger documento_tipo_updated_at before update on core.documento_tipo
  for each row execute function plataforma.definir_updated_at();
alter table core.documento_tipo enable row level security;
alter table core.documento_tipo force row level security;
create policy isolamento_tenant on core.documento_tipo for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
create policy manutencao on core.documento_tipo for all to macuxi_manutencao using (true) with check (true);
grant select, insert, update on core.documento_tipo to macuxi_app;
grant select on core.documento_tipo to macuxi_leitura;
create policy leitura on core.documento_tipo for select to macuxi_leitura using (tenant_id = plataforma.tenant_atual());

-- =============================================================================================
-- core.documento_cliente — documentos do cliente (§5; o arquivo em plataforma.arquivo, sem FK)
-- =============================================================================================
create table core.documento_cliente (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references plataforma.tenant (id),
  cliente_id      uuid not null,
  tipo_id         uuid not null,
  nome            text not null,
  arquivo_id      uuid,
  data_documento  date not null,
  valido_ate      date,
  enviado_por     uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  external_id     text,
  constraint documento_cliente_tenant_id_uk unique (tenant_id, id),
  constraint documento_cliente_cliente_fk foreign key (tenant_id, cliente_id) references core.cliente (tenant_id, id),
  constraint documento_cliente_tipo_fk foreign key (tenant_id, tipo_id) references core.documento_tipo (tenant_id, id),
  constraint documento_cliente_enviado_por_fk foreign key (tenant_id, enviado_por) references core.usuario (tenant_id, id),
  constraint documento_cliente_nome_tamanho check (btrim(nome) <> '' and char_length(nome) <= 120),
  constraint documento_cliente_validade_coerente check (valido_ate is null or valido_ate >= data_documento)
);
create unique index documento_cliente_arquivo_uk on core.documento_cliente (tenant_id, arquivo_id) where arquivo_id is not null and deleted_at is null;
create index documento_cliente_cliente_ix on core.documento_cliente (tenant_id, cliente_id);
create index documento_cliente_tipo_ix on core.documento_cliente (tenant_id, tipo_id);
create unique index documento_cliente_external_uk on core.documento_cliente (tenant_id, external_id) where external_id is not null and deleted_at is null;
create trigger documento_cliente_updated_at before update on core.documento_cliente
  for each row execute function plataforma.definir_updated_at();
alter table core.documento_cliente enable row level security;
alter table core.documento_cliente force row level security;
create policy isolamento_tenant on core.documento_cliente for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
create policy manutencao on core.documento_cliente for all to macuxi_manutencao using (true) with check (true);
grant select, insert, update on core.documento_cliente to macuxi_app;
grant select on core.documento_cliente to macuxi_leitura;
create policy leitura on core.documento_cliente for select to macuxi_leitura using (tenant_id = plataforma.tenant_atual());

-- =============================================================================================
-- core.documento_permissao — matriz tipo × perfil (§7; perfil_id sem FK: plataforma.perfil é de outro schema)
-- =============================================================================================
create table core.documento_permissao (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references plataforma.tenant (id),
  tipo_id      uuid not null,
  perfil_id    uuid not null,
  nivel        text not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  external_id  text,
  constraint documento_permissao_tenant_id_uk unique (tenant_id, id),
  constraint documento_permissao_tipo_fk foreign key (tenant_id, tipo_id) references core.documento_tipo (tenant_id, id),
  constraint documento_permissao_nivel_valido check (nivel in ('nao_ve', 've', 've_envia'))
);
create unique index documento_permissao_tipo_perfil_uk on core.documento_permissao (tenant_id, tipo_id, perfil_id) where deleted_at is null;
create unique index documento_permissao_external_uk on core.documento_permissao (tenant_id, external_id) where external_id is not null and deleted_at is null;
create trigger documento_permissao_updated_at before update on core.documento_permissao
  for each row execute function plataforma.definir_updated_at();
alter table core.documento_permissao enable row level security;
alter table core.documento_permissao force row level security;
create policy isolamento_tenant on core.documento_permissao for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
create policy manutencao on core.documento_permissao for all to macuxi_manutencao using (true) with check (true);
grant select, insert, update on core.documento_permissao to macuxi_app;
grant select on core.documento_permissao to macuxi_leitura;
create policy leitura on core.documento_permissao for select to macuxi_leitura using (tenant_id = plataforma.tenant_atual());

-- =============================================================================================
-- core.documento_excecao — "este perfil NÃO vê este documento" (P11: a exceção só tira acesso)
-- =============================================================================================
create table core.documento_excecao (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references plataforma.tenant (id),
  documento_id  uuid not null,
  perfil_id     uuid not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  external_id   text,
  constraint documento_excecao_tenant_id_uk unique (tenant_id, id),
  constraint documento_excecao_documento_fk foreign key (tenant_id, documento_id) references core.documento_cliente (tenant_id, id)
);
create unique index documento_excecao_documento_perfil_uk on core.documento_excecao (tenant_id, documento_id, perfil_id) where deleted_at is null;
create unique index documento_excecao_external_uk on core.documento_excecao (tenant_id, external_id) where external_id is not null and deleted_at is null;
create trigger documento_excecao_updated_at before update on core.documento_excecao
  for each row execute function plataforma.definir_updated_at();
alter table core.documento_excecao enable row level security;
alter table core.documento_excecao force row level security;
create policy isolamento_tenant on core.documento_excecao for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
create policy manutencao on core.documento_excecao for all to macuxi_manutencao using (true) with check (true);
grant select, insert, update on core.documento_excecao to macuxi_app;
grant select on core.documento_excecao to macuxi_leitura;
create policy leitura on core.documento_excecao for select to macuxi_leitura using (tenant_id = plataforma.tenant_atual());
