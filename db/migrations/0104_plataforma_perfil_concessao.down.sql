-- 0104_plataforma_perfil_concessao (down) — volta ao catálogo da 0102: apaga as 4 tabelas da 0104 (com as políticas, os índices
-- e os gatilhos delas) e as funções novas. O migrador desce antes a 0106 e a 0105. Nada das tabelas de hoje muda: perfil,
-- perfil_permissao, usuario_perfil e core.usuario.perfil ficaram intocados na 0104.
-- Perda documentada: as concessões e os conflitos somem; o efeito de cada perfil volta pelas sobreposições, que o down da 0105
-- recalcula para os perfis mudados depois da migração.
drop table if exists plataforma.perfil_migracao_conflito;
drop function if exists plataforma.leitura_de_perfis(uuid);
drop table if exists plataforma.catalogo_aplicado;
drop table if exists plataforma.perfil_concessao;
drop function if exists plataforma.perfil_concessao_travas();
drop table if exists plataforma.modelo_permissao;
drop function if exists plataforma.trava_da_chave_do_cargo(text, text, text);
drop function if exists plataforma.teto_escopo_do_cargo(text);
