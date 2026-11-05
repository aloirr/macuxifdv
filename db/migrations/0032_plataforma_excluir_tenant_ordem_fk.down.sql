-- 0032_plataforma_excluir_tenant_ordem_fk (down) — T-0075 (B2)
-- Volta plataforma.excluir_tenant(uuid, text) ao corpo da 0024 (mesma assinatura e retorno): DELETE em toda tabela com
-- tenant_id com session_replication_role = replica só na transação, que EXIGE superusuário (no DBaaS da Magalu a função
-- volta a falhar com "permission denied to set parameter"). O que já foi excluído NÃO volta (só pelo backup).
-- Idempotente (create or replace). Pré-condição: 0033+ desfeitas.

create or replace function plataforma.excluir_tenant(p_tenant uuid, p_codigo text)
  returns table (tabela text, quantidade bigint)
  language plpgsql volatile
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_codigo text;
  v_status text;
  v_replicacao text := current_setting('session_replication_role');
  v_t record;
  v_n bigint;
begin
  if p_tenant is null then
    raise exception 'excluir_tenant: p_tenant obrigatório' using errcode = '22004';
  end if;
  select t.codigo, t.status into v_codigo, v_status from plataforma.tenant t where t.id = p_tenant for update;
  if not found then
    raise exception 'excluir_tenant: tenant não encontrado' using errcode = 'P0002';
  end if;
  if p_codigo is distinct from v_codigo then
    raise exception 'excluir_tenant: código de confirmação não confere com o do tenant' using errcode = '22023';
  end if;
  if v_status <> 'encerrado' then
    raise exception 'excluir_tenant: o tenant precisa estar com status encerrado (está %)', v_status using errcode = '55000';
  end if;

  perform set_config('session_replication_role', 'replica', true);
  for v_t in
    select ns.nspname as esquema, c.relname as nome
      from pg_class c
      join pg_namespace ns on ns.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id' and a.attnum > 0 and not a.attisdropped
     where c.relkind in ('r', 'p') and not c.relispartition
       and ns.nspname not in ('pg_catalog', 'information_schema') and ns.nspname not like 'pg\_%'
     order by 1, 2
  loop
    execute format('delete from %I.%I where tenant_id = $1', v_t.esquema, v_t.nome) using p_tenant;
    get diagnostics v_n = row_count;
    if v_n > 0 then
      tabela := v_t.esquema || '.' || v_t.nome; quantidade := v_n; return next;
    end if;
  end loop;
  delete from plataforma.tenant t where t.id = p_tenant;
  tabela := 'plataforma.tenant'; quantidade := 1; return next;
  perform set_config('session_replication_role', v_replicacao, true);
end
$$;
revoke all on function plataforma.excluir_tenant(uuid, text) from public;
