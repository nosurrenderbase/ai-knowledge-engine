# Admin panel image. Build context: the repo root (see compose.yaml).
FROM node:24-alpine

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# Workspace manifests first, so dependency layers are cached across code changes.
COPY package.json package-lock.json ./
COPY packages/accounts/package.json packages/accounts/
COPY packages/gamedb/package.json packages/gamedb/
COPY packages/kb/package.json packages/kb/
COPY packages/search/package.json packages/search/
COPY packages/settings/package.json packages/settings/
COPY apps/deploy/package.json apps/deploy/
COPY apps/mcp/package.json apps/mcp/
COPY apps/panel/package.json apps/panel/
COPY apps/sync/package.json apps/sync/
RUN npm ci --workspace @ai-knowledge-engine/panel --no-audit --no-fund

# The shared packages are loaded from source at runtime (Node strips the types).
COPY packages/accounts/src packages/accounts/src
COPY packages/kb/src packages/kb/src
COPY packages/search/src packages/search/src
COPY packages/settings/src packages/settings/src
COPY apps/panel apps/panel
RUN npm run build --workspace @ai-knowledge-engine/panel

# Commit this image was built from (compose passes GIT_SHA; the deploy job sets it).
ARG GIT_SHA=unknown
ENV APP_VERSION=$GIT_SHA
ENV NODE_ENV=production
USER node
EXPOSE 3100
WORKDIR /app/apps/panel
CMD ["npx", "next", "start", "-p", "3100", "-H", "0.0.0.0"]
