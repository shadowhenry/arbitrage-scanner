# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS workspace
WORKDIR /app
# pnpm 10 uses a JSON store index (no SQLite) — required on hosts whose storage
# driver cannot run SQLite (legacy overlay/devicemapper on CentOS 7).
# Installed globally via npm (instead of corepack) so the runtime image can run
# pnpm as the non-root 'app' user without touching corepack's /root cache,
# which is read-only and EACCES for non-root users.
ENV XDG_CACHE_HOME=/tmp/.cache \
    npm_config_store_dir=/tmp/.pnpm-store \
    npm_config_manage_package_manager_versions=false
RUN npm install -g pnpm@10.34.5
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json vitest.config.ts eslint.config.mjs ./
COPY apps ./apps
COPY packages ./packages
RUN --mount=type=cache,target=/tmp/.pnpm-store \
    pnpm install --frozen-lockfile

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
ENV NODE_ENV=production \
    HOME=/tmp \
    XDG_CACHE_HOME=/tmp/.cache \
    npm_config_store_dir=/tmp/.pnpm-store \
    npm_config_cache=/tmp/.npm
RUN addgroup -S app && adduser -S -G app app && chown -R app:app /app
COPY --from=dashboard-build /app/apps/dashboard/dist /app/apps/api/public
USER app
