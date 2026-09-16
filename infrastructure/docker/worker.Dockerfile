# syntax=docker/dockerfile:1

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
# §12.6: worker needs @print-automated/api's own prisma/schema.prisma
# to generate a client (see the RUN below) even though it has no
# workspace dependency on the api package itself -- pruning both scopes
# together is what makes the schema file present in /app/out/full/
# without vendoring a second copy of it into the worker's own package.
RUN npx turbo prune @print-automated/worker @print-automated/api --docker

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
# §12.6: worker has no Prisma CLI of its own (it only ever reads via
# @prisma/client, never migrates) -- prisma generate still needs the
# schema itself, present because `turbo prune`'s dependency graph for
# @print-automated/worker includes @print-automated/backend-shared,
# which is what actually declares the @prisma/client dependency, but
# the .prisma schema file itself lives under services/api/prisma/ --
# generating from there and letting node_modules resolution find the
# shared @prisma/client package (same mechanism the dev workspace
# already relies on, confirmed in 12.6's own research) is what makes
# this work without vendoring a second copy of the schema.
RUN pnpm --filter @print-automated/api exec prisma generate
RUN pnpm turbo run build --filter=@print-automated/worker

FROM base AS runner
WORKDIR /app
RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs worker
COPY --from=installer /app .
USER worker
ENV NODE_ENV=production
# Lives under services/worker/ (not this Dockerfile's own directory) so
# its `import Redis from "ioredis"` resolves against
# services/worker/node_modules the same way the app's own code does --
# pnpm's isolated node_modules means a script sitting outside any
# workspace package's own directory can't resolve a bare package
# specifier at all, confirmed by hitting exactly that
# ERR_MODULE_NOT_FOUND when this first lived at the repo root.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node services/worker/worker-healthcheck.mjs
CMD ["node", "services/worker/dist/main.js"]
