-- 0107_plataforma_perfis_sem_base_conferencia_espelho (down) — volta ao catálogo da 0106: apaga os 4 gatilhos de espelho e as
-- funções desta migração. As concessões, os achados e catalogo_aplicado ficam como estão (o down da 0106 é quem os desfaz).
-- Tenant criado depois da 0107 já nasceu 'concessao' e continua assim até o down da 0106.
drop trigger if exists tenant_semear_perfis_concessao on plataforma.tenant;
drop function if exists plataforma.tenant_semear_concessoes();
drop trigger if exists parametro_espelho on plataforma.parametro;
drop function if exists plataforma.parametro_espelho();
drop trigger if exists perfil_espelho on plataforma.perfil;
drop function if exists plataforma.perfil_espelho();
drop trigger if exists perfil_permissao_espelho on plataforma.perfil_permissao;
drop function if exists plataforma.perfil_permissao_espelho();
drop function if exists plataforma.espelhar_perfil(uuid);
drop function if exists plataforma.conferir_perfis_sem_base(uuid);
