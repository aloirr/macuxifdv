-- 0066_core_meta_produtividade (down) — desfaz a 0066 (T-0170) e volta ao catálogo da 0065.
-- APAGA core.meta_produtividade (as metas de produtividade do BKO: volta a valer o padrão do FDV), core.deslocamento_dia (os
-- resumos de km; o rastreamento os recalcula dos pontos enquanto eles existirem) e, em core.meta, as metas com indicador
-- 'itens_por_pedido' (DELETE físico: o CHECK da 0006 não as aceita; reaplicar a 0066 NÃO as devolve — exporte antes se
-- precisar). Volta o CHECK meta_indicador_valido aos 4 indicadores da 0006.
-- Volte antes o Core que lê ou grava as tabelas e o indicador novo (senão 42P01/23514). Idempotente. Pré-condição: 0067+
-- desfeitas.

delete from core.meta where indicador = 'itens_por_pedido';
alter table core.meta drop constraint if exists meta_indicador_valido;
alter table core.meta add constraint meta_indicador_valido
  check (indicador in ('venda_cents', 'positivacao', 'cobertura_pct', 'visitas'));

drop table if exists core.deslocamento_dia;
drop table if exists core.meta_produtividade; -- leva junto os gatilhos meta_produtividade_updated_at e meta_produtividade_conferir_alvo
drop function if exists core.meta_produtividade_conferir_alvo();
