-- 0029_plataforma_provisionar_tenant (down) — T-0083
-- Desfaz a 0029. APAGA a função plataforma.provisionar_tenant(jsonb); o comando `pnpm tenant:criar` passa a falhar com
-- 42883 (função inexistente). Tenants, licenças, perfis, admins e auditoria já gravados por ela FICAM (são dados do
-- tenant; a exclusão é o roteiro de docs/banco/lgpd.md). Nenhuma tabela muda. Idempotente (if exists).
-- Pré-condição: 0030+ desfeitas.

drop function if exists plataforma.provisionar_tenant(jsonb);
