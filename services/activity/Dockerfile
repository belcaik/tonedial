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
RUN pnpm --filter @tonedial/activity build

FROM nginx:1.27-alpine AS runner
RUN apk add --no-cache ca-certificates
COPY infra/certs/mkcert-root/rootCA.pem /usr/local/share/ca-certificates/tonedial-root.crt
RUN update-ca-certificates
COPY --from=build /app/services/activity/dist /usr/share/nginx/html
COPY services/activity/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80 443
CMD ["nginx", "-g", "daemon off;"]
