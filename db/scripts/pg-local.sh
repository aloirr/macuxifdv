#!/usr/bin/env bash
# Postgres local SEM Docker para os testes de banco na sessão da nuvem (dono: banco-dados; R-20261115-213600-alexandre).
#
# Sobe os DOIS servidores do CI (.github/workflows/ci.yml, job de testes) com o PostgreSQL 16 do sistema:
#   5432  superusuário postgres/postgres: pnpm --filter @macuxi/db test, tests/ e os demais pacotes;
#   5433  servidor limpo, também postgres/postgres: pnpm --filter @macuxi/db admin-sem-superusuario + a suíte com
#         MACUXI_PG_ADMIN_SEM_SUPER=1 (o script exige servidor sem os papéis da aplicação: use --limpar-5433 para repetir).
# Como a imagem do CI: TZ=UTC, codificação UTF8, locale en_US.utf8 (gera com locale-gen se faltar) e pgvector.
# Diferenças conhecidas: pgvector 0.6.0 do Ubuntu (o CI tem 0.8.2) e fsync/synchronous_commit desligados (base descartável).
# O pacote fica no 16.15 travado pelo CI (digest no ci.yml): o script nunca atualiza o postgresql-16.
# Os dados ficam fora do repositório (MACUXI_PG_LOCAL_DIR, padrão /var/lib/postgresql/macuxi); nada sai da máquina.
#
# Uso (raiz do repositório):
#   bash db/scripts/pg-local.sh [--subir]   instala o que faltar, sobe 5432 e 5433 e imprime as linhas do --env
#   bash db/scripts/pg-local.sh --status    pg_isready e versão de cada servidor
#   bash db/scripts/pg-local.sh --parar     para os dois servidores (os dados ficam)
#   bash db/scripts/pg-local.sh --env       só as linhas export MACUXI_PG_...=... do CI (+ export PATH: pg_dump 16, Node 24)
#   bash db/scripts/pg-local.sh --limpar-5433  apaga e recria o servidor 5433 (para repetir o admin sem superusuário)
#   eval "$(bash db/scripts/pg-local.sh --env)"
set -euo pipefail

PG_VERSAO=16
PG_BIN="/usr/lib/postgresql/${PG_VERSAO}/bin"
BASE="${MACUXI_PG_LOCAL_DIR:-/var/lib/postgresql/macuxi}"
PORTAS=(5432 5433)
SENHA_ADMIN=postgres # senha pública do Postgres descartável do CI (a mesma do ci.yml); não é segredo
LOCALE_CI=en_US.UTF-8
NODE24_DIR="${MACUXI_NODE24_DIR:-/opt/node24}"

aviso() { printf '[pg-local] %s\n' "$*" >&2; }
falha() { aviso "ERRO: $*"; exit 1; }

linhas_env() {
  cat <<'FIM'
export MACUXI_PG_EXIGIR=1
export MACUXI_PG_AUTO_SUBIR=0
export MACUXI_PG_HOST=127.0.0.1
export MACUXI_PG_PORTA=5432
export MACUXI_PG_ADMIN_USUARIO=postgres
export MACUXI_PG_ADMIN_SENHA=postgres
FIM
  if [[ ! -f "/usr/share/postgresql/${PG_VERSAO}/extension/vector.control" ]]; then
    echo 'export MACUXI_PG_SEM_VECTOR=1'
  fi
  # psql/pg_dump/pg_restore nativos do 16 (sem o pg_wrapper em perl do /usr/bin) e o Node 24 de /opt/node24, se o do
  # PATH for anterior ao 24.7 (engines).
  local caminho="${PG_BIN}"
  if ! node_ok "$(command -v node || true)" && node_ok "${NODE24_DIR}/bin/node"; then
    caminho="${NODE24_DIR}/bin:${caminho}"
  fi
  echo "export PATH=\"${caminho}:\$PATH\""
}

# Node >= 24.7 (engines do package.json: crypto.argon2 do seed e node:sqlite)?
node_ok() {
  [[ -n "$1" && -x "$1" ]] || return 1
  "$1" -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>24||(a===24&&b>=7)?0:1)' 2>/dev/null
}

