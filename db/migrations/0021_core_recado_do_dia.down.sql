-- 0021_core_recado_do_dia (down) — T-0073
-- Desfaz a 0021 na ordem inversa. APAGA a contagem core.indicador_diario.clientes_positivados (pedidos, vendido_cents e
-- cancelado_cents ficam; o Início sem o Vendedor volta a positivacao = null) e as marcações de recado do dia
-- (recado_do_dia e recado_do_dia_por); os recados em si (core.notificacao) ficam intactos e o Início volta a mostrar a
-- frase padrão inicio.recado_do_dia_padrao. Idempotente (if exists em tudo).
-- Pré-condição: 0022+ desfeitas.

alter table core.indicador_diario drop constraint if exists indicador_diario_clientes_positivados_nao_negativo;
alter table core.indicador_diario drop column if exists clientes_positivados;

drop index if exists core.notificacao_envio_ix;
drop index if exists core.notificacao_recado_do_dia_uk;
alter table core.notificacao drop constraint if exists notificacao_recado_do_dia_por_fk;
alter table core.notificacao drop constraint if exists notificacao_recado_do_dia_par;
alter table core.notificacao drop constraint if exists notificacao_recado_do_dia_so_recado;
alter table core.notificacao drop column if exists recado_do_dia_por;
alter table core.notificacao drop column if exists recado_do_dia;
