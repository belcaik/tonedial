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
COPY --from=build /app/services/activity/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
