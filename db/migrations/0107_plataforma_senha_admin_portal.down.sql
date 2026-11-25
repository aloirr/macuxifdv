-- 0107_plataforma_senha_admin_portal (down) — volta ao catálogo da migração anterior: apaga as 3 funções da troca da senha do
-- admin do cliente pelo portal. Nada de dado se perde: a senha trocada fica em core.usuario.senha_hash e as linhas
-- 'usuario.senha_trocar', 'sa.reautenticar', 'sa.bloqueio' e 'sa.senha.trocada' da auditoria ficam (append-only). Antes do
-- down, volte a API ao 403 TROCA_SO_SUPER_ADMIN para o admin do cliente (sem as funções a rota responde 503).

drop function if exists plataforma.sa_gravar_senha_admin(uuid, text, text);
drop function if exists plataforma.sa_falha_senha_admin(uuid);
drop function if exists plataforma.sa_reautenticar_admin(uuid);
