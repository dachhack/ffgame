// App push notifications (0150) — the worker half.
//
// Every sweep (60s): DETECT the four notify-worthy moments into push_outbox
// (each detector re-scans a trailing window; the outbox's unique dedupe_key +
// ignoreDuplicates makes re-scans idempotent), then SEND unsent rows to each
// recipient's registered devices via FCM HTTP v1.
//
// Delivery is raw FCM — no Expo push service in the middle. Credentials are a
// Firebase service account (JSON) in the FCM_SERVICE_ACCOUNT env (Fly secret);
// without it the sweep still ENQUEUES (the record accrues) and logs once that
// sending is off. Dead tokens (UNREGISTERED) are deleted on sight.
//
// The four kinds, and where each is detected:
//   lineup  — a window's lock (kickoff − 1h) is 55–65 min out and a manager
//             still has empty base slots in it (slotsFor; extra powerup slots
//             never alarm — you shouldn't be paged over a slot you'd buy).
//   chat    — an @mention names you, a DM lands in your thread, a poll or a
//             commish note goes up, or — for a league you have asked to hear
//             EVERY message from (league_chat_push, 0241) — anybody speaks.
//   trades  — a trade offer is created with you as the recipient.
//   waivers — your waiver claim processed to WON or LOST.
//   members — somebody took a seat in a league you commission (0241).
//   format  — your league's FORMAT did something to you (0273): the guillotine
//             took your team, or a vampire fed on you. Both are rare and
//             high-stakes, and both had only ever been a banner you had to
//             open the app to find.
import { createSign } from 'node:crypto';
import { db } from './supabase.js';
import { webPushSend, vapidKeys } from './webpush.js';
import { slotsFor } from '../../packages/core/src/engine/matchup.ts';

const log = (...a) => console.log(new Date().toISOString(), '[push]', ...a);

const SCAN_MS = 10 * 60_000;          // detector trailing window
const LOCK_LEAD_MS = 3_600_000;       // picks lock 1h before kickoff (nflSlate.LOCK_LEAD_MS)
const ALARM_MIN_MS = 55 * 60_000;     // notify when the lock is 55–65 min out —
const ALARM_MAX_MS = 65 * 60_000;     // one sweep-width band, so each window fires once

// ── FCM auth: service-account JWT → OAuth token, cached ─────────────────────
let sa = null;
let saWarned = false;
function serviceAccount() {
  if (sa) return sa;
  const raw = process.env.FCM_SERVICE_ACCOUNT;
  if (!raw) {
    if (!saWarned) { log('FCM_SERVICE_ACCOUNT unset — enqueuing only, sending off'); saWarned = true; }
    return null;
  }
  try { sa = JSON.parse(raw); } catch { if (!saWarned) { log('FCM_SERVICE_ACCOUNT unparsable — sending off'); saWarned = true; } return null; }
  return sa;
}

let cachedToken = null; // { token, expMs }
async function fcmAccessToken() {
  const acct = serviceAccount();
  if (!acct) return null;
  if (cachedToken && cachedToken.expMs - Date.now() > 5 * 60_000) return cachedToken.token;
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
    iss: acct.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600,
  })}`;
  const sig = createSign('RSA-SHA256').update(unsigned).sign(acct.private_key).toString('base64url');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${unsigned}.${sig}`,
  });
  if (!res.ok) { log('oauth token failed', res.status, (await res.text()).slice(0, 200)); return null; }
  const j = await res.json();
  cachedToken = { token: j.access_token, expMs: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return cachedToken.token;
}

