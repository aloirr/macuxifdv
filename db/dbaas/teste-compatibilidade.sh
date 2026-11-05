#!/usr/bin/env bash
# Teste de compatibilidade do DBaaS PostgreSQL da Magalu (T-0075; dono: banco-dados). Roda NA VM da demo (a única
# máquina na VPC do DBaaS), chamado pelo workflow manual .github/workflows/dbaas-teste.yml (engenheiro-software) ou à
# mão por SSH. Não precisa de node/pnpm no host: o teste roda num contêiner descartável da imagem da API.
#
#   DBAAS_SENHA=... bash teste-compatibilidade.sh          (a senha só no ambiente do processo; nunca em argv/disco)
#   bash teste-compatibilidade.sh --senha-stdin < pipe      (alternativa: 1ª linha do stdin)
#
# Variáveis (padrões entre parênteses):
#   DBAAS_HOST (172.18.3.212) · DBAAS_PORTA (5432) · DBAAS_USUARIO (macuxi_admin) · DBAAS_BANCO (postgres: base de
#   manutenção) · DBAAS_SSLMODE (prefer | require | verify-full | disable) · DBAAS_SENHA (obrigatória) ·
#   DBAAS_DIR (pasta pai desta) · DBAAS_SAIDA ($DBAAS_DIR/saida) · DBAAS_RELATORIO ($DBAAS_SAIDA/relatorio.md) ·
#   MACUXI_IMAGEM_API (imagem com tag; sem tag usa MACUXI_SHA, o MACUXI_TAG de /opt/macuxi/imagens.env ou "main") ·
#   DBAAS_MIGRAR_ATE (vazio = a última migração da imagem) · DBAAS_SUITE (1; 0 pula a suíte) · DBAAS_VITEST_WORKERS (2) · DBAAS_TEMPO_SUITE_MIN (16) ·
#   DBAAS_HNSW_LINHAS (5000) · DBAAS_HNSW_DIM (1536) · DBAAS_VITEST_VERSAO (a do pnpm-lock.yaml da imagem) ·
#   DBAAS_PG_BIN (pasta do pg_dump/pg_restore 16 DENTRO da imagem, para o A9; vazio = PATH e /usr/lib/postgresql/1[67]/bin).
#   DBAAS_REPO_TGZ e DOCKER_CONFIG: não usados aqui (o código vem da imagem; o docker pull usa o DOCKER_CONFIG herdado).
#
# O que faz:
#   1. confere a rota (não pode sair por rede do Docker) e o alcance TCP de DBAAS_HOST:DBAAS_PORTA; falha com código 3;
#   2. sobe um contêiner da imagem da API (--network host, root só dentro dele, sem o .env da demo, sem a rede do compose)
#      com esta pasta em /app/db/dbaas e $DBAAS_SAIDA em /saida, e roda teste-compatibilidade.ts: base nova
#      macuxi_dbaas_AAAAMMDD_HHMMSS (CREATE DATABASE direto, sem ALTER ROLE), papéis (sem ALTER de atributo), o que o
#      admin pode (mgc_superuser, BYPASSRLS, session_replication_role), migrações até a última da imagem (0031 B1 e 0032 B2), RLS forçado, SECURITY
#      DEFINER, vector, seed demo, RLS na prática, exclusão de tenant, HNSW com EXPLAIN, os complementares da ADR 0024
#      (A12 collation e ctype, A11 vector × CI, A9 pg_dump/pg_restore numa 2ª base <base>_r, apagada logo depois) e a
#      suíte do @macuxi/db; onde falta privilégio, roda o caminho alternativo do plano B e marca ⚠️; no fim (sempre) apaga
#      as bases (a do teste, a restaurada e as da suíte) e os papéis de teste;
#   3. confere que a senha não aparece em nenhum arquivo de $DBAAS_SAIDA (apaga o arquivo e falha se aparecer).
# Saída: $DBAAS_RELATORIO (Markdown com ✅/⚠️/❌, versões, tempos e a seção "Plano B"), $DBAAS_SAIDA/execucao.log,
# suite.json e suite.log. DBAAS_SUITE=forcar roda a suíte mesmo com o log do servidor registrando comandos de papel;
# DBAAS_MANTER_PAPEIS=1 não apaga macuxi_app/macuxi_worker/macuxi_manutencao no fim.
# Código: 0 = pré-requisitos e critérios 1–4 ✅ · 1 = algum critério ❌ · 2 = configuração · 3 = sem alcance/rota ·
#         4 = critérios sem ❌ mas sobrou base/papel de teste · 5 = critérios sem ❌, mas algum ⚠️ (só com o plano B) ·
#         130 = interrompido (as bases e os papéis de teste são apagados antes de sair).
# Nunca toca o Postgres da demo: host local é recusado e o contêiner não entra na rede do compose nem lê o .env da demo.
set -uo pipefail
umask 077

