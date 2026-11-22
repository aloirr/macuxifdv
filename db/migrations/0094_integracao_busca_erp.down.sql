-- 0094_integracao_busca_erp (down) — volta da 0094 (integração por ERP, F2) ao catálogo da 0093. APAGA as 5 tabelas com tudo o
-- que tiverem — configuração da busca na API, credenciais do ERP cifradas (o cliente redigita depois de um novo up), estado do
-- assistente, marcos e retratos do painel dos 30 dias e o histórico das coletas — e as 2 funções dos CHECKs. Políticas,
-- gatilhos, índices e grants saem com as tabelas. Idempotente. Volte antes o código da API e do worker que lê ou grava essas
-- tabelas (senão 42P01).

drop table if exists integracao.coleta_execucao;
drop table if exists integracao.implantacao_dia;
drop table if exists integracao.implantacao;
drop table if exists integracao.credencial_erp;
drop table if exists integracao.conector_api;
drop function if exists integracao.parametros_sem_segredo(jsonb);
drop function if exists integracao.frequencias_validas(jsonb);
