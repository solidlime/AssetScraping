# syntax=docker/dockerfile:1
# mcp: stdio MCP server（Chromium 不要の軽量イメージ）
FROM node:24-bookworm-slim AS base
ENV NODE_ENV=production
RUN corepack enable

WORKDIR /app

# --- deps ---
FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/mcp/package.json apps/mcp/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter @asset-scraping/mcp

# --- build: 型チェックのみ（runtime は tsx で .ts を直接実行するため JS ビルド不要）---
FROM deps AS build
COPY tsconfig.base.json ./
COPY apps/mcp apps/mcp
COPY packages/db packages/db
COPY packages/shared packages/shared
RUN pnpm --filter @asset-scraping/mcp typecheck

# --- runtime ---
FROM base AS runtime
COPY --from=deps /app /app
COPY --from=build /app/apps/mcp /app/apps/mcp
COPY packages/db/src /app/packages/db/src
COPY packages/shared/src /app/packages/shared/src
ENV DB_PATH=file:/data/asset-scraping.db?mode=ro
CMD ["node_modules/.bin/tsx", "apps/mcp/src/index.ts"]
