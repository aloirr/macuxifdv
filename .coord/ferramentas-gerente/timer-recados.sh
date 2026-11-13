#!/usr/bin/env bash
# Timer do gerente: espera 5 min, lê a caixa no GitHub e mostra só os recados novos desde o último disparo.
SP="C:/Users/domon/AppData/Local/Temp/claude/b5e741428393dd6e/dcc73486-2afb-480b-ae75-9b725bb97756/scratchpad"
sleep "${1:-300}"
cd /c/macuxifdv || exit 1
# Token só no ambiente deste processo (nunca em arquivo ou log); o keyring às vezes falha com agentes em paralelo.
for i in 1 2 3 4 5 6; do
  T="$(gh auth token 2>/dev/null)" && [ -n "$T" ] && { export GH_TOKEN="$T"; break; }
  sleep 5
done
unset T
[ -z "$GH_TOKEN" ] && echo "AVISO: gh auth token falhou 6 vezes; leitura pela cópia local"
node scripts/coord.mjs caixa gerente-projetos > "$SP/caixa-atual.txt" 2>&1
head -1 "$SP/caixa-atual.txt"
grep -oE 'R-[0-9]{8}-[0-9]{6}-[a-z-]+' "$SP/caixa-atual.txt" | sort -u > "$SP/caixa-ids-atual.txt"
touch "$SP/caixa-ids-anterior.txt"
comm -13 "$SP/caixa-ids-anterior.txt" "$SP/caixa-ids-atual.txt" > "$SP/caixa-ids-novos.txt"
echo "novos: $(wc -l < "$SP/caixa-ids-novos.txt")"
if [ -s "$SP/caixa-ids-novos.txt" ] && [ "$(wc -l < "$SP/caixa-ids-novos.txt")" -lt 60 ]; then
  grep -A1 -F -f "$SP/caixa-ids-novos.txt" "$SP/caixa-atual.txt" | grep -v '^--$'
fi
cp "$SP/caixa-ids-atual.txt" "$SP/caixa-ids-anterior.txt"
echo "--- pendências ---"
node scripts/coord.mjs pendencias 2>&1 | head -15
