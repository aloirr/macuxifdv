-- 0027_plataforma_tenants_ativos (down) — T-0039
-- Desfaz a 0027. APAGA a função plataforma.tenants_ativos(); nenhuma tabela muda. O worker passa a ver
-- to_regprocedure('plataforma.tenants_ativos()') nulo e deixa o agendador das tarefas periódicas desligado (warn no log);
-- o despachante da outbox segue normal. Idempotente (if exists).
-- Pré-condição: 0028+ desfeitas.

drop function if exists plataforma.tenants_ativos();
