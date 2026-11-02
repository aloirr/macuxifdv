-- 0013_catalogo_vendedor_prevenda (up) — prazo de 06/11 (R-20261101-214812): destrava as sessões da nuvem T-0052
-- (Catálogo), T-0053/T-0054 (Vendedor) e a T-0047 item 3 (cota de IA). Pedidos: R-20261101-222233-3-modulo-catalogo
-- (débito atômico da cota), R-20261102-091519/092329 (cadastro mínimo do cliente), R-20261102-093007 (novo pedido:
-- unidade/caixa, desconto e acréscimo por item, frete, transportadora, endereço de entrega, árvore do catálogo) e
-- R-20261102-094644 (custo, preço de venda e desconto máximo do produto).
-- Regras: RN-CAT-03 (cota de IA por usuário/dia no fuso do tenant), RN-CAT-04/07, RF-CAT-01..07, RN-CORE-16/17/18,
-- RN-VEN-02/03 (desconto e acréscimo), RN-VEN-11 (preço mínimo), RN-VEN-13/32 (orçamento), RN-VEN-15 (unidade de venda),
-- RN-VEN-16 (frete, R-20261102-105040), RN-VEN-17 (endereço de entrega), RN-INT-08 (envio ao ERP e faturamento), RF-VEN-03/11/12/13.
--
-- Mudanças por schema:
--   core     : cliente (inscricao_estadual, observacao, cadastro_incompleto, cadastro_campos_faltantes), produto
--              (custo_cents, preco_venda_cents, desconto_maximo_pct), novas produto_unidade e cliente_endereco.
--   catalogo : uso_ia + funções debitar_cota_ia / consultas_ia_do_dia (fora do sync), catalogo_no e produto_no (árvore),
--              produto_conteudo, produto_atributo, produto_midia, sinonimo, produto_busca (FTS do servidor), deposito,
--              estoque_saldo, busca_log (fora do sync); tabela_preco_item ganha unidade (preço próprio da CX).
--   vendedor : pedido (orçamento, acréscimo, desconto efetivo, frete, transportadora, endereço de entrega, marcos do ERP,
--              total faturado), pedido_item (fator, quantidade_base, acréscimo, quantidade_faturada, preço mínimo),
--              novas transportadora e pedido_faturamento.
--   integracao: CHECKs de entidade aceitam 12 (+ catalogo_no, produto_unidade, cliente_endereco, transportadora; padrão
--              do conector continua as 8) e pedido_fila_erp.exige_conector (R-20261102-100400, ADR 0016).
-- Toda tabela nova: campos comuns, RLS forçado com isolamento_tenant, gatilho de updated_at, índice de sync
-- (tenant_id, updated_at, id) salvo as fora do sync (db/src/excecoes.ts), external_id único vivo por tenant e FKs
-- COMPOSTAS (tenant_id, x_id) só dentro do schema. Nenhuma FK entre schemas de módulo (produto_id, cliente_id,
-- usuario_id, endereco_entrega_id, arquivo_id são validados pelas APIs; ADR 0005 e 0012).
-- Dinheiro em centavos (bigint). Percentuais numeric(5,2) de 0 a 100 (desconto efetivo pode ser negativo).
-- Fica para depois (não bloqueia a T-0047): catalogo.produto_embedding (pgvector) — exige CREATE EXTENSION vector, que
-- nem todo ambiente de teste da nuvem tem; entra numa migração própria quando o ranking semântico for ligado.
-- Caminho de volta: 0013_catalogo_vendedor_prevenda.down.sql (APAGA as tabelas e colunas novas e os dados delas; ver lá).

-- =============================================================================================
-- CORE
-- =============================================================================================

-- cliente — cadastro mínimo (RN-CORE-16/17, RN-INT-14). A verificação é do domain do Core; o banco só guarda o
-- resultado. cadastro_campos_faltantes = nomes dos campos (ex.: {'documento','cep'}); vazio <=> cadastro completo.
-- observacao = texto do ERP; a linha automática "Cadastro incompleto: falta ..." é montada na exibição (não gravada).
alter table core.cliente add column inscricao_estadual text;
alter table core.cliente add column observacao text;
alter table core.cliente add column cadastro_incompleto boolean not null default false;
alter table core.cliente add column cadastro_campos_faltantes text[] not null default '{}';
alter table core.cliente add constraint cliente_cadastro_coerente check (cadastro_incompleto = (cardinality(cadastro_campos_faltantes) > 0));
alter table core.cliente add constraint cliente_ie_preenchida check (inscricao_estadual is null or btrim(inscricao_estadual) <> '');
create index cliente_incompleto_ix on core.cliente (tenant_id) where cadastro_incompleto and deleted_at is null;

-- produto — custo e preço de venda do cadastro e desconto máximo próprio (RN-CORE-18, RN-VEN-11). DADO INTERNO: custo
-- nunca vai ao aparelho (o provedor de sync do Core lista colunas; custo_cents fica fora da lista) nem ao PDF do cliente.
-- desconto_maximo_pct nulo = usa o parâmetro do tenant desconto_maximo_produto_pct (padrão 15).
alter table core.produto add column custo_cents bigint;
alter table core.produto add column preco_venda_cents bigint;
alter table core.produto add column desconto_maximo_pct numeric(5, 2);
alter table core.produto add constraint produto_custo_nao_negativo check (custo_cents is null or custo_cents >= 0);
alter table core.produto add constraint produto_preco_venda_nao_negativo check (preco_venda_cents is null or preco_venda_cents >= 0);
alter table core.produto add constraint produto_desconto_maximo_faixa check (desconto_maximo_pct is null or desconto_maximo_pct between 0 and 100);

