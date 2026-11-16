#!/usr/bin/env bash
# Comando único "antes do push" (agente testes). Passos, opções e o bloco do PR: docs/testes/antes-do-push.md.
set -uo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${RAIZ}" || exit 2

PG_LOCAL="db/scripts/pg-local.sh"
MODO=afetados
PG_LOCAL_REF=""
SAIDA=""
SEM_TESTS=0
PACOTES=()
ARQUIVOS=()
ORIGINAIS=("$@")

msg() { printf '[antes-do-push] %s\n' "$*" >&2; }
erro() {
  msg "ERRO: $*"
  exit 2
}
uso() {
  cat <<'USO'
Uso (raiz do repositório): bash tests/scripts/rodar-antes-do-push.sh [opções]   (detalhes: docs/testes/antes-do-push.md)
  (nenhuma)              afetados contra origin/main (o que vai no PR)
  --tudo                 todos os pacotes, o passo sem superusuário e tests/
  --pacote <nome>        só esses pacotes, mais tests/ (repetível)
  --so-tests             só pnpm test:tests
  --arquivo <caminho>    só esses arquivos de tests/ (repetível)
  --sem-tests            não roda tests/
  --pg-local-de <ref>    executa o db/scripts/pg-local.sh desse ref do git
  --saida <arquivo>      grava também o bloco Markdown nesse arquivo
USO
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tudo) MODO=tudo ;;
    --pacote)
      [[ -n "${2:-}" ]] || erro "--pacote exige o nome do pacote (ex.: @macuxi/db)"
      MODO=pacotes
      PACOTES+=("$2")
      shift
      ;;
    --so-tests) MODO=so-tests ;;
    --arquivo)
      [[ -n "${2:-}" ]] || erro "--arquivo exige um caminho de tests/"
      MODO=so-tests
      ARQUIVOS+=("$2")
      shift
      ;;
    --sem-tests) SEM_TESTS=1 ;;
    --pg-local-de)
      [[ -n "${2:-}" ]] || erro "--pg-local-de exige um ref do git"
      PG_LOCAL_REF="$2"
      shift
      ;;
    --saida)
      [[ -n "${2:-}" ]] || erro "--saida exige um arquivo"
      SAIDA="$2"
      shift
      ;;
    -h | --help)
      uso
      exit 0
      ;;
    *) erro "opção desconhecida: $1 (veja --help)" ;;
  esac
  shift
done

for a in "${ARQUIVOS[@]}"; do
  [[ -f "${a}" || -f "tests/${a}" ]] || erro "arquivo não encontrado: ${a}"
done

# ---------- Postgres local (script do banco-dados) ----------

pg_local() {
  if [[ -n "${PG_LOCAL_REF}" ]]; then
    git cat-file -e "${PG_LOCAL_REF}:${PG_LOCAL}" 2>/dev/null \
      || erro "${PG_LOCAL} não existe em ${PG_LOCAL_REF}"
    git show "${PG_LOCAL_REF}:${PG_LOCAL}" | bash -s -- "$@"
  else
    bash "${PG_LOCAL}" "$@"
  fi
}

if [[ -z "${PG_LOCAL_REF}" && ! -f "${PG_LOCAL}" ]]; then
  erro "${PG_LOCAL} não existe neste branch. Ele vem do PR do banco-dados (branch nuvem/pg-local-banco-dados):
  espere o merge e atualize o branch, ou rode com --pg-local-de origin/nuvem/pg-local-banco-dados."
fi

msg "subindo o Postgres local (${PG_LOCAL}${PG_LOCAL_REF:+ de ${PG_LOCAL_REF}})"
ENV_PG="$(pg_local --subir)" || erro "o ${PG_LOCAL} --subir falhou (mensagem acima)"
eval "${ENV_PG}"

node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>24||(a===24&&b>=7)?0:1)' \
  || erro "Node $(node -v) no PATH; os testes exigem >= 24.7 (crypto.argon2Sync). Veja docs/banco/README.md."
[[ -d node_modules ]] || erro "sem node_modules: rode pnpm install --frozen-lockfile antes"

PG_VERSAO="$(PGPASSWORD="${MACUXI_PG_ADMIN_SENHA}" psql -h "${MACUXI_PG_HOST}" -p "${MACUXI_PG_PORTA}" \
  -U "${MACUXI_PG_ADMIN_USUARIO}" -d postgres -Atqc 'show server_version' 2>/dev/null | awk '{print $1}')"
[[ -n "${PG_VERSAO}" ]] || erro "não consegui conectar no Postgres ${MACUXI_PG_HOST}:${MACUXI_PG_PORTA}"

# ---------- escopo ----------