async function fcmSend(token, deviceToken, { title, body, data }) {
  const acct = serviceAccount();
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${acct.project_id}/messages:send`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      message: {
        token: deviceToken,
        notification: { title, body },
        data: Object.fromEntries(Object.entries(data ?? {}).map(([k, v]) => [k, String(v)])),
        android: { priority: 'high', notification: { channel_id: 'drip-default' } },
      },
    }),
  });
  if (res.ok) return { ok: true };
  const text = await res.text();
  const dead = res.status === 404 || text.includes('UNREGISTERED') || text.includes('INVALID_ARGUMENT');
  return { ok: false, dead, error: `${res.status} ${text.slice(0, 160)}` };
}

// ── enqueue with dedupe ─────────────────────────────────────────────────────
async function enqueue(rows) {
  if (!rows.length) return;
  const { error } = await db().from('push_outbox')
    .upsert(rows, { onConflict: 'dedupe_key', ignoreDuplicates: true });
  if (error) log('enqueue error', error.message);
}

const sinceIso = () => new Date(Date.now() - SCAN_MS).toISOString();

/** roster → enrolled app_user_id for a set of (league, roster) pairs. */
async function ownersFor(pairs) {
  const byLeague = new Map();
  for (const [lid, rid] of pairs) {
    if (!byLeague.has(lid)) byLeague.set(lid, new Set());
    byLeague.get(lid).add(rid);
  }
  const out = new Map(); // `${lid}:${rid}` → app_user_id
  for (const [lid, rids] of byLeague) {
    const { data } = await db().from('league_membership')
      .select('sleeper_roster_id, app_user_id')
      .eq('league_id', lid).eq('enrolled', true).in('sleeper_roster_id', [...rids]);
    for (const m of data ?? []) if (m.app_user_id) out.set(`${lid}:${m.sleeper_roster_id}`, m.app_user_id);
  }
  return out;
}

/** Every enrolled member of a league — the broadcast list for league-wide
 *  moments (draft live/complete, a new poll, a fresh commish note). */
async function leagueMembers(lid) {
  const { data } = await db().from('league_membership')
    .select('app_user_id')
    .eq('league_id', lid).eq('enrolled', true).not('app_user_id', 'is', null);
  return [...new Set((data ?? []).map((m) => m.app_user_id))];
}

async function leagueNames(ids) {
  if (!ids.length) return new Map();
  const { data } = await db().from('league').select('id, name').in('id', ids);
  return new Map((data ?? []).map((l) => [l.id, l.name]));
}

// ── detectors ───────────────────────────────────────────────────────────────

async function detectChat() {
  const rows = [];
  const { data: msgs } = await db().from('league_message')
    .select('id, league_id, body, mentions, author_id, created_at')
    .gt('created_at', sinceIso()).neq('mentions', '{}');
  const names = await leagueNames([...new Set((msgs ?? []).map((m) => m.league_id))]);
  for (const m of msgs ?? []) {
    for (const uid of m.mentions ?? []) {
      rows.push({
        app_user_id: uid, kind: 'chat',
        title: `You were mentioned · ${names.get(m.league_id) ?? 'your league'}`,
        body: m.body.slice(0, 140),
        data: { league_id: m.league_id, open: 'chat' },
        dedupe_key: `chat:m${m.id}:${uid}`,
      });
    }
  }
  // New polls (0152): the whole league hears about a question, not just the
  // mentioned. Author excluded — you asked it.
  const { data: polls } = await db().from('league_message')
    .select('id, league_id, body, author_id, created_at')
    .eq('kind', 'poll').gt('created_at', sinceIso());
  const pollNames = await leagueNames([...new Set((polls ?? []).map((p) => p.league_id))]);
  for (const p of polls ?? []) {
    for (const uid of await leagueMembers(p.league_id)) {
      if (uid === p.author_id) continue;
      rows.push({
        app_user_id: uid, kind: 'chat',
        title: `📊 New poll · ${pollNames.get(p.league_id) ?? 'your league'}`,
        body: p.body.slice(0, 140),
        data: { league_id: p.league_id, open: 'chat' },
        dedupe_key: `poll:${p.id}:${uid}`,
      });
    }
  }
  // A fresh commish note (0152): the league's standing word changed.
  const { data: noted } = await db().from('league')
    .select('id, name, commissioner_id, settings_json')
    .gt('settings_json->commish_note->>at', sinceIso());
  for (const l of noted ?? []) {
    const note = l.settings_json?.commish_note;
    if (!note?.text) continue;
    const stamp = Date.parse(note.at ?? '') || 0;
    for (const uid of await leagueMembers(l.id)) {
      if (uid === l.commissioner_id) continue;
      rows.push({
        app_user_id: uid, kind: 'chat',
        title: `⚑ League note · ${l.name}`,
        body: String(note.text).slice(0, 140),
        data: { league_id: l.id },
        dedupe_key: `note:${l.id}:${stamp}:${uid}`,
      });
    }
  }
  // EVERY MESSAGE, where somebody asked for it (0241). Per-device mutes are
  // global — "chat off" means off everywhere — so wanting every word of one
  // league and only mentions in another is a per-league answer, and this is
  // where it is spent. Off unless a row says otherwise, so an upgrade alone
  // never starts a phone buzzing.
  const { data: subs } = await db().from('league_chat_push')
    .select('league_id, app_user_id').eq('all_messages', true);
  if (subs?.length) {
    const wanted = new Map();          // league_id → [app_user_id]
    for (const r of subs) {
      if (!wanted.has(r.league_id)) wanted.set(r.league_id, []);
      wanted.get(r.league_id).push(r.app_user_id);
    }
    const { data: all } = await db().from('league_message')
      .select('id, league_id, body, mentions, author_id, kind, created_at')
      .in('league_id', [...wanted.keys()]).gt('created_at', sinceIso());
    const allNames = await leagueNames([...wanted.keys()]);
    for (const m of all ?? []) {
      // A poll already broadcasts to the whole league above; sending it again
      // through this door would be the same message twice on one phone.
      if (m.kind === 'poll') continue;
      const mentioned = new Set(m.mentions ?? []);
      for (const uid of wanted.get(m.league_id) ?? []) {
        if (uid === m.author_id) continue;   // you wrote it
        if (mentioned.has(uid)) continue;    // the mention push above is the better one
        rows.push({
          app_user_id: uid, kind: 'chat',
          title: `New message · ${allNames.get(m.league_id) ?? 'your league'}`,
          body: String(m.body ?? '').slice(0, 140),
          data: { league_id: m.league_id, open: 'chat' },
          dedupe_key: `chat:all${m.id}:${uid}`,
        });
      }
    }
  }

  const { data: dms } = await db().from('dm_message')
    .select('id, body, author_id, created_at, thread:dm_thread(id, league_id, user_lo, user_hi)')
    .gt('created_at', sinceIso());
  for (const d of dms ?? []) {
    const t = d.thread;
    if (!t) continue;
    const to = d.author_id === t.user_lo ? t.user_hi : t.user_lo;
    rows.push({
      app_user_id: to, kind: 'chat',
      title: 'New direct message',
      body: d.body.slice(0, 140),
      data: { league_id: t.league_id, open: 'chat' },
      dedupe_key: `chat:d${d.id}`,
    });
  }
  await enqueue(rows);
}

// ── draft night (0152) ──────────────────────────────────────────────────────
// The clock itself is already driven — sweepNative ticks every live draft, so
// an unattended room autopicks without us. This detector is the VOICE:
// "the draft is LIVE" and "the draft is complete" to every member (dedupe
// makes them once-ever), and "you're ON THE CLOCK" to the snake picker
// (dedupe per overall). Auction lots have no single on-clock target, so
// auction leagues get the live/complete brackets only.
// "your draft is at 8pm" — the reminder a SCHEDULED start (0177) earns. The
// draft-is-LIVE push below already fires the moment status flips, but that
// arrives as the room opens, which is no use to someone who needed an hour's
// warning to be at a laptop. Fires once per armed time (the dedupe key carries
// start_at, so moving the draft re-arms the reminder rather than suppressing
// it), and only inside a T-90m..T-0 window so a schedule set weeks out doesn't
// nag from the day it's made.
async function detectDraftSoon() {
  const { data: armed } = await db().from('draft')
    .select('league_id, start_at').eq('status', 'pending').not('start_at', 'is', null);
  const now = Date.now();
  const due = (armed ?? []).filter((d) => {
    const t = Date.parse(d.start_at);
    return Number.isFinite(t) && t > now && t - now <= 90 * 60_000;
  });
  if (!due.length) return;
  const names = await leagueNames(due.map((d) => d.league_id));
  const rows = [];
  for (const d of due) {
    const name = names.get(d.league_id) ?? 'your league';
    const mins = Math.max(1, Math.round((Date.parse(d.start_at) - now) / 60_000));
    const when = mins >= 60 ? `${Math.round(mins / 60)}h` : `${mins}m`;
    for (const uid of await leagueMembers(d.league_id)) {
      rows.push({
        app_user_id: uid, kind: 'draft', title: `⛏ ${name}`,
        body: `Draft starts in ${when} — it opens on its own, be in the room.`,
        data: { league_id: d.league_id, open: 'draft' },
        dedupe_key: `draft:${d.league_id}:soon:${d.start_at}`,
      });
    }
  }
  await enqueue(rows);
}

async function detectDraft() {
  await detectDraftSoon();
  const { data: drafts } = await db().from('draft')
    .select('league_id, status, mode, draft_order, current_overall, paused, completed_at')
    .in('status', ['live', 'complete']);
  const fresh = (drafts ?? []).filter((d) =>
    d.status === 'live' || (d.completed_at && Date.now() - Date.parse(d.completed_at) < 15 * 60_000));
  if (!fresh.length) return;
  const names = await leagueNames(fresh.map((d) => d.league_id));
  const rows = [];
  for (const d of fresh) {
    const name = names.get(d.league_id) ?? 'your league';
    if (d.status === 'live') {
      for (const uid of await leagueMembers(d.league_id)) {
        rows.push({
          app_user_id: uid, kind: 'draft', title: `⛏ ${name}`,
          body: 'The draft is LIVE — get in the room.',
          data: { league_id: d.league_id, open: 'draft' },
          dedupe_key: `draft:${d.league_id}:live`,
        });
      }
      // the snake picker on the clock — same reversal as SQL draft_on_clock
      const order = Array.isArray(d.draft_order) ? d.draft_order : [];
      if (!d.paused && d.mode === 'snake' && order.length) {
        const n = order.length; const o = d.current_overall;
        const rnd = Math.floor((o - 1) / n) + 1;
        let idx = (o - 1) % n;
        if (rnd % 2 === 0) idx = n - 1 - idx;
        const rid = Number(order[idx]);
        const owner = (await ownersFor([[d.league_id, rid]])).get(`${d.league_id}:${rid}`);
        if (owner) {
          rows.push({
            app_user_id: owner, kind: 'draft', title: `⛏ ${name}`,
            body: `You're ON THE CLOCK — pick ${o} is yours.`,
            data: { league_id: d.league_id, open: 'draft' },
            dedupe_key: `draft:${d.league_id}:${o}`,
          });
        }
      }
    } else {
      for (const uid of await leagueMembers(d.league_id)) {
        rows.push({
          app_user_id: uid, kind: 'draft', title: `⛏ ${name}`,
          body: 'The draft is complete — rosters are set.',
          data: { league_id: d.league_id, open: 'draft' },
          dedupe_key: `draft:${d.league_id}:complete`,
        });
      }
    }
  }
  await enqueue(rows);
}

