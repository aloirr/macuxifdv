#!/usr/bin/env bash
# shellcheck disable=SC2016 # os $ entre aspas simples são o dollar quoting do Postgres, não do shell
# Ensaio das migrações em produção (producao-ensaio-migracoes.yml), passo 2: monta o SQL do ensaio no runner.
#
# Uso: montar.sh <pasta db/migrations do SHA> <aplicadas.txt> <ensaio.sql> <conferir.sql>
#   aplicadas.txt = saída do aplicadas.sql ("versao checksum checksum_down", uma por linha; pode ser vazio).
#
# Confere como o migrador (db/src/migrador.ts): arquivo NNNN_nome.up.sql com o .down.sql, checksum (sha256 com CRLF -> LF)
# de toda migração aplicada igual ao do arquivo, nenhuma aplicada sem arquivo, numeração sem buraco e nenhum .sql em symlink.
# ensaio.sql: BEGIN, timeouts curtos, trava do migrador, antes.sql, as migrações pendentes na ordem (cada uma dentro de um
# DO com EXECUTE: o Postgres recusa ali qualquer comando de transação, então nenhuma migração consegue gravar a transação),
# a linha de cada uma em public.macuxi_migracao, diagnostico.sql e ROLLBACK. Erro em qualquer ponto: ON_ERROR_STOP encerra o
# psql e o Postgres desfaz a transação aberta. conferir.sql: confere, numa sessão nova e só leitura, que nenhuma das
# migrações do ensaio ficou na tabela de controle.
set -euo pipefail

[ "$#" -eq 4 ] || { echo "uso: $0 <pasta> <aplicadas.txt> <ensaio.sql> <conferir.sql>" >&2; exit 2; }
pasta="$1"; aplicadas="$2"; saida="$3"; conferir="$4"
aqui="$(cd "$(dirname "$0")" && pwd)"
erro() { echo "::error::$*" >&2; exit 1; }

# texto com CRLF -> LF e o sha256 dele (normalizar() do migrador)
normalizar() { perl -0777 -pe 's/\r\n/\n/g' "$1"; }
soma() { normalizar "$1" | sha256sum | cut -d' ' -f1; }

declare -A ck=() ckd=()
while read -r v c d; do
  [ -n "${v:-}" ] || continue
  [[ "$v" =~ ^[0-9]{4}$ && "$c" =~ ^[0-9a-f]{64}$ && "$d" =~ ^([0-9a-f]{64}|-)$ ]] || erro "linha inesperada em $aplicadas"
  ck[$v]="$c"; ckd[$v]="$d"
done < "$aplicadas"

links="$(find "$pasta" -maxdepth 1 -name '*.sql' ! -type f -printf '%f ')"
[ -z "$links" ] || erro "migração que não é arquivo comum (symlink?): $links"

declare -A nome_de=()
versoes=()
while IFS= read -r arq; do
  [[ "$arq" =~ ^([0-9]{4})_([a-z0-9_]+)\.up\.sql$ ]] || erro "arquivo fora do padrão NNNN_nome.up.sql: $arq"
  v="${BASH_REMATCH[1]}"; n="${BASH_REMATCH[2]}"
  [ -z "${nome_de[$v]:-}" ] || erro "versão $v repetida"
  [ -f "$pasta/${v}_${n}.down.sql" ] || erro "${v}_${n} sem .down.sql"
  nome_de[$v]="$n"; versoes+=("$v")
done < <(find "$pasta" -maxdepth 1 -type f -name '*.up.sql' -printf '%f\n' | LC_ALL=C sort)
[ "${#versoes[@]}" -gt 0 ] || erro "nenhuma migração em $pasta"

for v in "${!ck[@]}"; do
  [ -n "${nome_de[$v]:-}" ] || erro "migração $v aplicada em produção e ausente no SHA"
  base="$pasta/${v}_${nome_de[$v]}"
  [ "$(soma "$base.up.sql")" = "${ck[$v]}" ] || erro "migração aplicada ${v}_${nome_de[$v]} com o up diferente no SHA (checksum)"
  [ "${ckd[$v]}" = - ] || [ "$(soma "$base.down.sql")" = "${ckd[$v]}" ] \
    || erro "migração aplicada ${v}_${nome_de[$v]} com o down diferente no SHA (checksum_down)"
done

i=0
for v in "${versoes[@]}"; do
  i=$((i + 1))
  [ "$v" = "$(printf '%04d' "$i")" ] || erro "numeração com buraco: falta a $(printf '%04d' "$i") (o migrador recusaria no deploy)"
done

