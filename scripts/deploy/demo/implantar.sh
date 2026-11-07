#!/usr/bin/env bash
# Publicação do ambiente demo na VM (T-0074, ADR 0020). Roda NA VM, como o usuário de deploy (grupo docker), a partir
# da pasta para onde o workflow copiou scripts/deploy/demo/. Também serve para o deploy manual por SSH.
#
#   bash implantar.sh <tag> [--bko] [--recriar-base]
#
#   <tag>           tag das imagens no GHCR (o sha do commit; "main" = a última publicada)
#   --bko           liga o serviço bko (a imagem ghcr.io/<dono>/macuxi-bko:<tag> existe)
#   --recriar-base  "seed demo --recriar": apaga o tenant demo e recarrega a base (workflow "recriar base demo")
#
# Ordem: compose.yml para /opt/macuxi → pull → Postgres no ar → migrações (com os papéis macuxi_app e macuxi_worker
# e as senhas do .env) → seed da demo (só no primeiro deploy, ou com --recriar-base) → up -d → conferência local
# (/v1/saude e /login) → scripts do backup em /opt/macuxi/backup (tirados da imagem) e conferência do backup mais novo
# (só aviso) → docker image prune -f. Qualquer falha, menos as do backup, para o script com saída != 0 (workflow vermelho).
# Nenhum segredo é impresso: os .env só são lidos pelo compose.
set -euo pipefail

TAG="${1:?informe a tag das imagens}"
shift
BKO=0
RECRIAR=0
for a in "$@"; do
  case "$a" in
    --bko) BKO=1 ;;
    --recriar-base) RECRIAR=1 ;;
    *) echo "[implantar] opção desconhecida: $a" >&2; exit 2 ;;
  esac
done
if ! [[ "$TAG" =~ ^[A-Za-z0-9._-]{1,128}$ ]]; then
  echo "[implantar] tag inválida" >&2
  exit 2
fi

ORIGEM="$(cd "$(dirname "$0")" && pwd)"
PASTA=/opt/macuxi
log() { echo "[implantar] $(date -u +%H:%M:%S) $*"; }

[ -f "$PASTA/.env" ] || { echo "[implantar] $PASTA/.env ausente: rode antes sudo bash preparar-vm.sh" >&2; exit 1; }
[ -s "$PASTA/portal.env" ] || { echo "[implantar] $PASTA/portal.env ausente (T-0091): rode antes sudo bash preparar-vm.sh" >&2; exit 1; }
[ -f "$PASTA/tunel.env" ] || { echo "[implantar] $PASTA/tunel.env ausente (TUNNEL_TOKEN): o workflow grava antes" >&2; exit 1; }

install -m 644 "$ORIGEM/compose.yml" "$PASTA/compose.yml"
umask 077
perfis=""
[ "$BKO" = 1 ] && perfis="bko"
printf 'MACUXI_TAG=%s\nMACUXI_TAG_BKO=%s\nCOMPOSE_PROFILES=%s\n' "$TAG" "$TAG" "$perfis" > "$PASTA/imagens.env"
cd "$PASTA"
PERFIL=()
[ "$BKO" = 1 ] && PERFIL=(--profile bko)
dc() { docker compose --env-file .env --env-file imagens.env "${PERFIL[@]}" "$@"; }

log "baixando imagens (tag $TAG${perfis:+, perfis: $perfis})"
# banco e seed-demo usam a mesma imagem da api
dc pull --quiet

log "Postgres"
dc up -d --wait postgres

log "migrações (e papéis macuxi_app/macuxi_worker)"
for t in 1 2 3; do
  dc --profile ferramentas run --rm banco migrar up && break
  [ "$t" = 3 ] && { echo "[implantar] migrações falharam 3 vezes" >&2; exit 1; }
  log "migração falhou (tentativa $t); de novo em 10 s"
  sleep 10
done

MARCA="$PASTA/.base-demo-carregada"
if [ "$RECRIAR" = 1 ]; then
  log "base de demo: seed demo --recriar"
  dc --profile ferramentas run --rm seed-demo --recriar
  touch "$MARCA"
elif [ ! -f "$MARCA" ]; then
  log "primeiro deploy: seed demo"
  dc --profile ferramentas run --rm seed-demo
  touch "$MARCA"
fi

log "subindo os serviços"
dc up -d --remove-orphans --wait --wait-timeout 180

log "conferência local"
for i in $(seq 1 30); do
  curl -fsS -o /dev/null http://127.0.0.1:8100/v1/saude && break
  [ "$i" = 30 ] && { echo "[implantar] /v1/saude não respondeu" >&2; dc logs --tail 80 api >&2; exit 1; }
  sleep 2
