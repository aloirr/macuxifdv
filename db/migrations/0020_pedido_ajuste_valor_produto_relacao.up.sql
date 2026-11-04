-- 0020_pedido_ajuste_valor_produto_relacao (up) — T-0071 (novo pedido em 3 abas e orçamento; desenho docs/desenho/T-0071.md
-- §5, §1.4 e §4.2; premissas de R$ e meta confirmadas em R-20261103-140707). Regras: RN-VEN-02 (desconto e acréscimo em % ou
-- em R$; arredondamento no preço unitário; ajuste do pedido sobre o total dos itens), RN-VEN-03 (desconto efetivo),
-- RN-VEN-18 (orçamento com validade), RF-CAT-03 (relacionados do produto). Dicionário: docs/banco/vendedor.md e catalogo.md.
-- Migração ADITIVA: nenhuma coluna existente muda, nenhum dado existente é reescrito (padrões constantes: sem reescrita).
--
-- Mudanças:
--   vendedor.pedido: desconto_valor_cents / acrescimo_valor_cents = o R$ do ajuste do PEDIDO, sobre o total dos itens
--     (digitado ou derivado do %); ajuste_em = o que o vendedor digitou ('pct' | 'valor'), para Editar e Duplicar reabrirem
--     no mesmo modo. desconto_pct/acrescimo_pct continuam com o % (digitado ou equivalente, 2 casas). CHECKs: R$ >= 0,
--     desconto e acréscimo em R$ excludentes, e sentido coerente entre % e R$ (desconto em % com acréscimo em R$, ou o
--     contrário, é recusado — "% e R$ juntos" em sentidos opostos). Pedido anterior à 0020 fica 0/0/'pct' (sem backfill;
--     quem lê usa Σ (preco_unitario × quantidade) − total). Índice parcial pedido_orcamento_aberto_ix (lista de
--     Orçamentos e janela do pull: tipo = 'orcamento', não convertido, vivo).
--   vendedor.pedido_item: desconto_unitario_cents / acrescimo_unitario_cents = R$ por unidade da MEDIDA VENDIDA (1 FD, 1 CX,
--     1 UN), sempre gravado (digitado, ou tabela − final no modo %); ajuste_em ('pct' | 'valor'). CHECKs: R$ >= 0,
--     excludentes, sentido coerente com o %, desconto em R$ <= preço de tabela (o preço final nunca fica negativo) e, quando
--     há R$ gravado, preco_unitario_cents = preco_tabela_cents − desconto_unitario_cents + acrescimo_unitario_cents
--     (o item legado, 0/0, fica fora dessa conta).
--   catalogo.produto_relacao (nova): relacionados do produto (RF-CAT-03) — complementar ("Combina com o pedido"), superior
--     ("Leve mais": versão superior) e substituto (ficha/ruptura). produto_id e relacionado_id SEM FK para core.produto
--     (fronteira entre schemas de módulo, ADR 0005/0012; como catalogo.produto_no.produto_id) — a API do Catálogo valida.
--     Único vivo (tenant_id, produto_id, relacionado_id, tipo), external_id único vivo, índice de sync, RLS forçado.
--     Pull escopo tenant (~5 linhas por produto). Origem hoje: base demo; depois Hub (ERP) e BKO do Catálogo.
-- Caminho de volta: 0020_pedido_ajuste_valor_produto_relacao.down.sql (APAGA catalogo.produto_relacao com os dados e as
-- colunas de ajuste em R$; os pedidos continuam com o % equivalente em desconto_pct/acrescimo_pct e com o preço final do
-- item em preco_unitario_cents, então totais, PDF e ERP não mudam — só se perde o modo digitado e o R$ exato).

