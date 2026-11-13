-- 0062_core_catalogo_erp_ordem (down) — desfaz a 0062 (T-0095) e volta ao catálogo da 0061.
-- Apaga os 5 índices, os 15 gatilhos, as 2 funções e as 11 colunas. Perde só as marcas de ordem e de desligamento: a próxima
-- carga do ERP aplica tudo de novo, e uma filial ou tabela de preço desligada no BKO pode voltar ativa. As colunas da seção
-- T-0095 da 0039 (cliente, usuario e produto) ficam. Volte antes o código dos consumidores e do BKO que lê ou grava as colunas
-- (senão 42703). Idempotente. Pré-condição: 0063+ desfeitas.

drop index if exists catalogo.cliente_tabela_preco_erp_versao_ix;
drop index if exists catalogo.estoque_saldo_erp_versao_ix;
drop index if exists catalogo.tabela_preco_item_erp_versao_ix;
drop index if exists core.nota_erp_erp_versao_ix;
drop index if exists core.titulo_erp_versao_ix;

drop trigger if exists tabela_preco_desligado_no_bko on catalogo.tabela_preco;
drop trigger if exists filial_desligado_no_bko on core.filial;
drop trigger if exists usuario_desligado_no_bko on core.usuario;

drop trigger if exists cliente_tabela_preco_versao_erp on catalogo.cliente_tabela_preco;
drop trigger if exists estoque_saldo_versao_erp on catalogo.estoque_saldo;
drop trigger if exists tabela_preco_item_versao_erp on catalogo.tabela_preco_item;
drop trigger if exists filial_versao_erp on core.filial;
drop trigger if exists rota_versao_erp on core.rota;
drop trigger if exists nota_erp_versao_erp on core.nota_erp;
drop trigger if exists titulo_versao_erp on core.titulo;
drop trigger if exists produto_unidade_versao_erp on core.produto_unidade;
drop trigger if exists cliente_endereco_versao_erp on core.cliente_endereco;
drop trigger if exists produto_versao_erp on core.produto;
drop trigger if exists usuario_versao_erp on core.usuario;
drop trigger if exists cliente_versao_erp on core.cliente;

drop function if exists plataforma.manter_desligado_no_bko();
drop function if exists plataforma.manter_versao_erp();

alter table catalogo.tabela_preco drop column if exists desligado_no_bko_em;
alter table catalogo.cliente_tabela_preco drop column if exists erp_alterado_em;
alter table catalogo.estoque_saldo drop column if exists erp_alterado_em;
alter table catalogo.tabela_preco_item drop column if exists erp_alterado_em;
alter table core.filial drop column if exists desligado_no_bko_em;
alter table core.filial drop column if exists erp_alterado_em;
alter table core.rota drop column if exists erp_alterado_em;
alter table core.nota_erp drop column if exists erp_alterado_em;
alter table core.titulo drop column if exists erp_alterado_em;
alter table core.produto_unidade drop column if exists erp_alterado_em;
alter table core.cliente_endereco drop column if exists erp_alterado_em;