done
log "api: /v1/saude ok"
# fotos: grava/lê/apaga um objeto de teste no bucket com as variáveis da API. Falha = AVISO (login e pedido seguem;
# só as fotos ficariam fora): confira MACUXI_S3_ENDPOINT/MACUXI_S3_ESTILO no compose.yml e os secrets DEMO_S3_*.
if ! dc exec -T api node --import tsx apps/api/src/sonda-armazenamento.ts; then
  echo "::warning::armazenamento de fotos (S3) falhou na sonda: veja a linha [sonda] acima"
fi
if [ "$BKO" = 1 ]; then
  for i in $(seq 1 30); do
    curl -fsS -o /dev/null http://127.0.0.1:3100/login && break
    [ "$i" = 30 ] && { echo "[implantar] BKO /login não respondeu" >&2; dc logs --tail 80 bko >&2; exit 1; }
    sleep 2
  done
  log "bko: /login ok"
fi

# ---------- backup (db/backup/, dono banco-dados; timer macuxi-backup.timer do preparar-vm.sh) ----------
# Os scripts do host saem da PRÓPRIA imagem publicada (mesma versão do serviço "backup"); o workflow só copia
# scripts/deploy/demo. Falha aqui é AVISO: o deploy da demo não depende do backup.
instalar_backup() {
  local destino="$PASTA/backup" tmp
  [ -d "$destino" ] || { echo "::warning::backup: $destino ausente (o preparar-vm.sh cria); scripts do backup não instalados"; return 0; }
  tmp="$(mktemp -d)"
  if dc --profile ferramentas run --rm --no-deps -T --entrypoint tar backup \
       -C /app/db/backup -cf - backup-vm.sh restaurar-vm.sh contagem.sql > "$tmp/b.tar" \
     && tar -xf "$tmp/b.tar" -C "$tmp" \
     && install -m 700 "$tmp/backup-vm.sh" "$tmp/restaurar-vm.sh" "$destino/" \
     && install -m 600 "$tmp/contagem.sql" "$destino/"; then
    log "backup: scripts em $destino ($(systemctl is-active macuxi-backup.timer 2>/dev/null || echo 'timer ?'))"
  else
    echo "::warning::backup: não consegui copiar db/backup/*.sh e contagem.sql da imagem para $destino"
  fi
  rm -rf "$tmp"
}

# Idade em horas do backup mais novo, lida da saída do "backup listar" (chave<TAB>tamanho, mais novo por último;
# chave <prefixo><banco>-AAAAMMDDTHHMMSSZ.dump). Sem backup: saída vazia.
idade_backup_horas() { # $1 = saída do listar, $2 = agora em epoch (opcional)
  local ultimo c quando
  ultimo="$(printf '%s\n' "$1" | cut -f1 | grep -E -- '-[0-9]{8}T[0-9]{6}Z\.dump$' | tail -n 1 || true)"
  [ -n "$ultimo" ] || return 0
  c="${ultimo%.dump}"; c="${c##*-}"
  quando="$(date -u -d "${c:0:4}-${c:4:2}-${c:6:2} ${c:9:2}:${c:11:2}:${c:13:2}" +%s)" || return 0
  echo $(( (${2:-$(date -u +%s)} - quando) / 3600 ))
}

# Aviso (nunca falha) se, depois do primeiro backup, não houver dump com menos de 26 h em backups/.
conferir_backup() {
  local saida idade disparou
  disparou="$(systemctl show macuxi-backup.timer -p LastTriggerUSec --value 2>/dev/null || true)"
  if ! saida="$(dc --profile ferramentas run --rm --no-deps -T backup listar 2>/dev/null)"; then
    echo "::warning::backup: não consegui listar backups/ no bucket (confira os secrets DEMO_S3_* e journalctl -u macuxi-backup)"
    return 0
  fi
  idade="$(idade_backup_horas "$saida")"
  if [ -z "$idade" ]; then
    if [ -z "$disparou" ] || [ "$disparou" = "n/a" ] || [ "$disparou" = "0" ]; then
      log "backup: nenhum ainda (o primeiro roda às 06:15 UTC; na mão: /opt/macuxi/backup/backup-vm.sh)"
    else
      echo "::warning::backup: o timer já rodou e não há nenhum dump em backups/ (journalctl -u macuxi-backup)"
    fi
  elif [ "$idade" -ge 26 ]; then
    echo "::warning::backup: o dump mais novo em backups/ tem ${idade} h (mais de 26 h): veja journalctl -u macuxi-backup"
  else
    log "backup: o mais novo tem ${idade} h"
  fi
}

instalar_backup || true
conferir_backup || true

docker image prune -f >/dev/null
dc ps --format 'table {{.Service}}\t{{.Status}}'
log "publicado: $TAG"