-- ---------------------------------------------------------------------------------------------
-- produto_unidade — unidades de venda do produto vindas do ERP (RN-VEN-15): UN, CX com fator, outras. fator = quantas
-- unidades base cabem na unidade (UN = 1). No máximo uma `padrao` viva por produto (o "+" adiciona 1 nela).
-- Pull escopo tenant. Volume: produtos x 1..3.
create table core.produto_unidade (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references plataforma.tenant (id),
  produto_id   uuid not null,
  unidade      text not null,
  fator        integer not null default 1,
  ean          text,
  padrao       boolean not null default false,
  ativo        boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  external_id  text,
  constraint produto_unidade_produto_fk foreign key (tenant_id, produto_id) references core.produto (tenant_id, id),
  constraint produto_unidade_preenchida check (unidade ~ '^[A-Z0-9]{1,6}$'),
  constraint produto_unidade_fator_positivo check (fator > 0),
  constraint produto_unidade_ean_formato check (ean is null or ean ~ '^[0-9]{8,14}$'),
  constraint produto_unidade_padrao_ativa check (not padrao or ativo)
);
create unique index produto_unidade_uk on core.produto_unidade (tenant_id, produto_id, unidade) where deleted_at is null;
create unique index produto_unidade_padrao_uk on core.produto_unidade (tenant_id, produto_id) where padrao and deleted_at is null;
create index produto_unidade_sync_ix on core.produto_unidade (tenant_id, updated_at, id);
create unique index produto_unidade_external_uk on core.produto_unidade (tenant_id, external_id) where external_id is not null and deleted_at is null;
create trigger produto_unidade_updated_at before update on core.produto_unidade
  for each row execute function plataforma.definir_updated_at();
alter table core.produto_unidade enable row level security;
alter table core.produto_unidade force row level security;
create policy isolamento_tenant on core.produto_unidade for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert, update, delete on core.produto_unidade to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- cliente_endereco — endereços do cliente vindos do ERP (RF-CORE-12, RN-VEN-17): o principal + os de entrega. O
-- vendedor escolhe entre eles; não digita endereço novo. No máximo um `principal` vivo por cliente.
-- Pull escopo carteira (cliente_id). Volume: clientes x 1..3.
create table core.cliente_endereco (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references plataforma.tenant (id),
  cliente_id   uuid not null,
  tipo         text not null default 'entrega',
  descricao    text,
  logradouro   text not null,
  numero       text,
  complemento  text,
  bairro       text,
  cidade       text not null,
  uf           text not null,
  cep          text,
  latitude     numeric(9, 6),
  longitude    numeric(9, 6),
  principal    boolean not null default false,
  ativo        boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  external_id  text,
  constraint cliente_endereco_cliente_fk foreign key (tenant_id, cliente_id) references core.cliente (tenant_id, id),
  constraint cliente_endereco_tipo_valido check (tipo in ('principal', 'entrega', 'cobranca')),
  constraint cliente_endereco_uf_formato check (uf ~ '^[A-Z]{2}$'),
  constraint cliente_endereco_cep_formato check (cep is null or cep ~ '^[0-9]{8}$'),
  constraint cliente_endereco_logradouro_preenchido check (btrim(logradouro) <> ''),
  constraint cliente_endereco_latitude_faixa check (latitude is null or latitude between -90 and 90),
  constraint cliente_endereco_longitude_faixa check (longitude is null or longitude between -180 and 180)
);
create unique index cliente_endereco_principal_uk on core.cliente_endereco (tenant_id, cliente_id) where principal and deleted_at is null;
create index cliente_endereco_cliente_ix on core.cliente_endereco (tenant_id, cliente_id);
create index cliente_endereco_sync_ix on core.cliente_endereco (tenant_id, updated_at, id);
create unique index cliente_endereco_external_uk on core.cliente_endereco (tenant_id, external_id) where external_id is not null and deleted_at is null;
create trigger cliente_endereco_updated_at before update on core.cliente_endereco
  for each row execute function plataforma.definir_updated_at();
alter table core.cliente_endereco enable row level security;
alter table core.cliente_endereco force row level security;
create policy isolamento_tenant on core.cliente_endereco for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert, update, delete on core.cliente_endereco to macuxi_app;

-- =============================================================================================
-- CATALOGO
-- =============================================================================================

-- ---------------------------------------------------------------------------------------------
-- uso_ia — consultas de IA respondidas por (tenant, usuário, dia civil no fuso do tenant) — RN-CAT-03. Fora do sync.
-- Escrita SÓ por catalogo.debitar_cota_ia (incremento atômico e condicional). Volume: usuários x dias.
create table catalogo.uso_ia (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references plataforma.tenant (id),
  usuario_id   uuid not null,
  dia          date not null,
  consultas    integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  external_id  text,
  constraint uso_ia_dia_uk unique (tenant_id, usuario_id, dia),
  constraint uso_ia_consultas_nao_negativas check (consultas >= 0)
);
create unique index uso_ia_external_uk on catalogo.uso_ia (tenant_id, external_id) where external_id is not null and deleted_at is null;
create trigger uso_ia_updated_at before update on catalogo.uso_ia
  for each row execute function plataforma.definir_updated_at();
alter table catalogo.uso_ia enable row level security;
alter table catalogo.uso_ia force row level security;
create policy isolamento_tenant on catalogo.uso_ia for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert, update on catalogo.uso_ia to macuxi_app;

-- debitar_cota_ia — RN-CAT-03: consome 1 consulta do usuário no dia civil do instante p_agora no fuso do tenant do
-- contexto (plataforma.tenant.fuso). Atômico: um único INSERT ... ON CONFLICT DO UPDATE ... WHERE consultas < limite
-- (a linha do dia fica travada até o fim da transação; requisições simultâneas entram em fila e a condição é
-- reavaliada na versão mais nova da linha — nunca passa do limite). Devolve o total do dia DEPOIS do débito, ou NULL
-- quando o limite já foi atingido (nada é gravado) ou quando p_limite <= 0 (IA desligada). Sem contexto de tenant:
-- erro (fecha). Função do invocador: RLS vale. Chame SÓ quando o provedor respondeu (desfecho 'respondida').
create function catalogo.debitar_cota_ia(p_usuario_id uuid, p_limite integer, p_agora timestamptz default now())
  returns integer
  language plpgsql volatile
  set search_path = pg_catalog, catalogo, plataforma, pg_temp
  as $$
