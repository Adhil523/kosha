# The foreign demo API. Build from the repo root:
#   docker build -f apps/demo-api-global/Dockerfile -t kosha-demo-api-global .
# Workspace packages export TypeScript source, so the image keeps the workspace (installing only
# this app's dependency graph) and runs the app with tsx.

FROM node:24-slim
RUN corepack enable && mkdir /repo && chown node:node /repo
USER node
WORKDIR /repo
COPY --chown=node:node . .
# In case the builder ignored Dockerfile.dockerignore: never reuse the host's installs
RUN find . -name node_modules -prune -exec rm -rf {} +
RUN pnpm install --frozen-lockfile --filter "@kosha/demo-api-global..."
WORKDIR /repo/apps/demo-api-global
ENV NODE_ENV=production DEMO_API_GLOBAL_PORT=8080
EXPOSE 8080
CMD ["node_modules/.bin/tsx", "src/server.ts"]
