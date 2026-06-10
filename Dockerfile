# syntax=docker/dockerfile:1.7
#
# Whiteboard — production image.
#
# Stages:
#   1. build   — install all deps and build the web app to apps/web/dist.
#   2. runtime — minimal image: production-only deps + server source + built web.
#
# The build stage's node_modules is hoisted per-workspace by Bun, so the runtime
# stage re-installs with --production rather than copying from the build stage.

# Tag pinned to a digest so builds are reproducible and immune to tag
# repointing. Refresh the digest when bumping the tag:
#   docker buildx imagetools inspect oven/bun:<tag>
ARG BUN_VERSION=1.3-slim@sha256:d56a2534ffd262e92c12fd3249d3924d296d97086da773f821d7d0477435ea04

# ---- 1. build --------------------------------------------------------------
FROM oven/bun:${BUN_VERSION} AS build
WORKDIR /app

COPY --link package.json bun.lock* bun.lockb* ./
COPY --link apps/web/package.json ./apps/web/
COPY --link apps/server/package.json ./apps/server/
COPY --link packages/shared/package.json ./packages/shared/

RUN bun install --frozen-lockfile

COPY --link tsconfig.base.json ./
COPY --link packages/shared ./packages/shared
COPY --link apps/web ./apps/web
COPY --link apps/server ./apps/server

ARG BASE_PATH=/
ENV BASE_PATH=${BASE_PATH}

RUN bun run --filter @whiteboard/web build

# ---- 2. runtime ------------------------------------------------------------
FROM oven/bun:${BUN_VERSION} AS runtime

ENV NODE_ENV=production \
    PORT=8787 \
    DATA_DIR=/data

WORKDIR /app

# Production-only install. All workspace package.json files are required so the
# lockfile's workspace tree matches; --production then skips devDependencies.
COPY --link package.json bun.lock* bun.lockb* ./
COPY --link apps/web/package.json ./apps/web/
COPY --link apps/server/package.json ./apps/server/
COPY --link packages/shared/package.json ./packages/shared/
RUN bun install --frozen-lockfile --production

# Source for the server and shared types.
COPY --link tsconfig.base.json ./
COPY --link apps/server ./apps/server
COPY --link packages/shared ./packages/shared

# Built web assets.
COPY --from=build /app/apps/web/dist ./apps/web/dist

# Non-root user.
RUN groupadd --system app \
 && useradd --system --gid app --create-home --home /home/app app \
 && mkdir -p /data \
 && chown -R app:app /app /data
USER app

EXPOSE 8787
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"

CMD ["bun", "run", "apps/server/src/index.ts"]
