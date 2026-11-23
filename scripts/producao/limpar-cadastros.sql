-- Limpeza de UMA empresa: workflow .github/workflows/producao-limpar-cadastros.yml, montado por montar-limpeza.sh (preâmbulo
-- psql e limpar-cadastros-rotina.sql antes deste arquivo; regras no cabeçalho da rotina).
-- Variáveis (psql -v): empresa (código), modo (simular | apagar), lote (carimbo UTC AAAAMMDDTHHMMSSZ).
-- Uma transação só: simular = o mesmo caminho do apagar, com ROLLBACK no fim. Log: só nomes de tabela e contagens.
select :'modo' in ('simular', 'apagar') and :'lote' ~ '^[0-9]{8}T[0-9]{6}Z$'
       and :'empresa' ~ '^([a-z0-9][a-z0-9-]{1,39}|[A-Z]{2}[0-9]{4})$' as entradas_ok \gset
\if :entradas_ok
\else
do $$ begin raise exception 'entradas inválidas (modo, lote ou empresa)'; end $$;
\endif

begin;
set local lock_timeout = '15s';
set local statement_timeout = '10min';
select count(*) = 1 as achou from plataforma.tenant_por_codigo(:'empresa') \gset
\if :achou
\else
rollback;
do $$ begin raise exception 'empresa não encontrada (código errado ou empresa excluída)'; end $$;
\endif
select id as tenant from plataforma.tenant_por_codigo(:'empresa') \gset
select set_config('app.tenant_id', :'tenant', true) <> '' as ok \gset

\echo 'antes: pedidos vivos por status (todos saem)'
select status, count(*) as pedidos from vendedor.pedido where tenant_id = :'tenant' and deleted_at is null group by 1 order by 1;
select count(*) > 0 as processando from integracao.lote where tenant_id = :'tenant' and status = 'processando' \gset
\if :processando
\echo 'ATENÇÃO: lote do Hub em processamento agora: o apagar aborta sem mudar nada (espere o lote terminar)'
\endif
select :'modo' = 'apagar' as gravar \gset

\echo
\echo 'o que sai, por tabela (soft = deleted_at; fisico = DELETE)'
select r_tabela as tabela, r_modo as modo, r_linhas as linhas
  from pg_temp.macuxi_limpar_cadastros(:'tenant'::uuid, :'lote', :'gravar'::boolean) where r_linhas > 0;
select count(*) as linhas_na_copia_de_seguranca from public.macuxi_limpeza_backup where lote = :'lote';

\echo
\echo 'o que fica (vivos depois da limpeza)'
select x.item, x.vivos from (
  select 1 as o, 'core.filial' as item, count(*) as vivos from core.filial where tenant_id = :'tenant' and deleted_at is null
  union all select 3, 'core.cliente', count(*) from core.cliente where tenant_id = :'tenant' and deleted_at is null
  union all select 4, 'core.produto', count(*) from core.produto where tenant_id = :'tenant' and deleted_at is null
  union all select 5, 'catalogo.tabela_preco_item', count(*) from catalogo.tabela_preco_item where tenant_id = :'tenant' and deleted_at is null
  union all select 6, 'catalogo.estoque_saldo', count(*) from catalogo.estoque_saldo where tenant_id = :'tenant' and deleted_at is null
  union all select 7, 'vendedor.forma_pagamento', count(*) from vendedor.forma_pagamento where tenant_id = :'tenant' and deleted_at is null
  union all select 8, 'vendedor.prazo_pagamento', count(*) from vendedor.prazo_pagamento where tenant_id = :'tenant' and deleted_at is null
  union all select 10, 'core.visita', count(*) from core.visita where tenant_id = :'tenant' and deleted_at is null
  union all select 11, 'core.usuario', count(*) from core.usuario where tenant_id = :'tenant' and deleted_at is null
  union all select 12, 'core.usuario com external_id (vendedor do ERP)', count(*) from core.usuario where tenant_id = :'tenant' and deleted_at is null and external_id is not null
  union all select 13, 'plataforma.usuario_perfil', count(*) from plataforma.usuario_perfil where tenant_id = :'tenant' and deleted_at is null
  union all select 14, 'plataforma.tenant_modulo (licenças)', count(*) from plataforma.tenant_modulo where tenant_id = :'tenant' and deleted_at is null
  union all select 15, 'plataforma.parametro', count(*) from plataforma.parametro where tenant_id = :'tenant' and deleted_at is null
  union all select 16, 'integracao.credencial (não revogadas)', count(*) from integracao.credencial where tenant_id = :'tenant' and deleted_at is null and revogada_em is null
) x order by x.o;
\echo 'conectores (ficam como estão)'
select identificador, tipo, ativo, recebe_pedidos from integracao.conector where tenant_id = :'tenant' and deleted_at is null order by identificador;

\if :gravar
commit;
\echo 'APAGADO: transação confirmada'
\else
rollback;
\echo 'SIMULADO: ROLLBACK, nada mudou'
\endif
