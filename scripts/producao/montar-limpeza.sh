#!/usr/bin/env bash
# Monta no stdout o SQL completo para o psql (stdin): o preâmbulo psql uma vez e o roteiro do modo.
#   limpar    -> limpar-cadastros-rotina.sql + limpar-cadastros.sql (simular e apagar)
#   restaurar -> conferência de lote e empresa + limpar-cadastros-restaurar.sql
#   descartar -> conferência de lote e empresa + limpar-cadastros-descartar.sql
# Usado por .github/workflows/producao-limpar-cadastros.yml e scripts/producao/teste/limpar-cadastros.teste.sh.
set -euo pipefail
d="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
case "${1:-}" in
  limpar) arquivos=("$d/limpar-cadastros-rotina.sql" "$d/limpar-cadastros.sql") ;;
  restaurar) arquivos=("$d/limpar-cadastros-restaurar.sql") ;;
  descartar) arquivos=("$d/limpar-cadastros-descartar.sql") ;;
  *) echo "uso: montar-limpeza.sh limpar|restaurar|descartar" >&2; exit 2 ;;
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
# restaurar e descartar: lote e empresa conferidos aqui, uma vez (o limpar confere os dele, com o modo)
if [ "$1" != limpar ]; then
  cat <<'ENTRADAS'
select :'lote' ~ '^[0-9]{8}T[0-9]{6}Z$' and :'empresa' ~ '^([a-z0-9][a-z0-9-]{1,39}|[A-Z]{2}[0-9]{4})$' as entradas_ok \gset
\if :entradas_ok
\else
do $$ begin raise exception 'entradas inválidas (lote ou empresa)'; end $$;
\endif
select count(*) = 1 as achou from plataforma.tenant_por_codigo(:'empresa') \gset
\if :achou
\else
do $$ begin raise exception 'empresa não encontrada (código errado ou empresa excluída)'; end $$;
\endif
select id as tenant from plataforma.tenant_por_codigo(:'empresa') \gset
ENTRADAS
fi
cat "${arquivos[@]}"
