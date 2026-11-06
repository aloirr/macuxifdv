-- 0033_catalogo_aplicacao_referencia (up) — T-0084 (aplicação do produto: RN-CAT-11, RN-CAT-12, RN-VEN-19) e T-0085 (Catálogo
-- do cadastro: RF-CAT-09, RN-CAT-09, RN-CAT-10). Desenhos docs/desenho/T-0084.md §6/§7 e T-0085.md §7; pedido
-- R-20261105-212656-engenheiro-software com a correção do gerente (ordem do Alexandre, 05/11 21h): as marcas concorrentes
-- NÃO vão para o Core (a ADR 0027 não vale) — o Catálogo lê as marcas pelo contrato que o Promotor já publica
-- (cadastro `concorrente`), então nada muda em core.* nem em promotor.*. Dicionário: docs/banco/catalogo.md e vendedor.md.
-- Uma migração só para as duas tarefas (publicada primeiro; os módulos trabalham em cima dela em paralelo).
--
-- Mudanças:
--   catalogo.produto_conteudo:
--     - aplicacoes (a "Aplicação"/descrição 2, que já existe desde a 0013) passa a ter teto de 2.000 caracteres
--       (produto_conteudo_aplicacoes_tamanho; RN-CAT-11, aplicacao_max_cadastro = 2.000). Antes do CHECK, o texto acima do
--       teto é cortado em 2.000 (sem espaço no fim), como o Hub fará na entrada — a base demo e as fixtures não têm nenhum
--       acima (conferido); o corte só protege base de cliente com texto longo gravado antes da regra.
--     - etiquetas text[] not null default '{}' (etiquetas curtas: posição, lado, "novo"; RF-CAT-09): até 4, cada uma não
--       vazia e com até 20 caracteres (produto_conteudo_etiquetas_validas, pela função imutável catalogo.etiquetas_validas,
--       porque CHECK não aceita subconsulta).
--   catalogo.produto_busca (documento de busca do servidor):
--     - colunas aplicacao (a API grava o textoIndice já expandido de expandirAplicacao; RN-CAT-12) e referencias (códigos
--       crus + compactos das referências cruzadas; RN-CAT-09);
--     - gatilho produto_busca_documento: A = sku, ean, nome e referencias · B = marca e categoria · C = atributos e
--       aplicacao · D = conteudo (que deixa de levar a aplicação: quem grava conteudo é o modulo-catalogo);
--     - backfill: aplicacao = produto_conteudo.aplicacoes (texto cru, sem expansão: o SQL não depende do JS; a API do
--       Catálogo reescreve expandido na próxima gravação ou no comando de reindexação). O UPDATE dispara o gatilho e
--       recalcula o documento.
--   catalogo.produto_referencia (nova; RN-CAT-09): referência cruzada do produto = marca concorrente + código, até 3 por
--     produto (ordem 1..3, único vivo por (tenant, produto, ordem)). marca_id = id do cadastro `concorrente` do Promotor
--     (contrato do Promotor), SEM FK: é outro schema de módulo (regra 1, ADR 0005) — a API do Catálogo valida pelo
--     contrato. produto_id também sem FK (core.produto). codigo = como o analista ou o ERP escreveu (1..30, não vazio);
--     codigo_compacto = forma normalizada para a busca, gravada pela API com o `codigoCompacto` do domain do Catálogo
--     (sem acento, minúsculas, só [a-z0-9]: "CB 3401", "cb-3401" e "C.B.3401" = "cb3401"); NÃO é coluna gerada em SQL
--     (uma implementação só, a do JS) — o banco só confere o formato. Único vivo (tenant, produto, marca, compacto): a
--     mesma marca não repete o código com outra grafia. Índice (tenant, codigo_compacto) text_pattern_ops para o achado
--     exato e por prefixo ("cb34%") do código do concorrente. Pull escopo tenant (índice de sync). Volume: até 3 x produtos
--     (60 mil linhas num catálogo de 20 mil).
--   vendedor.pedido_item: aplicacao text nulo (RN-VEN-19: retrato da aplicação no momento do pedido, cortado pela API em
--     aplicacao_max_orcamento, padrão 300, até 1.000; nulo = vendedor desmarcou ou produto sem aplicação), CHECK <= 1.000.
--     Item anterior à 0033 fica nulo (sem backfill: o retrato é o que o cliente viu).
--   Sem mudança: catalogo.produto_relacao ("oferece junto" = tipo 'complementar', até 5 pelo domain e pela API) e
--     catalogo.catalogo_no (a hierarquia sistema › grupo › linha é a árvore da 0013, níveis 1..8; nada faltava).
-- Tabela nova com a política manutencao (0031) junto da isolamento_tenant.
-- Caminho de volta: 0033_catalogo_aplicacao_referencia.down.sql (APAGA catalogo.produto_referencia com os dados, as
-- etiquetas, as colunas aplicacao/referencias da busca e pedido_item.aplicacao com os retratos; o gatilho volta aos pesos da
-- 0013 e recalcula o documento; o corte em 2.000 de produto_conteudo.aplicacoes, se houve, não volta).

