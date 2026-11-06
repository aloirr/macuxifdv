#!/usr/bin/env bash
# Publicação da PRODUÇÃO na VM macuxi-prod-se1 (T-0086, ADR 0028). Roda NA VM, como o usuário de deploy (grupo docker), a
# partir da pasta para onde o workflow "producao — publicar" copiou scripts/deploy/producao/ (+ o alerta-saude.sh).
#
#   bash implantar.sh --api <imagem@sha256:...> --versao <vX.Y.Z> [--bko <imagem@sha256:...>]
#
#   --api     imagem da API/worker/migrações POR DIGEST (a mesma que passou no CI do commit da tag; o workflow confere)
#   --bko     imagem do BKO de produção por digest (liga o perfil bko); sem ela o BKO fica parado
#   --versao  tag v* publicada: vai para MACUXI_VERSAO e o /v1/saude a devolve (prova de que a versão nova está no ar)
#
# Ordem: guarda a versão em uso (imagens.env + compose.yml → *.anterior) → compose novo e imagens.env → pull → modo do TLS
# → banco-dbaas.sh (papéis B0, banco, vector, migrações com o admin herdando o macuxi_manutencao, conferências) → up -d →
# conferência local (/v1/saude 200 com banco ok e a versão nova; BKO /login) → scripts do backup tirados da imagem →
# docker image prune -f.
# Falha ANTES do up (pull, banco, migração): nada da aplicação mudou; os arquivos anteriores voltam; saída 1.
# Falha DEPOIS do up (conferência): VOLTA ATRÁS para a versão anterior (imagens e compose), confere de novo e sai com 3
# (workflow vermelho, produção na versão anterior). Migração aplicada NÃO é desfeita: as migrações são aditivas
# (ADR 0024, item 6) e a versão anterior roda sobre o esquema novo. Sem versão anterior (1º deploy): sai com 1.
# Nenhum segredo é impresso: os .env só são lidos pelo compose.
set -euo pipefail

API=""; BKO=""; VERSAO=""
while [ $# -gt 0 ]; do
  case "$1" in
    --api) API="${2:-}"; shift 2 ;;
    --bko) BKO="${2:-}"; shift 2 ;;
    --versao) VERSAO="${2:-}"; shift 2 ;;
    *) echo "[implantar] opção desconhecida: $1" >&2; exit 2 ;;
  esac
done
REF='^[a-z0-9][a-z0-9./_-]*(:[0-9]+)?/[a-z0-9./_-]+(@sha256:[a-f0-9]{64}|:[A-Za-z0-9._-]{1,128})$'
[[ "$API" =~ $REF ]] || { echo "[implantar] --api inválida (esperado registro/imagem@sha256:<digest>)" >&2; exit 2; }
[ -z "$BKO" ] || [[ "$BKO" =~ $REF ]] || { echo "[implantar] --bko inválida" >&2; exit 2; }
[[ "$VERSAO" =~ ^v[0-9A-Za-z._-]{1,64}$ ]] || { echo "[implantar] --versao inválida (esperado v*)" >&2; exit 2; }

ORIGEM="$(cd "$(dirname "$0")" && pwd)"
PASTA=/opt/macuxi
log() { echo "[implantar] $(date -u +%H:%M:%S) $*"; }

for f in .env banco.env admin.env tunel.env; do
  [ -s "$PASTA/$f" ] || { echo "[implantar] $PASTA/$f ausente: preparar-vm.sh (.env) e workflow (banco/admin/tunel.env) gravam antes" >&2; exit 1; }
done

cd "$PASTA"
# perfil bko explícito (lido do imagens.env em uso a cada chamada: na volta atrás vale o da versão anterior)
dc() {
  local p=()
  grep -q "^COMPOSE_PROFILES=.*bko" imagens.env 2>/dev/null && p=(--profile bko)
  docker compose --env-file .env --env-file imagens.env "${p[@]}" "$@"
}

