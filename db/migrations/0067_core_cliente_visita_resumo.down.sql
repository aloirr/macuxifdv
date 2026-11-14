-- 0067_core_cliente_visita_resumo (down) — desfaz a 0067 (Oficial, resumo de visitas por cliente) e volta ao catálogo da 0066.
-- Apaga a view core.v_cliente_visita_resumo e os 2 índices de core.visita; nenhum dado se perde (as visitas ficam). Volte antes
-- o Core que lê a view (senão 42P01). Idempotente. Pré-condição: 0068+ desfeitas.

drop view if exists core.v_cliente_visita_resumo;
drop index if exists core.visita_cliente_sync_ix;
drop index if exists core.visita_cliente_resumo_ix;
