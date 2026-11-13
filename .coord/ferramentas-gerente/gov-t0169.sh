#!/usr/bin/env bash
# Rito de governança T-0169: commit só com o patch, sobre origin/main, sem tocar na árvore de trabalho.
set -euo pipefail
SP="C:/Users/domon/AppData/Local/Temp/claude/b5e741428393dd6e/dcc73486-2afb-480b-ae75-9b725bb97756/scratchpad"
cd /c/macuxifdv
BASE=$(git rev-parse refs/remotes/origin/main)
export GIT_INDEX_FILE="$SP/idx-t0169"
rm -f "$GIT_INDEX_FILE"
git read-tree "$BASE"
git apply --cached docs/desenho/T-0169-design-de-marca.diff
TREE=$(git write-tree)
SHA=$(git commit-tree "$TREE" -p "$BASE" -F "$SP/msg-gov-t0169.txt")
rm -f "$GIT_INDEX_FILE"
echo "base=$BASE"
echo "sha=$SHA"
git diff --stat "$BASE" "$SHA"
