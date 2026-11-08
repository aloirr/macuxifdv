-- 0049_plataforma_conferencias_no_commit_definer (up) — T-0093/T-0094: defeito R-20261108-130423-testes (criar empresa com o
-- admin pelo portal = 500). Dicionário: docs/banco/plataforma.md ("0049 — conferências do COMMIT como dono") e docs/banco/rls.md.
-- Migração em cima da 0048 (nenhuma anterior muda de texto). Só ALTER FUNCTION: nenhuma tabela, política, gatilho ou grant novo.
--
-- Causa: as 4 funções dos gatilhos de restrição ADIÁVEIS da 0041 (usuario_conferir_acesso, usuario_perfil_conferir,
-- perfil_conferir e perfil_permissao_conferir, DEFERRABLE INITIALLY DEFERRED) eram SECURITY INVOKER. Gatilho adiado dispara no
-- COMMIT, FORA da função que fez a escrita: quando a escrita vem de uma sa_* (SECURITY DEFINER) chamada pelo macuxi_portal — a
-- sa_provisionar_tenant cria o admin em core.usuario —, a conferência roda como macuxi_portal, que não tem grant de tabela
-- (ADR 0029) nem política de RLS: "permission denied for table tenant" no COMMIT e 500 na API. Os testes do banco não pegaram
-- porque rodavam em transação desfeita (o COMMIT nunca chega); o caso novo commita (conferencias-no-commit.test.ts).
--
-- Correção (menor privilégio entre as 3 opções do pedido):
--   As 4 funções de gatilho passam a SECURITY DEFINER, com o search_path fixo que já tinham (pg_catalog, plataforma, pg_temp) e
--   sem EXECUTE para ninguém além do dono (o revoke de PUBLIC da 0041 continua; repetido abaixo). Rodam como o dono das funções
--   (o migrador: superusuário no Docker; no DBaaS o macuxi_admin, que herda o macuxi_manutencao e enxerga pela política
--   manutencao da 0031 — a mesma premissa das sa_* e de tenants_ativos, docs/banco/rls.md).
--   Por que é o menor privilégio:
--   - função que devolve `trigger` só é chamada pelo mecanismo de gatilho ("trigger functions can only be called as triggers"):
--     nenhum papel ganha uma função nova para chamar; a elevação vale só dentro da conferência;
--   - as 4 só LEEM (perfil, usuario_perfil, perfil_permissao, core.usuario e a existência do tenant) e só do tenant da linha
--     escrita (new/old.tenant_id), que quem escreveu já podia escrever; o resultado é "segue" ou 23514 com a restrição;
--   - nada muda para o macuxi_app (RLS e grants iguais; a conferência só passa a enxergar o tenant da linha mesmo fora do
--     contexto, o que é o comportamento certo) e o macuxi_portal continua sem nenhum grant de tabela.
--   Opções recusadas: (3) GRANT ao macuxi_portal exigiria SELECT e política de RLS em core.usuario (com senha_hash), perfil,
--   usuario_perfil, perfil_permissao e tenant de TODOS os tenants — com só o SELECT, sem política, a conferência veria 0 linhas e
--   passaria em silêncio (buraco pior que o 500); (2) `set constraints all immediate` no fim de cada sa_* que escreve exige
--   recriar a sa_provisionar_tenant (0039/0040) e a sa_redefinir_senha_admin (0047), e toda sa_* futura que tocar core.usuario
--   repetiria o defeito se esquecesse a linha.
--   As funções auxiliares (conferir_perfis_do_usuario, conferir_ultimo_admin, tenant_tem_admin_com_gestao,
--   usuario_admin_com_gestao) ficam SECURITY INVOKER como estão: chamadas de dentro das 4, rodam como o dono.
--
-- Caminho de volta: 0049_plataforma_conferencias_no_commit_definer.down.sql (as 4 voltam a SECURITY INVOKER = catálogo da 0048;
-- o defeito do portal volta junto).

alter function plataforma.usuario_conferir_acesso() security definer;
alter function plataforma.usuario_perfil_conferir() security definer;
alter function plataforma.perfil_conferir() security definer;
alter function plataforma.perfil_permissao_conferir() security definer;

revoke all on function plataforma.usuario_conferir_acesso() from public;
revoke all on function plataforma.usuario_perfil_conferir() from public;
revoke all on function plataforma.perfil_conferir() from public;
revoke all on function plataforma.perfil_permissao_conferir() from public;

-- conferência: as 4 DEFINER com o search_path fixo e sem EXECUTE para PUBLIC, app, worker ou portal
do $$
declare
  v_n integer;
begin
  select count(*) into v_n
    from pg_proc p
   where p.oid in ('plataforma.usuario_conferir_acesso()'::regprocedure, 'plataforma.usuario_perfil_conferir()'::regprocedure,
                   'plataforma.perfil_conferir()'::regprocedure, 'plataforma.perfil_permissao_conferir()'::regprocedure)
     and p.prosecdef
     and p.proconfig @> array['search_path=pg_catalog, plataforma, pg_temp']
     and not exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                      where a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner);
  if v_n <> 4 then
    raise exception '0049: % de 4 funções de conferência DEFINER com search_path fixo e EXECUTE só do dono', v_n using errcode = '42501';
  end if;
end
$$;
