# syntax=docker/dockerfile:1
# web: Next.js standalone（Chromium 不要）
FROM node:24-bookworm-slim AS base
ENV NODE_ENV=production
RUN corepack enable

WORKDIR /app

FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter @asset-scraping/web

FROM deps AS build
COPY tsconfig.base.json ./
COPY apps/web apps/web
COPY packages/db packages/db
COPY packages/shared packages/shared
# next build には DB 参照が無い（全ページ force-dynamic）ので DB なしでビルド可能
RUN pnpm --filter @asset-scraping/web build

FROM base AS runtime
ENV PORT=8765 HOSTNAME=0.0.0.0 DB_PATH=/data/asset-scraping.db
COPY --from=build /app/apps/web/.next/standalone /app
COPY --from=build /app/apps/web/.next/static /app/apps/web/.next/static
COPY --from=build /app/apps/web/public /app/apps/web/public
EXPOSE 8765
CMD ["node", "apps/web/server.js"]
