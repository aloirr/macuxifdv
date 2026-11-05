-- 0027_plataforma_tenants_ativos (up) — T-0039 §2.3 passo 3 (tarefas periódicas dos módulos no worker, ADR 0022; pedido
-- R-20261105-035124-engenheiro-software). Dicionário: docs/banco/plataforma.md; RLS: docs/banco/rls.md.
-- Migração ADITIVA e idempotente (drop if exists + create): só uma função nova; nenhuma tabela, coluna, política ou grant de
-- tabela muda.
--
-- plataforma.tenants_ativos() returns table (id uuid)
--   Ids dos tenants com status = 'ativo' e deleted_at is null, ordenados por id, para o agendador do worker
--   (apps/api/src/agendador.ts) iterar os tenants. SÓ o id sai: nome, código, documento, plano e fuso NÃO (licenças,
--   parâmetros e fuso o agendador lê depois em comTenant, com o macuxi_app e a RLS do tenant). Suspenso, encerrado e
--   apagado ficam de fora (ADR 0022: tenant fora do ar não recebe tarefa).
--   SECURITY DEFINER: o macuxi_worker não tem SELECT em plataforma.tenant e o macuxi_app só vê o tenant da sessão (RLS
--   isolamento_tenant da 0001). search_path fixo com pg_temp por último (regra da 0012). EXECUTE só ao macuxi_worker; o
--   macuxi_app e PUBLIC NÃO executam (o app não tem por que listar os tenants). Tabela pequena (um registro por empresa):
--   seq scan, sem índice novo.
-- Volta (down): drop function; o worker vê to_regprocedure nulo e só deixa o agendador desligado com warn.

drop function if exists plataforma.tenants_ativos();
create function plataforma.tenants_ativos()
  returns table (id uuid)
  language sql stable security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
    select t.id
      from plataforma.tenant t
     where t.status = 'ativo' and t.deleted_at is null
     order by t.id
  $$;
revoke all on function plataforma.tenants_ativos() from public;
grant execute on function plataforma.tenants_ativos() to macuxi_worker;
