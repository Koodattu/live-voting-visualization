# syntax=docker/dockerfile:1

ARG NODE_IMAGE=node:24.22.1-trixie-slim@sha256:43b9ba1142b8dcf33fa8f922ca1be85714adc444e0586c7cf7726daaeabc1bea
FROM ${NODE_IMAGE} AS base

WORKDIR /app

FROM base AS dependencies

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    npm ci --no-audit --no-fund

FROM base AS production-dependencies

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    npm ci --omit=dev --no-audit --no-fund

FROM dependencies AS build

COPY tsconfig.json tsconfig.server.json vite.config.ts index.html ./
COPY src ./src
RUN npm run build

FROM base AS runtime

ENV NODE_ENV=production

COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node migrations ./migrations

RUN install -d -o node -g node /app/data /app/backups
USER node

EXPOSE 3000
CMD ["node", "dist/server/server/index.js"]
