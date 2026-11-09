-- 0052_plataforma_tenant_por_codigo_minimo (down) — desfaz a 0052 (T-0122 N5) e volta ao catálogo da 0051.
-- tenant_por_codigo volta a devolver (id, nome, fuso, status) como na 0001 (search_path da 0012); tenant_da_sessao sai
-- (volte antes o Core para ler nome e fuso de tenant_por_codigo); os 2 CHECKs voltam a aceitar hífen (texto da 0001/0003).
-- Idempotente. Pré-condição: 0053+ desfeitas.

drop function if exists plataforma.tenant_da_sessao();
drop function if exists plataforma.tenant_por_codigo(text);
create function plataforma.tenant_por_codigo(p_codigo text)
  returns table (id uuid, nome text, fuso text, status text)
  language sql stable security definer
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
    select t.id, t.nome, t.fuso, t.status
      from plataforma.tenant t
     where lower(t.codigo) = lower(p_codigo) and t.deleted_at is null
  $$;
revoke all on function plataforma.tenant_por_codigo(text) from public;
grant execute on function plataforma.tenant_por_codigo(text) to macuxi_app;

alter table plataforma.evento drop constraint if exists evento_nome_formato;
alter table plataforma.evento add constraint evento_nome_formato check (nome ~ '^[a-z][a-z0-9-]*\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*@[1-9][0-9]*$');
alter table plataforma.evento_consumo drop constraint if exists evento_consumo_consumidor_formato;
alter table plataforma.evento_consumo add constraint evento_consumo_consumidor_formato check (consumidor ~ '^[a-z][a-z0-9-]*(\.[a-z][a-z0-9_-]*)*$');
