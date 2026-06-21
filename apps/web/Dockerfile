FROM node:24-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN apk add --no-cache libc6-compat openssl python3 make g++
RUN corepack enable && corepack prepare pnpm@10.11.0 --activate

FROM base AS builder
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY apps/worker/package.json ./apps/worker/package.json
COPY packages/db/package.json ./packages/db/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/domain/package.json ./packages/domain/package.json
COPY packages/repository-provider/package.json ./packages/repository-provider/package.json

RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm --filter @taskforge/contracts build
RUN pnpm --filter @taskforge/web build

FROM base AS runner
WORKDIR /app/apps/web
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

COPY --from=builder /app/package.json /app/pnpm-workspace.yaml /app/pnpm-lock.yaml /app/.npmrc /app/
COPY --from=builder /app/apps/web/package.json /app/apps/web/next.config.js /app/apps/web/tailwind.config.js /app/apps/web/postcss.config.js ./
COPY --from=builder /app/apps/web/public ./public
COPY --from=builder /app/apps/web/.next ./.next
COPY --from=builder /app/apps/web/node_modules ./node_modules
COPY --from=builder /app/node_modules /app/node_modules

CMD ["../../node_modules/.bin/next", "start"]
