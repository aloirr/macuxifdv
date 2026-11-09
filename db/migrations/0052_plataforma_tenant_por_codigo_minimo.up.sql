-- 0052_plataforma_tenant_por_codigo_minimo (up) — T-0122 N5 (conferência T-0110; 🟢6 da revisão da T-0002). Pedido
-- R-20261109-000053-engenheiro-software. Dicionário: docs/banco/plataforma.md ("0052 — login sem nome do tenant").
-- Migração em cima da 0051. SÓ SOBE JUNTO com o Core que lê o nome e o fuso por plataforma.tenant_da_sessao() (o
-- tenantParaExibicao de modules/core/api/repositorio.ts que lia nome/fuso de tenant_por_codigo dá 42703 sem ele).
-- (a) plataforma.tenant_por_codigo(text) passa a devolver só (id uuid, status text): antes da senha ninguém enumera nome nem
--     fuso das empresas pelo código. Mudou o tipo de retorno = drop + create (mesma assinatura de entrada, SECURITY DEFINER,
--     stable, search_path da 0012 com pg_temp por último, EXECUTE só ao macuxi_app).
-- (b) plataforma.tenant_da_sessao(): id, codigo, nome e fuso do tenant DA SESSÃO (app.tenant_id), SECURITY INVOKER: lê
--     plataforma.tenant pela RLS do macuxi_app (id = tenant_atual()); sem contexto = 0 linhas. EXECUTE só ao macuxi_app.
-- (c) evento_nome_formato e evento_consumo_consumidor_formato alinhados ao EVENTO_RE do SDK (packages/platform-sdk/src/
--     nomes.ts: segmento [a-z][a-z0-9_]*, sem hífen). Nenhum módulo nem consumidor tem hífen (o consumidor é o id do
--     módulo, apps/api/src/despachante.ts); NOT VALID + VALIDATE para não segurar a outbox com lock forte.
-- Caminho de volta: 0052_plataforma_tenant_por_codigo_minimo.down.sql.

drop function plataforma.tenant_por_codigo(text);
create function plataforma.tenant_por_codigo(p_codigo text)
  returns table (id uuid, status text)
  language sql stable security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
    select t.id, t.status
      from plataforma.tenant t
     where lower(t.codigo) = lower(p_codigo) and t.deleted_at is null
  $$;
revoke all on function plataforma.tenant_por_codigo(text) from public;
grant execute on function plataforma.tenant_por_codigo(text) to macuxi_app;

create function plataforma.tenant_da_sessao()
  returns table (id uuid, codigo text, nome text, fuso text)
  language sql stable security invoker
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
    select t.id, t.codigo, t.nome, t.fuso
      from plataforma.tenant t
     where t.id = plataforma.tenant_atual() and t.deleted_at is null
  $$;
revoke all on function plataforma.tenant_da_sessao() from public;
grant execute on function plataforma.tenant_da_sessao() to macuxi_app;

alter table plataforma.evento drop constraint evento_nome_formato;
alter table plataforma.evento add constraint evento_nome_formato
  check (nome ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*@[1-9][0-9]*$') not valid;
alter table plataforma.evento validate constraint evento_nome_formato;
alter table plataforma.evento_consumo drop constraint evento_consumo_consumidor_formato;
alter table plataforma.evento_consumo add constraint evento_consumo_consumidor_formato
  check (consumidor ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$') not valid;
alter table plataforma.evento_consumo validate constraint evento_consumo_consumidor_formato;
