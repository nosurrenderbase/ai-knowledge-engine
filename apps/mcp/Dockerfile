# MCP server image. Build context: the repo root (see compose.yaml).
FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production

# Workspace manifests first, so dependency layers are cached across code changes.
COPY package.json package-lock.json ./
COPY packages/accounts/package.json packages/accounts/
COPY packages/gamedb/package.json packages/gamedb/
COPY packages/kb/package.json packages/kb/
COPY packages/search/package.json packages/search/
COPY packages/settings/package.json packages/settings/
COPY apps/deploy/package.json apps/deploy/
COPY apps/mcp/package.json apps/mcp/
COPY apps/sync/package.json apps/sync/
RUN npm ci --omit=dev --workspace @ai-knowledge-engine/mcp --no-audit --no-fund

COPY packages/accounts/src packages/accounts/src
COPY packages/gamedb/src packages/gamedb/src
COPY packages/kb/src packages/kb/src
COPY packages/search/src packages/search/src
COPY apps/mcp/src apps/mcp/src

# Commit this image was built from (compose passes GIT_SHA; the deploy job sets it).
ARG GIT_SHA=unknown
ENV APP_VERSION=$GIT_SHA
USER node
EXPOSE 8787
CMD ["node", "apps/mcp/src/main.ts"]
