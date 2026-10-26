FROM oven/bun:1.4.0 AS bun
FROM node:22-bookworm-slim AS build
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