-- =============================================================================================
-- catalogo.produto_conteudo — teto da aplicação (RN-CAT-11) e etiquetas (RF-CAT-09)
-- =============================================================================================
update catalogo.produto_conteudo set aplicacoes = rtrim(left(aplicacoes, 2000)) where char_length(aplicacoes) > 2000;
alter table catalogo.produto_conteudo add constraint produto_conteudo_aplicacoes_tamanho check (aplicacoes is null or char_length(aplicacoes) <= 2000);

-- etiquetas: até 4, array de 1 dimensão, cada uma não nula, não vazia e com até 20 caracteres
create function catalogo.etiquetas_validas(p text[]) returns boolean
  language sql immutable parallel safe
  set search_path = pg_catalog, pg_temp
  as $$
    select p is not null
       and cardinality(p) <= 4
       and (array_ndims(p) is null or array_ndims(p) = 1)
       and coalesce((select bool_and(e is not null and btrim(e) <> '' and char_length(e) <= 20) from unnest(p) as e), true)
  $$;
grant execute on function catalogo.etiquetas_validas(text[]) to macuxi_app;
alter table catalogo.produto_conteudo add column etiquetas text[] not null default '{}';
alter table catalogo.produto_conteudo add constraint produto_conteudo_etiquetas_validas check (catalogo.etiquetas_validas(etiquetas));

-- =============================================================================================
-- catalogo.produto_busca — aplicação (peso C) e referências (peso A) no documento do servidor
-- =============================================================================================
alter table catalogo.produto_busca add column aplicacao text;
alter table catalogo.produto_busca add column referencias text;

-- pesos: A = sku/ean/nome/referencias, B = marca/categoria, C = atributos/aplicacao, D = conteúdo (descrição, argumentos)
create or replace function catalogo.produto_busca_documento() returns trigger
  language plpgsql
  set search_path = pg_catalog, catalogo, pg_temp
  as $$
begin
  new.documento :=
    setweight(to_tsvector('portuguese', catalogo.sem_acento(concat_ws(' ', new.sku, new.ean, new.nome, new.referencias))), 'A') ||
    setweight(to_tsvector('portuguese', catalogo.sem_acento(concat_ws(' ', new.marca, new.categoria))), 'B') ||
    setweight(to_tsvector('portuguese', catalogo.sem_acento(concat_ws(' ', new.atributos, new.aplicacao))), 'C') ||
    setweight(to_tsvector('portuguese', catalogo.sem_acento(new.conteudo)), 'D');
  return new;
end
$$;

-- backfill (texto cru; a API reescreve com o texto expandido): dispara o gatilho e recalcula o documento
update catalogo.produto_busca b
   set aplicacao = c.aplicacoes
  from catalogo.produto_conteudo c
 where c.tenant_id = b.tenant_id
   and c.produto_id = b.produto_id
   and c.deleted_at is null
   and c.aplicacoes is not null
   and btrim(c.aplicacoes) <> '';

-- =============================================================================================
-- catalogo.produto_referencia — referência cruzada (RN-CAT-09)
-- =============================================================================================
create table catalogo.produto_referencia (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references plataforma.tenant (id),
  produto_id       uuid not null,
  marca_id         uuid not null,
  codigo           text not null,
  codigo_compacto  text not null,
  ordem            smallint not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  external_id      text,
  constraint produto_referencia_codigo_preenchido check (btrim(codigo) <> '' and char_length(codigo) <= 30),
  constraint produto_referencia_codigo_compacto_formato check (codigo_compacto ~ '^[a-z0-9]{1,30}$'),
  constraint produto_referencia_ordem_faixa check (ordem between 1 and 3)
);
-- até 3 vivas por produto (ordem 1..3 única entre as vivas); também atende a leitura por produto (ficha, textos_produto@1)
create unique index produto_referencia_ordem_uk on catalogo.produto_referencia (tenant_id, produto_id, ordem) where deleted_at is null;
-- a mesma marca não repete o código no produto, nem com outra grafia ("CB 3401" x "cb-3401")
create unique index produto_referencia_codigo_uk on catalogo.produto_referencia (tenant_id, produto_id, marca_id, codigo_compacto) where deleted_at is null;
-- busca pelo código do concorrente: igualdade e prefixo (text_pattern_ops) sobre a forma normalizada
create index produto_referencia_codigo_compacto_ix on catalogo.produto_referencia (tenant_id, codigo_compacto text_pattern_ops) where deleted_at is null;
create index produto_referencia_sync_ix on catalogo.produto_referencia (tenant_id, updated_at, id);
create unique index produto_referencia_external_uk on catalogo.produto_referencia (tenant_id, external_id) where external_id is not null and deleted_at is null;
create trigger produto_referencia_updated_at before update on catalogo.produto_referencia
  for each row execute function plataforma.definir_updated_at();
alter table catalogo.produto_referencia enable row level security;
alter table catalogo.produto_referencia force row level security;
create policy isolamento_tenant on catalogo.produto_referencia for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
create policy manutencao on catalogo.produto_referencia for all to macuxi_manutencao using (true) with check (true);
grant select, insert, update, delete on catalogo.produto_referencia to macuxi_app;

-- =============================================================================================
-- vendedor.pedido_item — retrato da aplicação no item (RN-VEN-19)
-- =============================================================================================
alter table vendedor.pedido_item add column aplicacao text;
alter table vendedor.pedido_item add constraint pedido_item_aplicacao_tamanho check (aplicacao is null or char_length(aplicacao) <= 1000);
