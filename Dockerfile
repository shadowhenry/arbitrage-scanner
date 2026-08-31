# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS workspace
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.20.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json vitest.config.ts eslint.config.mjs ./
COPY apps ./apps
COPY packages ./packages
RUN pnpm install --frozen-lockfile

# Build the Vue dashboard into static assets first.
FROM workspace AS dashboard-build
ARG VITE_API_BASE_URL=/api
ARG VITE_WS_URL=
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
ENV VITE_WS_URL=${VITE_WS_URL}
RUN pnpm --filter @arbitrage-scanner/dashboard build

# Runtime image: the API process serves REST + WebSocket AND the static dashboard
# from the same port, so an external Nginx only needs to reverse-proxy one port.
FROM workspace AS application
ENV NODE_ENV=production
RUN addgroup -S app && adduser -S -G app app && chown -R app:app /app
COPY --from=dashboard-build /app/apps/dashboard/dist /app/apps/api/public
USER app