async function detectTrades() {
  const { data: trades } = await db().from('trade_proposal')
    .select('id, league_id, to_roster, created_at')
    .eq('status', 'pending').gt('created_at', sinceIso());
  if (!trades?.length) return;
  const owners = await ownersFor(trades.map((t) => [t.league_id, t.to_roster]));
  const names = await leagueNames([...new Set(trades.map((t) => t.league_id))]);
  await enqueue(trades.flatMap((t) => {
    const uid = owners.get(`${t.league_id}:${t.to_roster}`);
    if (!uid) return [];
    return [{
      app_user_id: uid, kind: 'trades',
      title: `Trade offer · ${names.get(t.league_id) ?? 'your league'}`,
      body: 'A trade is waiting on your answer.',
      data: { league_id: t.league_id, open: 'team' },
      dedupe_key: `trade:${t.id}`,
    }];
  }));
}

async function detectWaivers() {
  const { data: claims } = await db().from('waiver_claim')
    .select('id, league_id, roster_id, add_slug, status, processed_at')
    .in('status', ['won', 'lost']).gt('processed_at', sinceIso());
  if (!claims?.length) return;
  const owners = await ownersFor(claims.map((c) => [c.league_id, c.roster_id]));
  const names = await leagueNames([...new Set(claims.map((c) => c.league_id))]);
  const pretty = (slug) => slug.split('-').map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');
  await enqueue(claims.flatMap((c) => {
    const uid = owners.get(`${c.league_id}:${c.roster_id}`);
    if (!uid) return [];
    return [{
      app_user_id: uid, kind: 'waivers',
      title: `Waivers · ${names.get(c.league_id) ?? 'your league'}`,
      body: c.status === 'won' ? `Your claim WON — ${pretty(c.add_slug)} is yours.` : `Your claim for ${pretty(c.add_slug)} lost.`,
      data: { league_id: c.league_id, open: 'team' },
      dedupe_key: `waiver:${c.id}:${c.status}`,
    }];
  }));
}

