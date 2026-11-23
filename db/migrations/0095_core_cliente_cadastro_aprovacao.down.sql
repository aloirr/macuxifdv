-- 0095_core_cliente_cadastro_aprovacao (down) — desfaz a 0095 (v1.0.27, RF-CORE-10) e volta exatamente ao catálogo e às ACLs
-- da 0094. APAGA o índice, os 5 CHECKs e as 4 colunas: a origem, o status e a aprovação dos pré-cadastros (os clientes ficam;
-- os pré-cadastros passam a parecer do ERP). O drop column leva o SELECT por coluna do macuxi_leitura. Idempotente.
-- Pré-condição: o código do Core e do Hub sem ler ou gravar as colunas (senão 42703).

drop index if exists core.cliente_aprovado_sem_erp_ix;
alter table core.cliente drop constraint if exists cliente_aprovacao_status;
alter table core.cliente drop constraint if exists cliente_aprovacao_par;
alter table core.cliente drop constraint if exists cliente_status_cadastro_origem;
alter table core.cliente drop constraint if exists cliente_status_cadastro_valido;
alter table core.cliente drop constraint if exists cliente_origem_cadastro_valida;
alter table core.cliente drop column if exists aprovado_por;
alter table core.cliente drop column if exists aprovado_em;
alter table core.cliente drop column if exists status_cadastro;
alter table core.cliente drop column if exists origem_cadastro;
