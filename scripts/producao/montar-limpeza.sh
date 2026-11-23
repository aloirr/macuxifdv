#!/usr/bin/env bash
# Monta o SQL completo da limpeza (ou da restauração) no stdout, para o psql da VM (stdin) e para o teste local:
#   bash scripts/producao/montar-limpeza.sh limpar     -> ON_ERROR_STOP + limpar-cadastros-rotina.sql + limpar-cadastros.sql
#   bash scripts/producao/montar-limpeza.sh restaurar  -> ON_ERROR_STOP + limpar-cadastros-restaurar.sql
# Usado por .github/workflows/producao-limpar-cadastros.yml e scripts/producao/teste/limpar-cadastros.teste.sh.
set -euo pipefail
d="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
printf '\\set ON_ERROR_STOP on\n'
case "${1:-}" in
  limpar) cat "$d/limpar-cadastros-rotina.sql" "$d/limpar-cadastros.sql" ;;
  restaurar) cat "$d/limpar-cadastros-restaurar.sql" ;;
  *) echo "uso: montar-limpeza.sh limpar|restaurar" >&2; exit 2 ;;
esac