declare
  v_tenant uuid := plataforma.tenant_atual();
  v_dia date;
  v_consultas integer;
begin
  if v_tenant is null then
    raise exception 'debitar_cota_ia: sem contexto de tenant (app.tenant_id)' using errcode = '42501';
  end if;
  if p_usuario_id is null or p_agora is null then
    raise exception 'debitar_cota_ia: informe o usuário e o instante' using errcode = '22004';
  end if;
  if p_limite is null or p_limite <= 0 then
    return null;
  end if;
  select (p_agora at time zone t.fuso)::date into v_dia from plataforma.tenant t where t.id = v_tenant;
  if v_dia is null then
    raise exception 'debitar_cota_ia: tenant do contexto não encontrado' using errcode = '42501';
  end if;
  insert into catalogo.uso_ia as u (tenant_id, usuario_id, dia, consultas)
  values (v_tenant, p_usuario_id, v_dia, 1)
  on conflict on constraint uso_ia_dia_uk do update
    set consultas = u.consultas + 1
    where u.consultas < p_limite
  returning u.consultas into v_consultas;
  return v_consultas;
end
$$;
revoke all on function catalogo.debitar_cota_ia(uuid, integer, timestamptz) from public;
grant execute on function catalogo.debitar_cota_ia(uuid, integer, timestamptz) to macuxi_app;

-- consultas_ia_do_dia — quantas consultas o usuário já consumiu no dia civil de p_agora (fuso do tenant); 0 sem linha.
-- Para o `verificarConsultaIa` (barra antes de chamar o provedor, sem consumir).
create function catalogo.consultas_ia_do_dia(p_usuario_id uuid, p_agora timestamptz default now())
  returns integer
  language sql stable
  set search_path = pg_catalog, catalogo, plataforma, pg_temp
  as $$
    select coalesce((
      select u.consultas
        from catalogo.uso_ia u
        join plataforma.tenant t on t.id = u.tenant_id
       where u.tenant_id = plataforma.tenant_atual()
         and u.usuario_id = p_usuario_id
         and u.dia = (p_agora at time zone t.fuso)::date
         and u.deleted_at is null
    ), 0)
  $$;
revoke all on function catalogo.consultas_ia_do_dia(uuid, timestamptz) from public;
grant execute on function catalogo.consultas_ia_do_dia(uuid, timestamptz) to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- catalogo_no — árvore do catálogo vinda do ERP (RF-CAT-04; ex.: Categoria > Família > Grupo > Subgrupo). Níveis e
-- nomes do ERP. pai_id nulo = raiz. Pull escopo tenant. Volume: centenas.
create table catalogo.catalogo_no (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references plataforma.tenant (id),
  pai_id       uuid,
  nivel        smallint not null,
  codigo       text not null,
  nome         text not null,
  ordem        integer not null default 0,
  ativo        boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  external_id  text,
  constraint catalogo_no_tenant_id_uk unique (tenant_id, id),
  constraint catalogo_no_pai_fk foreign key (tenant_id, pai_id) references catalogo.catalogo_no (tenant_id, id),
  constraint catalogo_no_nivel_faixa check (nivel between 1 and 8),
  constraint catalogo_no_raiz_nivel_1 check ((pai_id is null) = (nivel = 1)),
  constraint catalogo_no_nao_e_pai_de_si check (pai_id is null or pai_id <> id),
  constraint catalogo_no_codigo_preenchido check (btrim(codigo) <> ''),
  constraint catalogo_no_nome_preenchido check (btrim(nome) <> '')
);
create unique index catalogo_no_codigo_uk on catalogo.catalogo_no (tenant_id, codigo) where deleted_at is null;
create index catalogo_no_pai_ix on catalogo.catalogo_no (tenant_id, pai_id, ordem);
create index catalogo_no_sync_ix on catalogo.catalogo_no (tenant_id, updated_at, id);
create unique index catalogo_no_external_uk on catalogo.catalogo_no (tenant_id, external_id) where external_id is not null and deleted_at is null;
create trigger catalogo_no_updated_at before update on catalogo.catalogo_no
  for each row execute function plataforma.definir_updated_at();
alter table catalogo.catalogo_no enable row level security;
alter table catalogo.catalogo_no force row level security;
create policy isolamento_tenant on catalogo.catalogo_no for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert, update, delete on catalogo.catalogo_no to macuxi_app;

-- produto_no — produto -> nó da árvore (normalmente a folha). Pull escopo tenant. Volume: produtos x 1.
create table catalogo.produto_no (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references plataforma.tenant (id),
  produto_id   uuid not null,
  no_id        uuid not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  external_id  text,
  constraint produto_no_no_fk foreign key (tenant_id, no_id) references catalogo.catalogo_no (tenant_id, id)
);
create unique index produto_no_uk on catalogo.produto_no (tenant_id, produto_id, no_id) where deleted_at is null;
create index produto_no_no_ix on catalogo.produto_no (tenant_id, no_id);
create index produto_no_sync_ix on catalogo.produto_no (tenant_id, updated_at, id);
create unique index produto_no_external_uk on catalogo.produto_no (tenant_id, external_id) where external_id is not null and deleted_at is null;
create trigger produto_no_updated_at before update on catalogo.produto_no
  for each row execute function plataforma.definir_updated_at();
alter table catalogo.produto_no enable row level security;
alter table catalogo.produto_no force row level security;
create policy isolamento_tenant on catalogo.produto_no for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert, update, delete on catalogo.produto_no to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- produto_conteudo — conteúdo rico do produto, editado no BKO (RF-CAT-03/07; RN-CAT-04: só analista e admin editam):
-- descrição, aplicações (o `applications` do contrato), argumentos de venda, FAQ (lista de {pergunta, resposta},
-- base do "Pergunte ao catálogo", RN-CAT-02), campanha e destaque. Um por produto. Pull escopo tenant.
create table catalogo.produto_conteudo (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references plataforma.tenant (id),
  produto_id        uuid not null,
  descricao         text,
  aplicacoes        text,
  argumentos_venda  text,
  faq               jsonb not null default '[]',
  campanha          boolean not null default false,
  destaque          boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  external_id       text,
  constraint produto_conteudo_faq_lista check (jsonb_typeof(faq) = 'array')
);
create unique index produto_conteudo_produto_uk on catalogo.produto_conteudo (tenant_id, produto_id) where deleted_at is null;
create index produto_conteudo_sync_ix on catalogo.produto_conteudo (tenant_id, updated_at, id);
create unique index produto_conteudo_external_uk on catalogo.produto_conteudo (tenant_id, external_id) where external_id is not null and deleted_at is null;
create trigger produto_conteudo_updated_at before update on catalogo.produto_conteudo
  for each row execute function plataforma.definir_updated_at();
