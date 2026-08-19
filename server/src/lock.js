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
import { PLAYER_BIO } from '../../packages/core/src/data/playerBio.ts';
import { autoSlotPlan, leagueSlotDefs, leagueBestball, slateAwareProj, CLASSIC_WIN } from '../../packages/core/src/engine/classic.ts';
import { setLeagueGolf, clearLeagueGolf } from '../../packages/core/src/engine/golf.ts';
import { setLeagueProjScoring, clearLeagueProjScoring, leagueCatalogOf } from '../../packages/core/src/engine/projScoring.ts';
import { autoLineup } from './engine.js';
import { modeOfSettings } from './resolve.js';
import { seatAgentsFor } from './agents.js';
import { wantsComboDrip, aiLiveBuffs, aiBattlePlan, AI_STACKS } from '../../packages/core/src/data/aiLineup.ts';
import { powerupById } from '../../packages/core/src/data/powerups.ts';

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
  // NOTE: 'wk' is deliberately NOT added here any more (0178). A classic
  // league's weekly lineup used to seal wholesale the instant ANY window came
  // due — so a Thursday night game froze your Sunday backs, which is not how
  // normal fantasy behaves. Classic rows now seal one player at a time, in
  // sealDueClassicPicks below.
}

/** Team → this week's kickoff (ms), from the slate the caller already built. */
export function teamKickoffs(slate) {
  const out = {};
  for (const g of slate ?? []) {
    const ms = g.kickoff ? Date.parse(g.kickoff) : NaN;
    if (!Number.isFinite(ms)) continue;
    for (const team of [g.home, g.away]) {
      if (!team) continue;
      const k = String(team).toUpperCase();
      out[k] = Math.min(out[k] ?? Infinity, ms);
    }
  }
  return out;
}

/** LATE SWAP for classic leagues (0178): seal each 'wk' pick at ITS OWN
 *  player's kickoff, not at the week's first.
 *
 *  A player's team comes from the league's own pool first — the same source
 *  the DB trigger (classic_player_kickoff) reads, so the two layers can never
 *  disagree about who is locked — then from the baked bio, which covers
 *  Sleeper-imported leagues that have no pool of their own.
 *
 *  A player we CANNOT place is sealed at the week's first kickoff, which is
 *  exactly what every classic pick did before this function existed. Unknown
 *  must fall back to the stricter rule: leaving it editable would let an
 *  unresolvable slug be swapped all week.
 *
 *  Returns the number of picks sealed. */
export async function sealDueClassicPicks(week, teamKicks, now = new Date()) {
  if (!teamKicks || !Object.keys(teamKicks).length) return 0;
  const t = now.getTime();
  const firstKick = Math.min(...Object.values(teamKicks));
  // Classic matchups of this week that are live or final and still hold
  // unsealed weekly picks.
  const { data: ms } = await db().from('matchup')
    .select('id,league_id,status').eq('week', week).in('status', ['scheduled', 'live', 'final']);
  if (!ms?.length) return 0;
  const leagueIds = [...new Set(ms.map((m) => m.league_id))];
  const { data: lgs } = await db().from('league').select('id,settings_json').in('id', leagueIds);
  const classicLeagues = new Set((lgs ?? [])
    .filter((l) => (l.settings_json?.game_mode ?? 'drip') === 'classic').map((l) => l.id));
  if (!classicLeagues.size) return 0;
  const mine = ms.filter((m) => classicLeagues.has(m.league_id));
  const { data: picks } = await db().from('sealed_pick')
    .select('id,matchup_id,player_slug')
    .in('matchup_id', mine.map((m) => m.id)).eq('game_window', 'wk').eq('locked', false);
  if (!picks?.length) return 0;

  const leagueOf = new Map(mine.map((m) => [m.id, m.league_id]));
  const { data: pool } = await db().from('league_pool')
    .select('league_id,slug,team').in('league_id', [...classicLeagues]);
  const poolTeam = new Map((pool ?? []).map((r) => [`${r.league_id}:${r.slug}`, r.team]));
  const teamOf = (leagueId, slug) => {
    const fromPool = poolTeam.get(`${leagueId}:${slug}`);
    if (fromPool) return String(fromPool).toUpperCase();
    const baked = PLAYER_BIO[slug]?.team;
    return baked ? String(baked).toUpperCase() : null;
  };

  const dueIds = [];
  for (const p of picks) {
    // An EMPTY spot has nobody to be late for; it seals with the week so a
    // manager can still fill it right up to their next kickoff.
    const team = p.player_slug ? teamOf(leagueOf.get(p.matchup_id), p.player_slug) : null;
    // No team resolved (unknown slug) or no game this week (BYE) → the old
    // week-wide rule. A bye player can't be swapped in after the week starts
    // any more than he could before.
    const kick = team != null && Number.isFinite(teamKicks[team]) ? teamKicks[team] : firstKick;
    if (kick <= t) dueIds.push(p.id);
  }
  if (!dueIds.length) return 0;
  const iso = now.toISOString();
  const { data } = await db().from('sealed_pick')
    .update({ locked: true, revealed_at: iso }).in('id', dueIds).eq('locked', false).select('id');
  return (data ?? []).length;
}

