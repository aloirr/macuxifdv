-- 0002_core (down) — T-0002
-- Remove o schema core inteiro. APAGA OS DADOS do Core (usuários, equipes, produtos, clientes, carteira).
-- Antes, solta a FK que a 0002 criou em plataforma.usuario_modulo (a 0001 continua de pé).
alter table if exists plataforma.usuario_modulo drop constraint if exists usuario_modulo_usuario_fk;
drop schema if exists core cascade;
