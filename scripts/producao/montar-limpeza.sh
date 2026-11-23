#!/usr/bin/env bash
# Monta no stdout o SQL completo para o psql (stdin): o preâmbulo psql uma vez e o roteiro do modo.
# Todos os modos começam pela conferência de lote, empresa e migração 0099 (define :tenant). Variáveis (psql -v): empresa, lote
# (e modo e entidades no limpar). A regra é a do banco (0099, ADR 0068): plataforma.limpar_cadastros, restaurar_limpeza,
# descartar_limpeza e a cópia plataforma.limpeza_copia. Banco sem a 0099 para aqui, antes de qualquer mudança.
#   limpar    -> limpar-cadastros.sql (simular e apagar)
#   restaurar -> limpar-cadastros-restaurar.sql
#   descartar -> limpar-cadastros-descartar.sql
#   arquivo   -> as linhas do lote na cópia de segurança, em COPY texto, no stdout (o arquivo da VM)
# Usado por .github/workflows/producao-limpar-cadastros.yml e scripts/producao/teste/limpar-cadastros.teste.sh.
set -euo pipefail
d="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
case "${1:-}" in
  limpar) arquivos=("$d/limpar-cadastros.sql") ;;
  restaurar) arquivos=("$d/limpar-cadastros-restaurar.sql") ;;
  descartar) arquivos=("$d/limpar-cadastros-descartar.sql") ;;
  arquivo) arquivos=() ;;
  *) echo "uso: montar-limpeza.sh limpar|restaurar|descartar|arquivo" >&2; exit 2 ;;
esac
# VERBOSITY terse: o erro sai sem DETAIL (que traria valores das linhas)
cat <<'PREAMBULO'
\set ON_ERROR_STOP on
\set QUIET on
\set VERBOSITY terse
\pset pager off
\pset footer off
\pset null '-'
set client_min_messages = warning;
PREAMBULO
cat <<'ENTRADAS'
select :'lote' ~ '^[0-9]{8}T[0-9]{6}Z(-[0-9a-f]{8})?$' and :'empresa' ~ '^([a-z0-9][a-z0-9-]{1,39}|[A-Z]{2}[0-9]{4})$' as entradas_ok \gset
\if :entradas_ok
\else
do $$ begin raise exception 'entradas inválidas (lote ou empresa)'; end $$;
\endif
select to_regclass('plataforma.limpeza_copia') is not null
   and (select count(distinct p.proname) = 3 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'plataforma' and p.proname in ('limpar_cadastros', 'restaurar_limpeza', 'descartar_limpeza')) as tem_0099 \gset
\if :tem_0099
\else
do $$ begin raise exception 'o banco ainda não tem a migração 0099 (plataforma.limpar_cadastros): faça antes o deploy da v1.0.31 ou rode o workflow numa tag anterior (nada mudou)'; end $$;
\endif
select count(*) = 1 as achou from plataforma.tenant_por_codigo(:'empresa') \gset
\if :achou
\else
do $$ begin raise exception 'empresa não encontrada (código errado ou empresa excluída)'; end $$;
\endif
select id as tenant from plataforma.tenant_por_codigo(:'empresa') \gset
ENTRADAS
if [ "$1" = arquivo ]; then
  echo "copy (select * from plataforma.limpeza_copia where lote = :'lote' and tenant_id = :'tenant') to stdout;"
else
  cat "${arquivos[@]}"
fi
