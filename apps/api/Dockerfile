# syntax=docker/dockerfile:1.7
# Imagem da API e do worker da outbox (T-0074, ADR 0020). Contexto = RAIZ do monorepo (.dockerignore da raiz):
#   docker build -f apps/api/Dockerfile -t macuxi-api .
# A mesma imagem roda os três papéis do ambiente demo (scripts/deploy/demo/compose.yml):
#   api     → node --import tsx apps/api/src/servidor.ts   (padrão; porta MACUXI_API_PORTA, 8100)
#   worker  → node --import tsx apps/api/src/worker.ts
#   banco   → node --import tsx db/scripts/banco.ts <papeis|migrar up|seed demo --recriar>   (deploy e "recriar base demo")
# Os pacotes do monorepo são publicados como TypeScript puro (sem build): o tsx transpila na subida, como no `pnpm dev`.
# Nenhum segredo entra na imagem: tudo vem do /opt/macuxi/.env da VM (env_file do compose).

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
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --frozen-lockfile --filter "api..." --filter "@macuxi/db..."

FROM node:24-bookworm-slim AS final
ENV NODE_ENV=production \
    TZ=UTC \
    MACUXI_API_HOST=0.0.0.0 \
    MACUXI_API_PORTA=8100
WORKDIR /app
COPY --from=deps /app /app
# fotos no disco (MACUXI_ARQUIVOS_DRIVER=disco): o volume nomeado herda o dono desta pasta
RUN mkdir -p /dados/arquivos && chown node:node /dados/arquivos
USER node
EXPOSE 8100
# Sobe a API. O compose troca o comando para o worker e para os comandos do banco.
CMD ["node", "--import", "tsx", "apps/api/src/servidor.ts"]