/** AUTO-SLOT (v0.247.0): give every classic team the best projected lineup its
 *  roster can field, for this week, before anyone touches it.
 *
 *  Until now a classic team started each week EMPTY. A manager who never opened
 *  the app scored an honest zero, which is honest and also nothing like normal
 *  fantasy: there, your lineup is already set and you adjust it. So the worker
 *  sets it — `optimalLineup` over the roster, ranked by projection.
 *
 *  It writes ONLY spots with no stored row, and that is the whole safety
 *  argument. A row holding NULL is a manager who emptied that spot on purpose;
 *  refilling it would silently un-do a decision, every tick, forever. `insert`
 *  with ignoreDuplicates makes the database enforce the same thing under a race
 *  — a manager saving in the same second keeps their write, because ours turns
 *  into ON CONFLICT DO NOTHING rather than an overwrite.
 *
 *  Only 'scheduled' matchups, and only the tick's own week: a schedule is
 *  generated weeks ahead, and slotting week 12 today would fill it with players
 *  who may be dropped by then and then never revisit it (the rows would exist).
 *  Rows land UNLOCKED — this is a starting point, not a seal. The per-player
 *  kickoff seal (sealDueClassicPicks) freezes them exactly as it does a
 *  hand-set lineup.
 *
 *  Seats with no app_user_id are skipped: sealed_pick hangs off a user, so
 *  there is nowhere to put the row. Those score the honest zero they always did.
 *
 *  Returns the number of spots slotted. */
