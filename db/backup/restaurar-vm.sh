#!/usr/bin/env bash
# Restauração do backup da demo (dono: banco-dados; T-0074; db/backup/LEIA-ME.md). Roda no HOST da VM, em /opt/macuxi.
#
#   restaurar-vm.sh [ultimo|<chave>] [--destino NOME] [--trocar]
#
# Padrão SEGURO: baixa o backup (sha256 conferido), restaura num banco NOVO (padrão macuxi_restaurado_<UTC>) e compara a
# contagem de linhas, políticas e privilégios com o banco atual. O banco em uso NÃO é tocado.
# --trocar: depois de restaurar e conferir, para api e worker, renomeia o banco atual para macuxi_antes_<UTC> (fica,
#           nada é apagado), põe o restaurado no lugar e sobe api e worker de novo.
# Pré-requisito numa VM nova (volume vazio): "banco migrar up" uma vez antes, para criar os papéis macuxi_app e
# macuxi_worker (os GRANTs do dump citam esses papéis; papel é do cluster e não vai no dump).
set -euo pipefail
umask 077

PASTA="${MACUXI_DIR:-/opt/macuxi}"
BANCO="${MACUXI_PG_BANCO:-macuxi}"
SERVICO_PG="${MACUXI_SERVICO_PG:-postgres}"
SERVICO_BACKUP="${MACUXI_SERVICO_BACKUP:-backup}"
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTAGEM="$AQUI/contagem.sql"

QUAL="ultimo"
DESTINO=""
TROCAR=0
while [ $# -gt 0 ]; do
  case "$1" in
    --destino) DESTINO="${2:-}"; shift 2 ;;
    --trocar) TROCAR=1; shift ;;
    -h|--help) sed -n '2,13p' "$0"; exit 0 ;;
    *) QUAL="$1"; shift ;;
  esac
done
AGORA="$(date -u +%Y%m%d%H%M%S)"
[ -n "$DESTINO" ] || DESTINO="${BANCO}_restaurado_${AGORA}"
for n in "$BANCO" "$DESTINO"; do
  [[ "$n" =~ ^[a-z_][a-z0-9_]{0,62}$ ]] || { echo "[restaurar] nome de banco inválido: $n" >&2; exit 2; }
done
[ "$DESTINO" != "$BANCO" ] || { echo "[restaurar] o destino não pode ser o banco em uso ($BANCO); use --trocar" >&2; exit 2; }
[ -f "$CONTAGEM" ] || { echo "[restaurar] falta $CONTAGEM (copie db/backup/contagem.sql para o lado deste script)" >&2; exit 2; }

cd "$PASTA"
dc() {
  local arquivos=(--env-file .env)
  [ -f imagens.env ] && arquivos+=(--env-file imagens.env)
  docker compose "${arquivos[@]}" "$@"
}
log() { echo "[restaurar] $(date -u +%Y-%m-%dT%H:%M:%SZ) $*"; }
psql_pg() { dc exec -T "$SERVICO_PG" sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -At -F "|" "$@"' _ "$@"; }

tmp="$(mktemp -d "${TMPDIR:-/tmp}/macuxi-restaurar.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT

log "baixando $QUAL"
dc --profile ferramentas run --rm -T "$SERVICO_BACKUP" baixar "$QUAL" > "$tmp/dump"
dc exec -T "$SERVICO_PG" pg_restore -l < "$tmp/dump" > /dev/null
log "dump ok ($(stat -c %s "$tmp/dump") bytes)"

if [ -n "$(psql_pg -d postgres -c "select 1 from pg_database where datname = '$DESTINO'")" ]; then
  echo "[restaurar] o banco $DESTINO já existe: escolha outro --destino" >&2
  exit 1
fi
log "criando $DESTINO e restaurando (uma transação; erro desfaz tudo)"
psql_pg -d postgres -c "create database $DESTINO" > /dev/null
if ! dc exec -T "$SERVICO_PG" sh -c 'pg_restore -U "$POSTGRES_USER" -d "$1" --exit-on-error --single-transaction' _ "$DESTINO" < "$tmp/dump"; then
  psql_pg -d postgres -c "drop database if exists $DESTINO" > /dev/null || true
  echo "[restaurar] pg_restore falhou; $DESTINO removido" >&2
  exit 1
fi

# T-0079 (0022): a restauração VOLTA os dados de todos os tenants; gira a geração da base para os aparelhos limparem a
# cópia local (pedido que só o aparelho tem é reenviado pela fila). Backup anterior à 0022 não tem a função: o
# "banco migrar up" do deploy cria a coluna com um valor novo por tenant, o que dá no mesmo.
if [ "$(psql_pg -d "$DESTINO" -c "select to_regprocedure('plataforma.girar_geracao_base(uuid)') is not null")" = "t" ]; then
  log "geração da base girada em $(psql_pg -d "$DESTINO" -c "select plataforma.girar_geracao_base(null)") tenant(s) de $DESTINO"
else
  log "backup anterior à 0022 (sem geracao_base): o migrar up do deploy cria o marcador novo"
fi

psql_pg -d "$DESTINO" < "$CONTAGEM" > "$tmp/restaurado.txt"
log "restaurado: $(grep -c '^linhas|' "$tmp/restaurado.txt") tabelas, $(awk -F'|' '/^linhas\|/ {s += $3} END {print s + 0}' "$tmp/restaurado.txt") linhas"
if [ -n "$(psql_pg -d postgres -c "select 1 from pg_database where datname = '$BANCO'")" ]; then
  psql_pg -d "$BANCO" < "$CONTAGEM" > "$tmp/atual.txt"
  if diff -u "$tmp/atual.txt" "$tmp/restaurado.txt" > "$tmp/diferenca.txt"; then
    log "contagem IGUAL à do banco atual ($BANCO)"
  else
    log "contagem DIFERENTE da do banco atual ($BANCO) — normal se houve uso depois do backup:"
    grep '^[-+][a-z]' "$tmp/diferenca.txt" | head -40 || true
  fi
fi

if [ "$TROCAR" != 1 ]; then
  log "pronto: $DESTINO restaurado ao lado de $BANCO (nada foi trocado). Para trocar: rode de novo com --trocar."
  exit 0
fi

ANTIGO="${BANCO}_antes_${AGORA}"
log "trocando: parando api e worker; $BANCO → $ANTIGO; $DESTINO → $BANCO"
dc stop api worker
# ALTER DATABASE RENAME falha sozinho se ainda houver conexão no banco: nesse caso nada muda e api/worker voltam
if ! psql_pg -d postgres -c "alter database $BANCO rename to $ANTIGO" > /dev/null; then
  dc up -d api worker
  echo "[restaurar] $BANCO ainda tem conexão aberta: nada foi trocado (api e worker religados)" >&2
  exit 1
fi
if ! psql_pg -d postgres -c "alter database $DESTINO rename to $BANCO" > /dev/null; then
  psql_pg -d postgres -c "alter database $ANTIGO rename to $BANCO" > /dev/null || true
  dc up -d api worker
  echo "[restaurar] falha ao renomear $DESTINO: o banco anterior voltou para $BANCO" >&2
  exit 1
fi
dc up -d --wait api worker
log "pronto: $BANCO é o restaurado; o anterior ficou em $ANTIGO (apague à mão quando conferir)"