log() { echo "[dbaas] $(date -u +%H:%M:%S) $*"; }
falhar() {
  local codigo="$1"
  shift
  echo "[dbaas] ❌ $*" >&2
  relatorio_minimo "$*" "$codigo"
  exit "$codigo"
}

ORIGEM="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SENHA_STDIN=0
for a in "$@"; do
  case "$a" in
    --senha-stdin) SENHA_STDIN=1 ;;
    *) echo "[dbaas] opção desconhecida: $a" >&2; exit 2 ;;
  esac
done

export DBAAS_HOST="${DBAAS_HOST:-172.18.3.212}"
export DBAAS_PORTA="${DBAAS_PORTA:-5432}"
export DBAAS_USUARIO="${DBAAS_USUARIO:-macuxi_admin}"
export DBAAS_BANCO="${DBAAS_BANCO:-postgres}"
export DBAAS_SSLMODE="${DBAAS_SSLMODE:-prefer}"
export DBAAS_MIGRAR_ATE="${DBAAS_MIGRAR_ATE:-}"
DBAAS_DIR="${DBAAS_DIR:-$(dirname "$ORIGEM")}"
DBAAS_SAIDA="${DBAAS_SAIDA:-$DBAAS_DIR/saida}"
DBAAS_RELATORIO="${DBAAS_RELATORIO:-$DBAAS_SAIDA/relatorio.md}"
for v in DBAAS_SUITE DBAAS_VITEST_WORKERS DBAAS_TEMPO_SUITE_MIN DBAAS_HNSW_LINHAS DBAAS_HNSW_DIM DBAAS_VITEST_VERSAO DBAAS_PG_BIN; do
  # shellcheck disable=SC2163
  [ -n "${!v:-}" ] && export "$v"
done

mkdir -p "$DBAAS_SAIDA"

# Relatório de uma linha quando o contêiner nem chega a rodar (configuração, rota, alcance, Docker).
relatorio_minimo() {
  {
    echo '# Teste de compatibilidade do DBaaS PostgreSQL da Magalu (T-0075)'
    echo
    echo "- Quando (UTC): $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "- Alvo: ${DBAAS_HOST}:${DBAAS_PORTA}"
    echo
    echo "**❌ RESULTADO: o teste não rodou — $1**"
    echo
    echo "Código de saída: $2 (0 = ok · 1 = critério ❌ · 2 = configuração · 3 = sem alcance · 4 = limpeza ❌ · 5 = só com o plano B (⚠️))"
  } > "$DBAAS_RELATORIO"
}

# ---------- configuração ----------
if [ "$SENHA_STDIN" = 1 ]; then
  IFS= read -r DBAAS_SENHA || true
fi
[ -n "${DBAAS_SENHA:-}" ] || falhar 2 "senha do admin ausente: defina DBAAS_SENHA no ambiente do processo (ou use --senha-stdin)"
[[ "$DBAAS_HOST" =~ ^[A-Za-z0-9.-]{1,253}$ ]] || falhar 2 "DBAAS_HOST inválido"
case "${DBAAS_HOST,,}" in
  localhost | 127.* | 0.0.0.0 | ::1 | postgres | macuxi-postgres | macuxi-postgres-testes | host.docker.internal)
    falhar 2 "DBAAS_HOST=$DBAAS_HOST é local ou o Postgres da demo: recusado (só o DBaaS)" ;;