async function detectLineup() {
  // Windows whose LOCK sits inside the alarm band, from the synced slate.
  const { data: slate } = await db().from('nfl_slate').select('season, week, win, kickoff').not('kickoff', 'is', null);
  const now = Date.now();
  const winKick = new Map(); // `${season}:${week}:${win}` → earliest kickoff ms
  for (const g of slate ?? []) {
    const k = `${g.season}:${g.week}:${g.win}`;
    const ms = Date.parse(g.kickoff);
    if (!winKick.has(k) || ms < winKick.get(k)) winKick.set(k, ms);
  }
  const due = [...winKick.entries()].filter(([, kick]) => {
    const toLock = kick - LOCK_LEAD_MS - now;
    return toLock > ALARM_MIN_MS && toLock <= ALARM_MAX_MS;
  });
  if (!due.length) return;
  const rows = [];
  for (const [key, kick] of due) {
    const [season, weekStr, win] = key.split(':');
    const week = Number(weekStr);
    const cap = slotsFor(win, week);
    if (!cap) continue;
    const { data: matchups } = await db().from('matchup')
      .select('id, league_id, week, status, home_roster_id, away_roster_id, league:league_id(name, season)')
      .eq('week', week).in('status', ['scheduled', 'live']);
    const lockLabel = new Date(kick - LOCK_LEAD_MS)
      .toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
    for (const m of matchups ?? []) {
      if (m.league?.season && String(m.league.season) !== String(season)) continue;
      const owners = await ownersFor([[m.league_id, m.home_roster_id], [m.league_id, m.away_roster_id]]);
      for (const rid of [m.home_roster_id, m.away_roster_id]) {
        const uid = owners.get(`${m.league_id}:${rid}`);
        if (!uid) continue;
        const { count } = await db().from('sealed_pick')
          .select('roster_slot', { count: 'exact', head: true })
          .eq('matchup_id', m.id).eq('app_user_id', uid).eq('game_window', win).not('player_slug', 'is', null);
        const empty = cap - (count ?? 0);
        if (empty <= 0) continue;
        rows.push({
          app_user_id: uid, kind: 'lineup',
          title: `⚠ Lineup locks ${lockLabel} ET`,
          body: `${empty} empty slot${empty === 1 ? '' : 's'} in ${m.league?.name ?? 'your league'} — set your picks.`,
          data: { league_id: m.league_id, open: 'picks' },
          dedupe_key: `lineup:${m.id}:${win}:${uid}`,
        });
      }
    }
  }
  await enqueue(rows);
}

