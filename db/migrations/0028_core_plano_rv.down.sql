-- 0028_core_plano_rv (down) — T-0082
-- Desfaz a 0028. APAGA core.plano_rv com todos os planos de RV gravados pelo BKO (o domain e a API do Core passam a ver
-- a tabela ausente: GET /v1/core/plano-rv e /v1/core/rv sem plano). Índices, gatilho, política e grants caem com a
-- tabela. Nada mais muda. Idempotente (if exists).
-- Pré-condição: 0029+ desfeitas.

drop table if exists core.plano_rv;
