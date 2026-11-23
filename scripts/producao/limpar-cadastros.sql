-- Limpeza de UMA empresa: workflow .github/workflows/producao-limpar-cadastros.yml, montado por montar-limpeza.sh (preâmbulo
-- psql e conferência de lote, empresa e 0099 antes deste arquivo). A regra é a plataforma.limpar_cadastros da 0099, a mesma
-- do "Zerar dados" do portal (ADR 0068, docs/desenho/empresa-zerar.md §4).
-- Variáveis (psql -v): empresa (código), modo (simular | apagar), lote (carimbo UTC AAAAMMDDTHHMMSSZ) e entidades (opcional:
-- lista por vírgula; vazia = a empresa inteira; entidade fora da lista para a função com 22023).
-- Uma transação só: simular = o mesmo caminho do apagar, com ROLLBACK no fim. Log: só nomes de tabela e contagens.
\if :{?entidades}
\else
\set entidades ''
\endif
select :'modo' in ('simular', 'apagar') and :'entidades' ~ '^([a-z_]+(,[a-z_]+)*)?$' as modo_ok \gset
\if :modo_ok
\else
do $$ begin raise exception 'modo ou entidades inválidos'; end $$;
\endif

begin;
set local lock_timeout = '15s';
set local statement_timeout = '10min';
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
  from plataforma.limpar_cadastros(:'tenant'::uuid, :'lote', string_to_array(nullif(:'entidades', ''), ','), :'gravar'::boolean)
 where r_linhas > 0 order by r_ordem;
select count(*) as linhas_na_copia_de_seguranca from plataforma.limpeza_copia where lote = :'lote' and empresa_id = :'tenant';

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
  union all select 14, 'plataforma.tenant_modulo (licenças)', count(*) from plataforma.tenant_modulo where tenant_id = :'tenant' and deleted_at is null
  union all select 15, 'plataforma.parametro', count(*) from plataforma.parametro where tenant_id = :'tenant' and deleted_at is null
  union all select 16, 'integracao.credencial (não revogadas)', count(*) from integracao.credencial where tenant_id = :'tenant' and deleted_at is null and revogada_em is null
) x order by x.o;
\echo 'usuários por perfil principal (saem todos, menos os administradores)'
select perfil, count(*) filter (where deleted_at = now()) as saem, count(*) filter (where deleted_at is null) as ficam
  from core.usuario where tenant_id = :'tenant' and (deleted_at is null or deleted_at = now()) group by 1 order by 1;
\echo 'conectores (ficam como estão)'
select identificador, tipo, ativo, recebe_pedidos from integracao.conector where tenant_id = :'tenant' and deleted_at is null order by identificador;

\if :gravar
commit;
\echo 'APAGADO: transação confirmada'
\else
rollback;
\echo 'SIMULADO: ROLLBACK, nada mudou'
\endif
