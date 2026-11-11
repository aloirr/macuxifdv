-- 0059_core_filial_dados_fiscais (down) — desfaz a 0059 (T-0159) e volta à core.filial da 0056.
-- APAGA as colunas cnpj, logradouro, numero, complemento, bairro, cep e telefone de core.filial (os dados fiscais das filiais
-- se perdem: reaplicar a 0059 volta as colunas VAZIAS; a seed da demo e a próxima carga do ERP preenchem de novo). O retrato
-- da filial já gravado nos pedidos (vendedor.pedido.filial, jsonb) FICA com os campos: é retrato.
-- Volte antes o Core (BKO e core.filiais@1), o Hub (carga de filial) e o pull que leem/gravam as colunas (senão 42703).
-- Idempotente (if exists em tudo). Pré-condição: 0060+ desfeitas.

drop index if exists core.filial_cnpj_uk;
alter table core.filial drop constraint if exists filial_cnpj_formato;
alter table core.filial drop constraint if exists filial_logradouro_tamanho;
alter table core.filial drop constraint if exists filial_numero_tamanho;
alter table core.filial drop constraint if exists filial_complemento_tamanho;
alter table core.filial drop constraint if exists filial_bairro_tamanho;
alter table core.filial drop constraint if exists filial_cep_formato;
alter table core.filial drop constraint if exists filial_telefone_tamanho;
alter table core.filial drop column if exists cnpj;
alter table core.filial drop column if exists logradouro;
alter table core.filial drop column if exists numero;
alter table core.filial drop column if exists complemento;
alter table core.filial drop column if exists bairro;
alter table core.filial drop column if exists cep;
alter table core.filial drop column if exists telefone;
