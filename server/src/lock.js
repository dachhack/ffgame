// Lock / reveal — PER WINDOW. At a matchup's lock_at (first kickoff of the week)
// the server flips the matchup to 'live', but picks seal window by window: each
// window's picks lock (locked = true) at that window's OWN first kickoff, so a
// MNF pick stays editable — and hidden — through Sunday ("late swap"). ONLY the
// service role can flip locked — the RLS WITH CHECK forbids clients from ever
// setting it — and a locked row is the moment the opponent can first read it.
// The DB-side enforce_window_lock trigger (migration 0058) rejects client writes
// into an already-kicked-off window, so the sweep's tick cadence is never an
// integrity window.
import { db } from './supabase.js';
import { autoLineup } from './engine.js';
import { wantsComboDrip, aiLiveBuffs, aiBattlePlan, AI_STACKS } from '../../src/data/aiLineup.ts';
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

  // 2. Buy power-ups blind + priority-ordered (own roster only) — RETRAINED from
  //    the lever sweep (tools/playtester/aggregate.mjs, findings §17) by measured
  //    lift-per-coin: first amp → RIVALRY on its densest window (2.80 pts/10c —
  //    better per-coin than momentum) → remaining amps → GHOST when the lineup
  //    leaves a base slot open (slate/bye gaps; a flat 14 beats an empty slot) →
  //    the Combo Drip unlock for a genuine dual-threat. Blind by construction:
  //    the battle-play targets read only the AI's OWN deterministic lineup.
  //    Each item charged once (idempotent per item); items already owned from a prior
  //    lock are kept without re-charging, so a depleted balance can't drop a bought item.
  //    (Mirror: tools/playtester/lib.mjs aiLoadout — keep in lockstep.)
  const slugs = starters.map((s) => s.player_slug).filter(Boolean);
  const plan = aiBattlePlan(autoLineup(slugs, m.week), m.week);
  const amps = aiLiveBuffs(`${m.league_id}:${rosterId}`, m.week);
  // The raid STACK (findings §18): when the lineup deploys no Field General,
  // Air Raid (◎40) is bought FIRST — it fits alongside the amp inside weekly
  // income, and aiMetric flips the QB onto passbig once the unlock is owned.
  // (The other probed stacks — don/herring/twin-FG/extra-stacking — ship OFF in
  // AI_STACKS: they never fire at the current economy, so no dead code here.)
  const raidFits = (AI_STACKS.raid || AI_STACKS.raidFirst) && !plan.fgDeployed;
  const desired = [];
  if (raidFits && AI_STACKS.raidFirst) desired.push('unlock-pass-td10');
  desired.push(amps[0], 'rivalry', ...amps.slice(1));
  if (raidFits && !AI_STACKS.raidFirst) desired.push('unlock-pass-td10');
  if (plan.ghost) desired.push('ghost');
  if (starters.some((s) => s.player_slug && wantsComboDrip(s.player_slug, s.pos))) desired.push('unlock-combo-drip');
  const targeted = { ...(own.payload.targeted ?? {}) };
  // Amplifiers are capacity-limited (1 + Second Amp + Third Amp, migration
  // 0063): buying an amplifier beyond capacity requires buying the capacity
  // unlock first — if THAT isn't affordable, skip the amp. (Mirrored in
  // tools/playtester/lib.mjs aiLoadout — keep in lockstep.)
  const AMPS = new Set(['momentum', 'garbage-time', 'overtime']);
  const ampCap = () => 1 + (own.buffs.has('amp-2') ? 1 : 0) + (own.buffs.has('amp-2') && own.buffs.has('amp-3') ? 1 : 0);
  const balance = async () => {
    const { data } = await db().from('team_wallet').select('coins')
      .eq('league_id', m.league_id).eq('roster_id', rosterId).maybeSingle();
    return Number(data?.coins ?? 0);
  };
  for (const item of desired) {
    // Battle plays: spend, then record the blind target in the same targeted
    // payload the human apply RPCs use (resolve.js toExtras scores it).
    if (item === 'rivalry' || item === 'ghost') {
      const target = item === 'rivalry' ? plan.rivalry : plan.ghost;
      if (!target || (targeted[item] ?? []).includes(target)) continue;
      if (await spend(item, `${m.id}:ai:${item}:${rosterId}`)) targeted[item] = [...(targeted[item] ?? []), target];
      continue;
    }
    if (own.buffs.has(item) || own.unlocks.has(item)) continue;
    if (AMPS.has(item) && [...own.buffs].filter((b) => AMPS.has(b)).length >= ampCap()) {
      const need = own.buffs.has('amp-2') ? 'amp-3' : 'amp-2';
      // Capacity only pays off with the amp on top — skip both unless BOTH fit,
      // so a failed amp buy can't strand a paid-for capacity unlock.
      const both = (powerupById(need)?.price ?? 9999) + (powerupById(item)?.price ?? 9999);
      if ((await balance()) < both) continue;
      if (!(await spend(need, `${m.id}:ai:${need}:${rosterId}`))) continue;
      own.buffs.add(need);
    }
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
    payload_json: { ...own.payload, buffs: [...own.buffs], unlocks: [...own.unlocks], extra: own.extra, targeted },
  }, { onConflict: 'matchup_id,app_user_id' });

  return { owned: own.unlocks, extra: own.extra };
}