# ---------- versão em uso (para voltar atrás) ----------
TEM_ANTERIOR=0
if [ -f imagens.env ] && [ -f compose.yml ]; then
  cp -p imagens.env imagens.anterior.env
  cp -p compose.yml compose.anterior.yml
  TEM_ANTERIOR=1
  log "versão em uso guardada: $(sed -n 's/^MACUXI_VERSAO=//p' imagens.anterior.env)"
fi
restaurar_arquivos() {
  if [ "$TEM_ANTERIOR" = 1 ]; then
    cp -p imagens.anterior.env imagens.env
    cp -p compose.anterior.yml compose.yml
  fi
}

# ---------- TLS do banco ----------
# verify-full só com a CA do DBaaS (secret PROD_PG_CA_CERT → certs/dbaas-ca.pem); sem ela, cifra sem conferir o
# certificado (o mesmo do teste da ADR 0024). MACUXI_PG_SSL_FORCAR=require|verify-full troca (só manutenção).
if [ -n "${MACUXI_PG_SSL_FORCAR:-}" ]; then
  LIBPQ="$MACUXI_PG_SSL_FORCAR"
elif [ -s certs/dbaas-ca.pem ]; then
  LIBPQ=verify-full
else
  LIBPQ=require
fi
case "$LIBPQ" in
  verify-full) NODE_SSL=verify-full ;;
  require) NODE_SSL=no-verify; echo "::warning::TLS com o DBaaS sem conferir o certificado (falta o secret PROD_PG_CA_CERT): a conexão é cifrada, mas não autenticada" ;;
  *) echo "[implantar] MACUXI_PG_SSL_FORCAR inválido: $LIBPQ (require|verify-full)" >&2; exit 2 ;;
esac

# ---------- compose e imagens novos ----------
umask 077
install -m 644 "$ORIGEM/compose.yml" "$PASTA/compose.yml"
perfis=""
[ -n "$BKO" ] && perfis="bko"
{
  printf 'MACUXI_IMAGEM_API=%s\n' "$API"
  printf 'MACUXI_IMAGEM_BKO=%s\n' "${BKO:-ghcr.io/aloirr/macuxi-bko-prod:ausente}"
  printf 'MACUXI_VERSAO=%s\n' "$VERSAO"
  printf 'COMPOSE_PROFILES=%s\n' "$perfis"
  printf 'MACUXI_PG_SSL_NODE=%s\nMACUXI_PG_SSL_LIBPQ=%s\n' "$NODE_SSL" "$LIBPQ"
} > imagens.env
log "publicando $VERSAO (api ${API##*@}${BKO:+, bko ${BKO##*@}}; TLS $LIBPQ)"

antes_do_up() { # $1 = mensagem
  echo "[implantar] $1: nada da aplicação foi trocado" >&2
  restaurar_arquivos
  exit 1
}

log "baixando imagens"
dc --profile ferramentas pull --quiet || antes_do_up "pull falhou"

log "banco (DBaaS): papéis, extensão, migrações e conferências"
bash "$ORIGEM/banco-dbaas.sh" || antes_do_up "banco-dbaas.sh falhou"

# ---------- conferência ----------
conferir() { # 0 = api com banco ok e a versão esperada (e o BKO, se ligado)
  local corpo="" i
  for i in $(seq 1 45); do
    corpo="$(curl -fsS -m 5 http://127.0.0.1:8100/v1/saude 2>/dev/null || true)"
    if printf '%s' "$corpo" | grep -q '"banco":"ok"' && printf '%s' "$corpo" | grep -q "\"versao\":\"$1\""; then
      log "api: /v1/saude ok (banco ok, versão $1)"
      break
    fi
    [ "$i" = 45 ] && { echo "[implantar] /v1/saude sem banco ok ou sem a versão $1 em 90 s" >&2; return 1; }
    sleep 2
  done
  if grep -q '^COMPOSE_PROFILES=.*bko' imagens.env; then
    for i in $(seq 1 30); do
      curl -fsS -m 5 -o /dev/null http://127.0.0.1:3100/login && { log "bko: /login ok"; return 0; }
      sleep 2
    done
    echo "[implantar] BKO /login não respondeu" >&2
    return 1
  fi
}