// ── sender ──────────────────────────────────────────────────────────────────
// Two channels, per device platform: 'web' rows hold a browser subscription
// JSON and go out via the Web Push protocol (webpush.js, VAPID creds); every
// other platform is an FCM device token. A row is only marked sent once at
// least one of its devices' channels had credentials — with a channel's creds
// absent, its devices wait in the queue rather than being burned.
/** 🪓 THE BLADE (0273). guillotine_tick writes a league_txn row the moment it
 *  eliminates a seat — kind 'elimination', with the week and fatal score in
 *  its note — so that row is both the event and its timestamp. Keyed on the
 *  txn id: the tick is idempotent and never writes a second row per seat, so
 *  one elimination can never page twice however many sweeps see it. */
async function detectChopped() {
  const { data: cuts } = await db().from('league_txn')
    .select('id, league_id, roster_id, note, created_at')
    .eq('kind', 'elimination').gt('created_at', sinceIso());
  if (!cuts?.length) return;
  const owners = await ownersFor(cuts.map((c) => [c.league_id, c.roster_id]));
  const names = await leagueNames([...new Set(cuts.map((c) => c.league_id))]);
  await enqueue(cuts.flatMap((c) => {
    const uid = owners.get(`${c.league_id}:${c.roster_id}`);
    if (!uid) return [];   // an unmanaged seat has nobody to tell
    return [{
      app_user_id: uid, kind: 'format',
      title: `🪓 Chopped · ${names.get(c.league_id) ?? 'your league'}`,
      // the tick's own note reads "week N — lowest score, 84.2"
      body: `The guillotine took your team — ${c.note || 'lowest score of the week'}. Your roster is on the wire.`,
      data: { league_id: c.league_id, open: 'league' },
      dedupe_key: `chopped:${c.id}`,
    }];
  }));
}

