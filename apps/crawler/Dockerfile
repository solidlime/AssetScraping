# syntax=docker/dockerfile:1
# ssnb crawler: Playwright chromium + supercronic
FROM node:24-bookworm-slim AS base
ENV NODE_ENV=production
RUN corepack enable

# Playwright chromium の依存ライブラリ + supercronic
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl xz-utils \
    && curl -fsSL -o /usr/local/bin/supercronic \
      https://github.com/aptible/supercronic/releases/download/v0.2.33/supercronic-linux-amd64 \
    && chmod +x /usr/local/bin/supercronic \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# --- deps ---
FROM base AS deps
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ \
      libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
      libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
      libgbm1 libasound2 libpango-1.0-0 libcairo2 libatspi2.0-0 \
    && apt-get clean && rm -rf /var/lib/apt/lists/*
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/crawler/package.json apps/crawler/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter @asset-scraping/crawler --filter @asset-scraping/db --filter @asset-scraping/shared

# --- build (typecheck のみ。runtime は tsx で実行するため JS ビルド不要) ---
FROM deps AS build
COPY tsconfig.base.json ./
COPY apps/crawler apps/crawler
COPY packages/db packages/db
COPY packages/shared packages/shared
RUN pnpm --filter @asset-scraping/crawler typecheck

# --- runtime ---
FROM base AS runtime
# Chromium 本体
RUN npx playwright@1.50.1 install --with-deps chromium
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
COPY --from=deps /app /app
COPY --from=build /app/apps/crawler /app/apps/crawler
COPY --from=build /app/packages/db/src /app/packages/db/src
COPY --from=build /app/packages/shared/src /app/packages/shared/src
COPY --from=build /app/tsconfig.base.json /app/tsconfig.base.json
COPY apps/crawler/docker/crontab /app/docker/crontab
ENV DB_PATH=/data/asset-scraping.db \
    AUTH_STATE_PATH=/data/auth-state.json \
    PORT=8766
EXPOSE 8766
# 常駐: 手動更新 API。cron は supercronic が index.ts を叩く
CMD ["sh", "-c", "supercronic /app/docker/crontab & cd /app/apps/crawler && exec node_modules/.bin/tsx src/server.ts"]