log "subindo os serviços"
subiu=0
dc up -d --remove-orphans --wait --wait-timeout 240 && subiu=1
if [ "$subiu" = 1 ] && conferir "$VERSAO"; then
  :
else
  echo "[implantar] a versão $VERSAO não passou na conferência" >&2
  dc logs --no-color --tail 60 api worker >&2 || true
  if [ "$TEM_ANTERIOR" != 1 ]; then
    echo "[implantar] primeiro deploy: não há versão anterior para voltar (serviços ficam como estão para diagnóstico)" >&2
    exit 1
  fi
  restaurar_arquivos
  versao_ant="$(sed -n 's/^MACUXI_VERSAO=//p' imagens.env)"
  echo "::error::voltando atrás para $versao_ant"
  dc up -d --remove-orphans --wait --wait-timeout 240 || true
  if conferir "$versao_ant"; then
    echo "::error::produção de volta em $versao_ant (a $VERSAO falhou na conferência)"
  else
    echo "::error::a volta para $versao_ant também falhou na conferência: veja docs/status/producao.md, 'Voltar atrás'"
  fi
  exit 3
fi

# fotos: grava/lê/apaga um objeto de teste no bucket. Falha = AVISO (login e pedido seguem; só as fotos ficam fora).
if ! dc exec -T api node --import tsx apps/api/src/sonda-armazenamento.ts; then
  echo "::warning::armazenamento de fotos (S3, bucket macuxi-prod) falhou na sonda: confira os secrets PROD_S3_*"
fi

# ---------- backup (db/backup/, dono banco-dados; timer macuxi-backup.timer do preparar-vm.sh) ----------
# Os scripts do host saem da PRÓPRIA imagem publicada. Falha aqui é AVISO: a publicação não depende do backup.
instalar_backup() {
  local destino="$PASTA/backup" tmp
  [ -d "$destino" ] || { echo "::warning::backup: $destino ausente (o preparar-vm.sh cria)"; return 0; }
  tmp="$(mktemp -d)"
  if dc --profile ferramentas run --rm --no-deps -T --entrypoint sh backup -c \
       'cd /app/db/backup && ls backup-dbaas.sh ensaio-restauracao.sh contagem.sql 2>/dev/null | xargs -r tar -cf -' > "$tmp/b.tar" \
     && tar -xf "$tmp/b.tar" -C "$tmp"; then
    local n=0 f
    for f in backup-dbaas.sh ensaio-restauracao.sh; do
      [ -f "$tmp/$f" ] && { install -m 700 "$tmp/$f" "$destino/"; n=$((n + 1)); }
    done
    [ -f "$tmp/contagem.sql" ] && install -m 600 "$tmp/contagem.sql" "$destino/"
    if [ -f "$destino/backup-dbaas.sh" ]; then
      log "backup: $n script(s) em $destino (timer $(systemctl is-active macuxi-backup.timer 2>/dev/null || echo '?'))"
    else
      echo "::warning::backup: a imagem ainda não traz db/backup/backup-dbaas.sh (banco-dados, T-0086): sem backup diário"
    fi
  else
    echo "::warning::backup: não consegui copiar os scripts de db/backup/ da imagem"
  fi
  rm -rf "$tmp"
}
instalar_backup || true

log "alerta: $(systemctl is-active macuxi-alerta.timer 2>/dev/null || echo '?') ($( /opt/macuxi/alerta-saude.sh --mostrar 2>/dev/null | head -n 1 || echo 'estado ?'))"

docker image prune -f >/dev/null
dc ps --format 'table {{.Service}}\t{{.Status}}'
log "publicado: $VERSAO"
