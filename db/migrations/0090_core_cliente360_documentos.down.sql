-- 0090_core_cliente360_documentos (down) — volta da 0090 (T-0186). APAGA core.documento_excecao, core.documento_permissao,
-- core.documento_cliente e core.documento_tipo com os dados (os metadados em plataforma.arquivo e os bytes no armazenamento
-- ficam) e as colunas novas de core.nota_erp (forma_pagamento, nf_origem_numero, nf_origem_serie) e core.titulo
-- (forma_pagamento, nf_numero, nf_serie), com os índices e CHECKs (drop column leva os que dependem da coluna). A forma de
-- pagamento e o vínculo NF/devolução voltam na próxima carga do ERP. Idempotente. Volte antes o código do Core e da Integração
-- que lê ou grava.

drop table if exists core.documento_excecao;
drop table if exists core.documento_permissao;
drop table if exists core.documento_cliente;
drop table if exists core.documento_tipo; -- leva junto índices, gatilho, políticas (inclusive a leitura) e grants

drop index if exists core.titulo_nf_ix;
alter table core.titulo drop constraint if exists titulo_nf_serie_com_numero;
alter table core.titulo drop constraint if exists titulo_nf_tamanho;
alter table core.titulo drop constraint if exists titulo_forma_pagamento_tamanho;
alter table core.titulo drop column if exists nf_serie;
alter table core.titulo drop column if exists nf_numero;
alter table core.titulo drop column if exists forma_pagamento;

drop index if exists core.nota_erp_nf_origem_ix;
drop index if exists core.nota_erp_cliente_emitida_ix;
alter table core.nota_erp drop constraint if exists nota_erp_nf_origem_serie_com_numero;
alter table core.nota_erp drop constraint if exists nota_erp_nf_origem_so_devolucao;
alter table core.nota_erp drop constraint if exists nota_erp_nf_origem_tamanho;
alter table core.nota_erp drop constraint if exists nota_erp_forma_pagamento_tamanho;
alter table core.nota_erp drop column if exists nf_origem_serie;
alter table core.nota_erp drop column if exists nf_origem_numero;
alter table core.nota_erp drop column if exists forma_pagamento;