/** 🩸 THE BITE (0273). A steal stamps resolved_at when it EXECUTES — whether
 *  it went straight through or waited for the commissioner's ruling — so the
 *  victim hears the moment a player actually leaves, and never on a steal that
 *  is still pending or was vetoed. */
async function detectBitten() {
  const { data: bites } = await db().from('vampire_steal')
    .select('id, league_id, vampire, victim, take_slug, give_slug, week, status, resolved_at')
    .eq('status', 'executed').gt('resolved_at', sinceIso());
  if (!bites?.length) return;
  // both sides of every bite: the victim is told, and the vampire's own team
  // name is what the victim is told ABOUT.
  const owners = await ownersFor(bites.flatMap((b) => [[b.league_id, b.victim], [b.league_id, b.vampire]]));
  const names = await leagueNames([...new Set(bites.map((b) => b.league_id))]);
  const teams = new Map();
  for (const lid of new Set(bites.map((b) => b.league_id))) {
    const { data } = await db().from('league_membership')
      .select('sleeper_roster_id, team_name').eq('league_id', lid);
    for (const m of data ?? []) teams.set(`${lid}:${m.sleeper_roster_id}`, m.team_name);
  }
  const pretty = (slug) => slug.split('-').map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');
  await enqueue(bites.flatMap((b) => {
    const uid = owners.get(`${b.league_id}:${b.victim}`);
    if (!uid) return [];
    const vamp = teams.get(`${b.league_id}:${b.vampire}`) || 'The vampire';
    return [{
      app_user_id: uid, kind: 'format',
      title: `🩸 Bitten · ${names.get(b.league_id) ?? 'your league'}`,
      body: `${vamp} beat you in week ${b.week} and took ${pretty(b.take_slug)}. ${pretty(b.give_slug)} came back the other way.`,
      data: { league_id: b.league_id, open: 'team' },
      dedupe_key: `bitten:${b.id}`,
    }];
  }));
}

