# syntax=docker/dockerfile:1.7
# Imagem da API e do worker da outbox (T-0074, ADR 0020). Contexto = RAIZ do monorepo (.dockerignore da raiz):
#   docker build -f apps/api/Dockerfile -t macuxi-api .
# A mesma imagem roda os três papéis do ambiente demo (scripts/deploy/demo/compose.yml):
#   api     → node --import tsx apps/api/src/servidor.ts   (padrão; porta MACUXI_API_PORTA, 8100)
#   worker  → node --import tsx apps/api/src/worker.ts
#   banco   → node --import tsx db/scripts/banco.ts <papeis|migrar up|seed demo --recriar>   (deploy e "recriar base demo")
# Os pacotes do monorepo são publicados como TypeScript puro (sem build): o tsx transpila na subida, como no `pnpm dev`.
# Nenhum segredo entra na imagem: tudo vem do /opt/macuxi/.env da VM (env_file do compose).
#
# Alvos: "final" (o ÚLTIMO estágio, padrão do docker build: é a imagem macuxi-api da demo) e "teste-db" (T-0075):
#   docker build -f apps/api/Dockerfile --target teste-db -t macuxi-api-teste .
# A teste-db é a final + o Vitest do pnpm-lock do commit + pg_dump/pg_restore 16 (A9), para a suíte do @macuxi/db rodar contra o DBaaS a partir da VM,
# que não tem saída para o registry.npmjs.org (.github/workflows/dbaas-teste.yml). Nunca vai para a demo nem para produção.

FROM node:24-bookworm-slim AS base
ENV CI=1 \
    PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    NEXT_TELEMETRY_DISABLED=1 \
    TURBO_TELEMETRY_DISABLED=1
# pnpm da raiz (packageManager do package.json): uma versão só no CI, no PC e na imagem
RUN corepack enable && corepack prepare pnpm@12.11.2 --activate
WORKDIR /app

FROM base AS deps
COPY . .
# Só a API, o @macuxi/db (migrações e seeds) e o que eles importam. --frozen-lockfile: a imagem usa exatamente o lock do commit.
# --prod (ADR 0023): sem as devDependencies dos módulos (react-native, expo-router, next, vitest... das telas e testes);
# o tsx, que roda a API, o worker e o banco.ts, é dependência de produção da API.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --frozen-lockfile --prod --filter "api..." --filter "@macuxi/db..."

# Só para o alvo teste-db: as devDependencies do @macuxi/db (Vitest na versão do lock) numa pasta À PARTE, para não mexer
# no node_modules de produção do /app. Sem "...": nenhum módulo de tela entra (ADR 0023 continua valendo na final).
FROM base AS vitest-db
WORKDIR /opt/macuxi-vitest
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --frozen-lockfile --filter "@macuxi/db" && \
    mkdir -p db/node_modules && \
    { [ -f node_modules/vitest/package.json ] || [ -f db/node_modules/vitest/package.json ]; }

# Base comum da final e da teste-db (mesmas camadas da imagem de antes).
FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production \
    TZ=UTC \
    MACUXI_API_HOST=0.0.0.0 \
    MACUXI_API_PORTA=8100
WORKDIR /app
COPY --from=deps /app /app
# fotos no disco (MACUXI_ARQUIVOS_DRIVER=disco): o volume nomeado herda o dono desta pasta
RUN mkdir -p /dados/arquivos && chown node:node /dados/arquivos

# Imagem de teste do banco (T-0075): o db/dbaas/teste-compatibilidade.ts procura /app/node_modules/vitest e, achando,
# não chama o npm (C3.3). O link aponta para o Vitest do vitest-db; o Node resolve as dependências dele pelo caminho real.
FROM runtime AS teste-db
COPY --from=vitest-db /opt/macuxi-vitest/node_modules /opt/macuxi-vitest/node_modules
COPY --from=vitest-db /opt/macuxi-vitest/db/node_modules /opt/macuxi-vitest/db/node_modules
USER root
SHELL ["/bin/bash", "-euo", "pipefail", "-c"]
# A9 da ADR 0024 (restauração do dump, R-20261105-100628): pg_dump/pg_restore 16 do PGDG (o postgresql-client do bookworm
# é o 15, que recusa servidor 16). Baixado no build, no runner do GitHub; a VM continua só com o GHCR. Só neste alvo.
# A chave do repositório é fixada pelo fingerprint publicado pelo PGDG (www.postgresql.org/download/linux/debian):
# o build falha se o arquivo baixado tiver outra chave ou mais de uma. curl e gpg saem da imagem no mesmo RUN.
# Fingerprint fixo no RUN (não é ARG, para um --build-arg não trocar a chave).
# Sem versão fixa do pacote (DL3008): queremos o 16.x mais recente; a conferência abaixo garante o major 16.
# hadolint ignore=DL3008
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl gpg && \
    chave=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc && \
    install -d "$(dirname "$chave")" && \
    curl -fsSo "$chave" https://www.postgresql.org/media/keys/ACCC4CF8.asc && \
    fpr="$(GNUPGHOME="$(mktemp -d)" gpg --batch --show-keys --with-colons "$chave" | awk -F: '$1=="pub"{p=1;next} p&&$1=="fpr"{print $10;p=0}')" && \
    if [ "$fpr" != "B97B0AFCAA1A47F044F244A07FCC7D46ACCC4CF8" ]; then echo "chave do PGDG inesperada: '${fpr}'" >&2; exit 1; fi && \
    echo "deb [signed-by=$chave] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list && \
    apt-get update && apt-get install -y --no-install-recommends postgresql-client-16 && \
    apt-get purge -y curl gpg && apt-get autoremove -y && apt-get clean && rm -rf /var/lib/apt/lists/* /tmp/tmp.* && \
    for b in pg_dump pg_restore /usr/lib/postgresql/16/bin/pg_dump /usr/lib/postgresql/16/bin/pg_restore; do \
      v="$("$b" --version)" || exit 1; echo "$b: $v"; \
      case "$v" in *" 16."*) ;; *) echo "$b não é o 16.x" >&2; exit 1 ;; esac; \
    done
RUN alvo=/opt/macuxi-vitest/db/node_modules/vitest; \
    [ -f "$alvo/package.json" ] || alvo=/opt/macuxi-vitest/node_modules/vitest; \
    if [ ! -e /app/node_modules/vitest ]; then ln -s "$alvo" /app/node_modules/vitest; fi && \
    node /app/node_modules/vitest/vitest.mjs --version
USER node
LABEL org.macuxi.uso="teste do banco (T-0075); nunca em produção"

FROM runtime AS final
USER node
EXPOSE 8100
# Sobe a API. O compose troca o comando para o worker e para os comandos do banco.
CMD ["node", "--import", "tsx", "apps/api/src/servidor.ts"]