# A decisão é a do CI, pelo próprio CLI (scripts/ci/escopo.mjs no modo workflow_dispatch: merge-base de HEAD com
# origin/main, só o que está commitado). Data fixa numa segunda-feira: a matriz de sexta é do push ao main.
timeout 60 git fetch -q origin main 2>/dev/null || msg "aviso: git fetch origin main falhou; uso o origin/main local"
ESCOPO_SAIDA="$(GITHUB_EVENT_NAME=workflow_dispatch GITHUB_OUTPUT='' MACUXI_CI_AGORA=2026-11-16T15:00:00Z \
  node scripts/ci/escopo.mjs)" || erro "scripts/ci/escopo.mjs falhou"
campo() { printf '%s\n' "${ESCOPO_SAIDA}" | sed -n "s/^$1=//p"; }
BASE_SHA="$(campo base)"
[[ -n "${BASE_SHA}" ]] || erro "sem merge-base de HEAD com origin/main"
N_ARQUIVOS="$(git diff --name-only --no-renames "${BASE_SHA}" HEAD | grep -c .)"
ESCOPO="$(campo escopo)"
# Nada commitado contra a base: o CI trataria a lista vazia como "todos os pacotes"; aqui não roda nada.
[[ "${N_ARQUIVOS}" -eq 0 ]] && ESCOPO=vazio
# Sem o job testes-pacotes = nenhum pacote (só tests/ mudou); com ele e filtro vazio = todos (lockfile, turbo.json...).
if [[ "$(campo jobs)" != *'"testes-pacotes"'* ]]; then
  PACOTES_CI=nenhum
elif [[ -n "$(campo filtro_test)" ]]; then
  PACOTES_CI=filtro
else
  PACOTES_CI=todos
fi

