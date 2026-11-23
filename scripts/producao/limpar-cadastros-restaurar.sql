-- Restauração de UM lote da limpeza (scripts/producao/limpar-cadastros.sql), pela cópia public.macuxi_limpeza_backup.
-- Workflow .github/workflows/producao-limpar-cadastros.yml, modo restaurar. Variáveis (psql -v): empresa, lote.
-- Uma transação: tudo volta ou nada volta. Só serve ANTES do reenvio do ERP: depois dele, a linha nova com o mesmo
-- external_id (ou código) bate no índice único parcial e a transação inteira aborta sem mudar nada.
-- soft          -> deleted_at volta ao valor copiado (nulo), na ordem inversa da limpeza
-- fisico        -> a linha copiada volta inteira (jsonb_populate_record), pais antes dos filhos
-- filial_padrao -> o external_id da padrão volta
-- sync_pacote   -> não volta (cache: o worker gera outro); a geracao_base gira de novo (o aparelho puxa tudo outra vez)
\set ON_ERROR_STOP on
\set QUIET on
\set VERBOSITY terse
set client_min_messages = warning;
\pset pager off
\pset footer off

select :'lote' ~ '^[0-9]{8}T[0-9]{6}Z$' and :'empresa' ~ '^([a-z0-9][a-z0-9-]{1,39}|[A-Z]{2}[0-9]{4})$' as entradas_ok \gset
\if :entradas_ok
\else
do $$ begin raise exception 'entradas inválidas (lote ou empresa)'; end $$;
\endif

begin;
set local lock_timeout = '15s';
select id as tenant from plataforma.tenant_por_codigo(:'empresa') \gset
select set_config('app.tenant_id', :'tenant', true) <> '' as ok, set_config('limpeza.lote', :'lote', true) <> '' as ok2 \gset
\echo '### restaurar · empresa' :empresa '· lote' :lote
create temp table resumo (tabela text, modo text, linhas bigint) on commit drop;
do $$
declare
  r record;
  n bigint;
  v_tenant uuid := current_setting('app.tenant_id')::uuid;
  v_lote text := current_setting('limpeza.lote');
  -- pais antes dos filhos (inverso do DELETE da limpeza)
  v_fisico text[] := array['integracao.coleta_execucao', 'integracao.reconciliacao', 'integracao.cursor_entidade',
    'integracao.sessao_carga', 'integracao.sessao_carga_recebido', 'integracao.lote', 'integracao.lote_staging',
    'integracao.lote_linha_erro', 'integracao.registro_atual', 'integracao.pendencia_inativacao',
    'integracao.inativacao_auditoria', 'integracao.cliente_fila_erp', 'integracao.pedido_fila_erp',
    'integracao.pedido_retorno', 'integracao.pedido_retorno_erro'];
  t text;
begin
  if not exists (select 1 from public.macuxi_limpeza_backup b where b.lote = v_lote and b.tenant_id = v_tenant) then
    raise exception 'lote % sem cópia de segurança para esta empresa', v_lote;
  end if;
  for r in select b.tabela, count(*) as linhas from public.macuxi_limpeza_backup b
            where b.lote = v_lote and b.tenant_id = v_tenant and b.modo = 'fisico' group by 1 loop
    if not r.tabela = any (v_fisico) then raise exception 'tabela física fora da lista: %', r.tabela; end if;
  end loop;
  foreach t in array v_fisico loop
    execute format('insert into %1$s select (jsonb_populate_record(null::%1$s, b.linha)).* from public.macuxi_limpeza_backup b
                     where b.lote = %2$L and b.tenant_id = %3$L and b.tabela = %4$L and b.modo = ''fisico''', t, v_lote, v_tenant, t);
    get diagnostics n = row_count;
    if n > 0 then insert into resumo values (t, 'fisico', n); end if;
  end loop;
  for r in select distinct b.tabela from public.macuxi_limpeza_backup b
            where b.lote = v_lote and b.tenant_id = v_tenant and b.modo = 'soft' loop
    execute format('update %1$s t set deleted_at = (b.linha->>''deleted_at'')::timestamptz, updated_at = now()
                      from public.macuxi_limpeza_backup b
                     where b.lote = %2$L and b.tenant_id = %3$L and b.tabela = %4$L and b.modo = ''soft''
                       and t.tenant_id = b.tenant_id and t.id = (b.linha->>''id'')::uuid', r.tabela, v_lote, v_tenant, r.tabela);
    get diagnostics n = row_count;
    insert into resumo values (r.tabela, 'soft', n);
  end loop;
  update core.filial f set external_id = b.linha->>'external_id', updated_at = now()
    from public.macuxi_limpeza_backup b
   where b.lote = v_lote and b.tenant_id = v_tenant and b.modo = 'filial_padrao'
     and f.tenant_id = b.tenant_id and f.id = (b.linha->>'id')::uuid;
  get diagnostics n = row_count;
  insert into resumo values ('core.filial (padrão: external_id)', 'filial_padrao', n);
  perform plataforma.girar_geracao_base(v_tenant);
end $$;
select tabela, modo, linhas from resumo order by modo, tabela;
commit;
\echo 'RESTAURADO: lote' :lote '(a cópia continua em public.macuxi_limpeza_backup)'