-- =============================================================================================
-- vendedor.pedido — ajuste do pedido em R$ (RN-VEN-02)
-- =============================================================================================
alter table vendedor.pedido add column desconto_valor_cents bigint not null default 0;
alter table vendedor.pedido add column acrescimo_valor_cents bigint not null default 0;
alter table vendedor.pedido add column ajuste_em text not null default 'pct';
alter table vendedor.pedido add constraint pedido_ajuste_valor_nao_negativo check (desconto_valor_cents >= 0 and acrescimo_valor_cents >= 0);
alter table vendedor.pedido add constraint pedido_ajuste_valor_exclusivo check (desconto_valor_cents = 0 or acrescimo_valor_cents = 0);
alter table vendedor.pedido add constraint pedido_ajuste_sentido_coerente check ((desconto_valor_cents = 0 or acrescimo_pct = 0) and (acrescimo_valor_cents = 0 or desconto_pct = 0));
alter table vendedor.pedido add constraint pedido_ajuste_em_valido check (ajuste_em in ('pct', 'valor'));
-- Orçamentos abertos (RN-VEN-18; desenho T-0071 §1.4 b): lista por vendedor e validade, janela do pull
create index pedido_orcamento_aberto_ix on vendedor.pedido (tenant_id, vendedor_id, orcamento_validade) where tipo = 'orcamento' and convertido_em is null and deleted_at is null;

-- =============================================================================================
-- vendedor.pedido_item — ajuste do item em R$ por unidade da medida vendida (RN-VEN-02, RN-VEN-15)
-- =============================================================================================
alter table vendedor.pedido_item add column desconto_unitario_cents bigint not null default 0;
alter table vendedor.pedido_item add column acrescimo_unitario_cents bigint not null default 0;
alter table vendedor.pedido_item add column ajuste_em text not null default 'pct';
alter table vendedor.pedido_item add constraint pedido_item_ajuste_valor_nao_negativo check (desconto_unitario_cents >= 0 and acrescimo_unitario_cents >= 0);
alter table vendedor.pedido_item add constraint pedido_item_ajuste_valor_exclusivo check (desconto_unitario_cents = 0 or acrescimo_unitario_cents = 0);
alter table vendedor.pedido_item add constraint pedido_item_ajuste_sentido_coerente check ((desconto_unitario_cents = 0 or acrescimo_pct = 0) and (acrescimo_unitario_cents = 0 or desconto_pct = 0));
alter table vendedor.pedido_item add constraint pedido_item_desconto_unitario_ate_tabela check (desconto_unitario_cents <= preco_tabela_cents);
alter table vendedor.pedido_item add constraint pedido_item_ajuste_unitario_coerente check ((desconto_unitario_cents = 0 and acrescimo_unitario_cents = 0) or preco_unitario_cents = preco_tabela_cents - desconto_unitario_cents + acrescimo_unitario_cents);
alter table vendedor.pedido_item add constraint pedido_item_ajuste_em_valido check (ajuste_em in ('pct', 'valor'));

-- =============================================================================================
-- catalogo.produto_relacao — relacionados do produto (RF-CAT-03)
-- =============================================================================================
create table catalogo.produto_relacao (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references plataforma.tenant (id),
  produto_id      uuid not null,
  relacionado_id  uuid not null,
  tipo            text not null,
  ordem           integer not null default 0,
  ativo           boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  external_id     text,
  constraint produto_relacao_tipo_valido check (tipo in ('complementar', 'superior', 'substituto')),
  constraint produto_relacao_nao_e_de_si check (produto_id <> relacionado_id)
);
-- único vivo: também atende a consulta das sugestões (produto_id = any(...), tipo) dentro do tenant
create unique index produto_relacao_uk on catalogo.produto_relacao (tenant_id, produto_id, relacionado_id, tipo) where deleted_at is null;
create index produto_relacao_sync_ix on catalogo.produto_relacao (tenant_id, updated_at, id);
create unique index produto_relacao_external_uk on catalogo.produto_relacao (tenant_id, external_id) where external_id is not null and deleted_at is null;
create trigger produto_relacao_updated_at before update on catalogo.produto_relacao
  for each row execute function plataforma.definir_updated_at();
alter table catalogo.produto_relacao enable row level security;
alter table catalogo.produto_relacao force row level security;
create policy isolamento_tenant on catalogo.produto_relacao for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
grant select, insert, update, delete on catalogo.produto_relacao to macuxi_app;