pendentes=()
for v in "${versoes[@]}"; do [ -n "${ck[$v]:-}" ] || pendentes+=("$v"); done
lista=""
for v in "${pendentes[@]}"; do lista+="${lista:+, }'$v'"; done
echo "aplicadas em produção: ${#ck[@]} · no SHA: ${#versoes[@]} · pendentes (ensaio): ${#pendentes[@]}"
for v in "${pendentes[@]}"; do echo "  ${v}_${nome_de[$v]}"; done
[ "${#pendentes[@]}" -gt 0 ] || echo "::warning::nenhuma migração pendente: o ensaio só roda o diagnóstico"

# Moldura (tudo menos o texto das migrações): também vai para $saida.moldura, para a trava contra gravação abaixo.
moldura="$saida.moldura"
: > "$saida"; : > "$moldura"
emitir() { tee -a "$moldura" >> "$saida"; }

emitir <<'SQL'
\set ON_ERROR_STOP on
\set QUIET on
\set VERBOSITY terse
\set SHOW_CONTEXT never
\pset pager off
\pset footer off
\pset null '-'
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';
set local idle_in_transaction_session_timeout = '60s';
\echo 'ensaio: transação aberta (lock_timeout 5s, statement_timeout 120s); termina em ROLLBACK'
-- mesma chave do pg_advisory_lock do migrador (db/src/migrador.ts, CHAVE_LOCK): não ensaia durante um deploy
select pg_try_advisory_xact_lock(120265047898217) as trava_ok \gset
\if :trava_ok
\else
do $t$ begin raise exception 'ensaio: trava do migrador ocupada'; end $t$;
\endif
SQL
emitir < "$aqui/antes.sql"
printf '\n\\echo\n\\echo %s\n' "'== migrações do ensaio: ${#pendentes[@]}'" | emitir

for v in "${pendentes[@]}"; do
  n="${nome_de[$v]}"; arq="$pasta/${v}_${n}.up.sql"
  tag="m$(openssl rand -hex 8)"
  if grep -qF "\$${tag}\$" "$arq" || grep -qF "\$e${tag}\$" "$arq"; then erro "marcador repetido em ${v}_${n}; rode de novo"; fi
  printf '\\echo %s\n' "'aplicando ${v}_${n}'" | emitir
  printf 'do $e%s$ begin\n  if exists (select 1 from public.macuxi_migracao where versao = %s) then\n    raise exception %s;\n  end if;\n  execute $%s$' \
    "$tag" "'$v'" "'ensaio: $v já aplicada'" "$tag" | emitir
  normalizar "$arq" >> "$saida"
  printf '$%s$;\nend $e%s$;\n' "$tag" "$tag" | emitir
  printf "insert into public.macuxi_migracao (versao, nome, checksum, checksum_down) values ('%s', '%s', '%s', '%s');\n" \
    "$v" "$n" "$(soma "$arq")" "$(soma "$pasta/${v}_${n}.down.sql")" | emitir
done

emitir < "$aqui/diagnostico.sql"
emitir <<'SQL'
rollback;
\echo 'ensaio: ROLLBACK feito, nada gravado'
\if :ensaio_falhou
\echo 'RESULTADO: REPROVADO (DIFERENCA em tenant derivado ou leitura fora do esperado); esperado:' :esperado_leitura
do $r$ begin raise exception 'ensaio reprovado'; end $r$;
\else
\echo 'RESULTADO: OK'
\endif
SQL

# Trava contra gravação: a moldura não tem nenhum comando que grave a transação, e o único fim dela é o ROLLBACK.
if grep -n -i -E '\bcommit\b|^[[:space:]]*(end|abort)([[:space:]]+(work|transaction))?[[:space:]]*;|prepare[[:space:]]+transaction' "$moldura"; then
  erro "o SQL do ensaio tem comando que gravaria a transação"
fi
[ "$(grep -c -i -E '^(begin|rollback);$' "$moldura")" = 2 ] || erro "o SQL do ensaio precisa de exatamente um begin e um rollback"
rm -f "$moldura"

cat > "$conferir" <<SQL
\\set ON_ERROR_STOP on
\\set QUIET on
\\set VERBOSITY terse
\\pset footer off
begin transaction read only;
select count(*) filter (where versao in (${lista:-''})) as restaram, max(versao) as ultima from public.macuxi_migracao \\gset
\\echo 'depois do ensaio: última migração aplicada' :ultima '| migrações do ensaio na tabela de controle:' :restaram 'de ${#pendentes[@]}'
rollback;
select :restaram = 0 as limpo \\gset
\\if :limpo
\\else
do \$c\$ begin raise exception 'migração do ensaio ficou gravada'; end \$c\$;
\\endif
SQL
