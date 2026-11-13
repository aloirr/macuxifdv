#!/usr/bin/env bash
# Ensaio da v1.0.4: retrato da árvore sobre origin/main, sem governança e sem recados, e SEM a T-0095 (0062 e consumidores),
# que fica na árvore para a v1.0.5. Push na branch de verificação e dispara CI e stack isolado.
set -euo pipefail
cd /c/macuxifdv
RAMO="${1:-verificacao/v104-ensaio-1}"
S="C:/Users/domon/AppData/Local/Temp/claude/b5e741428393dd6e/dcc73486-2afb-480b-ae75-9b725bb97756/scratchpad"
IDX="$S/idx-ensaio"; rm -f "$IDX"
export GIT_INDEX_FILE="$IDX"
git read-tree origin/main
git add -A -- . \
  ':(exclude).coord/recados' ':(exclude).coord/lidos' ':(exclude)_instalar' ':(exclude).vscode' \
  ':(exclude).claude' ':(exclude).coord/donos.json' ':(exclude)scripts/coord-lib.mjs' \
  ':(exclude)scripts/coord.mjs' ':(exclude)scripts/coord-verificar.test.mjs' ':(exclude)scripts/coord-recados.test.mjs' ':(exclude).github' \
  ':(exclude)db/migrations/0062_core_catalogo_erp_ordem.up.sql' ':(exclude)db/migrations/0062_core_catalogo_erp_ordem.down.sql' \
  ':(exclude)modules/core/db/nuvem.ts' ':(exclude)modules/catalogo/db/nuvem.ts' \
  ':(exclude)db/testes/erp-ordem.test.ts' ':(exclude)db/testes/estatico.test.ts' \
  ':(exclude)docs/banco/core.md' ':(exclude)docs/banco/README.md' \
  ':(exclude)modules/catalogo/domain/zz-bench.test.ts'
TREE="$(git write-tree)"
unset GIT_INDEX_FILE
rm -f "$IDX"
SHA="$(git commit-tree "$TREE" -p origin/main -m "Ensaio v1.0.4 (retrato da árvore, sem T-0095)")"
echo "retrato: $SHA"
echo "$SHA" > "$S/retrato-v104.txt"
