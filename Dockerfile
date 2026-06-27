# Worker image for the 2026 pilot (server/). NOT the static site — the Vite/Pages
# build ignores this. The worker runs the shared TS engine (src/) via tsx, so the
# image bundles src/ + scripts/espn/ alongside server/. The engine's TS graph has
# no external npm deps, so only server/'s packages (supabase-js, dotenv, tsx) install.
FROM node:20-slim
WORKDIR /app

# Worker deps only.
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci

# Shared engine + ESPN adapters (imported by the worker through tsx).
COPY src ./src
COPY scripts/espn ./scripts/espn
# Baked play-by-play — needed by the on-worker dress rehearsal (`fly ssh … simulate`)
# and the scale re-run (`scripts/loadtest.mjs`); the live tick reads plays from the DB.
COPY public/pbp ./public/pbp
# Worker source + ops scripts + tests (so `fly ssh … npm run smoke` / loadtest / simulate work).
COPY server/src ./server/src
COPY server/scripts ./server/scripts
COPY server/test ./server/test

WORKDIR /app/server
ENV NODE_ENV=production
CMD ["npx", "tsx", "src/index.js"]
