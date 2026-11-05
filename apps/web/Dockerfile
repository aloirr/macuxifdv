# syntax=docker/dockerfile:1.7
# Imagem do BKO (shell Next.js) para o ambiente demo (T-0074, ADR 0020). Contexto = RAIZ do monorepo (.dockerignore da raiz):
#   docker build -f apps/web/Dockerfile -t macuxi-bko .
#   docker run -p 3100:3100 macuxi-bko        → http://localhost:3100/login
# No compose da VM (scripts/deploy/demo/compose.yml) o serviço se chama `bko` (rota do túnel: http://bko:3100) e fala
# com a API pela rede interna (`api:8100`).
#
# O endereço da API é GRAVADO NO BUILD: o rewrite same-origin `/api-proxy/*` → NEXT_PUBLIC_API_URL (next.config.ts) e
# o NEXT_PUBLIC_* do navegador saem do `next build`. Trocar a API = nova imagem (--build-arg NEXT_PUBLIC_API_URL=...).
# MACUXI_BKO_ORIGEM: origem pública aceita pelo Next (allowedOrigins das Server Actions), também GRAVADA NO BUILD: o
# server.js do standalone leva o next.config serializado e não relê o next.config.ts nem o ambiente. Trocar a origem =
# nova imagem (--build-arg MACUXI_BKO_ORIGEM=...); a variável no estágio final ou no environment do compose não muda nada.
# Nenhum dos dois é segredo; nenhum segredo entra na imagem (o BKO não usa nenhum: o login e os tokens passam pela API).
#
# Saída `standalone` (MACUXI_NEXT_STANDALONE=1 no build): a imagem final leva só o server.js e os node_modules
# rastreados pelo Next, sem o Expo/React Native que o pnpm instala como peer dos módulos.

FROM node:24-bookworm-slim AS base
ENV CI=1 \
    PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    NEXT_TELEMETRY_DISABLED=1 \
    TURBO_TELEMETRY_DISABLED=1
# pnpm da raiz (packageManager do package.json): uma versão só no CI, no PC e nas imagens
RUN corepack enable && corepack prepare pnpm@12.11.2 --activate
WORKDIR /app

# Instalação em camada própria (T-0074, 🟢 1 da revisão): o `pnpm install` só depende dos MANIFESTOS (todos os
# package.json do workspace, pnpm-lock.yaml, pnpm-workspace.yaml, .pnpmfile.cjs, .npmrc e patches/). Mudou só código?
# A camada do install vem do cache de camadas (no CI, `cache-from/cache-to: type=gha,mode=max` do demo-publicar) e o
# build pula direto para o `next build`. Por que não `pnpm fetch`: ele não aceita --filter e guardaria a store do monorepo
# inteiro (Expo/React Native) no cache do GitHub; e o `--mount=type=cache` da store não sobrevive entre runners do CI
# (só ajuda em builds repetidos na mesma máquina). Por que não `turbo prune --docker`: lockfile podado regenerado pelo
# turbo, que pode divergir do lock do commit (--frozen-lockfile) com o .pnpmfile.cjs e o nodeLinker hoisted.
# A imagem final é a mesma: mesmo lockfile, mesmo filtro, mesmo `next build` sobre a árvore inteira.
FROM base AS manifestos
COPY . .
# Apaga tudo o que não é manifesto e as pastas que ficaram vazias: pasta ou arquivo de código novo não muda o
# resultado, e o COPY --from abaixo (cache por conteúdo no BuildKit) continua acertando o cache.
RUN find . ! -type d ! \( -name package.json -o -name pnpm-lock.yaml -o -name pnpm-workspace.yaml -o -name .npmrc \
        -o -name .pnpmfile.cjs -o -path './patches/*' \) -delete && \
    find . -mindepth 1 -depth -type d -empty -delete

FROM base AS build
COPY --from=manifestos /app/ ./
# Só o BKO e o que ele importa (pacotes e módulos do monorepo). --frozen-lockfile: exatamente o lock do commit.
# O cache da store fica para builds locais repetidos (no CI quem economiza é o cache da camada).
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --frozen-lockfile --filter "web..."
# Agora o código (o .dockerignore deixa os node_modules de fora: os instalados acima ficam intactos).
COPY . .
ARG NEXT_PUBLIC_API_URL=http://api:8100/v1
ARG MACUXI_BKO_ORIGEM=https://bko-demo.macuxifdv.com.br
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    MACUXI_BKO_ORIGEM=$MACUXI_BKO_ORIGEM \
    MACUXI_NEXT_STANDALONE=1 \
    NODE_ENV=production
RUN pnpm --filter web exec next build

FROM node:24-bookworm-slim AS final
# HOSTNAME explícito: o Docker preenche HOSTNAME com o id do container e o server.js do standalone escuta nele.
# Sem MACUXI_BKO_ORIGEM aqui: a origem ficou gravada no next build (ver o cabeçalho).
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    TZ=UTC \
    PORT=3100 \
    HOSTNAME=0.0.0.0
WORKDIR /app
# .next/standalone espelha o monorepo (rastreio a partir da raiz): o servidor fica em apps/web/server.js.
# Os arquivos estáticos (.next/static) não entram no standalone: copiados à parte. O BKO não tem pasta public/.
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3100
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:3100/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
# Equivale a `next start -p 3100 -H 0.0.0.0` (PORT e HOSTNAME acima), sem precisar do pacote next inteiro.
CMD ["node", "apps/web/server.js"]