esac
[[ "$DBAAS_PORTA" =~ ^[0-9]{1,5}$ ]] || falhar 2 "DBAAS_PORTA inválida"
case "$DBAAS_SSLMODE" in prefer | require | verify-full | disable) ;; *) falhar 2 "DBAAS_SSLMODE: use prefer, require, verify-full ou disable" ;; esac
command -v docker >/dev/null 2>&1 || falhar 2 "docker não encontrado na VM"
docker info >/dev/null 2>&1 || falhar 2 "sem acesso ao Docker (o usuário precisa do grupo docker)"

IMAGEM="${MACUXI_IMAGEM_API:-ghcr.io/aloirr/macuxi-api}"
if [[ "${IMAGEM##*/}" != *:* ]]; then
  TAG="${MACUXI_SHA:-}"
  if [ -z "$TAG" ] && [ -r /opt/macuxi/imagens.env ]; then
    TAG="$(sed -n 's/^MACUXI_TAG=//p' /opt/macuxi/imagens.env | head -n 1)"
  fi
  IMAGEM="$IMAGEM:${TAG:-main}"
fi
[[ "$IMAGEM" =~ ^[A-Za-z0-9./_:@-]{1,300}$ ]] || falhar 2 "MACUXI_IMAGEM_API inválida"

# ---------- 1. rota e alcance ----------
ROTA_DEV="$(ip -o route get "$DBAAS_HOST" 2>/dev/null | sed -n 's/.* dev \([^ ]*\).*/\1/p' | head -n 1)"
case "$ROTA_DEV" in
  docker* | br-* | veth*)
    falhar 3 "a rota até $DBAAS_HOST sai pela rede do Docker (dev $ROTA_DEV): a sub-rede de uma rede do compose colide com a da VPC; mude o address pool do Docker ou a sub-rede do DBaaS" ;;
esac
log "rota até o DBaaS: dev ${ROTA_DEV:-desconhecido}"
if (exec 3<>/dev/tcp/127.0.0.1/5432) 2>/dev/null; then
  falhar 2 "algo escuta em 127.0.0.1:5432 nesta VM: recusado (o contêiner usa --network host e nunca pode alcançar um Postgres local)"
fi
t0="$(date +%s%N)"
if ! timeout 8 bash -c 'exec 3<>"/dev/tcp/$0/$1"' "$DBAAS_HOST" "$DBAAS_PORTA" 2>/dev/null; then
  falhar 3 "não alcancei $DBAAS_HOST:$DBAAS_PORTA a partir da VM em 8 s: confira se a instância está ativa, se está na mesma VPC/sub-rede da VM e se o grupo de segurança do DBaaS libera a $DBAAS_PORTA para o IP privado da VM"
fi
export DBAAS_ALCANCE_MS="$(( ($(date +%s%N) - t0) / 1000000 ))"
export DBAAS_ROTA_DEV="${ROTA_DEV:-desconhecido}"
log "✅ alcance TCP $DBAAS_HOST:$DBAAS_PORTA em ${DBAAS_ALCANCE_MS} ms"

# ---------- 2. contêiner do teste ----------
if ! docker image inspect "$IMAGEM" >/dev/null 2>&1; then
  log "baixando a imagem $IMAGEM"
  docker pull --quiet "$IMAGEM" >/dev/null || falhar 2 "não consegui baixar a imagem $IMAGEM (login no GHCR?)"
fi

NOME="macuxi-dbaas-teste-$$"
REL_DIR="$(cd "$(dirname "$DBAAS_RELATORIO")" 2>/dev/null && pwd || true)"
REL_NOME="relatorio.md"
[ "$REL_DIR" = "$(cd "$DBAAS_SAIDA" && pwd)" ] && REL_NOME="$(basename "$DBAAS_RELATORIO")"

