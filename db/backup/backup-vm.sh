#!/usr/bin/env bash
# Backup diário do Postgres da demo para o Object Storage (dono: banco-dados; T-0074, ADR 0020; db/backup/LEIA-ME.md).
# Roda no HOST da VM (timer do systemd ou cron instalado pelo preparar-vm.sh), na pasta do compose (/opt/macuxi):
#   1. pg_dump -Fc DENTRO do contêiner postgres (pg_dump 16 = servidor 16; socket local, sem senha) → arquivo temporário;
#   2. pg_restore -l confere o índice do dump (dump truncado ou vazio para aqui, NADA vai ao bucket);
#   3. serviço "backup" do compose (imagem macuxi-api, node db/backup/backup.mjs enviar) grava em backups/, confere o
#      tamanho no bucket e apaga os backups com mais de MACUXI_BACKUP_DIAS (7) dias, sempre deixando o mais novo.
# Nenhum segredo passa por aqui: as variáveis S3 chegam ao serviço "backup" pelo segredos.env do compose.
# Saída: código 0 = backup no bucket; qualquer falha = código != 0 (o systemd/cron registra).
set -euo pipefail
umask 077

PASTA="${MACUXI_DIR:-/opt/macuxi}"
BANCO="${MACUXI_PG_BANCO:-macuxi}"
SERVICO_PG="${MACUXI_SERVICO_PG:-postgres}"
SERVICO_BACKUP="${MACUXI_SERVICO_BACKUP:-backup}"
[[ "$BANCO" =~ ^[a-z_][a-z0-9_]{0,62}$ ]] || { echo "[backup-vm] MACUXI_PG_BANCO inválido" >&2; exit 2; }

cd "$PASTA"
dc() {
  local arquivos=(--env-file .env)
  [ -f imagens.env ] && arquivos+=(--env-file imagens.env)
  docker compose "${arquivos[@]}" "$@"
}
log() { echo "[backup-vm] $(date -u +%Y-%m-%dT%H:%M:%SZ) $*"; }

tmp="$(mktemp -d "${TMPDIR:-/tmp}/macuxi-backup.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT

log "pg_dump de $BANCO"
# -Fc (custom, comprimido), sem senha: o socket local do contêiner é "trust" na imagem oficial do Postgres
dc exec -T "$SERVICO_PG" sh -c 'pg_dump -U "$POSTGRES_USER" -d "$1" -Fc -Z 6' _ "$BANCO" > "$tmp/dump"
tamanho="$(stat -c %s "$tmp/dump")"
log "dump: $tamanho bytes"

dc exec -T "$SERVICO_PG" pg_restore -l < "$tmp/dump" > "$tmp/indice"
log "índice do dump conferido: $(grep -c ' TABLE DATA ' "$tmp/indice" || true) tabelas com dados"

dc --profile ferramentas run --rm -T "$SERVICO_BACKUP" enviar < "$tmp/dump"
log "pronto"
