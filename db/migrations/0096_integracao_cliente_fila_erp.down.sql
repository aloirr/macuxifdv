-- 0096_integracao_cliente_fila_erp (down) — desfaz a 0096 (v1.0.27, RF-CORE-10) e volta exatamente ao catálogo e às ACLs da
-- 0095. APAGA integracao.cliente_fila_erp com tudo o que tiver (o drop leva índices, gatilho, políticas e grants). Idempotente.
-- Pré-condição: o código do Hub sem ler ou gravar a tabela (senão 42P01).

drop table if exists integracao.cliente_fila_erp;