export async function autoSlotClassicLineups(week, slate = null) {
  const { data: ms } = await db().from('matchup')
    .select('id,league_id,home_roster_id,away_roster_id').eq('week', week).eq('status', 'scheduled');
  if (!ms?.length) return 0;
  // SLATE-AWARE VALUES (v0.252.0). PROJ_2026 is a season constant that knows
  // neither byes nor Friday's injury report, so ranking by it raw seats a
  // 20-point projection who is guaranteed to score zero. The tick's slate
  // proves byes; injury_status (the worker's own ESPN poll) proves ruled-out.
  // Only O and IR — questionable and doubtful players play often enough that
  // benching them automatically would overrule real decisions.
  const { data: injRows } = await db().from('injury_status')
    .select('player_slug').in('status', ['O', 'IR']);
  const outs = new Set((injRows ?? []).map((r) => r.player_slug));
  const valueOf = slateAwareProj(week, slate, (slug) => outs.has(slug));
  const { data: lgs } = await db().from('league')
    .select('id,settings_json,lineup_policy').in('id', [...new Set(ms.map((m) => m.league_id))]);
  // Through modeOfSettings, never raw: settings_json calls the builder spec
  // `roster_slots`, and leagueSlotDefs reads `slots` — hand it the raw row and
  // every builder league quietly gets the default nine spots instead.
  const modeOf = new Map((lgs ?? []).map((l) => [l.id, modeOfSettings(l.settings_json)]));
  // 'empty' is a commissioner saying OUT LOUD that a missed lineup should score
  // zero. Auto-slot is a default, not a policy override, so that league opts
  // out. Everything else ('best_lineup', 'ai', unset) gets slotted.
  const optedOut = new Set((lgs ?? []).filter((l) => l.lineup_policy === 'empty').map((l) => l.id));
  const byLeague = new Map();
  for (const m of ms) {
    if (modeOf.get(m.league_id)?.mode !== 'classic' || optedOut.has(m.league_id)) continue;
    if (!byLeague.has(m.league_id)) byLeague.set(m.league_id, []);
    byLeague.get(m.league_id).push(m);
  }
  if (!byLeague.size) return 0;

  let slotted = 0;
  try {
  for (const [leagueId, matchups] of byLeague) {
    const mode = modeOf.get(leagueId);
    // GOLF (v0.303.1): "the best lineup this roster can field" means the
    // LOWEST-scoring one there, and autoSlotPlan ranks through the engine's
    // module global. Installed per league and set UNCONDITIONALLY — skipping
    // the false case would leave the previous league's rule in force over this
    // one, which is how one golf league would quietly mis-slot the whole tick.
    setLeagueGolf(mode?.golf === true);
    // THE LEAGUE'S SCORING (v0.310.0), on the same terms and for the same
    // reason. `slateAwareProj` ranks candidates through `projectedPoints`, so
    // without this a league paying 6 for a passing touchdown, or a TE premium,
    // had its auto-slot rank by STOCK PPR and seat the wrong player — on the
    // seats least able to notice, since auto-slot exists for the ones nobody
    // is managing. Unconditional for the same reason golf is: it is a module
    // global, and skipping the plain-scoring case would leave the previous
    // league's catalog in force over this one.
    //
    // `valueOf` above is built once for the tick and still correct: it closes
    // over nothing but the slate and the outs, and reads the catalog at CALL
    // time — which is inside this loop, after this install.
    setLeagueProjScoring(leagueCatalogOf(mode));
    const slots = leagueSlotDefs(mode);
    const bestball = leagueBestball(mode);
    if (slots.every((d) => bestball.includes(d.slot))) continue;   // all best ball: nothing to set

    // The league's own pool carries position, team and tenure — everything
    // slotAllows needs. A Sleeper-imported classic league has no pool of its
    // own, so it has no auto-slot either (and no draft that built one).
    const { data: pool } = await db().from('league_pool')
      .select('slug,pos,team,exp').eq('league_id', leagueId).range(0, 1999);
    if (!pool?.length) continue;
    const meta = new Map(pool.map((p) => [p.slug, p]));

    const rosterIds = [...new Set(matchups.flatMap((m) => [m.home_roster_id, m.away_roster_id]))];
    const { data: ros } = await db().from('native_roster')
      .select('roster_id,slug').eq('league_id', leagueId).eq('spot', 'active')   // taxi/IR never start (0164)
      .in('roster_id', rosterIds);
    if (!ros?.length) continue;   // undrafted — nothing to slot yet, and no rows written, so the next tick retries

    // no_start (0144) binds the auto-fill: the sealed_pick trigger exempts the
    // server, so the exclusion has to happen here. autoSlotPlan checks the
    // engine's own flag cache too, which this worker does not install per
    // league — so this filter is the one that actually bites.
    const { data: flagRows } = await db().from('player_flag').select('slug,rules').eq('league_id', leagueId);
    const noStart = new Set((flagRows ?? []).filter((f) => f.rules?.no_start === true).map((f) => f.slug));
    const rosterOf = new Map();
    for (const r of ros) {
      const p = meta.get(r.slug);
      if (!p || noStart.has(r.slug)) continue;
      if (!rosterOf.has(r.roster_id)) rosterOf.set(r.roster_id, []);
      rosterOf.get(r.roster_id).push({ id: r.slug, pos: p.pos, team: p.team, exp: p.exp ?? null });
    }

    const { data: mems } = await db().from('league_membership')
      .select('sleeper_roster_id,app_user_id').eq('league_id', leagueId).in('sleeper_roster_id', rosterIds);
    const userOf = new Map((mems ?? []).filter((x) => x.app_user_id).map((x) => [x.sleeper_roster_id, x.app_user_id]));
    // SEAT AGENTS (0180): an unclaimed seat writes as its agent. The mapping
    // exists only for classic leagues, and the claim trigger retires it the
    // moment a human takes the seat.
    const agents = await seatAgentsFor([leagueId]);
    const agentOf = (rid) => agents.get(`${leagueId}:${rid}`) ?? null;
    if (!userOf.size && !agents.size) continue;

    const { data: rows } = await db().from('sealed_pick')
      .select('matchup_id,app_user_id,roster_slot,player_slug,locked')
      .in('matchup_id', matchups.map((m) => m.id)).eq('game_window', CLASSIC_WIN);
    // (matchup, user) → { slot: slug|null } for the spots that HAVE a row,
    // and the locked subset separately — the agent path treats them apart.
    const storedBy = new Map();
    const lockedBy = new Map();
    for (const r of rows ?? []) {
      const k = `${r.matchup_id}#${r.app_user_id}`;
      if (!storedBy.has(k)) storedBy.set(k, {});
      storedBy.get(k)[r.roster_slot] = r.player_slug;
      if (r.locked) {
        if (!lockedBy.has(k)) lockedBy.set(k, {});
        lockedBy.get(k)[r.roster_slot] = r.player_slug;
      }
    }

    const humanPayload = [];
    const agentPayload = [];
    for (const m of matchups) {
      // Deduped: a self-matchup (a bye week's placeholder) would otherwise plan
      // the same seat twice and put two rows for one spot in a single insert.
      for (const rosterId of new Set([m.home_roster_id, m.away_roster_id])) {
        const uid = userOf.get(rosterId);
        const roster = rosterOf.get(rosterId);
        if (!roster?.length) continue;
        if (uid) {
          // A MANAGED seat: fill only the spots with no row at all. A row is a
          // decision — including a NULL a manager wrote on purpose.
          const stored = storedBy.get(`${m.id}#${uid}`) ?? {};
          for (const p of autoSlotPlan(slots, bestball, stored, roster, valueOf)) {
            humanPayload.push({
              matchup_id: m.id, app_user_id: uid, game_window: CLASSIC_WIN,
              roster_slot: p.slot, player_slug: p.player, metric_id: null, locked: false,
            });
          }
          continue;
        }
        const agent = agentOf(rosterId);
        if (!agent) continue;
        // An AGENT seat is a DILIGENT manager, not a Tuesday snapshot: its
        // unlocked rows are the worker's own prior writes, never a decision,
        // so they are re-planned at the current values every tick — a player
        // ruled Out on Friday drops from Sunday's spots exactly as a careful
        // human would drop him. Only LOCKED rows stand (his game started; the
        // seal is the seal), and their players stay reserved.
        const k = `${m.id}#${agent}`;
        const lockedMap = lockedBy.get(k) ?? {};
        const current = storedBy.get(k) ?? {};
        for (const p of autoSlotPlan(slots, bestball, lockedMap, roster, valueOf)) {
          if (current[p.slot] === p.player) continue;   // already right — no churn
          agentPayload.push({
            matchup_id: m.id, app_user_id: agent, game_window: CLASSIC_WIN,
            roster_slot: p.slot, player_slug: p.player, metric_id: null, locked: false,
          });
        }
      }
    }
    // Humans: ignoreDuplicates → ON CONFLICT DO NOTHING. Not an upsert: a row
    // that appeared since the read above is a manager's, and it wins. The
    // returned rows are the ones actually inserted, so the count is honest.
    if (humanPayload.length) {
      const { data: ins, error } = await db().from('sealed_pick')
        .upsert(humanPayload, { onConflict: 'matchup_id,app_user_id,game_window,roster_slot', ignoreDuplicates: true })
        .select('id');
      if (error) throw error;
      slotted += (ins ?? []).length;
    }
    // Agents: a real upsert — the worker owns these rows and is replacing its
    // own earlier answer. enforce_window_lock passes the server unconditionally
    // and the sweep re-locks nothing that isn't due, so a locked row can only
    // be missing from this payload, never clobbered by it. (A claim landing
    // inside this tick's window can strand a few just-written agent rows on a
    // now-managed seat; seat attribution's orphan adoption renders them until
    // the next claim-free tick, and the mapping's deletion stops the writes.)
    if (agentPayload.length) {
      const { error } = await db().from('sealed_pick')
        .upsert(agentPayload, { onConflict: 'matchup_id,app_user_id,game_window,roster_slot' });
      if (error) throw error;
      slotted += agentPayload.length;
    }
  }
  } finally {
    // The install is a module global; nothing downstream in this tick should
    // inherit the last league's rule.
    clearLeagueGolf();
    clearLeagueProjScoring();
  }
  return slotted;
}

