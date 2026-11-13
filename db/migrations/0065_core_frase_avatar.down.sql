-- 0065_core_frase_avatar (down) — desfaz a 0065 (T-0170) e volta ao catálogo da 0064.
-- APAGA core.frase_dia (as 30 padrão e as frases criadas, editadas, desativadas ou reordenadas pelo tenant no BKO) e
-- core.usuario_avatar (todas as trocas: os usuários voltam às iniciais), o gatilho tenant_semear_frase_dia e as funções
-- core.semear_tenant_frase_dia() e core.semear_frase_dia(uuid). Reaplicar a 0065 recarrega só as 30 padrão (as edições do
-- tenant se perdem). Os metadados das fotos (plataforma.arquivo, finalidade 'avatar') e os bytes FICAM: apague-os antes se não
-- puderem ficar órfãos. Volte antes o Core que lê ou grava as tabelas (senão 42P01). Idempotente. Pré-condição: 0066+ desfeitas.

drop trigger if exists tenant_semear_frase_dia on plataforma.tenant;
drop function if exists core.semear_tenant_frase_dia();
drop function if exists core.semear_frase_dia(uuid);

drop table if exists core.usuario_avatar;
drop table if exists core.frase_dia;
