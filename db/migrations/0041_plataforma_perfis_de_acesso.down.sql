-- 0041_plataforma_perfis_de_acesso (down) — desfaz a 0041 (T-0111/T-0112, ADR 0033) e volta exatamente ao catálogo da 0040.
-- APAGA os perfis do tenant (os de fábrica e os personalizados), as sobreposições e o multiperfil: o perfil do usuário volta a
-- ser só core.usuario.perfil (o principal, que a 0041 manteve). Linhas de plataforma.perfil_modulo de perfis personalizados
-- (código fora dos 7 perfis) são APAGADAS antes de o CHECK perfil_modulo_perfil_valido voltar. Nenhuma função da 0039/0040 é
-- tocada. Desfaça junto o código do Core e da API que lê/grava as tabelas novas.

-- perfil_modulo volta ao CHECK dos 7 perfis (texto da 0001); idempotente (rodar 2× não falha)
alter table plataforma.perfil_modulo drop constraint if exists perfil_modulo_perfil_fk;
delete from plataforma.perfil_modulo
 where perfil not in ('admin', 'analista', 'assistente', 'supervisor', 'gerente', 'vendedor', 'promotor');
alter table plataforma.perfil_modulo drop constraint if exists perfil_modulo_perfil_valido;
alter table plataforma.perfil_modulo add constraint perfil_modulo_perfil_valido
  check (perfil in ('admin', 'analista', 'assistente', 'supervisor', 'gerente', 'vendedor', 'promotor'));

-- gatilhos fora das tabelas novas
drop trigger if exists usuario_conferir_acesso on core.usuario;
drop trigger if exists usuario_perfil_principal on core.usuario;
drop trigger if exists tenant_semear_perfis on plataforma.tenant;

-- tabelas (os gatilhos delas saem junto)
drop table if exists plataforma.usuario_perfil;
drop table if exists plataforma.perfil_permissao;
drop table if exists plataforma.perfil;

-- funções
drop function if exists plataforma.perfis_do_usuario(uuid);
drop function if exists plataforma.perfil_permissao_conferir();
drop function if exists plataforma.perfil_conferir();
drop function if exists plataforma.usuario_perfil_conferir();
drop function if exists plataforma.usuario_conferir_acesso();
drop function if exists plataforma.conferir_ultimo_admin(uuid);
drop function if exists plataforma.conferir_perfis_do_usuario(uuid, uuid);
drop function if exists plataforma.tenant_tem_admin_com_gestao(uuid);
drop function if exists plataforma.usuario_admin_com_gestao(uuid, uuid);
drop function if exists plataforma.perfil_permissao_travas();
drop function if exists plataforma.perfil_imutavel();
drop function if exists plataforma.garantir_perfil_principal();
drop function if exists plataforma.semear_tenant_perfis();
drop function if exists plataforma.semear_perfis_fabrica(uuid);