# Comando como o dono dos dados (postgres quando root; senão o próprio usuário).
como_dono() {
  if [[ "$(id -u)" -eq 0 ]]; then
    runuser -u postgres -- env TZ=UTC PGTZ=UTC "$@"
  else
    env TZ=UTC PGTZ=UTC "$@"
  fi
}

instalar() {
  if [[ ! -x "${PG_BIN}/postgres" ]]; then
    [[ "$(id -u)" -eq 0 ]] || falha "PostgreSQL ${PG_VERSAO} não instalado e não sou root para instalar."
    aviso "instalando postgresql-${PG_VERSAO} (apt)"
    apt-get update -qq || aviso "apt-get update falhou"
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends "postgresql-${PG_VERSAO}" \
      || falha "não consegui instalar postgresql-${PG_VERSAO}"
  fi
  local versao
  versao="$("${PG_BIN}/postgres" --version | awk '{print $3}')"
  [[ "${versao}" == "16.15" ]] || aviso "PostgreSQL ${versao} (o CI trava 16.15 pelo digest; a 16.16 muda a RLS do on conflict)"

  if [[ ! -f "/usr/share/postgresql/${PG_VERSAO}/extension/vector.control" ]]; then
    if [[ "$(id -u)" -eq 0 ]]; then
      local pacote="postgresql-${PG_VERSAO}-pgvector"
      apt-cache show "${pacote}" >/dev/null 2>&1 || apt-get update -qq || true
      # Nunca deixar o apt atualizar o postgresql-16 junto (16.15 travado).
      if apt-get install -s --no-install-recommends "${pacote}" 2>/dev/null | grep -q "^Inst postgresql-${PG_VERSAO} "; then
        aviso "o apt atualizaria o postgresql-${PG_VERSAO} para instalar o pgvector: pulei (MACUXI_PG_SEM_VECTOR=1)"
      else
        aviso "instalando ${pacote} (apt)"
        DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends "${pacote}" >/dev/null \
          || aviso "apt falhou no pgvector: os testes do vector pulam com MACUXI_PG_SEM_VECTOR=1"
      fi
    else
      aviso "sem pgvector e sem root: os testes do vector pulam com MACUXI_PG_SEM_VECTOR=1"
    fi
  fi

  if ! locale -a 2>/dev/null | grep -qi '^en_US\.utf-\?8$'; then
    if [[ "$(id -u)" -eq 0 ]] && command -v locale-gen >/dev/null; then
      locale-gen "${LOCALE_CI}" >/dev/null || aviso "locale-gen ${LOCALE_CI} falhou"
    fi
  fi
}

locale_base() {
  if locale -a 2>/dev/null | grep -qi '^en_US\.utf-\?8$'; then
    echo "${LOCALE_CI}"
  else
    aviso "sem locale en_US.UTF-8: base em C.UTF-8 (o caso A12 de ordem linguística pula)"
    echo C.UTF-8
  fi
}

pasta() { echo "${BASE}/${1}"; }

ouvindo_alheio() {
  # Porta ocupada por processo que não é o nosso servidor?
  local porta="$1" pid_arq
  pid_arq="$(pasta "${porta}")/postmaster.pid"
  if "${PG_BIN}/pg_isready" -q -h 127.0.0.1 -p "${porta}" 2>/dev/null; then
    [[ -f "${pid_arq}" ]] && kill -0 "$(head -1 "${pid_arq}")" 2>/dev/null && return 1
    return 0
  fi
  return 1
}

