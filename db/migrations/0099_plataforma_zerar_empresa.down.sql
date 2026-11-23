-- 0099_plataforma_zerar_empresa (down) — desfaz a 0099 e volta ao catálogo da 0098. Idempotente. Pré-condição: 0100+ desfeitas,
-- as rotas e o worker do zerar desligados na API (chamam funções que somem).
-- PERDE os registros de zerar e as cópias ainda não expurgadas (desfaça antes o que precisar com plataforma.restaurar_zerar).
-- Os bytes listados em plataforma.zerar_empresa_objeto ficam no bucket: exporte antes
-- "select armazenamento, chave from plataforma.zerar_empresa_objeto" para removê-los à mão.
-- A excluir_tenant volta ao corpo da 0032 (create or replace: a ACL fica), com o laço de ordem por FK dentro dela.

-- funções do portal, do worker, do dono e internas --------------------------------------------------------------------------------
drop function if exists plataforma.sa_ler_zerar(uuid, uuid);
drop function if exists plataforma.sa_pedir_zerar(uuid, uuid, uuid, text);
drop function if exists plataforma.sa_previa_zerar(uuid, uuid);
drop function if exists plataforma.restaurar_zerar(uuid);
drop function if exists plataforma.zerar_tenant_manual(uuid, text);
drop function if exists plataforma.fechar_expurgo_zerar(uuid);
drop function if exists plataforma.objetos_do_expurgo_zerar(integer);
drop function if exists plataforma.fechar_zerar(uuid, jsonb);
drop function if exists plataforma.executar_zerar(uuid);
drop function if exists plataforma.pegar_zerar();
drop function if exists plataforma.zerar_tenant(uuid);
drop function if exists plataforma.zerar_empresa_json(plataforma.zerar_empresa);
drop function if exists plataforma.zerar_bloqueado(uuid, uuid, bigint);
drop function if exists plataforma.previa_do_zerar(uuid);
drop function if exists plataforma.alvos_do_zerar(uuid);
drop function if exists plataforma.tabelas_mantidas_no_zerar();

-- tabelas (filhas antes das mães) ------------------------------------------------------------------------------------------------
drop table if exists plataforma.zerar_empresa_objeto;
drop table if exists plataforma.zerar_empresa_copia;
drop table if exists plataforma.zerar_empresa;

-- excluir_tenant com o corpo da 0032; depois o laço comum sai -------------------------------------------------------------------
create or replace function plataforma.excluir_tenant(p_tenant uuid, p_codigo text)
  returns table (tabela text, quantidade bigint)
  language plpgsql volatile
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
declare
  v_codigo text;
  v_status text;
  v_tabelas oid[];
  v_restantes oid[];
  v_prontas oid[];
  v_filha oid[];
  v_mae oid[];
  v_fk text[];
  v_anular text[];
  v_com_valor text[];
  v_ativa boolean[];
  v_rel oid;
  v_i integer;
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

  -- 1. tabelas com tenant_id (como a 0024) e FKs entre elas, sem as da tabela para ela mesma
  select coalesce(array_agg(c.oid order by ns.nspname, c.relname), '{}') into v_tabelas
    from pg_class c
    join pg_namespace ns on ns.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id' and a.attnum > 0 and not a.attisdropped
   where c.relkind in ('r', 'p') and not c.relispartition
     and ns.nspname not in ('pg_catalog', 'information_schema') and ns.nspname not like 'pg\_%';

  select coalesce(array_agg(k.conrelid order by k.conname, k.oid), '{}'),
         coalesce(array_agg(k.confrelid order by k.conname, k.oid), '{}'),
         coalesce(array_agg(k.conname::text order by k.conname, k.oid), '{}'),
         coalesce(array_agg(k.anular order by k.conname, k.oid), '{}'),
         coalesce(array_agg(k.com_valor order by k.conname, k.oid), '{}'),
         coalesce(array_agg(true order by k.conname, k.oid), '{}')
    into v_filha, v_mae, v_fk, v_anular, v_com_valor, v_ativa
    from (
      select con.oid, con.conname, con.conrelid, con.confrelid,
             -- colunas da FK menos tenant_id; anulável = todas aceitam nulo (senão anular fica nulo e a FK não quebra ciclo)
             (select case when count(*) > 0 and bool_and(not at.attnotnull)
                          then string_agg(format('%I = null', at.attname), ', ' order by at.attnum) end
                from unnest(con.conkey) as kk(n)
                join pg_attribute at on at.attrelid = con.conrelid and at.attnum = kk.n
               where at.attname <> 'tenant_id') as anular,
             (select string_agg(format('%I is not null', at.attname), ' or ' order by at.attnum)
                from unnest(con.conkey) as kk(n)
                join pg_attribute at on at.attrelid = con.conrelid and at.attnum = kk.n
               where at.attname <> 'tenant_id') as com_valor
        from pg_constraint con
       where con.contype = 'f' and con.conparentid = 0
         and con.conrelid <> con.confrelid
         and con.conrelid = any (v_tabelas) and con.confrelid = any (v_tabelas)
    ) k;

  -- 2. filhas antes das mães; ciclo quebrado anulando a FK anulável de nome menor
  v_restantes := v_tabelas;
  while cardinality(v_restantes) > 0 loop
    select array_agg(t.rel order by ns.nspname, c.relname) into v_prontas
      from unnest(v_restantes) as t(rel)
      join pg_class c on c.oid = t.rel
      join pg_namespace ns on ns.oid = c.relnamespace
     where not exists (
       select 1 from generate_subscripts(v_mae, 1) as i
        where v_ativa[i] and v_mae[i] = t.rel and v_filha[i] = any (v_restantes));

    if v_prontas is not null then
      foreach v_rel in array v_prontas loop
        select ns.nspname || '.' || c.relname into tabela
          from pg_class c join pg_namespace ns on ns.oid = c.relnamespace where c.oid = v_rel;
        execute format('delete from %s where tenant_id = $1', v_rel::regclass) using p_tenant;
        get diagnostics v_n = row_count;
        if v_n > 0 then
          quantidade := v_n; return next;
        end if;
      end loop;
      v_restantes := array(select t.rel from unnest(v_restantes) as t(rel) where t.rel <> all (v_prontas));
      continue;
    end if;

    v_i := null;
    select i into v_i
      from generate_subscripts(v_fk, 1) as i
     where v_ativa[i] and v_anular[i] is not null
       and v_filha[i] = any (v_restantes) and v_mae[i] = any (v_restantes)
     order by v_fk[i], i
     limit 1;
    if v_i is null then
      raise exception 'excluir_tenant: ciclo de FK sem coluna anulável entre %',
        (select string_agg(t.rel::regclass::text, ', ' order by t.rel::regclass::text) from unnest(v_restantes) as t(rel))
        using errcode = '55000';
    end if;
    execute format('update %s set %s where tenant_id = $1 and (%s)', v_filha[v_i]::regclass, v_anular[v_i], v_com_valor[v_i])
      using p_tenant;
    v_ativa[v_i] := false;
  end loop;

  -- 3. o tenant (FK de qualquer linha que tivesse sobrado = 23503)
  delete from plataforma.tenant t where t.id = p_tenant;
  tabela := 'plataforma.tenant'; quantidade := 1; return next;
end
$$;
revoke all on function plataforma.excluir_tenant(uuid, text) from public;
drop function if exists plataforma.apagar_em_ordem_fk(uuid, jsonb, uuid);
drop function if exists plataforma.passos_em_ordem_fk(oid[]);
drop function if exists plataforma.tabelas_com_tenant();