FILTRO=""          # filtro do turbo (vazio + RODAR_PACOTES=1 = todos)
RODAR_PACOTES=0
DB_SEM_SUPER=0
RODAR_TESTS=1
PARCIAL=""
case "${MODO}" in
  afetados)
    case "${ESCOPO}" in
      vazio | documentacao) RODAR_TESTS=0 ;;
      codigo)
        case "${PACOTES_CI}" in
          filtro)
            RODAR_PACOTES=1
            FILTRO="$(campo filtro_test)"
            ;;
          todos) RODAR_PACOTES=1 ;;
        esac
        [[ "$(campo db_sem_super)" == true ]] && DB_SEM_SUPER=1
        ;;
    esac
    ;;
  tudo)
    RODAR_PACOTES=1
    DB_SEM_SUPER=1
    ;;
  pacotes)
    RODAR_PACOTES=1
    for p in "${PACOTES[@]}"; do
      FILTRO+="${FILTRO:+ }--filter=${p}"
      [[ "${p}" == @macuxi/db ]] && DB_SEM_SUPER=1
    done
    PARCIAL="só os pacotes escolhidos (--pacote)"
    ;;
  so-tests)
    if [[ ${#ARQUIVOS[@]} -gt 0 ]]; then PARCIAL="só os arquivos escolhidos de tests/ (--arquivo)"; else PARCIAL="só tests/ (--so-tests)"; fi
    ;;
esac
if [[ "${SEM_TESTS}" -eq 1 && "${RODAR_TESTS}" -eq 1 ]]; then
  RODAR_TESTS=0
  PARCIAL="${PARCIAL:+${PARCIAL}; }sem tests/ (--sem-tests)"
fi
if [[ "${RODAR_PACOTES}" -eq 1 ]]; then SEL="${FILTRO:-todos}"; else SEL=nenhum; fi
msg "modo=${MODO} escopo=${ESCOPO} arquivos=${N_ARQUIVOS} pacotes=${SEL} sem-super=${DB_SEM_SUPER} tests=${RODAR_TESTS}"

# ---------- etapas ----------

LOGS="${MACUXI_ANTES_DO_PUSH_LOGS:-$(mktemp -d "${TMPDIR:-/tmp}/macuxi-antes-do-push.XXXXXX")}"
mkdir -p "${LOGS}"
LINHAS=()   # linhas da tabela Markdown
FALHOU=0
N_ETAPA=0

# Soma as linhas "Tests  N passed | M failed | K skipped (T)" do vitest (uma por pacote no turbo).
contar() {
  sed 's/\x1b\[[0-9;]*m//g' "$1" | awk '
    /(^|[: ])[ ]*Tests[ ]{2,}[0-9]/ {
      for (i = 1; i <= NF; i++) {
        if ($i ~ /^passed/) p += $(i-1); else if ($i ~ /^failed/) f += $(i-1);
        else if ($i ~ /^skipped/) s += $(i-1); else if ($i ~ /^todo/) t += $(i-1);
      }
    }
    END { printf "%d %d %d", p, f, s + t }'
}

# etapa <nome> <comando> [env...]: roda, mede, conta e guarda a linha da tabela.
etapa() {
  local nome="$1" cmd="$2" log ini fim seg codigo p f s res
  N_ETAPA=$((N_ETAPA + 1))
  log="${LOGS}/$(printf '%02d' "${N_ETAPA}")-$(printf '%s' "${nome}" | tr -c 'a-zA-Z0-9' '-').log"
  msg "▶ ${nome}: ${cmd}"
  ini="$(date +%s)"
  bash -c "${cmd}" 2>&1 | tee "${log}"
  codigo="${PIPESTATUS[0]}"
  fim="$(date +%s)"
  seg=$((fim - ini))
  read -r p f s <<<"$(contar "${log}")"
  if [[ "${codigo}" -eq 0 ]]; then res="verde"; else res="**VERMELHO** (saída ${codigo})"; FALHOU=1; fi
  LINHAS+=("| ${nome} | \`${cmd}\` | $((seg / 60))min$(printf '%02d' $((seg % 60)))s | ${p} | ${f} | ${s} | ${res} |")
  msg "■ ${nome}: ${res} em ${seg}s (${p} passados, ${f} falhos, ${s} pulados; log ${log})"
}

INICIO="$(date +%s)"
if [[ "${RODAR_PACOTES}" -eq 1 ]]; then
  etapa "pacotes" "pnpm exec turbo run test --continue ${FILTRO}"
fi
if [[ "${DB_SEM_SUPER}" -eq 1 ]]; then
  # Como no ci.yml (testes-pacotes): servidor 5433 limpo, o admin sem superusuário criado nele e a suíte do @macuxi/db.
  ini="$(date +%s)"
  if pg_local --limpar-5433 >"${LOGS}/limpar-5433.log" 2>&1; then
    etapa "admin sem superusuário (5433)" "MACUXI_PG_PORTA=5433 pnpm --filter @macuxi/db admin-sem-superusuario"
    etapa "@macuxi/db sem superusuário" "MACUXI_PG_PORTA=5433 MACUXI_PG_ADMIN_USUARIO=macuxi_admin_sem_super MACUXI_PG_ADMIN_SENHA=macuxi_admin_sem_super_ci MACUXI_PG_ADMIN_SEM_SUPER=1 pnpm --filter @macuxi/db test"
  else
    LINHAS+=("| limpar a 5433 | \`${PG_LOCAL} --limpar-5433\` | $(($(date +%s) - ini))s | 0 | 0 | 0 | **VERMELHO** (log ${LOGS}/limpar-5433.log) |")
    FALHOU=1
    msg "ERRO: ${PG_LOCAL} --limpar-5433 falhou; veja ${LOGS}/limpar-5433.log"
  fi
fi
if [[ "${RODAR_TESTS}" -eq 1 ]]; then
  etapa "tests/" "pnpm test:tests${ARQUIVOS[*]:+ ${ARQUIVOS[*]}}"
fi
TOTAL=$(($(date +%s) - INICIO))

# ---------- bloco do PR ----------

HEAD_SHA="$(git rev-parse HEAD)"
SUJO="$(git status --porcelain | head -1)"
if [[ "${N_ETAPA}" -eq 0 && "${#LINHAS[@]}" -eq 0 ]]; then
  GERAL="nada a rodar (escopo ${ESCOPO}: como no CI, sem testes)"
elif [[ "${FALHOU}" -eq 0 ]]; then
  GERAL="VERDE"
else
  GERAL="VERMELHO"
fi
[[ -n "${PARCIAL}" ]] && GERAL="${GERAL} — PARCIAL: ${PARCIAL}"

BLOCO="$(
  cat <<FIM
### Testes na sessão (antes do push)

- **Status geral:** ${GERAL}
- **HEAD:** \`${HEAD_SHA}\`${SUJO:+ (com mudanças não commitadas: rode de novo depois do commit)}
- **Base:** \`origin/main\` (merge-base \`${BASE_SHA}\`), ${N_ARQUIVOS} arquivo(s) alterado(s), escopo \`${ESCOPO}\`, modo \`${MODO}\`
- **Ambiente:** Node $(node -v), PostgreSQL ${PG_VERSAO} local sem Docker (5432 superusuário, 5433 sem superusuário)${MACUXI_PG_SEM_VECTOR:+, sem pgvector}
- **Comando:** \`bash tests/scripts/rodar-antes-do-push.sh${ORIGINAIS[*]:+$(printf ' %q' "${ORIGINAIS[@]}")}\`
- **Tempo total:** $((TOTAL / 60))min$(printf '%02d' $((TOTAL % 60)))s

| Etapa | Comando | Tempo | Passados | Falhos | Pulados | Resultado |
|---|---|---|---|---|---|---|
$(if [[ ${#LINHAS[@]} -gt 0 ]]; then printf '%s\n' "${LINHAS[@]}"; else echo '| — | — | — | — | — | — | nada a rodar |'; fi)
FIM
)"

printf '\n----- cole no corpo do PR -----\n%s\n-------------------------------\n' "${BLOCO}"
[[ -n "${SAIDA}" ]] && printf '%s\n' "${BLOCO}" >"${SAIDA}"
msg "logs em ${LOGS}"
[[ "${FALHOU}" -eq 0 ]] || exit 1