alter table catalogo.produto_conteudo enable row level security;
alter table catalogo.produto_conteudo force row level security;
create policy isolamento_tenant on catalogo.produto_conteudo for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert, update, delete on catalogo.produto_conteudo to macuxi_app;

-- produto_atributo — atributos filtráveis (RF-CAT-01/02: "150 cilindradas", "5 litros", "viscosidade 20W50").
-- valor em texto; valor_num quando numérico (filtro por faixa). Pull escopo tenant. Volume: produtos x 2..10.
create table catalogo.produto_atributo (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references plataforma.tenant (id),
  produto_id   uuid not null,
  nome         text not null,
  valor        text not null,
  valor_num    numeric(14, 4),
  unidade      text,
  ordem        integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  external_id  text,
  constraint produto_atributo_nome_preenchido check (btrim(nome) <> ''),
  constraint produto_atributo_valor_preenchido check (btrim(valor) <> '')
);
create unique index produto_atributo_uk on catalogo.produto_atributo (tenant_id, produto_id, nome) where deleted_at is null;
create index produto_atributo_nome_ix on catalogo.produto_atributo (tenant_id, nome, valor);
create index produto_atributo_sync_ix on catalogo.produto_atributo (tenant_id, updated_at, id);
create unique index produto_atributo_external_uk on catalogo.produto_atributo (tenant_id, external_id) where external_id is not null and deleted_at is null;
create trigger produto_atributo_updated_at before update on catalogo.produto_atributo
  for each row execute function plataforma.definir_updated_at();
alter table catalogo.produto_atributo enable row level security;
alter table catalogo.produto_atributo force row level security;
create policy isolamento_tenant on catalogo.produto_atributo for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert, update, delete on catalogo.produto_atributo to macuxi_app;

-- produto_midia — fotos, vídeos curtos e PDFs técnicos (RF-CAT-03/07/08). arquivo_id = plataforma.arquivo (ADR 0010,
-- sem FK: validado pela API) ou url externa. No máximo uma foto `principal` viva por produto. Pull escopo tenant.
create table catalogo.produto_midia (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references plataforma.tenant (id),
  produto_id   uuid not null,
  tipo         text not null,
  arquivo_id   uuid,
  url          text,
  titulo       text,
  ordem        integer not null default 0,
  principal    boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  external_id  text,
  constraint produto_midia_tipo_valido check (tipo in ('foto', 'video', 'pdf')),
  constraint produto_midia_origem check (arquivo_id is not null or url is not null),
  constraint produto_midia_principal_foto check (not principal or tipo = 'foto')
);
create unique index produto_midia_principal_uk on catalogo.produto_midia (tenant_id, produto_id) where principal and deleted_at is null;
create index produto_midia_produto_ix on catalogo.produto_midia (tenant_id, produto_id, ordem);
create index produto_midia_sync_ix on catalogo.produto_midia (tenant_id, updated_at, id);
create unique index produto_midia_external_uk on catalogo.produto_midia (tenant_id, external_id) where external_id is not null and deleted_at is null;
create trigger produto_midia_updated_at before update on catalogo.produto_midia
  for each row execute function plataforma.definir_updated_at();
alter table catalogo.produto_midia enable row level security;
alter table catalogo.produto_midia force row level security;
create policy isolamento_tenant on catalogo.produto_midia for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert, update, delete on catalogo.produto_midia to macuxi_app;

-- sinonimo — sinônimos do tenant (RF-CAT-02, RN-CAT-04): termo -> lista (ex.: "moto" -> {motocicleta}, "cc" ->
-- {cilindradas}). Termo único vivo por tenant, sem diferenciar caixa. Pull escopo tenant (busca offline também usa).
create table catalogo.sinonimo (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references plataforma.tenant (id),
  termo        text not null,
  sinonimos    text[] not null,
  ativo        boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  external_id  text,
  constraint sinonimo_termo_preenchido check (btrim(termo) <> ''),
  constraint sinonimo_lista_preenchida check (cardinality(sinonimos) >= 1)
);
create unique index sinonimo_termo_uk on catalogo.sinonimo (tenant_id, lower(termo)) where deleted_at is null;
create index sinonimo_sync_ix on catalogo.sinonimo (tenant_id, updated_at, id);
create unique index sinonimo_external_uk on catalogo.sinonimo (tenant_id, external_id) where external_id is not null and deleted_at is null;
create trigger sinonimo_updated_at before update on catalogo.sinonimo
  for each row execute function plataforma.definir_updated_at();
