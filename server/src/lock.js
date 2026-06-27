// Lock / reveal. At a matchup's lock_at (first kickoff of the week), the server
// flips the matchup to 'locked' and seals every pick (locked = true). ONLY the
// service role can do this — the RLS WITH CHECK forbids clients from ever setting
// locked — which is the moment the opponent's picks first become readable.
import { db } from './supabase.js';
import { autoLineup } from './engine.js';
import { wantsComboDrip, aiLiveBuffs } from '../../src/data/aiLineup.ts';
import { powerupById } from '../../src/data/powerups.ts';

/** A team's armed loadout (applied_state) — what it already OWNS coming into the
 *  lock. Returns { buffs:Set, unlocks:Set, extra:int, payload }. */
async function ownedLoadout(matchupId, appUserId) {
  const { data } = await db().from('applied_state').select('payload_json')
    .eq('matchup_id', matchupId).eq('app_user_id', appUserId).maybeSingle();
  const payload = data?.payload_json ?? {};
  return {
    buffs: new Set(Array.isArray(payload.buffs) ? payload.buffs : []),
    unlocks: new Set(Array.isArray(payload.unlocks) ? payload.unlocks : []),
    extra: Number.isFinite(payload.extra) ? payload.extra : 0,
    payload,
  };
}

/** AI budget pass (M4b): an AI-driven team earns + spends coin exactly like a
 *  human. Seeds its wallet (idempotent), then buys power-ups BLIND on its OWN
 *  roster in priority order — (a) Combo Drip if it has a dual-threat, then
 *  (b) in-slot buffs from the deterministic draw — spending only what it can
 *  afford. Purchases land in the team's applied_state (the same store the human
 *  shop writes, app_user-keyed), so resolve.js scores it with exactly what it
 *  bought. Idempotent per item, so a re-lock never double-charges. Returns the
 *  team's owned-unlock Set + purchased extra-slot count, used to build a lineup
 *  that only fields a `combodrip` pick when the unlock was bought and stacks a
 *  window for each extra slot it could afford. */
const EXTRA_SLOT_CAP = 2; // mirrors extra_slot_cap() in migration 0027.

async function aiBudgetPass(m, rosterId, appUserId, starters, seed) {
  // 1. Seed the season starting balance (idempotent via the <league>:seed:<roster> key).
  await db().rpc('credit_wallet', {
    p_league_id: m.league_id, p_roster_id: rosterId, p_matchup_id: null,
    p_week: null, p_delta: seed, p_reason: 'seed',
  });

  const own = await ownedLoadout(m.id, appUserId);
  const spend = async (item, idem) => {
    const price = powerupById(item)?.price ?? 9999;
    const { data: sp } = await db().rpc('spend_from_wallet', {
      p_league_id: m.league_id, p_roster_id: rosterId, p_price: price,
      p_matchup_id: m.id, p_week: m.week, p_reason: 'spend:' + item, p_idem: idem,
    });
    return !!sp?.ok;
  };

  // 2. Buy power-ups blind + priority-ordered (own roster only): (a) the EV in-slot
  //    buffs first, then (b) the Combo Drip unlock if the roster has a dual-threat.
  //    The playtester (tools/playtester) shows that at the season coin seed a drip
  //    amplifier is a better single buy than the combodrip unlock — which only pays
  //    for a genuine dual-threat and otherwise crowds out the buff — so buffs lead.
  //    Each item charged once (idempotent per item); items already owned from a prior
  //    lock are kept without re-charging, so a depleted balance can't drop a bought item.
  const desired = [...aiLiveBuffs(`${m.league_id}:${rosterId}`, m.week)];
  if (starters.some((s) => s.player_slug && wantsComboDrip(s.player_slug, s.pos))) desired.push('unlock-combo-drip');
  for (const item of desired) {
    if (own.buffs.has(item) || own.unlocks.has(item)) continue;
    if (await spend(item, `${m.id}:ai:${item}:${rosterId}`)) (item.startsWith('unlock-') ? own.unlocks : own.buffs).add(item);
  }

  // 2c. Window-stacking: buy extra slots up to the cap if still affordable. Each
  //     index has its own idem key so a re-lock never double-buys the same slot.
  for (let i = own.extra; i < EXTRA_SLOT_CAP; i++) {
    if (await spend('extra-slot', `${m.id}:ai:extra-slot:${i}:${rosterId}`)) own.extra = i + 1; else break;
  }

  // 3. Record the bought loadout (merge, don't clobber any other payload keys).
  await db().from('applied_state').upsert({
    matchup_id: m.id, app_user_id: appUserId, week: m.week,
    payload_json: { ...own.payload, buffs: [...own.buffs], unlocks: [...own.unlocks], extra: own.extra },
  }, { onConflict: 'matchup_id,app_user_id' });

  return { owned: own.unlocks, extra: own.extra };
}

