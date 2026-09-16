# syntax=docker/dockerfile:1

# §100/12.6: pnpm + Turborepo monorepo -- `turbo prune` (not a plain
# `COPY . .`) produces a minimal per-app subset (that app's own
# package.json files first, for layer caching, then its full pruned
# source) so this image's build context and dependency graph carry only
# what @print-automated/api actually needs, not every other app/service
# in the workspace.
FROM node:22-slim AS base
RUN corepack enable
# Prisma's query engine binary needs to detect the system's OpenSSL at
# both generate time and runtime; without it installed, Prisma silently
# falls back to guessing a version (openssl-1.1.x) that this image
# doesn't actually have, which can break at runtime, not just warn.
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

FROM base AS pruner
WORKDIR /app
COPY . .
RUN npx turbo prune @print-automated/api --docker

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
# Explicit, not relied-on-as-a-postinstall-side-effect: pnpm's default
# lifecycle-script policy doesn't run a dependency's own postinstall
# without an explicit allowlist, so @prisma/client's generated types
# must exist before `nest build`'s own tsc step can typecheck against
# them.
RUN pnpm --filter @print-automated/api exec prisma generate
RUN pnpm turbo run build --filter=@print-automated/api

FROM base AS runner
WORKDIR /app
RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs api
COPY --from=installer /app .
USER api
ENV NODE_ENV=production
EXPOSE 3000
# §1.8's own liveness endpoint -- no external tool (curl/wget) installed
# in this slim image, so Node's own fetch (global since Node 18) is the
# healthcheck's own HTTP client.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:3000/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "services/api/dist/main.js"]