rodar_conteiner() {
  # senha pelo stdin do contêiner (printf é embutido do bash: não vai para argv nem para o docker inspect)
  printf '%s\n' "$DBAAS_SENHA" | docker run -i --rm --name "$1" --network host --user 0:0 \
    -e DBAAS_SENHA_STDIN=1 \
    -e DBAAS_HOST -e DBAAS_PORTA -e DBAAS_USUARIO -e DBAAS_BANCO -e DBAAS_SSLMODE -e DBAAS_MIGRAR_ATE \
    -e DBAAS_SUITE -e DBAAS_VITEST_WORKERS -e DBAAS_TEMPO_SUITE_MIN -e DBAAS_HNSW_LINHAS -e DBAAS_HNSW_DIM -e DBAAS_VITEST_VERSAO -e DBAAS_PG_BIN \
    -e DBAAS_ALCANCE_MS -e DBAAS_ROTA_DEV \
    -e DBAAS_SAIDA_CONTEINER=/saida -e "DBAAS_RELATORIO_CONTEINER=/saida/$REL_NOME" \
    -e "DBAAS_DONO=$(id -u):$(id -g)" -e "DBAAS_IMAGEM=$IMAGEM" \
    -v "$ORIGEM:/app/db/dbaas:ro" -v "$DBAAS_SAIDA:/saida" \
    --entrypoint node "$IMAGEM" --import tsx db/dbaas/teste-compatibilidade.ts "${@:2}"
}

limpar_emergencia() {
  trap - INT TERM
  log "interrompido: parando o contêiner e apagando as bases de teste do DBaaS"
  docker rm -f "$NOME" >/dev/null 2>&1 || true
  # só apaga as bases macuxi_dbaas_* e macuxi_teste_* e os papéis de teste (conexões com timeout de 15 s; drop … with force)
  rodar_conteiner "$NOME-limpeza" --so-limpar 2>&1 | tee -a "$DBAAS_SAIDA/execucao.log" || true
  exit 130
}
trap limpar_emergencia INT TERM

log "imagem $IMAGEM · contêiner $NOME"
# em segundo plano + wait: o trap de TERM (timeout do workflow) roda na hora, sem esperar o docker terminar
( rodar_conteiner "$NOME" 2>&1 | tee "$DBAAS_SAIDA/execucao.log"; exit "${PIPESTATUS[0]}" ) &
FILHO=$!
wait "$FILHO"
CODIGO=$?
trap - INT TERM

# ---------- 3. conferência da saída ----------
if [ ! -s "$DBAAS_SAIDA/$REL_NOME" ]; then
  relatorio_minimo "o contêiner terminou sem relatório (código $CODIGO); veja execucao.log" "$CODIGO"
  [ "$CODIGO" = 0 ] && CODIGO=1
elif [ "$DBAAS_SAIDA/$REL_NOME" != "$DBAAS_RELATORIO" ]; then
  cp "$DBAAS_SAIDA/$REL_NOME" "$DBAAS_RELATORIO"
fi
# a senha não pode estar em nenhum arquivo da saída (padrão lido de um descritor, nunca de argv)
VAZADOS="$(grep -rlF -f <(printf '%s\n' "$DBAAS_SENHA") "$DBAAS_SAIDA" "$DBAAS_RELATORIO" 2>/dev/null | sort -u || true)"
if [ -n "$VAZADOS" ]; then
  while IFS= read -r f; do rm -f -- "$f"; done <<< "$VAZADOS"
  echo "[dbaas] ❌ a senha apareceu em arquivo(s) da saída: apagados" >&2
  relatorio_minimo "a senha apareceu num arquivo da saída (apagado); o resultado não vale" 1
  CODIGO=1
fi
unset DBAAS_SENHA
log "fim: código $CODIGO · relatório em $DBAAS_RELATORIO"
exit "$CODIGO"
