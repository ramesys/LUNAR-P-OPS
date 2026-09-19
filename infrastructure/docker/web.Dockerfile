# Frontend image (React + Vite). Build context: frontend/ (pnpm workspace).
#   target "dev":  Vite dev server with /api proxied to the API; used by docker-compose.yml
#   target "prod": static build served by nginx, which also proxies /api; used by docker-compose.prod.yml
FROM node:24-slim AS deps
ENV CI=true
RUN npm install --global pnpm@11.1.3
WORKDIR /workspace
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY web/package.json web/
COPY api-client/package.json api-client/
RUN pnpm install --frozen-lockfile
COPY api-client api-client
COPY web web

FROM deps AS dev
WORKDIR /workspace/web
EXPOSE 5173
CMD ["pnpm", "dev"]

FROM deps AS build
RUN pnpm --filter @clps/web build

FROM nginx:1.27-alpine AS prod
COPY --from=build /workspace/web/dist /usr/share/nginx/html
# "infra" is an additional build context pointing at infrastructure/docker (see docker-compose.prod.yml).
COPY --from=infra nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
