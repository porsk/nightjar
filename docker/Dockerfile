FROM node:26-trixie-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN npm install --global pnpm@12.23.0
WORKDIR /app

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
COPY tsconfig.base.json ./
COPY apps/web apps/web
COPY packages/shared packages/shared
RUN pnpm --filter @nightjar/web build

FROM base AS prod-deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --prod --filter @nightjar/server...

FROM node:26-trixie-slim
RUN apt-get update \
    && apt-get install --yes --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir /data \
    && chown node:node /data
WORKDIR /app
ENV NODE_ENV=production
ENV NIGHTJAR_WEB_DIR=/app/apps/web/dist
COPY --from=prod-deps /app/node_modules node_modules
COPY --from=prod-deps /app/apps/server/node_modules apps/server/node_modules
COPY apps/server/package.json apps/server/
COPY apps/server/src apps/server/src
COPY packages/shared/package.json packages/shared/
COPY packages/shared/src packages/shared/src
COPY --from=prod-deps /app/packages/shared/node_modules packages/shared/node_modules
COPY --from=build /app/apps/web/dist apps/web/dist
VOLUME /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:3000/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
LABEL org.opencontainers.image.title="Nightjar" \
      org.opencontainers.image.description="Self-hosted voice and text journal" \
      org.opencontainers.image.source="https://github.com/porsk/nightjar" \
      org.opencontainers.image.licenses="AGPL-3.0-only"
CMD ["node", "apps/server/src/main.ts"]
