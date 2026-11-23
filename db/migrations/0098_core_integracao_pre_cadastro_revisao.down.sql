-- 0098_core_integracao_pre_cadastro_revisao (down) — desfaz a 0098 (v1.0.29, ADR 0069) e volta exatamente ao catálogo e às ACLs
-- da 0097. APAGA core.cliente_pre_cadastro_tentativa (o histórico das revisões, os hashes e os erros por campo se perdem; o drop
-- leva índices, gatilho, políticas e grants), core.cliente.revisao_cadastro e erros_recusa e integracao.cliente_fila_erp.revisao,
-- hash e erros (com os CHECKs e os SELECT por coluna do macuxi_leitura). Os parâmetros ficam como a 0098 deixou
-- (cliente.campos_obrigatorios unificado e o espelho cliente.pre_cadastro.obrigatorios): são válidos para o código da v1.0.28.
-- APAGA também o Código FDV do cliente (ADR 0069 item 10): os 2 gatilhos de core.cliente e a função deles, o contador (leva os
-- gatilhos dele) e as funções do "nunca diminui" e do piso, o índice, os CHECKs e a coluna (leva o SELECT do macuxi_leitura). PERDE
-- os códigos emitidos: reaplicar a 0098 renumera os pré-cadastros vivos por created_at, id. Idempotente.
-- Pré-condição: o código do Core e do Hub sem ler ou gravar a tabela ou as colunas novas (senão 42P01/42703).

-- 5. Código FDV do cliente
drop trigger if exists cliente_codigo_fdv_emitir on core.cliente;
drop trigger if exists cliente_codigo_fdv_somente_leitura on core.cliente;
drop function if exists core.cliente_codigo_fdv();
drop table if exists core.cliente_codigo_fdv_contador; -- leva os gatilhos _updated_at, _nao_diminui e _piso
drop function if exists core.cliente_codigo_fdv_contador_nao_diminui();
drop function if exists core.cliente_codigo_fdv_contador_piso();
drop index if exists core.cliente_codigo_fdv_uk;
alter table core.cliente drop constraint if exists cliente_codigo_fdv_origem;
alter table core.cliente drop constraint if exists cliente_codigo_fdv_formato;
alter table core.cliente drop column if exists codigo_fdv;

-- 3. integracao.cliente_fila_erp
alter table integracao.cliente_fila_erp drop constraint if exists cliente_fila_erp_erros_estado;
alter table integracao.cliente_fila_erp drop constraint if exists cliente_fila_erp_erros_lista;
alter table integracao.cliente_fila_erp drop column if exists erros;
alter table integracao.cliente_fila_erp drop constraint if exists cliente_fila_erp_hash_formato;
alter table integracao.cliente_fila_erp drop column if exists hash;
alter table integracao.cliente_fila_erp drop constraint if exists cliente_fila_erp_revisao_valida;
alter table integracao.cliente_fila_erp drop column if exists revisao;

-- 2. core.cliente_pre_cadastro_tentativa
drop table if exists core.cliente_pre_cadastro_tentativa;

-- 1. core.cliente
alter table core.cliente drop constraint if exists cliente_erros_recusa_status;
alter table core.cliente drop constraint if exists cliente_erros_recusa_lista;
alter table core.cliente drop column if exists erros_recusa;
alter table core.cliente drop constraint if exists cliente_revisao_cadastro_valida;
alter table core.cliente drop column if exists revisao_cadastro;