/** Backfill lock_at on scheduled matchups that were created without it. The in-app
 *  "sync week" and clone-week paths persist matchups with lock_at = null, so they
 *  would never auto-lock; here the worker fills in the week's authoritative first
 *  kickoff (epoch ms) so they seal at kickoff like worker-synced matchups. Scoped
 *  to one week; a no-op (returns 0) until ESPN has that week's kickoff. */
export async function backfillLockAt(week, kickoffMs) {
  if (!Number.isFinite(kickoffMs)) return 0;
  const iso = new Date(kickoffMs).toISOString();
  const { data } = await db().from('matchup')
    .update({ lock_at: iso })
    .eq('week', week).eq('status', 'scheduled').is('lock_at', null)
    .select('id');
  return (data ?? []).length;
}

/** Windows whose first kickoff has passed, from a {win → kickoffMs} map. Returns
 *  null when the map is unknown (no slate) — callers then fall back to sealing
 *  everything, the safe pre-0058 behavior. */
function dueWindows(winKicks, now) {
  if (!winKicks) return null;
  const t = now.getTime();
  return new Set(Object.keys(winKicks).filter((w) => Number.isFinite(winKicks[w]) && winKicks[w] <= t));
}

/** Lock any scheduled matchups whose lock_at has passed: flip status → 'live' and
 *  seal the picks of windows already kicked off (all picks when `winKicks` is
 *  unknown). Later windows stay unlocked — lockDueWindows seals each at its own
 *  kickoff. Returns count of matchups locked. */
export async function lockDueMatchups(now = new Date(), winKicks = null) {
  const iso = now.toISOString();
  const { data: due } = await db().from('matchup').select('id')
    .eq('status', 'scheduled').not('lock_at', 'is', null).lte('lock_at', iso);
  if (!due || !due.length) return 0;
  const ids = due.map((m) => m.id);
  const dueWins = dueWindows(winKicks, now);
  let q = db().from('sealed_pick').update({ locked: true, revealed_at: iso }).in('matchup_id', ids).eq('locked', false);
  if (dueWins) q = q.in('game_window', [...dueWins]);
  if (!dueWins || dueWins.size) await q;
  await db().from('matchup').update({ status: 'live' }).in('id', ids);
  try { await materializeAutoLineups(ids, iso, dueWins); } catch (e) { console.error('[lock] materialize auto-lineups', e?.message ?? e); }
  return ids.length;
}

/** Per-window lock sweep: on this week's already-live (or final) matchups, seal
 *  any still-unlocked picks whose window has kicked off — the moment a window's
 *  picks become final AND readable by the opponent. Runs every tick; a no-op
 *  when nothing is newly due. Returns count of picks sealed. */
export async function lockDueWindows(week, winKicks, now = new Date()) {
  const dueWins = dueWindows(winKicks, now);
  if (!dueWins || !dueWins.size) return 0;
  const { data: ms } = await db().from('matchup').select('id')
    .eq('week', week).in('status', ['live', 'final']);
  if (!ms || !ms.length) return 0;
  const { data } = await db().from('sealed_pick')
    .update({ locked: true, revealed_at: now.toISOString() })
    .in('matchup_id', ms.map((m) => m.id)).eq('locked', false).in('game_window', [...dueWins])
    .select('id');
  return (data ?? []).length;
}

/** At lock, write an auto-lineup (Sleeper starters + default metric) into
 *  sealed_pick for any side that is AI-controlled, or an enrolled manager who
 *  submitted no picks (unless the league policy is 'empty'). Rows in windows
 *  already kicked off (`dueWins`) land locked + revealed; later windows land
 *  UNLOCKED so they stay hidden from the opponent — and editable by a missed
 *  manager — until their own kickoff seals them (lockDueWindows). With no
 *  dueWins map (unknown slate) every row locks, the safe pre-0058 behavior.
 *  Empty seats with no app_user are left to the resolver's auto-backup. */
export async function materializeAutoLineups(matchupIds, iso = new Date().toISOString(), dueWins = null) {
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
      // Persona key ONLY for permanent AI seats: some weeks their TE hides an
      // 8-PT NUKE (EV-neutral drama, see aiPersonaNuker). A missed human's
      // autofill — even one flipped to AI policy for the week — stays vanilla.
      const persona = isAi ? `${m.league_id}:${rosterId}` : undefined;
      const rows = autoLineup(slugs, m.week, owned, extra, persona).map((p) => {
        const sealNow = !dueWins || dueWins.has(p.win);
        return {
          matchup_id: m.id, app_user_id: mem.app_user_id, game_window: p.win, roster_slot: p.slot,
          player_slug: p.slug, metric_id: p.metric, locked: sealNow, revealed_at: sealNow ? iso : null,
        };
      });
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
