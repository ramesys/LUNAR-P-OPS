# Build context: repository root (pnpm workspace).
FROM node:24-slim

ENV CI=true
RUN npm install --global pnpm@11.1.3

WORKDIR /workspace

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY packages/api-client/package.json packages/api-client/
RUN pnpm install --frozen-lockfile

COPY packages/api-client packages/api-client
COPY apps/web apps/web

WORKDIR /workspace/apps/web
EXPOSE 5173
CMD ["pnpm", "dev"]
