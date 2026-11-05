-- 0032_plataforma_excluir_tenant_ordem_fk (up) — T-0075, plano B do DBaaS da Magalu, item B2 (ADR 0024; relatório do run
-- 42021914715; pedido R-20261105-082502-engenheiro-software). Roteiro: docs/banco/lgpd.md; dicionário: docs/banco/plataforma.md.
-- Depende da 0031 (B1): sem superusuário, o dono só enxerga as linhas do tenant pela política manutencao.
--
-- Recria plataforma.excluir_tenant(p_tenant uuid, p_codigo text) returns table (tabela text, quantidade bigint) com a
-- MESMA assinatura, o mesmo retorno e as mesmas travas da 0024 (P0002 tenant inexistente, 22023 código de confirmação
-- errado, 55000 tenant que não está 'encerrado'), SECURITY INVOKER, sem EXECUTE para PUBLIC nem para os papéis da aplicação.
-- Muda só o COMO: a 0024 usava session_replication_role = replica (FKs e gatilhos desligados), que exige superusuário e
-- o DBaaS nega (X2). Agora, sem session_replication_role e sem desligar gatilho nem FK:
--   1. Grafo do catálogo: toda tabela com tenant_id (relkind r/p, fora de partição; como na 0024: tabela nova fica
--      coberta sozinha) e as FKs entre elas (pg_constraint, contype f, conparentid = 0). FK da tabela para ela mesma fica
--      de fora: um DELETE só apaga todas as linhas do tenant e a FK é conferida no fim do comando.
--   2. Ordem: filhas antes das mães. A cada rodada, apaga (em ordem alfabética) toda tabela que nenhuma restante
--      referencia; se nenhuma estiver pronta há um ciclo (hoje: core.usuario <-> core.equipe) e ele é quebrado com
--      UPDATE <filha> SET <colunas da FK> = null (só as linhas do tenant com valor), na FK anulável de nome menor do ciclo
--      (todas as colunas da FK, menos tenant_id, aceitam nulo; MATCH SIMPLE: uma coluna nula desliga a conferência).
--      Ciclo sem FK anulável = erro 55000 e nada muda (a transação do chamador desfaz).
--   3. Por fim, a linha de plataforma.tenant. Uma linha que sobrar em qualquer tabela faz a FK para plataforma.tenant
--      falhar (23503): nunca sobra tenant pela metade.
-- Gatilhos que disparam (aceitos): os 5 *_toca_trilha do Treinamento (0017) atualizam o updated_at da trilha do MESMO
-- tenant, que é apagada depois na mesma transação; os de updated_at disparam no UPDATE do passo 2. Nenhum gatilho de
-- DELETE grava em outra tabela nem em outro tenant.
-- Devolve, como na 0024, (tabela 'esquema.tabela', quantidade) de cada tabela com linhas apagadas, na ordem em que
-- apagou, e por fim ('plataforma.tenant', 1). Os UPDATEs do passo 2 não entram no retorno.
--
-- Caminho de volta: 0032_plataforma_excluir_tenant_ordem_fk.down.sql (volta ao corpo da 0024, com session_replication_role,
-- que só roda com superusuário).

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