alter table catalogo.sinonimo enable row level security;
alter table catalogo.sinonimo force row level security;
create policy isolamento_tenant on catalogo.sinonimo for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert, update, delete on catalogo.sinonimo to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- produto_busca — documento de busca do SERVIDOR (RF-CAT-01; GET /v1/catalogo/busca): o Catálogo não lê core.produto
-- (fronteira), então mantém aqui uma cópia de leitura do que é buscável (sku, ean, nome, marca, categoria do Core, via
-- consulta/evento do Core) + atributos e conteúdo do próprio Catálogo. `documento` (tsvector, config 'portuguese', sem
-- acento por catalogo.sem_acento) é preenchido pelo gatilho; nunca grave nele. Pull escopo tenant NÃO (o aparelho tem
-- a FTS5 própria), mas leva o índice de sync para a reconstrução incremental. Volume: = produtos (até 20 mil).
create function catalogo.sem_acento(p text) returns text
  language sql immutable parallel safe
  set search_path = pg_catalog, pg_temp
  as $$ select translate(lower(coalesce(p, '')), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn') $$;
grant execute on function catalogo.sem_acento(text) to macuxi_app;

create table catalogo.produto_busca (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references plataforma.tenant (id),
  produto_id   uuid not null,
  sku          text,
  ean          text,
  nome         text not null,
  marca        text,
  categoria    text,
  atributos    text,
  conteudo     text,
  ativo        boolean not null default true,
  documento    tsvector not null default ''::tsvector,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  external_id  text
);
create unique index produto_busca_produto_uk on catalogo.produto_busca (tenant_id, produto_id) where deleted_at is null;
create index produto_busca_documento_ix on catalogo.produto_busca using gin (documento);
create index produto_busca_sync_ix on catalogo.produto_busca (tenant_id, updated_at, id);
create unique index produto_busca_external_uk on catalogo.produto_busca (tenant_id, external_id) where external_id is not null and deleted_at is null;

-- pesos: A = sku/ean/nome, B = marca/categoria, C = atributos, D = conteúdo (descrição, aplicações, argumentos)
create function catalogo.produto_busca_documento() returns trigger
  language plpgsql
  set search_path = pg_catalog, catalogo, pg_temp
  as $$
begin
  new.documento :=
    setweight(to_tsvector('portuguese', catalogo.sem_acento(concat_ws(' ', new.sku, new.ean, new.nome))), 'A') ||
    setweight(to_tsvector('portuguese', catalogo.sem_acento(concat_ws(' ', new.marca, new.categoria))), 'B') ||
    setweight(to_tsvector('portuguese', catalogo.sem_acento(new.atributos)), 'C') ||
    setweight(to_tsvector('portuguese', catalogo.sem_acento(new.conteudo)), 'D');
  return new;
end
$$;
create trigger produto_busca_documento before insert or update on catalogo.produto_busca
  for each row execute function catalogo.produto_busca_documento();
create trigger produto_busca_updated_at before update on catalogo.produto_busca
  for each row execute function plataforma.definir_updated_at();
alter table catalogo.produto_busca enable row level security;
alter table catalogo.produto_busca force row level security;
create policy isolamento_tenant on catalogo.produto_busca for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert, update, delete on catalogo.produto_busca to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- deposito — filial/depósito do estoque (StockByBranch.branch_id/branch_name). Pull escopo tenant. Volume: unidades.
create table catalogo.deposito (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references plataforma.tenant (id),
  codigo       text not null,
  nome         text not null,
  ativo        boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  external_id  text,
  constraint deposito_tenant_id_uk unique (tenant_id, id),
  constraint deposito_codigo_preenchido check (btrim(codigo) <> ''),
  constraint deposito_nome_preenchido check (btrim(nome) <> '')
);
create unique index deposito_codigo_uk on catalogo.deposito (tenant_id, codigo) where deleted_at is null;
create index deposito_sync_ix on catalogo.deposito (tenant_id, updated_at, id);
create unique index deposito_external_uk on catalogo.deposito (tenant_id, external_id) where external_id is not null and deleted_at is null;
create trigger deposito_updated_at before update on catalogo.deposito
  for each row execute function plataforma.definir_updated_at();
alter table catalogo.deposito enable row level security;
alter table catalogo.deposito force row level security;
create policy isolamento_tenant on catalogo.deposito for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert, update, delete on catalogo.deposito to macuxi_app;

-- estoque_saldo — saldo do ERP por depósito e produto, na unidade base (RN-CAT-07; RN-VEN-20: reservas são do
-- Vendedor). quantidade numeric (o ERP pode mandar fração; a API arredonda para o contrato). atualizado_erp_em = hora
-- do saldo no ERP ("atualizado às hh:mm"). Pull escopo tenant. Volume: produtos x depósitos.
create table catalogo.estoque_saldo (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references plataforma.tenant (id),
  deposito_id        uuid not null,
  produto_id         uuid not null,
  quantidade         numeric(14, 3) not null default 0,
  atualizado_erp_em  timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  external_id        text,
  constraint estoque_saldo_deposito_fk foreign key (tenant_id, deposito_id) references catalogo.deposito (tenant_id, id)
);
create unique index estoque_saldo_uk on catalogo.estoque_saldo (tenant_id, deposito_id, produto_id) where deleted_at is null;
create index estoque_saldo_produto_ix on catalogo.estoque_saldo (tenant_id, produto_id);
create index estoque_saldo_sync_ix on catalogo.estoque_saldo (tenant_id, updated_at, id);
create unique index estoque_saldo_external_uk on catalogo.estoque_saldo (tenant_id, external_id) where external_id is not null and deleted_at is null;
create trigger estoque_saldo_updated_at before update on catalogo.estoque_saldo
  for each row execute function plataforma.definir_updated_at();
alter table catalogo.estoque_saldo enable row level security;
alter table catalogo.estoque_saldo force row level security;
create policy isolamento_tenant on catalogo.estoque_saldo for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert, update, delete on catalogo.estoque_saldo to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- busca_log — buscas feitas (RF-CAT-07: termos sem resultado no BKO; RN-CAT-08: calibração). termo = consulta
-- NORMALIZADA (chaveDeTermo do domain), até 200 caracteres; nada de dado pessoal. Fora do sync. Só leitura e inserção.
-- Volume alto (1 por busca): retenção a definir com o expurgo (backlog).
create table catalogo.busca_log (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references plataforma.tenant (id),
  usuario_id   uuid not null,
  termo        text not null,
  origem       text not null,
  resultados   integer not null,
  duracao_ms   integer,
  ocorrido_em  timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  external_id  text,
  constraint busca_log_termo_tamanho check (char_length(termo) between 1 and 200),
  constraint busca_log_origem_valida check (origem in ('llm', 'regras', 'cache', 'offline')),
  constraint busca_log_resultados_nao_negativos check (resultados >= 0),
  constraint busca_log_duracao_nao_negativa check (duracao_ms is null or duracao_ms >= 0)
);
create index busca_log_ocorrido_ix on catalogo.busca_log (tenant_id, ocorrido_em desc);
create index busca_log_sem_resultado_ix on catalogo.busca_log (tenant_id, termo, ocorrido_em desc) where resultados = 0;
create unique index busca_log_external_uk on catalogo.busca_log (tenant_id, external_id) where external_id is not null and deleted_at is null;
alter table catalogo.busca_log enable row level security;
alter table catalogo.busca_log force row level security;
create policy isolamento_tenant on catalogo.busca_log for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert on catalogo.busca_log to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- tabela_preco_item — preço próprio por unidade de venda (RN-VEN-15): unidade nula = unidade base do produto; 'CX' =
-- preço próprio da caixa (sem linha da CX, preço da CX = preço base x fator). O único vivo passa a incluir a unidade.
alter table catalogo.tabela_preco_item add column unidade text;
alter table catalogo.tabela_preco_item add constraint tabela_preco_item_unidade_formato check (unidade is null or unidade ~ '^[A-Z0-9]{1,6}$');
drop index catalogo.tabela_preco_item_vigencia_uk;
create unique index tabela_preco_item_unidade_vigencia_uk on catalogo.tabela_preco_item (tenant_id, tabela_preco_id, produto_id, unidade, vigencia_inicio) nulls not distinct where deleted_at is null;

-- =============================================================================================
-- VENDEDOR
-- =============================================================================================

-- ---------------------------------------------------------------------------------------------
-- transportadora — cadastro no BKO por admin, analista e assistente, ou vinda do ERP (RF-VEN-13, RN-VEN-16).
-- documento = CNPJ (14 dígitos), único vivo por tenant quando informado. Pull escopo tenant. Volume: dezenas.
create table vendedor.transportadora (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references plataforma.tenant (id),
  nome                text not null,
  documento           text,
  inscricao_estadual  text,
  telefone            text,
  ativo               boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz,
  external_id         text,
  constraint transportadora_tenant_id_uk unique (tenant_id, id),
  constraint transportadora_nome_preenchido check (btrim(nome) <> ''),
  constraint transportadora_documento_digitos check (documento is null or documento ~ '^[0-9]{14}$')
);
create unique index transportadora_documento_uk on vendedor.transportadora (tenant_id, documento) where documento is not null and deleted_at is null;
create index transportadora_sync_ix on vendedor.transportadora (tenant_id, updated_at, id);
create unique index transportadora_external_uk on vendedor.transportadora (tenant_id, external_id) where external_id is not null and deleted_at is null;
create trigger transportadora_updated_at before update on vendedor.transportadora
  for each row execute function plataforma.definir_updated_at();
alter table vendedor.transportadora enable row level security;
alter table vendedor.transportadora force row level security;
create policy isolamento_tenant on vendedor.transportadora for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert, update, delete on vendedor.transportadora to macuxi_app;

-- ---------------------------------------------------------------------------------------------
-- pedido — colunas novas (todas opcionais ou com padrão: APKs e rotas antigas continuam gravando).
-- Orçamento (RF-VEN-03, RN-VEN-13, RN-VEN-32): tipo = 'orcamento' não passa por aprovação nem vai ao ERP (status só
-- draft | queued | received | cancelled), não reserva estoque nem consome crédito; orcamento_validade = último dia
-- válido (data civil no fuso do tenant; hoje + 7 por padrão, calculado pela API). Converter = criar um pedido NOVO
-- (tipo 'pedido', uuid do aparelho) com orcamento_id = id do orçamento e marcar convertido_em no orçamento; um
-- orçamento vira no máximo um pedido (único parcial).
alter table vendedor.pedido add column tipo text not null default 'pedido';
alter table vendedor.pedido add column orcamento_validade date;
alter table vendedor.pedido add column orcamento_id uuid;
alter table vendedor.pedido add column convertido_em timestamptz;
-- Preço (RN-VEN-02/03): acréscimo do pedido (excludente com o desconto do pedido) e desconto efetivo calculado pela API
-- (1 − total dos itens ÷ total pela tabela, em %, SEM o frete; negativo = acréscimo).
alter table vendedor.pedido add column acrescimo_pct numeric(5, 2) not null default 0;
alter table vendedor.pedido add column desconto_efetivo_pct numeric(6, 2);
-- Frete (RN-VEN-16, decisão R-20261102-105040: quem paga define a modalidade; o pedido NÃO tem valor de frete):
-- CIF = a empresa paga (incluso no preço), sem transportadora; FOB = o cliente paga, transportadora OBRIGATÓRIA,
-- cadastrada (transportadora_id) ou digitada pelo vendedor (nome e CNPJ obrigatórios, telefone opcional; fica só no
-- pedido). transportadora_nome/documento/telefone = retrato da cadastrada no aceite, ou o digitado. Nulo = pedido
-- antigo (antes da 0013); a API grava sempre (padrão do tenant: parâmetro frete_modalidade_padrao = CIF, sem linha).
alter table vendedor.pedido add column frete_modalidade text;
alter table vendedor.pedido add column transportadora_id uuid;
alter table vendedor.pedido add column transportadora_digitada boolean not null default false;
alter table vendedor.pedido add column transportadora_nome text;
alter table vendedor.pedido add column transportadora_documento text;
alter table vendedor.pedido add column transportadora_telefone text;
-- Endereço de entrega (RN-VEN-17): id do core.cliente_endereco escolhido (sem FK, fronteira) + retrato no aceite.
alter table vendedor.pedido add column endereco_entrega_id uuid;
alter table vendedor.pedido add column endereco_entrega jsonb;
-- Marcos do ERP (RN-INT-08; consumo de integracao.pedido.retorno_erp@1). total_faturado_cents = soma das notas.
alter table vendedor.pedido add column enviado_erp_em timestamptz;
alter table vendedor.pedido add column integrado_em timestamptz;
alter table vendedor.pedido add column faturado_em timestamptz;
alter table vendedor.pedido add column total_faturado_cents bigint not null default 0;

alter table vendedor.pedido add constraint pedido_tipo_valido check (tipo in ('pedido', 'orcamento'));
alter table vendedor.pedido add constraint pedido_orcamento_status check (tipo = 'pedido' or status in ('draft', 'queued', 'received', 'cancelled'));
alter table vendedor.pedido add constraint pedido_orcamento_campos check (tipo = 'orcamento' or (orcamento_validade is null and convertido_em is null));
alter table vendedor.pedido add constraint pedido_orcamento_origem check (orcamento_id is null or (tipo = 'pedido' and orcamento_id <> id));
alter table vendedor.pedido add constraint pedido_orcamento_fk foreign key (tenant_id, orcamento_id) references vendedor.pedido (tenant_id, id);
alter table vendedor.pedido add constraint pedido_acrescimo_faixa check (acrescimo_pct between 0 and 100);
alter table vendedor.pedido add constraint pedido_desconto_ou_acrescimo check (desconto_pct = 0 or acrescimo_pct = 0);
alter table vendedor.pedido add constraint pedido_desconto_efetivo_faixa check (desconto_efetivo_pct is null or desconto_efetivo_pct between -1000 and 100);
alter table vendedor.pedido add constraint pedido_frete_modalidade_valida check (frete_modalidade is null or frete_modalidade in ('CIF', 'FOB'));
alter table vendedor.pedido add constraint pedido_cif_sem_transportadora check (frete_modalidade is distinct from 'CIF' or (transportadora_id is null and not transportadora_digitada));
alter table vendedor.pedido add constraint pedido_fob_com_transportadora check (frete_modalidade is distinct from 'FOB' or transportadora_id is not null or transportadora_digitada);
alter table vendedor.pedido add constraint pedido_transportadora_digitada check (not transportadora_digitada or (transportadora_id is null and coalesce(btrim(transportadora_nome), '') <> '' and transportadora_documento is not null));
alter table vendedor.pedido add constraint pedido_transportadora_documento_digitos check (transportadora_documento is null or transportadora_documento ~ '^[0-9]{14}$');
alter table vendedor.pedido add constraint pedido_transportadora_fk foreign key (tenant_id, transportadora_id) references vendedor.transportadora (tenant_id, id);
alter table vendedor.pedido add constraint pedido_endereco_entrega_objeto check (endereco_entrega is null or jsonb_typeof(endereco_entrega) = 'object');
alter table vendedor.pedido add constraint pedido_total_faturado_nao_negativo check (total_faturado_cents >= 0);
create unique index pedido_orcamento_uk on vendedor.pedido (tenant_id, orcamento_id) where orcamento_id is not null and deleted_at is null;
create index pedido_tipo_ix on vendedor.pedido (tenant_id, vendedor_id, tipo, created_at desc);
create index pedido_transportadora_digitada_ix on vendedor.pedido (tenant_id, created_at desc) where transportadora_digitada;

-- ---------------------------------------------------------------------------------------------
-- pedido_item — unidade de venda (RN-VEN-15), acréscimo do item (RN-VEN-02), preço mínimo (RN-VEN-11) e faturado.
-- unidade (0009) + fator: quantas unidades base há na unidade (UN = 1, "CX c/ 12" = 12). quantidade_base =
-- quantidade x fator, preenchida pelo GATILHO pedido_item_quantidade_base (nunca grave nela; ela confere múltiplo e
-- estoque). acrescimo_pct excludente com desconto_pct do item. preco_minimo_cents = retrato do preço mínimo do item na
-- unidade vendida (auditoria do RN-VEN-11). quantidade_faturada = soma faturada pelo ERP na UNIDADE BASE (o ERP fatura 6 UN
-- de uma "CX c/ 12"; desenho T-0061 §2.1, ADR 0016): de 0 a quantidade_base.
alter table vendedor.pedido_item add column fator integer not null default 1;
alter table vendedor.pedido_item add column quantidade_base integer not null default 0;
alter table vendedor.pedido_item add column acrescimo_pct numeric(5, 2) not null default 0;
alter table vendedor.pedido_item add column preco_minimo_cents bigint;
alter table vendedor.pedido_item add column quantidade_faturada integer not null default 0;
update vendedor.pedido_item set quantidade_base = quantidade * fator;
alter table vendedor.pedido_item add constraint pedido_item_fator_positivo check (fator > 0);
alter table vendedor.pedido_item add constraint pedido_item_quantidade_base_coerente check (quantidade_base = quantidade * fator);
alter table vendedor.pedido_item add constraint pedido_item_acrescimo_faixa check (acrescimo_pct between 0 and 100);
alter table vendedor.pedido_item add constraint pedido_item_desconto_ou_acrescimo check (desconto_pct = 0 or acrescimo_pct = 0);
alter table vendedor.pedido_item add constraint pedido_item_preco_minimo_nao_negativo check (preco_minimo_cents is null or preco_minimo_cents >= 0);
alter table vendedor.pedido_item add constraint pedido_item_faturada_faixa check (quantidade_faturada between 0 and quantidade_base);

create function vendedor.pedido_item_quantidade_base() returns trigger
  language plpgsql
  set search_path = pg_catalog, vendedor, pg_temp
  as $$
begin
  new.quantidade_base := new.quantidade * new.fator;
  return new;
end
$$;
create trigger pedido_item_quantidade_base before insert or update on vendedor.pedido_item
  for each row execute function vendedor.pedido_item_quantidade_base();

-- ---------------------------------------------------------------------------------------------
-- pedido_faturamento — uma linha por retorno do ERP faturado aceito (faturado_parcial | faturado_total), consumido de
-- integracao.pedido.retorno_erp@1. Idempotência: evento_id (id do evento na outbox) único por tenant. itens = o que foi
-- faturado NESTE retorno: [{sequencia, produto_id, quantidade, total_cents}] (o Vendedor soma em
-- pedido_item.quantidade_faturada na mesma transação). Pull com o escopo do pedido (join por pedido_id). Só leitura e
-- inserção pela aplicação. Volume: pedidos x 1..3. itens[].quantidade na UNIDADE BASE (como quantidade_faturada).
create table vendedor.pedido_faturamento (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references plataforma.tenant (id),
  pedido_id         uuid not null,
  evento_id         uuid not null,
  parcial           boolean not null,
  numero_erp        text,
  nota_numero       text,
  nota_serie        text,
  nota_emitida_em   timestamptz,
  nota_total_cents  bigint,
  itens             jsonb not null default '[]',
  faturado_em       timestamptz not null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  external_id       text,
  constraint pedido_faturamento_pedido_fk foreign key (tenant_id, pedido_id) references vendedor.pedido (tenant_id, id),
  constraint pedido_faturamento_evento_uk unique (tenant_id, evento_id),
  constraint pedido_faturamento_itens_lista check (jsonb_typeof(itens) = 'array'),
  constraint pedido_faturamento_total_nao_negativo check (nota_total_cents is null or nota_total_cents >= 0)
);
create index pedido_faturamento_pedido_ix on vendedor.pedido_faturamento (tenant_id, pedido_id, faturado_em);
create index pedido_faturamento_sync_ix on vendedor.pedido_faturamento (tenant_id, updated_at, id);
create unique index pedido_faturamento_external_uk on vendedor.pedido_faturamento (tenant_id, external_id) where external_id is not null and deleted_at is null;
create trigger pedido_faturamento_updated_at before update on vendedor.pedido_faturamento
  for each row execute function plataforma.definir_updated_at();
alter table vendedor.pedido_faturamento enable row level security;
alter table vendedor.pedido_faturamento force row level security;
create policy isolamento_tenant on vendedor.pedido_faturamento for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert on vendedor.pedido_faturamento to macuxi_app;

-- =============================================================================================
-- INTEGRACAO (pedido R-20261102-100400-engenheiro-software; desenho T-0061 §6 e ADR 0016)
-- =============================================================================================
-- Entidades novas do contrato v1 (aditivo, RN-INT-09): catalogo_no, produto_unidade, cliente_endereco, transportadora.
-- Os CHECKs de entidade passam a aceitar as 12; o PADRÃO de integracao.conector.entidades continua as 8 originais
-- (Conector antigo não recebe entidade que não conhece). Lista do banco: ENTIDADES_BANCO em modules/integracao/db/nuvem.ts.
alter table integracao.conector drop constraint conector_entidades_validas;
alter table integracao.conector add constraint conector_entidades_validas check (cardinality(entidades) >= 1 and entidades <@ array['vendedor', 'cliente', 'produto', 'preco', 'estoque', 'titulo', 'nota', 'rota', 'catalogo_no', 'produto_unidade', 'cliente_endereco', 'transportadora']::text[] and integracao.sem_repeticao(entidades));
alter table integracao.sessao_carga drop constraint sessao_carga_entidade_valida;
alter table integracao.sessao_carga add constraint sessao_carga_entidade_valida check (entidade in ('vendedor', 'cliente', 'produto', 'preco', 'estoque', 'titulo', 'nota', 'rota', 'catalogo_no', 'produto_unidade', 'cliente_endereco', 'transportadora'));
alter table integracao.lote drop constraint lote_entidade_valida;
alter table integracao.lote add constraint lote_entidade_valida check (entidade in ('vendedor', 'cliente', 'produto', 'preco', 'estoque', 'titulo', 'nota', 'rota', 'catalogo_no', 'produto_unidade', 'cliente_endereco', 'transportadora'));
alter table integracao.registro_atual drop constraint registro_atual_entidade_valida;
alter table integracao.registro_atual add constraint registro_atual_entidade_valida check (entidade in ('vendedor', 'cliente', 'produto', 'preco', 'estoque', 'titulo', 'nota', 'rota', 'catalogo_no', 'produto_unidade', 'cliente_endereco', 'transportadora'));
alter table integracao.pendencia_inativacao drop constraint pendencia_inativacao_entidade_valida;
alter table integracao.pendencia_inativacao add constraint pendencia_inativacao_entidade_valida check (entidade in ('vendedor', 'cliente', 'produto', 'preco', 'estoque', 'titulo', 'nota', 'rota', 'catalogo_no', 'produto_unidade', 'cliente_endereco', 'transportadora'));
alter table integracao.inativacao_auditoria drop constraint inativacao_auditoria_entidade_valida;
alter table integracao.inativacao_auditoria add constraint inativacao_auditoria_entidade_valida check (entidade in ('vendedor', 'cliente', 'produto', 'preco', 'estoque', 'titulo', 'nota', 'rota', 'catalogo_no', 'produto_unidade', 'cliente_endereco', 'transportadora'));
alter table integracao.cursor_entidade drop constraint cursor_entidade_entidade_valida;
alter table integracao.cursor_entidade add constraint cursor_entidade_entidade_valida check (entidade in ('vendedor', 'cliente', 'produto', 'preco', 'estoque', 'titulo', 'nota', 'rota', 'catalogo_no', 'produto_unidade', 'cliente_endereco', 'transportadora'));
alter table integracao.reconciliacao drop constraint reconciliacao_entidade_valida;
alter table integracao.reconciliacao add constraint reconciliacao_entidade_valida check (entidade in ('vendedor', 'cliente', 'produto', 'preco', 'estoque', 'titulo', 'nota', 'rota', 'catalogo_no', 'produto_unidade', 'cliente_endereco', 'transportadora'));

-- pedido_fila_erp.exige_conector — versão mínima do Conector para levar este pedido (ADR 0016: pedido com unidade/frete/
-- entrega exige Conector que os conheça). Nulo = qualquer versão. Formato semver simples (1.3.0).
alter table integracao.pedido_fila_erp add column exige_conector text;
alter table integracao.pedido_fila_erp add constraint pedido_fila_erp_exige_conector_formato check (exige_conector is null or exige_conector ~ '^[0-9]+\.[0-9]+\.[0-9]+$');
