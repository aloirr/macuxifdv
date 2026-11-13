#!/usr/bin/env bash
# Retrato corrigido da v1.0.4: o retrato verificado a048d4a9 com .github/ e scripts/coord-recados.test.mjs iguais ao main
# (a árvore local nunca recebeu os patches de governança aplicados no worktree do lote).
set -euo pipefail
cd /c/macuxifdv
S="C:/Users/domon/AppData/Local/Temp/claude/b5e741428393dd6e/dcc73486-2afb-480b-ae75-9b725bb97756/scratchpad"
IDX="$S/idx-corrigido"; rm -f "$IDX"
export GIT_INDEX_FILE="$IDX"
git read-tree a048d4a99a8d3bee3f894351dd7ec04ff0231688
git rm -r -q -f --cached .github
MAIN_GH="$(git rev-parse 'refs/remotes/origin/main^{tree}')"
GH_TREE="$(git ls-tree "$MAIN_GH" .github | awk '{print $3}')"
git read-tree --prefix=.github/ "$GH_TREE"
BLOB="$(git ls-tree refs/remotes/origin/main scripts/coord-recados.test.mjs | awk '{print $3}')"
git update-index --cacheinfo "100644,$BLOB,scripts/coord-recados.test.mjs"
TREE="$(git write-tree)"
unset GIT_INDEX_FILE; rm -f "$IDX"
SHA="$(git commit-tree "$TREE" -p refs/remotes/origin/main -m "Retrato v1.0.4 corrigido (governança igual ao main)")"
echo "$SHA" > "$S/retrato-v104-corrigido.txt"
echo "retrato corrigido: $SHA"
git diff --stat a048d4a99a8d3bee3f894351dd7ec04ff0231688 "$SHA" | tail -5
