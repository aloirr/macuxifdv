-- 0088_vendedor_pedido_aprovacao (up) — T-0184 (P-6, v1.0.15): pedido em aprovação por motivo (crédito, inadimplência e
-- desconto). Desenho docs/desenho/T-0184.md §2, §6 item 2 e §7.3; decisões P1 a P8 do dono do produto. Migração em cima da
-- 0087 (o número segue a ordem de merge). Dicionário: docs/banco/vendedor.md ("0088"). Teste:
-- db/testes/pedido-aprovacao.db.test.ts (estático sempre; banco, backfill e up/down com o Postgres local).
--
-- 1. Tabela nova vendedor.pedido_aprovacao (dono: Vendedor) — uma aprovação por motivo e por ciclo do pedido:
--      pedido_id        uuid not null          FK composta (tenant_id, pedido_id) -> vendedor.pedido (tenant_id, id)
--      ciclo            integer not null 1     >= 1; cresce a cada reenvio depois de uma devolução (= pedido.aprovacao_ciclo)
--      motivo           text not null          desconto | credito | inadimplencia | estoque | preco_minimo (MOTIVOS_APROVACAO)
--      nivel            text not null          supervisor | gerente | analista (NIVEIS_APROVACAO): quem decide esta aprovação
--      estado           text not null pendente pendente | aprovada | rejeitada | devolvida | encerrada
--      texto_pendencia  text not null ''       o porquê da pendência, para o aprovador (ex.: crédito disponível e total)
--      decidida_por     uuid null              usuário do Core que decidiu (sem FK entre schemas; a API valida)
--      decidida_em      timestamptz null       nula se, e só se, pendente (pedido_aprovacao_decisao_coerente)
--      texto_decisao    text null              até 500 caracteres (o comentário do aprovador; RN-GES-08 na API)
--    + os campos comuns. Únicos: pedido_aprovacao_tenant_id_uk (tenant_id, id) e pedido_aprovacao_ciclo_uk (tenant_id,
--    pedido_id, ciclo, motivo) — NÃO parcial: a aprovação é histórico, nunca se repete no mesmo ciclo. external_uk parcial
--    (padrão). Índice da fila do aprovador pedido_aprovacao_fila_ix (tenant_id, nivel) where estado = 'pendente' and
--    deleted_at is null; o (tenant_id, pedido_id, ...) do único serve às aprovações de um pedido e à FK.
--    FORA DO SYNC (TABELAS_FORA_DO_SYNC): o app recebe as aprovações no detalhe do pedido pela API; o pull não muda (§7.3).
--    RLS ligado e FORÇADO: isolamento_tenant ao macuxi_app e manutencao (0031). macuxi_app: select, insert e update (a
--    decisão muda a linha; sem delete). macuxi_leitura (0078, ADR 0055): select e a política leitura (sem coluna sensível).
--    Volume: 0 a 5 linhas por pedido que vai para aprovação, uma por motivo e por ciclo; na ordem dos pedidos do tenant.
-- 2. vendedor.pedido:
--    - coluna aprovacao_ciclo integer not null default 1 (pedido_aprovacao_ciclo_positivo >= 1): o ciclo atual das aprovações.
--      O default preenche os pedidos que já existem sem disparar gatilho (o updated_at não anda; nada volta ao pull).
--      macuxi_leitura: a 0078 deu SELECT POR COLUNA em vendedor.pedido (hash_envio fica de fora); coluna nova não herda,
--      então recebe grant próprio.
--    - CHECK pedido_motivos_validos recriado com 'inadimplencia' (desenho §1: desconto, credito, inadimplencia, estoque,
--      preco_minimo). nivel_aprovacao segue como o maior nível pendente (pedido_pendente_com_nivel inalterado).
-- 3. Backfill (idempotente, on conflict do nothing): para cada pedido vivo em pending_approval, uma linha pendente no ciclo
--    1 por motivo de motivos_aprovacao (array vazio = 'desconto'), nivel = nivel_aprovacao e texto_pendencia ''. Só insere
--    em pedido_aprovacao: o updated_at do pedido não anda. id determinístico plataforma.uuid_de_chave('<tenant>:
--    vendedor.pedido_aprovacao:<pedido>:1:<motivo>') (gêmea: idAprovacaoDoBackfill em db/src/ids.ts): a fixture e a recarga
--    sobre um banco migrado com pedidos gravam a MESMA linha.
--
-- Caminho de volta: 0088_vendedor_pedido_aprovacao.down.sql (APAGA vendedor.pedido_aprovacao com as decisões por motivo e
-- a coluna aprovacao_ciclo; tira 'inadimplencia' de motivos_aprovacao antes de recriar o CHECK antigo — esses pedidos ficam
-- com os outros motivos). Volte antes o código do Vendedor e do Gestor que lê ou grava as aprovações (senão 42P01/42703).

-- =============================================================================================
-- vendedor.pedido: ciclo atual e o motivo inadimplencia
-- =============================================================================================
alter table vendedor.pedido add column aprovacao_ciclo integer not null default 1 constraint pedido_aprovacao_ciclo_positivo check (aprovacao_ciclo >= 1);
grant select (aprovacao_ciclo) on vendedor.pedido to macuxi_leitura;

alter table vendedor.pedido drop constraint pedido_motivos_validos;
alter table vendedor.pedido add constraint pedido_motivos_validos
  check (motivos_aprovacao <@ array['desconto', 'credito', 'inadimplencia', 'estoque', 'preco_minimo']::text[]);

-- =============================================================================================
-- vendedor.pedido_aprovacao — uma aprovação por motivo (desenho §2 e §7.3)
-- =============================================================================================
create table vendedor.pedido_aprovacao (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references plataforma.tenant (id),
  pedido_id        uuid not null,
  ciclo            integer not null default 1,
  motivo           text not null,
  nivel            text not null,
  estado           text not null default 'pendente',
  texto_pendencia  text not null default '',
  decidida_por     uuid,
  decidida_em      timestamptz,
  texto_decisao    text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  external_id      text,
  constraint pedido_aprovacao_tenant_id_uk unique (tenant_id, id),
  constraint pedido_aprovacao_ciclo_uk unique (tenant_id, pedido_id, ciclo, motivo),
  constraint pedido_aprovacao_pedido_fk foreign key (tenant_id, pedido_id) references vendedor.pedido (tenant_id, id),
  constraint pedido_aprovacao_ciclo_positivo check (ciclo >= 1),
  constraint pedido_aprovacao_motivo_valido check (motivo in ('desconto', 'credito', 'inadimplencia', 'estoque', 'preco_minimo')),
  constraint pedido_aprovacao_nivel_valido check (nivel in ('supervisor', 'gerente', 'analista')),
  constraint pedido_aprovacao_estado_valido check (estado in ('pendente', 'aprovada', 'rejeitada', 'devolvida', 'encerrada')),
  constraint pedido_aprovacao_texto_decisao_tamanho check (texto_decisao is null or char_length(texto_decisao) <= 500),
  constraint pedido_aprovacao_decisao_coerente check ((estado = 'pendente') = (decidida_em is null))
);
create index pedido_aprovacao_fila_ix on vendedor.pedido_aprovacao (tenant_id, nivel) where estado = 'pendente' and deleted_at is null;
create unique index pedido_aprovacao_external_uk on vendedor.pedido_aprovacao (tenant_id, external_id) where external_id is not null and deleted_at is null;
create trigger pedido_aprovacao_updated_at before update on vendedor.pedido_aprovacao
  for each row execute function plataforma.definir_updated_at();
alter table vendedor.pedido_aprovacao enable row level security;
alter table vendedor.pedido_aprovacao force row level security;
create policy isolamento_tenant on vendedor.pedido_aprovacao for all to macuxi_app
  using (tenant_id = plataforma.tenant_atual())
  with check (tenant_id = plataforma.tenant_atual());
create policy manutencao on vendedor.pedido_aprovacao for all to macuxi_manutencao using (true) with check (true);
grant select, insert, update on vendedor.pedido_aprovacao to macuxi_app;
-- consulta só leitura (0078, ADR 0055): sem coluna sensível, SELECT na tabela e a política leitura
grant select on vendedor.pedido_aprovacao to macuxi_leitura;
create policy leitura on vendedor.pedido_aprovacao for select to macuxi_leitura using (tenant_id = plataforma.tenant_atual());

-- =============================================================================================
-- Backfill: os pedidos que já estão em aprovação ganham uma linha pendente por motivo (ciclo 1)
-- =============================================================================================
insert into vendedor.pedido_aprovacao (id, tenant_id, pedido_id, ciclo, motivo, nivel, estado, texto_pendencia)
select plataforma.uuid_de_chave(p.tenant_id || ':vendedor.pedido_aprovacao:' || p.id || ':1:' || m.motivo),
       p.tenant_id, p.id, 1, m.motivo, p.nivel_aprovacao, 'pendente', ''
  from vendedor.pedido p
  cross join lateral unnest(case when cardinality(p.motivos_aprovacao) = 0 then array['desconto']::text[] else p.motivos_aprovacao end) as m (motivo)
 where p.status = 'pending_approval'
   and p.deleted_at is null
on conflict (tenant_id, pedido_id, ciclo, motivo) do nothing;
