-- 0049_plataforma_conferencias_no_commit_definer (down) — volta exatamente ao catálogo da 0048: as 4 funções dos gatilhos
-- adiáveis da 0041 voltam a SECURITY INVOKER (search_path e ACL não mudam). ATENÇÃO: o defeito R-20261108-130423-testes volta
-- junto (criar empresa com o admin pelo portal falha no COMMIT como macuxi_portal). Idempotente. Pré-condição: 0050+ desfeitas.

alter function plataforma.usuario_conferir_acesso() security invoker;
alter function plataforma.usuario_perfil_conferir() security invoker;
alter function plataforma.perfil_conferir() security invoker;
alter function plataforma.perfil_permissao_conferir() security invoker;
