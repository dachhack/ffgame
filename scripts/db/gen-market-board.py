#!/usr/bin/env python3
"""Generate the market_board upsert block from the baked dynasty board.

The cosmetic market refresh (0236, founder: "Let's do a regular cosmetic
pull"): whenever the dynasty board is rebaked from Stathead
(packages/core/src/data/dyn2026.ts), run this over it to emit the
market_board upserts for a new data migration:

    python3 scripts/db/gen-market-board.py > /tmp/board.sql

Rank is the 1QB dynasty value order (1 = most valuable), the same 1-is-best
scale league_pool.rank uses, so player_market_value's curve reads either
interchangeably. Slugs are derived exactly like the ADP module derives
engine slugs: normName(name) with spaces dashed — keep this in lockstep
with packages/core/src/data/players.ts normName.
"""
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
    rows = []
    for line in m.group(1).strip().split('\n'):
        parts = line.split(',')
        if len(parts) < 4:
            continue
        name, value = parts[2], parts[3]
        try:
            v = int(value)
        except ValueError:
            continue
        slug = norm_name(name).replace(' ', '-')
        if slug:
            rows.append((slug, v))
    rows.sort(key=lambda r: -r[1])
    seen: set[str] = set()
    out = []
    for slug, _v in rows:
        if slug in seen:            # duplicate normalized names keep the richer row
            continue
        seen.add(slug)
        out.append(slug)
    as_of = re.search(r"DYN_AS_OF = '([^']*)'", src)
    print(f"-- market_board refresh — Stathead dynasty market as of "
          f"{as_of.group(1) if as_of else 'unknown'}, {len(out)} players (1QB value order)")
    print("insert into market_board (slug, rank) values")
    print(',\n'.join(f"  ('{s}', {i + 1})" for i, s in enumerate(out)))
    print("on conflict (slug) do update set rank = excluded.rank, updated_at = now();")


if __name__ == '__main__':
    main()
