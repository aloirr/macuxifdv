-- 0078_plataforma_papel_leitura (down) — consulta só leitura na produção (ADR 0055)
-- Desfaz a 0078: apaga as políticas leitura, revoga do macuxi_leitura o SELECT em toda tabela, o USAGE em todo schema e o
-- EXECUTE em plataforma.tenant_por_codigo(text). O workflow de consulta passa a receber 42501 (falha fechada). O papel e os 3
-- ajustes de sessão FICAM (objetos do cluster, como o macuxi_portal na 0038: outro banco do mesmo servidor pode usá-los; e
-- nenhum ALTER ROLE aqui, para o down não disputar pg_db_role_setting com o passo de papéis). Para remover de vez, num
-- servidor sem nenhum banco que o use: drop role macuxi_leitura;
-- Idempotente. Pré-condição: 0079+ desfeitas.

do $$
declare
  v_t record;
begin
  for v_t in
    select c.oid::regclass::text as tabela
      from pg_policy p join pg_class c on c.oid = p.polrelid
     where p.polname = 'leitura'
     order by 1
  loop
    execute format('drop policy if exists leitura on %s', v_t.tabela);
  end loop;
  if exists (select 1 from pg_roles where rolname = 'macuxi_leitura') then
    for v_t in
      select c.oid::regclass::text as tabela
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where c.relkind in ('r', 'p', 'v', 'm', 'f') and n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg\_%'
         and has_table_privilege('macuxi_leitura', c.oid, 'SELECT')
       order by 1
    loop
      execute format('revoke select on %s from macuxi_leitura', v_t.tabela);
    end loop;
    for v_t in
      select n.nspname as esquema
        from pg_namespace n
       where n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg\_%'
         and has_schema_privilege('macuxi_leitura', n.oid, 'USAGE')
       order by 1
    loop
      execute format('revoke usage on schema %I from macuxi_leitura', v_t.esquema);
    end loop;
    revoke execute on function plataforma.tenant_por_codigo(text) from macuxi_leitura;
  end if;
end
$$;
