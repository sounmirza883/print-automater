# syntax=docker/dockerfile:1
#
# 23.17: apps/shop-web (the back-office app), a line-for-line mirror of
# web.Dockerfile (customer-web) -- same turbo-prune / standalone-output
# shape, its own filter, its own port (3002). Kept as a separate file
# rather than one parameterised Dockerfile so each app's image can change
# independently and the deploy workflow's existing customer-web build is
# untouched.
#
# SCALING NOTE: shop-web keeps no session state on the server (the
# httpOnly cookies are the session), but the browser-side
# CookieAuthStrategy does its refresh-and-retry single-flight IN-PROCESS
# (per browser tab), and the API rotates the refresh token with reuse
# detection. Run ONE shop-web instance, or put sticky sessions (client-IP
# or cookie affinity) on the reverse proxy in front of several, so two
# instances do not race a refresh for the same session.

FROM node:22-slim AS base
RUN corepack enable

FROM base AS pruner
WORKDIR /app
COPY . .
RUN npx turbo prune @print-automated/shop-web --docker

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
# Fix wave 1: customer-web's PUBLIC origin, inlined at build time into every
# business's guest-ordering QR code (components/admin/shop-qr-code.tsx) -- codes
# that get printed and posted at real shop counters. Same ARG/ENV shape as
# NEXT_PUBLIC_API_BASE_URL above, but deliberately with NO localhost default: a
# production image built without it must not quietly encode http://localhost:3001
# (every printed code would need reprinting). Unset, it arrives as an empty
# string, which shop-web treats as missing. Every compose file passes it.
ARG NEXT_PUBLIC_CUSTOMER_WEB_URL
ENV NEXT_PUBLIC_CUSTOMER_WEB_URL=${NEXT_PUBLIC_CUSTOMER_WEB_URL}
RUN pnpm turbo run build --filter=@print-automated/shop-web

# next.config.ts's `output: "standalone"` traces the real require/
# import graph into apps/shop-web/.next/standalone/ -- a minimal,
# monorepo-structure-preserving server.js plus only the node_modules it
# actually needs, not this whole workspace's. Static assets are
# deliberately excluded from that trace (Next's own documented
# behavior), so .next/static and public/ are copied in alongside it.
FROM base AS runner
WORKDIR /app
RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs web
COPY --from=installer /app/apps/shop-web/.next/standalone ./
COPY --from=installer /app/apps/shop-web/.next/static ./apps/shop-web/.next/static
# No public/ directory exists in this app yet (no static assets
# committed) -- add a COPY for it here once one does; an empty COPY
# source fails the build outright rather than silently no-op-ing.
USER web
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3002
# NEXT_PUBLIC_API_BASE_URL is also read server-side at request time
# (middleware, server components) via plain process.env, not just
# inlined into the client bundle -- packages/config's web schema
# re-validates it on every server boot, so the standalone server
# refuses to start without it, not only the build. Re-declaring it here
# (not just as the build ARG above) is what makes `docker run` with no
# override still boot; a real deploy overrides it per environment.
ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:3000
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}
# Mirrored into the runtime image too, so anything that reads it server-side at
# request time sees the same value the client bundle was built with.
ARG NEXT_PUBLIC_CUSTOMER_WEB_URL
ENV NEXT_PUBLIC_CUSTOMER_WEB_URL=${NEXT_PUBLIC_CUSTOMER_WEB_URL}
EXPOSE 3002
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:3002/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/shop-web/server.js"]
