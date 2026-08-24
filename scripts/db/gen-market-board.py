#!/usr/bin/env python3
"""Generate the market_board refresh call from the baked dynasty board.

The cosmetic market refresh (0236/0237, founder: "Let's do a regular
cosmetic pull"): whenever the dynasty board is rebaked from Stathead
(packages/core/src/data/dyn2026.ts), run this over it to emit the next
refresh migration's body:

    python3 scripts/db/gen-market-board.py > /tmp/refresh.sql

The output is one `select _market_refresh_apply(...)` call (0237): the
server function computes what entered, dropped, and moved against the
board it replaces, applies the new ranks, and files a market_refresh_log
row — the super-admin 📈 MARKET report reads that log.

Two ranks per player, both 1-is-best on league_pool.rank's scale:
`rank` orders by the 1QB dynasty value, `sf_rank` by the superflex value —
player_market_value picks by league_is_superflex(league). Slugs are
derived exactly like the ADP module derives engine slugs: normName(name)
with spaces dashed — keep in lockstep with players.ts normName.
"""
import json
import re
import sys
from pathlib import Path

DYN = Path(__file__).resolve().parents[2] / 'packages/core/src/data/dyn2026.ts'


def norm_name(raw: str) -> str:
    s = raw.lower()
    s = re.sub(r"[.'’]", '', s)
    s = re.sub(r'\b(jr|sr|ii|iii|iv|v)\b', '', s)
    s = re.sub(r'[^a-z\s-]', '', s)
    s = re.sub(r'\s+', ' ', s).strip()
    return s


def main() -> None:
    src = DYN.read_text()
    m = re.search(r'const DYN_CSV = `([^`]*)`', src)
    if not m:
        sys.exit('DYN_CSV block not found — did dyn2026.ts change shape?')
    rows = []  # (slug, 1qb value, sf value)
    seen: set[str] = set()
    for line in m.group(1).strip().split('\n'):
        parts = line.split(',')
        if len(parts) < 5:
            continue
        name, value, sf = parts[2], parts[3], parts[4]
        try:
            v, s = int(value), int(sf)
        except ValueError:
            continue
        slug = norm_name(name).replace(' ', '-')
        if not slug or slug in seen:   # duplicate normalized names keep the first (richer) row
            continue
        seen.add(slug)
        rows.append((slug, v, s))

    by_1qb = sorted(rows, key=lambda r: -r[1])
    sf_rank = {slug: i + 1 for i, (slug, _v, _s) in
               enumerate(sorted(rows, key=lambda r: -r[2]))}
    board = [{'slug': slug, 'rank': i + 1, 'sf_rank': sf_rank[slug]}
             for i, (slug, _v, _s) in enumerate(by_1qb)]

    as_of = re.search(r"DYN_AS_OF = '([^']*)'", src)
    date = as_of.group(1) if as_of else 'unknown'
    print(f"-- market_board refresh — Stathead dynasty market as of {date}, "
          f"{len(board)} players (rank = 1QB order, sf_rank = superflex order)")
    print(f"select _market_refresh_apply('{json.dumps(board, separators=(',', ':'))}'::jsonb, '{date}');")


if __name__ == '__main__':
    main()
