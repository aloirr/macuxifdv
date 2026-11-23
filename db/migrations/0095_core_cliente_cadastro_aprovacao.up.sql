-- 0095_core_cliente_cadastro_aprovacao (up) — v1.0.27 (decisão do dono R-20261122-084146-alexandre, item d; RF-CORE-10):
-- cliente de pré-cadastro (campo ou BKO) aprovado no BKO vai ao ERP pelo Hub, que devolve o external_id. Migração em cima da
-- 0094 (integracao_busca_erp); o número segue a ordem de merge (provisório até o gerente confirmar). Dicionário:
-- docs/banco/core.md ("0095"). Teste: db/testes/cliente-cadastro-aprovacao.db.test.ts (estático sempre; banco e up/down com o
-- Postgres local).
--
-- core.cliente (dono: Core):
--   origem_cadastro text not null default 'erp'   'erp' | 'campo' | 'bko' (cliente_origem_cadastro_valida). Quem já existe é
--                                                 do ERP (ou da carga, que espelha o ERP): o default preenche sem UPDATE
--                                                 (PG 11+, sem reescrever a tabela e sem andar o updated_at).
--   status_cadastro text                          'pendente' | 'aprovado' | 'recusado' (cliente_status_cadastro_valido);
--                                                 nulo se e só se origem_cadastro = 'erp' (cliente_status_cadastro_origem).
--   aprovado_em timestamptz                       quando o BKO aprovou (UTC); aprovado_por uuid = core.usuario.id de quem
--   aprovado_por uuid                             aprovou (sem FK: como core.notificacao.recado_do_dia_por, 0021). Os dois
--                                                 juntos (cliente_aprovacao_par) e só com status 'aprovado'
--                                                 (cliente_aprovacao_status).
-- Índice parcial cliente_aprovado_sem_erp_ix (tenant_id, aprovado_em, id) where external_id is null and aprovado_em is not null
-- and deleted_at is null: fila do Hub (aprovados ainda sem código do ERP), em ordem de aprovação e paginada por (aprovado_em, id).
-- Unicidade do external_id por tenant entre os vivos: JÁ EXISTE (cliente_external_uk, 0002) — nada novo aqui.
--
-- RLS: as políticas de core.cliente (isolamento_tenant e afins) e os grants do macuxi_app valem para as colunas novas; nenhuma
-- política nova. macuxi_leitura (0078/0093: SELECT por coluna em core.cliente): recebe SELECT nas 4 colunas novas (nenhuma
-- sensível pela regra da 0078). Fora do pull do aparelho (o app não lê; o pré-cadastro chega pela API).
--
-- Volume: core.cliente (milhares a dezenas de milhares por tenant); a fila de aprovados sem external_id é pequena (dezenas).
--
-- Caminho de volta: 0095_core_cliente_cadastro_aprovacao.down.sql (APAGA o índice, os CHECKs e as 4 colunas; perde a origem,
-- o status e a aprovação dos pré-cadastros — os clientes ficam). Volte antes o código do Core e do Hub que lê ou grava as
-- colunas (senão 42703).

alter table core.cliente add column origem_cadastro text not null default 'erp';
alter table core.cliente add column status_cadastro text;
alter table core.cliente add column aprovado_em timestamptz;
alter table core.cliente add column aprovado_por uuid;

alter table core.cliente add constraint cliente_origem_cadastro_valida
  check (origem_cadastro in ('erp', 'campo', 'bko'));
alter table core.cliente add constraint cliente_status_cadastro_valido
  check (status_cadastro is null or status_cadastro in ('pendente', 'aprovado', 'recusado'));
alter table core.cliente add constraint cliente_status_cadastro_origem
  check ((origem_cadastro = 'erp') = (status_cadastro is null));
alter table core.cliente add constraint cliente_aprovacao_par
  check ((aprovado_em is null) = (aprovado_por is null));
alter table core.cliente add constraint cliente_aprovacao_status
  check (aprovado_em is null or status_cadastro = 'aprovado');

create index cliente_aprovado_sem_erp_ix on core.cliente (tenant_id, aprovado_em, id)
  where external_id is null and aprovado_em is not null and deleted_at is null;

grant select (origem_cadastro, status_cadastro, aprovado_em, aprovado_por) on core.cliente to macuxi_leitura;
