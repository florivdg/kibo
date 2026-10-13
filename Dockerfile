# syntax=docker/dockerfile:1

# Kibo image. Nothing instance-specific is baked in: domain, secrets, SMTP and
# the legal pages all come from the environment at run time, so the same image
# works for every Kita (see docs/selbst-hosten/ueberblick.md).

# ---- dependencies (including dev, needed for the build) ---------------------
FROM oven/bun:1.4-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN --mount=type=cache,target=/root/.bun/install/cache \
  bun install --frozen-lockfile

# ---- build ------------------------------------------------------------------
FROM deps AS build
WORKDIR /app
COPY . .
# No secrets here on purpose: `astro build` reads no runtime variables, and a
# build argument would end up in the image history
RUN bun run build

# ---- standalone fixture helper (no Astro/application build) -----------------
FROM deps AS load-fixtures-build
WORKDIR /app
COPY scripts/load/fixtures.ts ./scripts/load/fixtures.ts
COPY tests/load/helpers/config.ts ./tests/load/helpers/config.ts
RUN bun build scripts/load/fixtures.ts --target=bun --outfile=/app/load-fixtures.mjs

# ---- standalone public load runner (no Astro/application build) -------------
FROM deps AS load-runner-build
WORKDIR /app
COPY scripts/load/run.ts ./scripts/load/run.ts
COPY tests/load ./tests/load
RUN bun build scripts/load/run.ts --target=bun --outfile=/app/scripts/load/run.mjs \
  && bun build tests/load/public.ts --target=browser --external=k6 --external='k6/*' --outfile=/app/bundled/public.ts

# ---- production dependencies only -------------------------------------------
FROM oven/bun:1.4-alpine AS prod-deps
WORKDIR /app
COPY package.json bun.lock ./
RUN --mount=type=cache,target=/root/.bun/install/cache \
  bun install --frozen-lockfile --production

# ---- runtime ----------------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4321 \
    LEGAL_DIR=/app/legal

COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json LICENSE ./
# Starts the standalone server by hand so SIGTERM can drain it (see the file);
# instance-config.mjs holds the instance rules (sign-up, hosted mode) its
# start-up check applies. The operator's tool (scripts/admin.ts) is already
# there, bundled as dist/admin.mjs — and so is the documentation from docs/,
# compiled into dist/ and served under /docs when HOSTED=true.
COPY --chown=node:node scripts/server.mjs scripts/instance-config.mjs ./

# Imprint and privacy policy are mounted here; an empty directory keeps the
# path valid when the operator links to their own website instead
RUN mkdir -p /app/legal && chown node:node /app/legal

USER node
EXPOSE 4321

# Answers 200 only when Postgres answers too. Shell form, so a PORT set at run
# time is the one asked
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT:-4321}/api/health" || exit 1

CMD ["node", "./server.mjs"]

# ---- dependencies for the migration image -----------------------------------
# Applying the SQL in drizzle/ needs drizzle-orm's migrator and a Postgres
# driver, not the app's dependency tree (that would be an order of magnitude
# larger). The versions come from this repository's package.json, so they
# cannot drift.
FROM oven/bun:1.4-alpine AS migrate-deps
WORKDIR /app
COPY package.json ./
RUN --mount=type=cache,target=/root/.bun/install/cache \
  PACKAGES="$(bun -e 'const { dependencies: d } = await Bun.file("package.json").json(); process.stdout.write(`drizzle-orm@${d["drizzle-orm"]} pg@${d.pg}`)')" \
  && rm package.json \
  && bun init -y >/dev/null \
  && bun add $PACKAGES

# ---- migrations -------------------------------------------------------------
# Runs to completion before the app starts; a failure keeps the new version
# from coming up (see deploy/compose.yml) and names its reason in the log
FROM oven/bun:1.4-alpine AS migrate
WORKDIR /app
ENV NODE_ENV=production
COPY --from=migrate-deps --chown=bun:bun /app/node_modules ./node_modules
COPY --chown=bun:bun drizzle ./drizzle
COPY --chown=bun:bun scripts/migrate.mjs ./migrate.mjs
USER bun
CMD ["bun", "./migrate.mjs"]

# ---- optional synthetic load-test fixtures ----------------------------------
# Started manually through the load profile. The named volume is initialized
# from this bun-owned directory, so journals survive --rm and interruptions.
FROM oven/bun:1.4.2-alpine AS load-fixtures
WORKDIR /app
ENV NODE_ENV=production
COPY --from=load-fixtures-build --chown=bun:bun /app/load-fixtures.mjs ./load-fixtures.mjs
COPY --chown=bun:bun LICENSE ./
RUN mkdir -p /fixtures && chown bun:bun /fixtures && chmod 700 /fixtures
USER bun
ENTRYPOINT ["bun", "/app/load-fixtures.mjs"]
# Running the image without arguments never changes the database.
CMD ["--help"]

# ---- separate load generator ------------------------------------------------
FROM grafana/k6:2.3.0 AS k6-binary
FROM oven/bun:1.4.2-alpine AS load-runner
WORKDIR /work
COPY --from=k6-binary /usr/bin/k6 /usr/local/bin/k6
COPY --from=load-runner-build --chown=bun:bun /app/scripts/load/run.mjs /app/scripts/load/run.mjs
COPY --from=load-runner-build --chown=bun:bun /app/bundled/public.ts /app/tests/load/public.ts
COPY --chown=bun:bun LICENSE /app/LICENSE
# Static scripts stay outside the writable working directory. A mounted /work
# workspace keeps output on the generator; the manifest is mounted read-only.
RUN chown bun:bun /work && chmod 700 /work
USER bun
ENTRYPOINT ["bun", "/app/scripts/load/run.mjs"]
CMD ["--help"]

# A build without --target still produces the application image.
FROM runtime AS default
