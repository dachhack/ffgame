// BULLSEYE (v0.643.0) — the worker's half: deal and publish each week's card,
// and hand the engine the card + setting before anything values a lineup.
// Spec: docs/bullseye.md. Engine: packages/core/src/engine/bullseye.ts.
//
// THE CARD IS DEALT FROM A SEED, not drawn fresh: dealBullseyeCard(league,
// week, spots) is deterministic, so publishing is a formality that makes the
// card auditable and lets the boards read one source. A board that loads
// before the worker has published deals the same numbers itself. Rows are
// written ON CONFLICT DO NOTHING — a dealt card never changes under a
// manager's lineup, even if the deal's inputs ever did.
import { db } from './supabase.js';
import { modeOfSettings } from './resolve.js';
import { leagueSlotDefs } from '../../packages/core/src/engine/classic.ts';
import {
  bullseyeConfigOf, dealBullseyeCard, cardRows, cardFromRows, setLeagueBullseye,
} from '../../packages/core/src/engine/bullseye.ts';

/** The engine's config for a league mode (modeOfSettings shape), null when off. */
export const bullseyeCfgOf = (mode) => (mode?.mode === 'classic' ? bullseyeConfigOf(mode) : null);

/** The published cards for these leagues in a week: Map(leagueId → card).
 *  Leagues with no rows are absent — the caller deals from the seed. */
export async function bullseyeCardsFor(leagueIds, week) {
  const ids = [...new Set(leagueIds)].filter(Boolean);
  const out = new Map();
  if (!ids.length) return out;
  const { data } = await db().from('bullseye_card').select('league_id,slot,target').in('league_id', ids).eq('week', week);
  const byLeague = new Map();
  for (const r of data ?? []) {
    if (!byLeague.has(r.league_id)) byLeague.set(r.league_id, []);
    byLeague.get(r.league_id).push(r);
  }
  for (const [id, rows] of byLeague) { const c = cardFromRows(rows); if (c) out.set(id, c); }
  return out;
}

/** The card a league plays this week: the published one, else the seed's. */
export function bullseyeCardOf(leagueId, week, mode, published) {
  return published?.get(leagueId) ?? dealBullseyeCard(leagueId, week, leagueSlotDefs(mode));
}

/** Install the league's setting + card in the engine — UNCONDITIONALLY, as
 *  golf is: a module global only set when true would leave the previous
 *  league's card standing over this one. Returns what was installed. */
export function installBullseye(leagueId, week, mode, published) {
  const cfg = bullseyeCfgOf(mode);
  const card = cfg ? bullseyeCardOf(leagueId, week, mode, published) : null;
  setLeagueBullseye(cfg, card);
  return cfg ? { cfg, card } : null;
}

/** Publish the week's card for every bullseye league. Idempotent: rows that
 *  exist are left exactly as they are. Returns how many leagues got a NEW
 *  card this call (0 on every tick but the week's first). */
export async function publishBullseyeCards(week, log = () => {}) {
  const { data: lgs, error } = await db().from('league').select('id,settings_json')
    .eq('settings_json->>game_mode', 'classic').in('settings_json->>bullseye', ['slots', 'total']);
  if (error) { log('bullseye leagues', error.message); return 0; }
  if (!lgs?.length) return 0;
  let dealt = 0;
  for (const l of lgs) {
    const mode = modeOfSettings(l.settings_json);
    if (!bullseyeCfgOf(mode)) continue;
    const card = dealBullseyeCard(l.id, week, leagueSlotDefs(mode));
    const rows = cardRows(card).map((r) => ({ league_id: l.id, week, slot: r.slot, target: r.target }));
    const { data: ins, error: e2 } = await db().from('bullseye_card')
      .upsert(rows, { onConflict: 'league_id,week,slot', ignoreDuplicates: true }).select('slot');
    if (e2) { log('bullseye deal', l.id.slice(0, 8), e2.message); continue; }
    if (ins?.length) { dealt++; log('bullseye dealt', l.id.slice(0, 8), 'wk', week, JSON.stringify(card.targets), 'total', card.total); }
  }
  return dealt;
}
