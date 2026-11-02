FROM node:22-alpine AS base
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@10.34.5 --activate

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
RUN addgroup -S -g 1001 nextjs && adduser -S -u 1001 -G nextjs nextjs \
  && corepack enable && corepack prepare pnpm@10.34.5 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile && chown -R nextjs:nextjs /app
COPY --from=builder --chown=nextjs:nextjs /app/.next ./.next
COPY --from=builder --chown=nextjs:nextjs /app/public ./public
COPY --from=builder --chown=nextjs:nextjs /app/next.config.ts ./next.config.ts
COPY --from=builder --chown=nextjs:nextjs /app/db ./db
COPY --from=builder --chown=nextjs:nextjs /app/scripts/migrate.mjs ./scripts/migrate.mjs
COPY --from=builder --chown=nextjs:nextjs /app/scripts/audit-chain-backfill.mjs ./scripts/audit-chain-backfill.mjs
COPY --from=builder --chown=nextjs:nextjs /app/scripts/migrations ./scripts/migrations
COPY --from=builder --chown=nextjs:nextjs /app/lib/audit/hash-chain.mjs ./lib/audit/hash-chain.mjs
EXPOSE 3000
USER nextjs
CMD ["sh", "-c", "node scripts/migrate.mjs && unset MIGRATION_DATABASE_URL MIGRATION_DATABASE_SSL && exec node node_modules/next/dist/bin/next start -H 0.0.0.0 -p ${PORT:-3000}"]
