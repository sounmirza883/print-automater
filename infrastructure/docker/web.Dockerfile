# syntax=docker/dockerfile:1

FROM node:22-slim AS base
RUN corepack enable

FROM base AS pruner
WORKDIR /app
COPY . .
RUN npx turbo prune @print-automated/customer-web --docker

FROM base AS installer
WORKDIR /app
COPY --from=pruner /app/out/json/ .
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ .
# `turbo prune` only traces package.json-declared workspace
# dependencies -- it has no notion of a root-level file every
# package's own tsconfig `extends`, so this has to be copied in by
# hand or every package's own `tsc` build step fails on it missing.
COPY --from=pruner /app/tsconfig.base.json ./tsconfig.base.json
# Next.js inlines every NEXT_PUBLIC_* var into the client bundle at
# BUILD time, not read at runtime the way every other service's env
# vars are -- packages/config's web schema requires it, and "Collecting
# page data" actually executes app code during `next build`, so a
# missing value fails the build itself, not just something a container
# would silently misbehave on later. A real deploy pipeline overrides
# this build arg per environment (12.7/12.8); the default here is only
# for a build with no explicit override, e.g. `docker compose build`.
ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:3000
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}
RUN pnpm turbo run build --filter=@print-automated/customer-web

# next.config.ts's `output: "standalone"` traces the real require/
# import graph into apps/customer-web/.next/standalone/ -- a minimal,
# monorepo-structure-preserving server.js plus only the node_modules it
# actually needs, not this whole workspace's. Static assets are
# deliberately excluded from that trace (Next's own documented
# behavior), so .next/static and public/ are copied in alongside it.
FROM base AS runner
WORKDIR /app
RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs web
COPY --from=installer /app/apps/customer-web/.next/standalone ./
COPY --from=installer /app/apps/customer-web/.next/static ./apps/customer-web/.next/static
# No public/ directory exists in this app yet (no static assets
# committed) -- add a COPY for it here once one does; an empty COPY
# source fails the build outright rather than silently no-op-ing.
USER web
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3001
# NEXT_PUBLIC_API_BASE_URL is also read server-side at request time
# (middleware, server components) via plain process.env, not just
# inlined into the client bundle -- packages/config's web schema
# re-validates it on every server boot, so the standalone server
# refuses to start without it, not only the build. Re-declaring it here
# (not just as the build ARG above) is what makes `docker run` with no
# override still boot; a real deploy overrides it per environment.
ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:3000
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:3001/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/customer-web/server.js"]
