# syntax=docker/dockerfile:1.7
# Imagem do BKO (shell Next.js) para o ambiente demo (T-0074, ADR 0020). Contexto = RAIZ do monorepo (.dockerignore da raiz):
#   docker build -f apps/web/Dockerfile -t macuxi-bko .
#   docker run -p 3100:3100 macuxi-bko        → http://localhost:3100/login
# No compose da VM (scripts/deploy/demo/compose.yml) o serviço se chama `bko` (rota do túnel: http://bko:3100) e fala
# com a API pela rede interna (`api:8100`).
#
# O endereço da API é GRAVADO NO BUILD: o rewrite same-origin `/api-proxy/*` → NEXT_PUBLIC_API_URL (next.config.ts) e
# o NEXT_PUBLIC_* do navegador saem do `next build`. Trocar a API = nova imagem (--build-arg NEXT_PUBLIC_API_URL=...).
# MACUXI_BKO_ORIGEM: origem pública aceita pelo Next (Server Actions). Nenhum dos dois é segredo; nenhum segredo entra
# na imagem (o BKO não usa nenhum: o login e os tokens passam pela API).
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

FROM base AS build
COPY . .
# Só o BKO e o que ele importa (pacotes e módulos do monorepo). --frozen-lockfile: exatamente o lock do commit.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --frozen-lockfile --filter "web..."
ARG NEXT_PUBLIC_API_URL=http://api:8100/v1
ARG MACUXI_BKO_ORIGEM=https://bko-demo.macuxifdv.com.br
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    MACUXI_BKO_ORIGEM=$MACUXI_BKO_ORIGEM \
    MACUXI_NEXT_STANDALONE=1 \
    NODE_ENV=production
RUN pnpm --filter web exec next build

FROM node:24-bookworm-slim AS final
ARG MACUXI_BKO_ORIGEM=https://bko-demo.macuxifdv.com.br
# HOSTNAME explícito: o Docker preenche HOSTNAME com o id do container e o server.js do standalone escuta nele.
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    TZ=UTC \
    PORT=3100 \
    HOSTNAME=0.0.0.0 \
    MACUXI_BKO_ORIGEM=$MACUXI_BKO_ORIGEM
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
