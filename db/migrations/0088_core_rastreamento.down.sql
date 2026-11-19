-- 0088_core_rastreamento (down) — volta da 0088 (T-0156). APAGA as 5 tabelas do rastreamento com tudo o que tiverem (pontos,
-- pausas, ausências, termos e aceites), a função de expurgo e o índice do expurgo em core.deslocamento_dia. Os resumos de
-- core.deslocamento_dia (0066) ficam. Idempotente. Volte antes o código do Core e do worker que lê, grava ou chama a função.

drop function if exists core.expurgar_rastreamento(timestamptz, integer);
revoke usage on schema core from macuxi_worker;
drop index if exists core.deslocamento_dia_expurgo_ix;
drop table if exists core.aceite_termo_rastreamento;
drop table if exists core.termo_rastreamento;
drop table if exists core.ausencia_usuario;
drop table if exists core.pausa_trajeto;
drop table if exists core.ponto_trajeto;