criar_cluster() {
  local porta="$1" dir senha_arq loc
  dir="$(pasta "${porta}")"
  [[ -f "${dir}/PG_VERSION" ]] && return 0
  loc="$(locale_base)"
  mkdir -p "${BASE}/run"
  [[ "$(id -u)" -eq 0 ]] && chown postgres:postgres "${BASE}" "${BASE}/run"
  senha_arq="$(mktemp)"
  printf '%s\n' "${SENHA_ADMIN}" >"${senha_arq}"
  [[ "$(id -u)" -eq 0 ]] && chown postgres "${senha_arq}"
  aviso "initdb ${dir} (locale ${loc})"
  como_dono "${PG_BIN}/initdb" -D "${dir}" -U postgres --pwfile="${senha_arq}" -E UTF8 --locale="${loc}" \
    --auth-local=peer --auth-host=scram-sha-256 >/dev/null
  rm -f "${senha_arq}"
  cat >>"${dir}/postgresql.conf" <<FIM

# --- db/scripts/pg-local.sh (testes de banco na sessão; base descartável) ---
port = ${porta}
listen_addresses = 'localhost'
unix_socket_directories = '${BASE}/run'
timezone = 'UTC'
log_timezone = 'UTC'
max_connections = 200
fsync = off
synchronous_commit = off
full_page_writes = off
FIM
}

subir_um() {
  local porta="$1" dir
  dir="$(pasta "${porta}")"
  if ouvindo_alheio "${porta}"; then
    falha "a porta ${porta} já tem um Postgres que não é deste script (ex.: o cluster main do Ubuntu). Pare-o: pg_ctlcluster ${PG_VERSAO} main stop"
  fi
  criar_cluster "${porta}"
  if como_dono "${PG_BIN}/pg_ctl" -D "${dir}" status >/dev/null 2>&1; then
    return 0
  fi
  como_dono "${PG_BIN}/pg_ctl" -D "${dir}" -l "${BASE}/${porta}.log" -w -t 60 start >/dev/null \
    || falha "o servidor ${porta} não subiu; veja ${BASE}/${porta}.log"
}

parar_um() {
  local dir
  dir="$(pasta "$1")"
  [[ -f "${dir}/PG_VERSION" ]] || return 0
  if como_dono "${PG_BIN}/pg_ctl" -D "${dir}" status >/dev/null 2>&1; then
    como_dono "${PG_BIN}/pg_ctl" -D "${dir}" -m fast -w stop >/dev/null
    aviso "parado: ${1}"
  fi
}

status() {
  local porta ok=0 versao
  for porta in "${PORTAS[@]}"; do
    if "${PG_BIN}/pg_isready" -q -h 127.0.0.1 -p "${porta}"; then
      versao="$(PGPASSWORD="${SENHA_ADMIN}" "${PG_BIN}/psql" -h 127.0.0.1 -p "${porta}" -U postgres -d postgres -Atqc 'show server_version' 2>/dev/null || echo '?')"
      echo "${porta}: de pé (PostgreSQL ${versao}; dados em $(pasta "${porta}"))"
    else
      echo "${porta}: parado"
      ok=1
    fi
  done
  return "${ok}"
}

subir() {
  instalar
  local porta
  for porta in "${PORTAS[@]}"; do subir_um "${porta}"; done
  # A senha precisa funcionar por TCP (scram), como no service container do CI.
  for porta in "${PORTAS[@]}"; do
    PGPASSWORD="${SENHA_ADMIN}" "${PG_BIN}/psql" -h 127.0.0.1 -p "${porta}" -U postgres -d postgres -Atqc 'select 1' >/dev/null \
      || falha "login postgres/postgres falhou na ${porta}"
  done
  status >&2
  if ! node_ok "$(command -v node || true)" && ! node_ok "${NODE24_DIR}/bin/node"; then
    aviso "Node do PATH anterior ao 24.7 (engines): a suíte falha no seed (crypto.argon2Sync). Instale o Node 24 em ${NODE24_DIR} (docs/banco/README.md)."
  fi
  linhas_env
}

case "${1:---subir}" in
  --subir) subir ;;
  --status) status ;;
  --parar) for p in "${PORTAS[@]}"; do parar_um "${p}"; done ;;
  --env) linhas_env ;;
  --limpar-5433)
    parar_um 5433
    rm -rf "$(pasta 5433)"
    instalar
    subir_um 5433
    status >&2
    ;;
  -h | --help) sed -n '2,21p' "$0" | sed 's/^# \{0,1\}//' ;;
  *) falha "opção desconhecida: $1 (use --subir, --status, --parar, --env, --limpar-5433)" ;;
esac
