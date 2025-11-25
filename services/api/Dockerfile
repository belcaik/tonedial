# syntax=docker/dockerfile:1.7
FROM node:22-bookworm AS base
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY .npmrc ./
COPY tsconfig.json ./
COPY services ./services
COPY packages ./packages
RUN pnpm install --frozen-lockfile

FROM deps AS build
RUN pnpm --filter @tonedial/shared build
RUN pnpm --filter @tonedial/api build
RUN pnpm deploy --filter @tonedial/api --prod /app/out

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY infra/certs/mkcert-root/rootCA.pem /usr/local/share/ca-certificates/tonedial-root.crt
RUN update-ca-certificates
ENV NODE_EXTRA_CA_CERTS=/usr/local/share/ca-certificates/tonedial-root.crt
COPY --from=build /app/out ./
EXPOSE 8080
CMD ["node", "dist/index.js"]