/** Lock any scheduled matchups whose lock_at has passed: flip status → 'live' and
 *  seal the picks of windows already kicked off (all picks when `winKicks` is
 *  unknown). Later windows stay unlocked — lockDueWindows seals each at its own
 *  kickoff. Returns count of matchups locked.
 *
 *  `week` scopes it to ONE board week, and matters now that the scheduler runs
 *  several week contexts per tick (index.js): `winKicks` describes that context's
 *  slate only, so an unscoped sweep would seal a regular-season matchup's windows
 *  against preseason kickoff times. Null = every week, the pre-context behavior. */
export async function lockDueMatchups(now = new Date(), winKicks = null, week = null) {
  const iso = now.toISOString();
  let dq = db().from('matchup').select('id')
    .eq('status', 'scheduled').not('lock_at', 'is', null).lte('lock_at', iso);
  if (week != null) dq = dq.eq('week', week);
  const { data: due } = await dq;
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
/** fillOnly (0170.8): the per-tick variant for ALREADY-LIVE matchups — later
 *  windows of a multi-window week come due long after the scheduled→live
 *  transition that runs the full pass, so without this they never fill. In
 *  fillOnly mode every seat (AI included) takes the plain empty-slot fill from
 *  what it owns: no AI delete/rewrite, no budget pass, no coin — so calling it
 *  every tick is a no-op once the slots are filled. */
export async function materializeAutoLineups(matchupIds, iso = new Date().toISOString(), dueWins = null, fillOnly = false) {
  const { data: ms } = await db().from('matchup')
    .select('id,league_id,week,home_roster_id,away_roster_id').in('id', matchupIds);
  // The season starting balance, authoritative from the DB so the AI seeds the
  // same amount a human's ensure_wallet does.
  const seed = Number((await db().rpc('wallet_seed')).data ?? 150);
  let n = 0;
  for (const m of ms ?? []) {
    const { data: lg } = await db().from('league').select('lineup_policy,settings_json').eq('id', m.league_id).maybeSingle();
    // Classic leagues (0157): the auto-fill below builds a DRIP lineup (windows
    // + metrics), which is junk under classic's 'wk' rows — and its rows would
    // eat the 9-slot classic cap. Missed classic lineups score their honest
    // zeros instead (the resolver's classic branch fields only 'wk' picks).
    if (lg?.settings_json?.game_mode === 'classic') continue;
    const policy = lg?.lineup_policy ?? 'best_lineup';
    // no_start flags (0144): the auto-fill must never field a player the
    // commissioner has barred — the sealed_pick trigger exempts the server
    // (game ops must not jam), so the exclusion has to happen HERE.
    const { data: flagRows } = await db().from('player_flag').select('slug,rules').eq('league_id', m.league_id);
    const noStart = new Set((flagRows ?? []).filter((f) => f.rules?.no_start === true).map((f) => f.slug));
    // TAXI/IR (0164): a stashed player can't start — the DB trigger would
    // refuse the row and take the whole autofill batch down with it.
    const { data: stashedRows } = await db().from('native_roster')
      .select('slug').eq('league_id', m.league_id).neq('spot', 'active');
    for (const r of stashedRows ?? []) noStart.add(r.slug);
    const { data: mems } = await db().from('league_membership')
      .select('sleeper_roster_id,app_user_id,enrolled,controller').eq('league_id', m.league_id)
      .in('sleeper_roster_id', [m.home_roster_id, m.away_roster_id]);
    const { data: lineups } = await db().from('sleeper_lineup').select('roster_id,starters_json')
      .eq('league_id', m.league_id).eq('week', m.week).in('roster_id', [m.home_roster_id, m.away_roster_id]);
    const startersByRoster = new Map((lineups ?? []).map((r) => [r.roster_id, r.starters_json]));
    for (const rosterId of [m.home_roster_id, m.away_roster_id]) {
      const mem = (mems ?? []).find((x) => x.sleeper_roster_id === rosterId);
      if (!mem?.app_user_id) continue; // empty seat → resolver auto-backup (can't store picks)
      // PER SLOT, not per matchup or even per window (founder's rule, refined
      // twice on live fire): any empty card spot with an eligible player
      // available gets the optimal fill at lock — human seats included. First
      // the Joeggernaut hole (a seat that set the 7:00 window read as "has
      // picks" and was skipped wholesale), then its little sibling (a window
      // with 2 of 3 slots set kept its empty slot). A slot counts as set only
      // if it holds a pick; the fill below targets exactly the empty ones.
      const { data: existing } = await db().from('sealed_pick').select('game_window,roster_slot,player_slug')
        .eq('matchup_id', m.id).eq('app_user_id', mem.app_user_id).not('player_slug', 'is', null);
      const setSlots = new Set((existing ?? []).map((r) => `${r.game_window}#${r.roster_slot}`));
      const fieldedSlugs = new Set((existing ?? []).map((r) => r.player_slug));
      const hasPicks = setSlots.size > 0;
      const isAi = mem.controller === 'ai';
      // The 8/16 ruling: every claimed seat gets its empty slots filled if
      // possible — enrolled or not, actively managed or not. (Unclaimed seats
      // have no app_user to key sealed rows under; the resolve-time fallback
      // still covers them.) The 'empty' lineup policy remains the commissioner's
      // explicit opt-out: a missed side scores its honest zero there.
      const missed = !!mem.app_user_id && !hasPicks;
      const partial = !!mem.app_user_id && hasPicks && !isAi; // some slots set, fill the rest
      if (!(isAi || ((missed || partial) && policy !== 'empty'))) continue;
      // The other half of the ruling: the AI SPENDS only when AI control is on
      // (controller === 'ai'). A missed manager — under ANY policy, 'ai'
      // included — gets auto-filled with whatever they already own; their coin
      // is never spent for them and no power-ups appear they didn't buy.
      const aiDriven = !fillOnly && isAi;
      const fullRewrite = !fillOnly && isAi;
      const starters = (startersByRoster.get(rosterId)) ?? [];
      // The fill must never duplicate a player the manager already fielded:
      // autoLineup builds blind from the pool it's given, so give it the pool
      // MINUS the fielded players (a full AI rewrite keeps it all).
      const slugs = starters.map((s) => s.player_slug).filter(Boolean)
        .filter((slug) => !noStart.has(slug))
        .filter((slug) => fullRewrite || !fieldedSlugs.has(slug));
      let owned, extra;
      if (aiDriven) { ({ owned, extra } = await aiBudgetPass(m, rosterId, mem.app_user_id, starters, seed)); }
      else { const l = await ownedLoadout(m.id, mem.app_user_id); owned = l.unlocks; extra = l.extra; }
      // Arm-before-write: applied_state (owned unlocks + the extra-slot count) is
      // upserted by the budget pass BEFORE these rows, so a `combodrip` pick
      // clears enforce_locked_metric and the extra 'x' rows clear enforce_slot_cap.
      if (fullRewrite && hasPicks) await db().from('sealed_pick').delete().eq('matchup_id', m.id).eq('app_user_id', mem.app_user_id);
      // Persona key ONLY for permanent AI seats: some weeks their TE hides an
      // 8-PT NUKE (EV-neutral drama, see aiPersonaNuker). A missed human's
      // autofill — even one flipped to AI policy for the week — stays vanilla.
      const persona = fullRewrite ? `${m.league_id}:${rosterId}` : undefined;
      const rows = autoLineup(slugs, m.week, owned, extra, persona)
        // A partially-set human keeps every SLOT they touched — the fill
        // covers only the empty ones (an AI seat still rewrites in full; its
        // old rows were deleted above).
        .filter((p) => fullRewrite || !setSlots.has(`${p.win}#${p.slot}`))
        .map((p) => {
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
