#!/usr/bin/env bash
# Ensaio de restauração do backup de PRODUÇÃO numa base TEMPORÁRIA do DBaaS (dono: banco-dados; T-0086; ADR 0028,
# ADR 0024 plano B e item 9; db/backup/LEIA-ME.md). Roda no HOST da VM, em /opt/macuxi (MACUXI_DIR), pelo workflow
# manual "producao — ensaio de restauração" e pelo job stack-producao do CI:
#
#   /opt/macuxi/backup/ensaio-restauracao.sh [ultimo|<chave>]       (padrão: ultimo)
#
#   1. serviço "backup": acha o dump (o mais novo ou a chave), baixa conferindo o sha256 e baixa a contagem gravada
#      junto dele pelo backup-dbaas.sh (backups/macuxi-<UTC>.contagem.txt);
#   2. pg_restore -l e a lista SEM os objetos do provedor que a base nova já traz do template1 (gatilhos de evento e
#      funções do pgaudit, COMMENT ON EXTENSION, que só o dono da extensão faz) — o mesmo filtro do A9 (db/dbaas);
#   3. CREATE DATABASE macuxi_ensaio_<UTC> pelo admin (CREATEDB), extensão vector e pg_restore --exit-on-error
#      --single-transaction pelo serviço "pgcliente", como o admin sem superusuário (dono dos objetos, como na origem);
#   4. contagem.sql na base restaurada (linhas por tabela, políticas, FORCE RLS, privilégios) comparada com a gravada
#      no backup, e db/scripts/conferir-rls.sql (da imagem) com zero linhas na restaurada;
#   5. a base temporária é APAGADA SEMPRE (trap: sucesso, falha ou interrupção), com drop database ... with (force).
# O banco em uso (macuxi) NUNCA é tocado: só a base postgres (create/drop) e a temporária, cujo nome é conferido.
# Última linha: "[ensaio] resultado: IGUAL ..." e código 0; ou "[ensaio] resultado: DIFERENTE ..." e código != 0
# (contagem diferente, conferir-rls com problema, restauração que falhou ou base temporária que não saiu).
# Código 2 = uso ou pré-requisito (nada foi criado). Segredos: nenhum passa por aqui (env_file do compose).
set -euo pipefail
umask 077

PASTA="${MACUXI_DIR:-/opt/macuxi}"
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTAGEM="${MACUXI_CONTAGEM_SQL:-$AQUI/contagem.sql}"
QUAL="${1:-ultimo}"

log() { echo "[ensaio] $(date -u +%H:%M:%S) $*"; }
uso() { echo "[ensaio] ERRO: $1" >&2; exit 2; }

case "$QUAL" in
  -h|--help) sed -n '2,22p' "$0"; exit 0 ;;
  ultimo) ;;
  *) [[ "$QUAL" =~ ^[a-z0-9][a-z0-9/_-]*/[a-z_][a-z0-9_]{0,62}-[0-9]{8}T[0-9]{6}Z\.dump$ ]] || uso "chave inválida: use ultimo ou backups/macuxi-AAAAMMDDTHHMMSSZ.dump" ;;
