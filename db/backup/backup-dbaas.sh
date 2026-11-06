#!/usr/bin/env bash
# Backup diário do banco de PRODUÇÃO no DBaaS da Magalu para o Object Storage (dono: banco-dados; T-0086; ADR 0028,
# ADR 0024 plano B; db/backup/LEIA-ME.md). Roda no HOST da VM macuxi-prod-se1, em /opt/macuxi (MACUXI_DIR), pelo
# macuxi-backup.timer (06:15 UTC) ou à mão:
#
#   /opt/macuxi/backup/backup-dbaas.sh
#
# Sem Postgres local: o pg_dump 16 roda no serviço "pgcliente" do compose (pgvector/pgvector:pg16), como o admin do
# DBaaS, por TLS. O admin NÃO tem SUPERUSER nem BYPASSRLS: ele herda o macuxi_manutencao (0031, B1) e a política
# "manutencao" de cada tabela mostra todos os tenants. Por isso o dump vai com --enable-row-security (com o padrão
# row_security=off o pg_dump aborta nas tabelas com FORCE RLS).
#   1. conferência (só leitura): conexão com TLS e o admin vendo todas as linhas (SUPERUSER, BYPASSRLS ou herança do
#      macuxi_manutencao); sem isso o dump sairia sem as linhas da RLS e o script para;
#   2. contagem.sql ANTES → pg_dump -Fc -Z 6 --enable-row-security → pg_restore -l (índice do dump) → contagem.sql DEPOIS.
#      Contagem igual antes e depois = a contagem é a do dump (nada mudou durante ele). Se mudou (uso no momento), repete
#      (até 3 vezes); na 3ª, segue com a de depois e marca "estavel=nao" (o ensaio pode dar DIFERENTE por isso);
#   3. serviço "backup" (db/backup/backup.mjs): grava a contagem em backups/macuxi-<UTC>.contagem.txt e o dump em
#      backups/macuxi-<UTC>.dump (mesmo carimbo UTC, o do início do dump; sha256 nos metadados, tamanho conferido) e
#      apaga os de mais de MACUXI_BACKUP_DIAS (30 no compose de produção), sempre deixando o mais novo.
# Segredos: a senha do admin só chega ao contêiner pgcliente pelo admin.env (env_file do compose → PGPASSWORD dentro
# dele); a do S3, ao contêiner backup pelo segredos.env. Este script não lê nenhum dos dois e nada vai no argv nem no log.
# Rota até o DBaaS: quem confere é o banco-dbaas.sh (MACUXI_CONFERIR_ROTA, a cada deploy); aqui não há conferência de rota.
# Saída: código 0 e a linha final "[backup-dbaas] ... pronto: ..." = dump e contagem no bucket; qualquer falha = != 0.
set -euo pipefail
umask 077

PASTA="${MACUXI_DIR:-/opt/macuxi}"
BANCO="${MACUXI_PG_BANCO:-macuxi}"
TENTATIVAS="${MACUXI_BACKUP_TENTATIVAS:-3}"
PAUSA="${MACUXI_BACKUP_PAUSA_S:-30}"
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTAGEM="${MACUXI_CONTAGEM_SQL:-$AQUI/contagem.sql}"

log() { echo "[backup-dbaas] $(date -u +%Y-%m-%dT%H:%M:%SZ) $*"; }
erro() { echo "[backup-dbaas] ERRO: $2" >&2; exit "$1"; }

[[ "$BANCO" =~ ^[a-z_][a-z0-9_]{0,62}$ ]] || erro 2 "MACUXI_PG_BANCO inválido"
[[ "$TENTATIVAS" =~ ^[1-9]$ ]] || erro 2 "MACUXI_BACKUP_TENTATIVAS precisa ser de 1 a 9"
[[ "$PAUSA" =~ ^[0-9]{1,4}$ ]] || erro 2 "MACUXI_BACKUP_PAUSA_S precisa ser um número de segundos"
[ -s "$CONTAGEM" ] || erro 2 "falta $CONTAGEM (o implantar.sh copia db/backup/contagem.sql da imagem para o lado deste script)"

cd "$PASTA"
for f in .env imagens.env banco.env admin.env; do
  [ -s "$f" ] || erro 2 "$PASTA/$f ausente ou vazio (preparar-vm.sh, workflow e implantar.sh gravam antes)"
done
dc() { docker compose --env-file .env --env-file imagens.env --profile ferramentas "$@"; }
# psql/pg_dump 16 no DBaaS como o admin (PG* do contêiner; senha nunca no argv). Sempre com -d explícito.
pgc() { dc run --rm --no-deps -T pgcliente "$@"; }
psqlc() { pgc psql -X -v ON_ERROR_STOP=1 -At -F '|' "$@"; }

tmp="$(mktemp -d "${TMPDIR:-/tmp}/macuxi-backup-dbaas.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT

