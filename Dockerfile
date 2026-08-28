# Worker image for the 2026 pilot (server/). NOT the static site — the Vite/Pages
# build ignores this. The worker runs the shared TS engine (packages/core/) via
# tsx, so the image bundles packages/core/ + scripts/espn/ alongside server/. The
# engine's TS graph has no external npm deps beyond supabase-js, so only server/'s
# packages (supabase-js, dotenv, tsx) install.
FROM node:20-slim
WORKDIR /app

# Worker deps only.
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci

# Shared engine + ESPN adapters (imported by the worker through tsx).
COPY packages/core ./packages/core
COPY scripts/espn ./scripts/espn
# Baked play-by-play — needed by the on-worker dress rehearsal (`fly ssh … simulate`)
# and the scale re-run (`scripts/loadtest.mjs`); the live tick reads plays from the DB.
COPY public/pbp ./public/pbp
# The field-visual bakes ride along for the board-driven sim (0251): the sweep
# releases game_feed docs from these. Their absence is GRACEFUL (loadBakedFeeds
# returns null) — which is exactly how it went silently missing: plays flowed,
# fields never did, and every classic row sat on "Yet to play" (v0.367.4).
COPY public/gamefeed ./public/gamefeed
# Worker source + ops scripts + tests (so `fly ssh … npm run smoke` / loadtest / simulate work).
COPY server/src ./server/src
COPY server/scripts ./server/scripts
COPY server/test ./server/test

WORKDIR /app/server
ENV NODE_ENV=production
CMD ["npx", "tsx", "src/index.js"]