/** Lock any scheduled matchups whose lock_at has passed. Returns count locked. */
export async function lockDueMatchups(now = new Date()) {
  const iso = now.toISOString();
  const { data: due } = await db().from('matchup').select('id')
    .eq('status', 'scheduled').not('lock_at', 'is', null).lte('lock_at', iso);
  if (!due || !due.length) return 0;
  const ids = due.map((m) => m.id);
  await db().from('sealed_pick').update({ locked: true, revealed_at: iso }).in('matchup_id', ids).eq('locked', false);
  await db().from('matchup').update({ status: 'live' }).in('id', ids);
  try { await materializeAutoLineups(ids, iso); } catch (e) { console.error('[lock] materialize auto-lineups', e?.message ?? e); }
  return ids.length;
}

/** At lock, write an auto-lineup (Sleeper starters + default metric) into
 *  sealed_pick — locked + revealed — for any side that is AI-controlled, or an
 *  enrolled manager who submitted no picks (unless the league policy is 'empty').
 *  Makes those lineups visible on the board and locks them; empty seats with no
 *  app_user are left to the resolver's auto-backup. */
export async function materializeAutoLineups(matchupIds, iso = new Date().toISOString()) {
  const { data: ms } = await db().from('matchup')
    .select('id,league_id,week,home_roster_id,away_roster_id').in('id', matchupIds);
  // The season starting balance, authoritative from the DB so the AI seeds the
  // same amount a human's ensure_wallet does.
  const seed = Number((await db().rpc('wallet_seed')).data ?? 150);
  let n = 0;
  for (const m of ms ?? []) {
    const policy = (await db().from('league').select('lineup_policy').eq('id', m.league_id).maybeSingle()).data?.lineup_policy ?? 'best_lineup';
    const { data: mems } = await db().from('league_membership')
      .select('sleeper_roster_id,app_user_id,enrolled,controller').eq('league_id', m.league_id)
      .in('sleeper_roster_id', [m.home_roster_id, m.away_roster_id]);
    const { data: lineups } = await db().from('sleeper_lineup').select('roster_id,starters_json')
      .eq('league_id', m.league_id).eq('week', m.week).in('roster_id', [m.home_roster_id, m.away_roster_id]);
    const startersByRoster = new Map((lineups ?? []).map((r) => [r.roster_id, r.starters_json]));
    for (const rosterId of [m.home_roster_id, m.away_roster_id]) {
      const mem = (mems ?? []).find((x) => x.sleeper_roster_id === rosterId);
      if (!mem?.app_user_id) continue; // empty seat → resolver auto-backup (can't store picks)
      const { data: existing } = await db().from('sealed_pick').select('id')
        .eq('matchup_id', m.id).eq('app_user_id', mem.app_user_id).not('player_slug', 'is', null).limit(1);
      const hasPicks = !!(existing && existing.length);
      const isAi = mem.controller === 'ai';
      const missed = mem.enrolled && !hasPicks;
      if (!(isAi || (missed && policy !== 'empty'))) continue;
      // An AI-controlled seat (always, or a missed manager flipped to AI for the
      // week) plays the economy: it earns + spends coin. A missed 'best_lineup'
      // manager just gets auto-filled with whatever they already own — we never
      // spend their coin for them.
      const aiDriven = isAi || (missed && policy === 'ai');
      const starters = (startersByRoster.get(rosterId)) ?? [];
      const slugs = starters.map((s) => s.player_slug).filter(Boolean);
      let owned, extra;
      if (aiDriven) { ({ owned, extra } = await aiBudgetPass(m, rosterId, mem.app_user_id, starters, seed)); }
      else { const l = await ownedLoadout(m.id, mem.app_user_id); owned = l.unlocks; extra = l.extra; }
      // Arm-before-write: applied_state (owned unlocks + the extra-slot count) is
      // upserted by the budget pass BEFORE these rows, so a `combodrip` pick
      // clears enforce_locked_metric and the extra 'x' rows clear enforce_slot_cap.
      if (isAi && hasPicks) await db().from('sealed_pick').delete().eq('matchup_id', m.id).eq('app_user_id', mem.app_user_id);
      const rows = autoLineup(slugs, m.week, owned, extra).map((p) => ({
        matchup_id: m.id, app_user_id: mem.app_user_id, game_window: p.win, roster_slot: p.slot,
        player_slug: p.slug, metric_id: p.metric, locked: true, revealed_at: iso,
      }));
      if (rows.length) { await db().from('sealed_pick').upsert(rows, { onConflict: 'matchup_id,app_user_id,game_window,roster_slot' }); n++; }
    }
  }
  return n;
}

/** Mark matchups final once all their week's games are complete. */
export async function finalizeMatchups(week, completed) {
  if (!completed) return 0;
  const { data } = await db().from('matchup').update({ status: 'final' }).eq('week', week).eq('status', 'live').select('id');
  return (data ?? []).length;
}
