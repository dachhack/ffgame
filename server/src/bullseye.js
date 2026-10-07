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
import { leagueCatalogOf } from '../../packages/core/src/engine/projScoring.ts';
import {
  bullseyeConfigOf, dealBullseyeCard, cardRows, cardsFromRows, setLeagueBullseye,
} from '../../packages/core/src/engine/bullseye.ts';

/** The engine's config for a league mode (modeOfSettings shape), null when off. */
export const bullseyeCfgOf = (mode) => (mode?.mode === 'classic' ? bullseyeConfigOf(mode) : null);

/** The published cards for these leagues in a week: Map(leagueId → { card,
 *  cards }) — the shared card and, under a per-team deal, one per roster.
 *  Leagues with no rows are absent — the caller deals from the seed. */
export async function bullseyeCardsFor(leagueIds, week) {
  const ids = [...new Set(leagueIds)].filter(Boolean);
  const out = new Map();
  if (!ids.length) return out;
  const { data } = await db().from('bullseye_card').select('league_id,roster_id,slot,target').in('league_id', ids).eq('week', week);
  const byLeague = new Map();
  for (const r of data ?? []) {
    if (!byLeague.has(r.league_id)) byLeague.set(r.league_id, []);
    byLeague.get(r.league_id).push(r);
  }
  for (const [id, rows] of byLeague) { const c = cardsFromRows(rows); if (c.card || Object.keys(c.cards).length) out.set(id, c); }
  return out;
}

/** The card a roster plays this week: the published one, else the seed's —
 *  its own under a per-team deal (rosterId > 0), the league's otherwise. */
export function bullseyeCardOf(leagueId, week, mode, published, rosterId = 0) {
  const pub = published?.get(leagueId);
  const perTeam = bullseyeCfgOf(mode)?.deal === 'team' && rosterId > 0;
  if (perTeam) return pub?.cards?.[rosterId] ?? dealBullseyeCard(leagueId, week, leagueSlotDefs(mode), leagueCatalogOf(mode), rosterId);
  return pub?.card ?? dealBullseyeCard(leagueId, week, leagueSlotDefs(mode), leagueCatalogOf(mode));
}

/** Install the league's setting + cards in the engine — UNCONDITIONALLY, as
 *  golf is: a module global only set when true would leave the previous
 *  league's card standing over this one. `rosterIds` are the seats about to
 *  be valued; under a per-team deal each gets its own card. Returns what
 *  was installed. */
export function installBullseye(leagueId, week, mode, published, rosterIds = []) {
  const cfg = bullseyeCfgOf(mode);
  const card = cfg ? bullseyeCardOf(leagueId, week, mode, published) : null;
  const cards = {};
  if (cfg?.deal === 'team') for (const rid of new Set(rosterIds)) if (rid > 0) cards[rid] = bullseyeCardOf(leagueId, week, mode, published, rid);
  setLeagueBullseye(cfg, card, cards);
  return cfg ? { cfg, card, cards } : null;
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
    const cfg = bullseyeCfgOf(mode);
    if (!cfg) continue;
    const slots = leagueSlotDefs(mode), catalog = leagueCatalogOf(mode);
    const card = dealBullseyeCard(l.id, week, slots, catalog);
    const rows = cardRows(card).map((r) => ({ league_id: l.id, week, roster_id: 0, slot: r.slot, target: r.target }));
    // PER-TEAM (v0.645.0): a card per enrolled seat, from its own seed. The
    // shared card is still published — the wire and a seat with no roster
    // read it — but no lineup is scored against it.
    if (cfg.deal === 'team') {
      const { data: mems } = await db().from('league_membership').select('sleeper_roster_id').eq('league_id', l.id).eq('enrolled', true);
      for (const m of mems ?? []) {
        const rid = m.sleeper_roster_id;
        if (!(rid > 0)) continue;
        for (const r of cardRows(dealBullseyeCard(l.id, week, slots, catalog, rid))) rows.push({ league_id: l.id, week, roster_id: rid, slot: r.slot, target: r.target });
      }
    }
    const { data: ins, error: e2 } = await db().from('bullseye_card')
      .upsert(rows, { onConflict: 'league_id,week,roster_id,slot', ignoreDuplicates: true }).select('slot');
    if (e2) { log('bullseye deal', l.id.slice(0, 8), e2.message); continue; }
    if (ins?.length) { dealt++; log('bullseye dealt', l.id.slice(0, 8), 'wk', week, cfg.deal === 'team' ? `${rows.length} rows (per team)` : JSON.stringify(card.targets), 'total', card.total); }
  }
  return dealt;
}