async function flush() {
  const { data: pending } = await db().from('push_outbox')
    .select('id, app_user_id, kind, title, body, data')
    .is('sent_at', null).order('id').limit(50);
  if (!pending?.length) return;
  const token = await fcmAccessToken();
  const vapid = vapidKeys();
  if (!token && !vapid) return; // no creds on either channel — leave the queue standing
  const uids = [...new Set(pending.map((p) => p.app_user_id))];
  const { data: toks } = await db().from('push_token').select('token, app_user_id, platform, prefs').in('app_user_id', uids);
  const byUser = new Map();
  for (const t of toks ?? []) {
    if (!byUser.has(t.app_user_id)) byUser.set(t.app_user_id, []);
    byUser.get(t.app_user_id).push(t);
  }
  let sent = 0;
  for (const p of pending) {
    const devices = (byUser.get(p.app_user_id) ?? []).filter((t) => t.prefs?.[p.kind] !== false);
    let err = devices.length ? null : 'no devices';
    let attempted = devices.length === 0; // deviceless rows resolve immediately
    for (const d of devices) {
      const web = d.platform === 'web';
      if (web ? !vapid : !token) { err = `${web ? 'vapid' : 'fcm'} creds absent`; continue; }
      attempted = true;
      const r = web ? await webPushSend(d.token, p) : await fcmSend(token, d.token, p);
      if (r.ok) { sent += 1; continue; }
      err = r.error;
      if (r.dead) await db().from('push_token').delete().eq('token', d.token);
    }
    if (!attempted) continue; // every device is on a credless channel — retry next sweep
    await db().from('push_outbox').update({ sent_at: new Date().toISOString(), error: err }).eq('id', p.id);
  }
  if (sent) log(`delivered ${sent} push${sent === 1 ? '' : 'es'}`);
}

// ── somebody took a seat (0241) ─────────────────────────────────────────────
// Founder: "anytime someone joins a league". THE COMMISSIONER'S NEWS, not the
// whole room's — a league filling up is the person who sent the invites
// watching it land, and twelve managers each hearing about the other eleven is
// eleven pushes nobody asked for. If the room should hear it too, that is a
// second audience to add here, not a different detector.
//
// Windows on league_membership.enrolled_at, which 0241 added and stamps by
// trigger. Rows that predate the column are NULL and never match, so the first
// sweep after deploy does not announce every existing member as new.
async function detectMembers() {
  const { data: joins } = await db().from('league_membership')
    .select('id, league_id, team_name, app_user_id, enrolled_at')
    .eq('enrolled', true).not('app_user_id', 'is', null).gt('enrolled_at', sinceIso());
  if (!joins?.length) return;
  const { data: leagues } = await db().from('league')
    .select('id, name, commissioner_id').in('id', [...new Set(joins.map((j) => j.league_id))]);
  const byId = new Map((leagues ?? []).map((l) => [l.id, l]));
  await enqueue(joins.flatMap((j) => {
    const l = byId.get(j.league_id);
    if (!l?.commissioner_id) return [];
    // The commissioner taking their own seat is not news to the commissioner.
    if (l.commissioner_id === j.app_user_id) return [];
    return [{
      app_user_id: l.commissioner_id, kind: 'members',
      title: `New manager · ${l.name}`,
      body: `${j.team_name || 'A new manager'} joined the league.`,
      data: { league_id: j.league_id },
      // Keyed on the SEAT, not the moment: a seat vacated and retaken stamps a
      // fresh enrolled_at and earns a fresh push, but one join cannot notify
      // twice however many sweeps see it inside the window.
      dedupe_key: `member:${j.id}:${j.enrolled_at}`,
    }];
  }));
}

/** One sweep: detect everything, then deliver. Called on its own interval. */
export async function sweepPush() {
  await detectChat().catch((e) => log('chat detector error', e.message));
  await detectMembers().catch((e) => log('members detector error', e.message));
  await detectTrades().catch((e) => log('trades detector error', e.message));
  await detectDraft().catch((e) => log('draft detector error', e.message));
  await detectWaivers().catch((e) => log('waivers detector error', e.message));
  await detectLineup().catch((e) => log('lineup detector error', e.message));
  await detectChopped().catch((e) => log('chopped detector error', e.message));
  await detectBitten().catch((e) => log('bitten detector error', e.message));
  await flush().catch((e) => log('flush error', e.message));
}
