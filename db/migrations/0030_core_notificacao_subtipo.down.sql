-- 0030_core_notificacao_subtipo (down) — T-0039
-- Desfaz a 0030: APAGA core.notificacao.subtipo e o CHECK notificacao_subtipo_formato. As notificações ficam intactas
-- (título, corpo, link, envio_id); o Gestão volta a reconhecer o alerta de etapa pendente pelo título (fallback) e o Core
-- anterior não grava a coluna. O updated_at avançado pelo backfill do up não volta (sem efeito: o pull só reenvia a linha).
-- Idempotente (if exists em tudo). Pré-condição: 0031+ desfeitas.

alter table core.notificacao drop constraint if exists notificacao_subtipo_formato;
alter table core.notificacao drop column if exists subtipo;