# ---------- 1. conexão TLS e visão de todas as linhas ----------
info=""
for t in 1 2 3; do
  info="$(psqlc -d "$BANCO" -c "select s.ssl, r.rolsuper, r.rolbypassrls,
                                       coalesce((select pg_has_role(r.oid, m.oid, 'USAGE') from pg_roles m where m.rolname = 'macuxi_manutencao'), false)
                                  from pg_stat_ssl s, pg_roles r
                                 where s.pid = pg_backend_pid() and r.rolname = current_user")" && break
  [ "$t" = 3 ] && erro 3 "sem conexão com o DBaaS como o admin (veja a linha do psql acima; o banco-dbaas.sh do deploy confere rota, TLS e admin)"
  log "conexão falhou (tentativa $t); de novo em 15 s"
  sleep 15
done
IFS='|' read -r ssl super bypass manutencao <<< "$info"
[ "$ssl" = t ] || erro 3 "conexão SEM TLS com o DBaaS: recusado (produção só com TLS)"
if [ "$super" = t ] || [ "$bypass" = t ]; then
  log "admin com superuser=$super bypassrls=$bypass: vê todas as linhas"
elif [ "$manutencao" = t ]; then
  log "admin sem SUPERUSER/BYPASSRLS, herdando o macuxi_manutencao (0031): a política manutencao mostra todos os tenants"
else
  erro 2 "o admin não herda o macuxi_manutencao (0031) nem ignora a RLS: o dump sairia sem as linhas protegidas (rode o deploy: banco migrar up)"
fi

# ---------- 2. contagem antes → dump → índice → contagem depois ----------
contar() { psqlc -d "$BANCO" < "$CONTAGEM" | LC_ALL=C sort; }

# Uma tentativa; devolve 0 = dump ok e contagem estável, 1 = falha de comando, 4 = contagem mudou durante o dump.
tentar() {
  CARIMBO="$(date -u +%Y%m%dT%H%M%SZ)"
  contar > "$tmp/antes.txt" || { log "contagem.sql (antes) falhou"; return 1; }
  pgc pg_dump --no-password -d "$BANCO" -Fc -Z 6 --enable-row-security > "$tmp/dump" || { log "pg_dump falhou"; return 1; }
  TAMANHO="$(stat -c %s "$tmp/dump")"
  # pg_restore -l lê só o índice: dump truncado ou vazio para aqui e NADA vai ao bucket
  pgc pg_restore -l < "$tmp/dump" > "$tmp/indice" || { log "pg_restore -l não leu o dump ($TAMANHO bytes)"; return 1; }
  contar > "$tmp/depois.txt" || { log "contagem.sql (depois) falhou"; return 1; }
  cmp -s "$tmp/antes.txt" "$tmp/depois.txt" || return 4
  return 0
}

ESTAVEL=nao
for t in $(seq 1 "$TENTATIVAS"); do
  log "pg_dump de $BANCO (tentativa $t de $TENTATIVAS)"
  codigo=0
  tentar || codigo=$?
  if [ "$codigo" = 0 ]; then
    ESTAVEL=sim
    break
  fi
  if [ "$codigo" = 4 ]; then
    log "a contagem mudou durante o dump (uso no momento): $(diff "$tmp/antes.txt" "$tmp/depois.txt" | grep -c '^[<>]' || true) linha(s) diferentes"
    [ "$t" = "$TENTATIVAS" ] && { log "AVISO: segue com a contagem de depois do dump, marcada estavel=nao (o ensaio pode dar DIFERENTE)"; break; }
  else
    [ "$t" = "$TENTATIVAS" ] && erro 1 "o dump falhou $TENTATIVAS vezes: nada foi ao bucket"
  fi
  log "de novo em $PAUSA s"
  sleep "$PAUSA"
done
TABELAS="$(grep -c '^linhas|' "$tmp/depois.txt" || true)"
LINHAS="$(awk -F'|' '$1 == "linhas" {s += $3} END {print s + 0}' "$tmp/depois.txt")"
[ "$TABELAS" -gt 0 ] || erro 1 "a contagem.sql não listou nenhuma tabela em $BANCO"
log "dump: $TAMANHO bytes, $(grep -c ' TABLE DATA ' "$tmp/indice" || true) tabelas com dados no índice; contagem: $TABELAS tabelas, $LINHAS linhas (estável: $ESTAVEL)"

{
  echo "# contagem.sql de $BANCO no momento do dump (backup-dbaas.sh, T-0086) carimbo=$CARIMBO estavel=$ESTAVEL"
  cat "$tmp/depois.txt"
} > "$tmp/contagem.txt"

# ---------- 3. bucket: contagem e depois o dump (mesmo carimbo), com a poda de 30 dias ----------
# a contagem vai PRIMEIRO: se o envio do dump falhar, sobra só uma contagem órfã, que a poda apaga quando vencer
dc run --rm --no-deps -T backup enviar-contagem --carimbo "$CARIMBO" < "$tmp/contagem.txt"
dc run --rm --no-deps -T backup enviar --carimbo "$CARIMBO" < "$tmp/dump"
log "pronto: backups/$BANCO-$CARIMBO.dump ($TAMANHO bytes) e a contagem ($TABELAS tabelas, $LINHAS linhas, estável: $ESTAVEL)"
