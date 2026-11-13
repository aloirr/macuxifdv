-- 0064_core_tarefa (down) — desfaz a 0064 (T-0170) e volta ao catálogo da 0063.
-- APAGA core.tarefa_destinatario (destinatários e conclusões) e core.tarefa (as tarefas cadastradas no BKO), o gatilho
-- tarefa_tocar_destinatarios e a coluna core.notificacao.tarefa_id (com o CHECK, a FK e o único): os avisos de tarefa já
-- gravados FICAM (tipo 'sistema', subtipo 'tarefa'), só perdem o vínculo. As fotos das conclusões (plataforma.arquivo,
-- finalidade 'tarefa') e os bytes FICAM: apague-os antes se não puderem ficar órfãos.
-- Volte antes o Core que lê ou grava as tabelas e a coluna (senão 42P01/42703). Idempotente. Pré-condição: 0065+ desfeitas.

drop index if exists core.notificacao_tarefa_uk;
alter table core.notificacao drop constraint if exists notificacao_tarefa_subtipo;
alter table core.notificacao drop constraint if exists notificacao_tarefa_fk;
alter table core.notificacao drop column if exists tarefa_id;

drop table if exists core.tarefa_destinatario;
drop table if exists core.tarefa; -- leva junto os gatilhos tarefa_updated_at e tarefa_tocar_destinatarios
drop function if exists core.tocar_destinatarios_tarefa();
