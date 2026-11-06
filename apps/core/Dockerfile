# Kosha Core. Build from the repo root:
#   docker build -f apps/core/Dockerfile -t kosha-core .
# The same shape as the demo APIs' images (B19), and for the same reasons: workspace packages
# export TypeScript source, Core finds its env and RULEPACK_PATH from the workspace root, and
# migrations live in apps/core/drizzle. So the image keeps the workspace, installs only Core's
# dependency graph, and runs Core with tsx. Core applies pending migrations at startup.

FROM node:24-slim
RUN corepack enable && mkdir /repo && chown node:node /repo
USER node
WORKDIR /repo
COPY --chown=node:node . .
# In case the builder ignored Dockerfile.dockerignore: never reuse the host's installs
RUN find . -name node_modules -prune -exec rm -rf {} +
RUN pnpm install --frozen-lockfile --filter "@kosha/core..."
WORKDIR /repo/apps/core
ENV NODE_ENV=production CORE_PORT=8080 RULEPACK_PATH=rulepacks/in-2026.2.json
EXPOSE 8080
CMD ["node_modules/.bin/tsx", "src/server.ts"]
