#!/usr/bin/env bash
# Monta no stdout o SQL completo para o psql (stdin): o preâmbulo psql uma vez e o roteiro do modo.
#   limpar    -> limpar-cadastros-rotina.sql + limpar-cadastros.sql (simular e apagar)
#   restaurar -> limpar-cadastros-restaurar.sql
#   descartar -> limpar-cadastros-descartar.sql
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
cat "${arquivos[@]}"
