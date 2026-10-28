FROM docker:29.9.2-cli@sha256:5e6baf67325a79f64ed3bed6863954d5e05d0f3d4e57cbdb14809346814bbfdb AS docker-cli
FROM oven/bun:1.4.0 AS bun
FROM node:24.22.1-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS build
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /srv/crm
COPY . .
RUN DATABASE_URL=postgresql://build:build@127.0.0.1:1/build bun install --frozen-lockfile
ARG STAGING_ORIGIN
RUN test -n "$STAGING_ORIGIN" && \
    DATABASE_URL=postgresql://build:build@127.0.0.1:1/build bun run --filter=@crm/db db:generate && \
    DATABASE_URL=postgresql://build:build@127.0.0.1:1/build \
    BETTER_AUTH_SECRET=build-only-placeholder-not-a-runtime-credential \
    ALLOWED_SIGN_IN=build.invalid \
    API_URL="$STAGING_ORIGIN" APP_URL="$STAGING_ORIGIN" \
    NEXT_TELEMETRY_DISABLED=1 CRM_TELEMETRY_DISABLED=1 \
    NODE_OPTIONS=--max-old-space-size=3072 \
    bun run --filter=api build && \
    DATABASE_URL=postgresql://build:build@127.0.0.1:1/build \
    BETTER_AUTH_SECRET=build-only-placeholder-not-a-runtime-credential \
    ALLOWED_SIGN_IN=build.invalid \
    API_URL="$STAGING_ORIGIN" APP_URL="$STAGING_ORIGIN" \
    NEXT_TELEMETRY_DISABLED=1 CRM_TELEMETRY_DISABLED=1 \
    NODE_OPTIONS=--max-old-space-size=3072 \
    bun run --filter=app build
FROM build AS runtime
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV CRM_TELEMETRY_DISABLED=1
RUN mkdir -p /run/crm-secrets/database /run/crm-secrets/auth /run/crm-secrets/bridge /run/crm-secrets/provider /run/crm-secrets/chat && \
    chown -R node:node /run/crm-secrets /srv/crm/apps/app/.next
USER node
ENTRYPOINT ["bun", "deploy/hostinger/start.mjs"]

FROM runtime AS agent-runtime
ENV EVE_TELEMETRY_DISABLED=1
USER root
COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker
RUN mkdir -p /srv/crm/apps/agent/.output /srv/crm/apps/agent/.eve && \
    chown -R node:node /srv/crm/apps/agent/.output /srv/crm/apps/agent/.eve
USER node

FROM agent-runtime AS agent-builder
USER root
RUN mkdir -p /srv/crm/apps/agent/node_modules/.cache/eve /srv/crm/apps/agent/node_modules/.nitro /run/crm-agent-output && \
    chown node:node /srv/crm/apps/agent /srv/crm/apps/agent/node_modules/.cache/eve /srv/crm/apps/agent/node_modules/.nitro /run/crm-agent-output
USER node