esac
[ $# -le 1 ] || uso "um argumento só: ultimo ou a chave do dump"
[ -s "$CONTAGEM" ] || uso "falta $CONTAGEM (o implantar.sh copia db/backup/contagem.sql da imagem para o lado deste script)"
cd "$PASTA"
for f in .env imagens.env banco.env admin.env; do
  [ -s "$f" ] || uso "$PASTA/$f ausente ou vazio"
done

DESTINO="macuxi_ensaio_$(date -u +%Y%m%d%H%M%S)"
# trava do nome: só uma base macuxi_ensaio_<14 dígitos> é criada e apagada aqui
[[ "$DESTINO" =~ ^macuxi_ensaio_[0-9]{14}$ ]] || uso "nome da base temporária inválido"

dc() { docker compose --env-file .env --env-file imagens.env --profile ferramentas "$@"; }
# pgcliente com a pasta de trabalho montada só leitura em /trabalho (o pg_restore -L precisa do dump e da lista em arquivo)
pgct() { dc run --rm --no-deps -T -v "$tmp:/trabalho:ro" pgcliente "$@"; }
psqlc() { dc run --rm --no-deps -T pgcliente psql -X -v ON_ERROR_STOP=1 -At -F '|' "$@"; }

# pasta de trabalho ao lado do script (no disco da VM, modo 700): montada só leitura no pgcliente para o pg_restore -L
tmp="$(mktemp -d "${MACUXI_ENSAIO_TMP:-$AQUI}/ensaio.XXXXXX")"
CRIADA=0
RESULTADO=""
DETALHE=""

finalizar() {
  local codigo=$? apagada=1
  set +e
  if [ "$CRIADA" = 1 ]; then
    apagada=0
    for t in 1 2 3; do
      if psqlc -d postgres -c "drop database if exists $DESTINO with (force)" > /dev/null; then
        if [ -z "$(psqlc -d postgres -c "select 1 from pg_database where datname = '$DESTINO'")" ]; then apagada=1; break; fi
      fi
      sleep 5
    done
    if [ "$apagada" = 1 ]; then
      log "base temporária $DESTINO apagada"
    else
      echo "[ensaio] ERRO: a base temporária $DESTINO NÃO saiu: apague à mão no pgcliente (DROP DATABASE $DESTINO WITH (FORCE))" >&2
    fi
  fi
  rm -rf "$tmp"
  if [ -z "$RESULTADO" ]; then
    RESULTADO=DIFERENTE
    DETALHE="(o ensaio parou antes da comparação, código $codigo: veja as linhas acima)"
  fi
  if [ "$RESULTADO" = IGUAL ] && [ "$apagada" != 1 ]; then
    RESULTADO=DIFERENTE
    DETALHE="$DETALHE — mas a base temporária $DESTINO não foi apagada"
  fi
  echo "[ensaio] resultado: $RESULTADO $DETALHE"
  if [ "$RESULTADO" = IGUAL ]; then exit 0; fi
  [ "$codigo" = 0 ] && codigo=1
  exit "$codigo"
}
trap finalizar EXIT
trap 'exit 130' INT TERM

# ---------- 1. dump e contagem gravada ----------
CHAVE="$(dc run --rm --no-deps -T backup resolver "$QUAL" | tail -n 1)"
[[ "$CHAVE" =~ \.dump$ ]] || { log "o serviço backup não achou o dump ($QUAL)"; exit 1; }
log "backup: $CHAVE"
dc run --rm --no-deps -T backup baixar "$CHAVE" > "$tmp/dump"
if ! dc run --rm --no-deps -T backup baixar-contagem "$CHAVE" > "$tmp/contagem-backup.txt"; then
  DETALHE="(o backup $CHAVE não tem a contagem gravada: só os backups do backup-dbaas.sh têm)"
  RESULTADO=DIFERENTE
  exit 1
fi
estavel="$(sed -n '1s/.* estavel=\([a-z]*\).*/\1/p' "$tmp/contagem-backup.txt")"
grep -v '^#' "$tmp/contagem-backup.txt" | LC_ALL=C sort > "$tmp/esperada.txt"
log "dump $(stat -c %s "$tmp/dump") bytes (sha256 conferido); contagem gravada: $(grep -c '^linhas|' "$tmp/esperada.txt" || true) tabelas (estável no dump: ${estavel:-?})"

# ---------- 2. índice do dump sem os objetos do provedor ----------
pgct pg_restore -l /trabalho/dump > "$tmp/indice"
awk '/^;/ || /^[[:space:]]*$/ {print; next}
     / EVENT TRIGGER / || /(^|[^A-Za-z0-9_])pgaudit_/ || / COMMENT - EXTENSION / {next}
     {print}' "$tmp/indice" > "$tmp/lista"
fora=$(( $(wc -l < "$tmp/indice") - $(wc -l < "$tmp/lista") ))
log "índice: $(grep -c ' TABLE DATA ' "$tmp/indice" || true) tabelas com dados; $fora objeto(s) do provedor fora da restauração"

# ---------- 3. base temporária e restauração ----------
info="$(psqlc -d postgres -c "select s.ssl, r.rolcreatedb from pg_stat_ssl s, pg_roles r where s.pid = pg_backend_pid() and r.rolname = current_user")"
IFS='|' read -r ssl createdb <<< "$info"
[ "$ssl" = t ] || { log "conexão SEM TLS com o DBaaS: recusado"; exit 3; }
[ "$createdb" = t ] || { log "o admin não tem CREATEDB"; exit 3; }
sobras="$(psqlc -d postgres -c "select string_agg(datname, ' ' order by datname) from pg_database where datname ~ '^macuxi_ensaio_[0-9]{14}$'")"
[ -z "$sobras" ] || log "AVISO: bases de ensaios anteriores ainda no DBaaS (ensaio interrompido à força?): $sobras"

CRIADA=1 # antes do CREATE: se ele cair no meio, o trap confere e apaga
psqlc -d postgres -c "create database $DESTINO" > /dev/null
log "base temporária $DESTINO criada"
# vector: no DBaaS pelo pgextwlist; no CI já vem do template1 (o "create extension if not exists" do dump fica sem efeito)
psqlc -d "$DESTINO" -c "create extension if not exists vector" > /dev/null || log "AVISO: create extension vector falhou na base temporária (o pg_restore tenta de novo)"
log "pg_restore --exit-on-error --single-transaction em $DESTINO"
inicio="$(date +%s)"
if ! pgct pg_restore --no-password --exit-on-error --single-transaction -d "$DESTINO" -L /trabalho/lista /trabalho/dump; then
  RESULTADO=DIFERENTE
  DETALHE="(a restauração de $CHAVE falhou: veja o erro do pg_restore acima; nada ficou na base temporária)"
  exit 1
fi
log "restaurado em $(( $(date +%s) - inicio )) s"

# ---------- 4. comparação ----------
psqlc -d "$DESTINO" < "$CONTAGEM" | LC_ALL=C sort > "$tmp/restaurada.txt"
TABELAS="$(grep -c '^linhas|' "$tmp/restaurada.txt" || true)"
LINHAS="$(awk -F'|' '$1 == "linhas" {s += $3} END {print s + 0}' "$tmp/restaurada.txt")"
POLITICAS="$(sed -n 's/^politicas|//p' "$tmp/restaurada.txt")"

rls="não conferido"
if dc run --rm --no-deps -T --entrypoint cat banco db/scripts/conferir-rls.sql > "$tmp/conferir-rls.sql" 2> /dev/null && [ -s "$tmp/conferir-rls.sql" ]; then
  psqlc -d "$DESTINO" < "$tmp/conferir-rls.sql" > "$tmp/rls.txt"
  if [ -s "$tmp/rls.txt" ]; then
    rls="$(wc -l < "$tmp/rls.txt") problema(s)"
    head -n 20 "$tmp/rls.txt" | sed 's/^/[ensaio]   conferir-rls: /'
  else
    rls="0 problemas"
  fi
else
  log "AVISO: conferir-rls.sql não saiu da imagem; RLS da restaurada não conferida"
fi

if diff -u "$tmp/esperada.txt" "$tmp/restaurada.txt" > "$tmp/diferenca.txt"; then
  if [ "$rls" = "0 problemas" ] || [ "$rls" = "não conferido" ]; then
    RESULTADO=IGUAL
    DETALHE="($TABELAS tabelas, $LINHAS linhas, ${POLITICAS:-?} políticas; conferir-rls: $rls; backup $CHAVE; base temporária apagada)"
  else
    RESULTADO=DIFERENTE
    DETALHE="(contagem igual, mas conferir-rls.sql achou $rls na restaurada; backup $CHAVE)"
  fi
else
  log "diferenças (- gravada no backup, + restaurada):"
  grep '^[-+][a-z]' "$tmp/diferenca.txt" | head -n 40 | sed 's/^/[ensaio]   /' || true
  RESULTADO=DIFERENTE
  DETALHE="($(grep -c '^[-+][a-z]' "$tmp/diferenca.txt" || true) linha(s) diferentes da contagem gravada; estável no dump: ${estavel:-?}; backup $CHAVE)"
fi
[ "$RESULTADO" = IGUAL ] || exit 1
exit 0
