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
import { contestConfigOf } from '../../packages/core/src/engine/contest.ts';
import { pushKindOn } from '../../packages/core/src/data/pushKinds.ts';
import { createSign } from 'node:crypto';
import { db } from './supabase.js';
import { webPushSend, vapidKeys } from './webpush.js';
import { apnsSend, apnsCreds } from './apns.js';
import { sweepComputer, relayFixes } from './computer.js';
import { sweepDevRoom } from './devRoom.js';
import { slotsFor } from '../../packages/core/src/engine/matchup.ts';
import { TeamMap } from '../../packages/core/src/data/teamCodes.ts';
import { isCollegeWeek } from '../../packages/core/src/data/nflSlate.ts';
import { starterSlugs } from '../../packages/core/src/data/poolEntry.ts';

const log = (...a) => console.log(new Date().toISOString(), '[push]', ...a);

const SCAN_MS = 10 * 60_000;          // detector trailing window
const WIDGET_EVERY_MS = 3 * 60_000;   // widget repaint pings, per matchup per owner
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

async function fcmSend(token, deviceToken, { title, body, data, kind }) {
  const acct = serviceAccount();
  // kind 'widget' (v0.421.0) is DATA-ONLY: no notification block, so nothing
  // shows in the shade; the app's background task wakes on it and repaints
  // the home-screen widget. Still high priority — a normal-priority data
  // message is deferred by Doze for exactly as long as a Sunday lasts.
  const silent = kind === 'widget';
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${acct.project_id}/messages:send`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      message: {
        token: deviceToken,
        ...(silent ? {} : { notification: { title, body } }),
        data: Object.fromEntries(Object.entries({ ...(data ?? {}), kind }).map(([k, v]) => [k, String(v)])),
        android: { priority: 'high', ...(silent ? {} : { notification: { channel_id: 'drip-default' } }) },
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
  // THE DEV ROOM (v0.663.0, 0465): an @mention there pushes like one in
  // league chat.
  const { data: dev } = await db().from('dev_room_message')
    .select('id, room_id, body, mentions, created_at')
    .gt('created_at', sinceIso()).neq('mentions', '{}');
  const roomIds = [...new Set((dev ?? []).map((m) => m.room_id))];
  const { data: rooms } = roomIds.length ? await db().from('dev_room').select('id, name').in('id', roomIds) : { data: [] };
  const roomName = new Map((rooms ?? []).map((r) => [r.id, r.name]));
  for (const m of dev ?? []) {
    for (const uid of m.mentions ?? []) {
      rows.push({
        app_user_id: uid, kind: 'chat',
        title: `You were mentioned · ${roomName.get(m.room_id) ?? 'the dev room'}`,
        body: String(m.body ?? '').slice(0, 140),
        data: { room_id: m.room_id, open: 'devroom' },
        dedupe_key: `dev:m${m.id}:${uid}`,
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
  // THE WEEKLY REPORT (v0.391.0): the house posted the week's write-up; the
  // whole league hears about it once, like a poll.
  const { data: reports } = await db().from('league_message')
    .select('id, league_id, body, created_at')
    .eq('kind', 'report').gt('created_at', sinceIso());
  const reportNames = await leagueNames([...new Set((reports ?? []).map((p) => p.league_id))]);
  for (const r of reports ?? []) {
    for (const uid of await leagueMembers(r.league_id)) {
      rows.push({
        app_user_id: uid, kind: 'chat',
        title: `📋 Weekly report · ${reportNames.get(r.league_id) ?? 'your league'}`,
        body: r.body.slice(0, 140),
        data: { league_id: r.league_id, open: 'chat' },
        dedupe_key: `report:${r.id}:${uid}`,
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
      //
      // A transaction line (0290) never comes through here at all. "Every
      // message" means every message somebody TYPED — it was a subscription to
      // the conversation, bought before the house started narrating adds and
      // drops, and turning it into a move-by-move feed would be a change
      // nobody asked for made to a setting they already set. The lines are in
      // chat for anyone who opens it.
      if (m.kind === 'poll' || m.kind === 'report' || m.kind === 'txn' || m.kind === 'computer') continue;
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

/** EMPTY SPOTS IN A WINDOW (v0.561.6). Founder: "I get this alert but I
 *  think I put a ghost in" — "1 empty slot in Turf Warriors". A Ghost (and a
 *  Bye Steal) holds a spot without a sealed_pick row: it lives in
 *  applied_state.payload_json.targeted, keyed `${win}|${slot}` as the boards
 *  key it (LivePicks phantomOf). So a spot is set when it has a player OR a
 *  phantom, and an Extra Slot played on the window (payload_json.extraSlots)
 *  adds a spot to fill. Pure; exported for the test. */
export function emptySpots(cap, win, pickedSlots, payload) {
  const filled = new Set((pickedSlots ?? []).map(String));
  const tg = payload?.targeted ?? {};
  for (const g of Array.isArray(tg.ghost) ? tg.ghost : []) {
    const [w, slot] = String(g).split('|');
    if (w === win && slot != null) filled.add(slot);
  }
  const bs = tg.byeSteal;
  if (bs && bs.win === win && bs.slot != null) filled.add(String(bs.slot));
  const extra = Number(payload?.extraSlots?.[win]) || 0;
  return Math.max(0, cap + extra - filled.size);
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
      .select('id, league_id, week, status, home_roster_id, away_roster_id, league:league_id(name, season, settings_json)')
      .eq('week', week).in('status', ['scheduled', 'live']);
    const lockLabel = new Date(kick - LOCK_LEAD_MS)
      .toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
    for (const m of matchups ?? []) {
      if (m.league?.season && String(m.league.season) !== String(season)) continue;
      // DRIP ONLY (v0.434.1). Founder, relaying a manager: "why do I keep
      // getting a message that says I have 2 empty roster spots? But it looks
      // like I am full." He was full. His league is CLASSIC: one weekly
      // lineup stored under the 'wk' window, never a row per slate window —
      // so this count, which asks for rows in 'early' or 'late', found none
      // and paged him for every window lock all Sunday. A classic lineup has
      // no window slots to be empty; its open spots are the board's and the
      // widget's business (v0.433.2), and the lock-time fill closes them.
      if ((m.league?.settings_json?.game_mode ?? 'drip') === 'classic') continue;
      const owners = await ownersFor([[m.league_id, m.home_roster_id], [m.league_id, m.away_roster_id]]);
      for (const rid of [m.home_roster_id, m.away_roster_id]) {
        const uid = owners.get(`${m.league_id}:${rid}`);
        if (!uid) continue;
        const [{ data: picked }, { data: ap }] = await Promise.all([
          db().from('sealed_pick').select('roster_slot')
            .eq('matchup_id', m.id).eq('app_user_id', uid).eq('game_window', win).not('player_slug', 'is', null),
          db().from('applied_state').select('payload_json')
            .eq('matchup_id', m.id).eq('app_user_id', uid).maybeSingle(),
        ]);
        const empty = emptySpots(cap, win, (picked ?? []).map((r) => r.roster_slot), ap?.payload_json);
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

// ── NO SQUAD YET (v0.668.1): the contest league's lock reminder ────────────
// Founder, on the weekly contest suite: "no push says 'you have no squad and
// the first game locks in 2 hours'. For a 50,000-seat weekly contest, that one
// push is most of the retention." Two reminders per week, to a member of a
// contest league who has NOT saved a squad for it: the day before (24h ± 5
// min before the week's first lock) and the last call (the same 55–65 min
// band the lineup alert uses). Each is one sweep-width band, so each fires
// once; the dedupe key carries the band. A head-to-head seat is told the CPU
// will build for it at lock; a leaderboard seat is told it scores nothing.
const DAY_MS = 24 * 3_600_000;
const DAY_BAND_MS = 5 * 60_000;
/** PURE: which reminder a week's first lock is due for right now, or null. */
export function contestLockBand(firstKickMs, now) {
  // v0.669.0: a contest player locks AT his kickoff, so the week's first lock is its first kickoff.
  const toLock = firstKickMs - now;
  if (toLock > ALARM_MIN_MS && toLock <= ALARM_MAX_MS) return 'last';
  if (toLock > DAY_MS - DAY_BAND_MS && toLock <= DAY_MS + DAY_BAND_MS) return 'day';
  return null;
}
/** PURE: is this nfl_slate week one a contest league can play? Not a college
 *  week (board week 200 + N, 0371): college leagues are classic-only (0365),
 *  so no contest plays one. Founder (Oct 13): "I don't think any squads should
 *  lock on Tuesday?" — college week 7's Tuesday-night kickoff (board week 207)
 *  had paged every NFL contest league "Squads lock Tue 7:00 PM ET … week 207". */
export const contestSlateWeek = (week) => !isCollegeWeek(Number(week));
/** PURE: the push rows for one league's members without a squad. */
export function contestLockRows(league, week, band, lockMs, members, entered) {
  const lockLabel = new Date(lockMs).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
  // NO SQUAD BY LOCK (v0.673.0): the league's own rule for a no-show, and
  // whether entries close at the first kickoff.
  const cfg = contestConfigOf(league.settings_json, league.kind);
  const late = cfg?.lateEntry ?? 'cpu';
  const tail = (late === 'cpu' ? 'the CPU builds one for you at lock, and you can still swap until each player’s game'
    : late === 'zero' ? 'a week without a squad scores zero' : 'a week without a squad scores nothing')
    + (cfg?.entryDeadline === 'first' ? ' — entries close at the first kickoff' : '');
  // PER SEAT (v0.682.3): a member with several entries (0481) is paged once,
  // and the push names the seats still without a squad — "Bees Two and Bees
  // Three have no week 7 squad yet" — so they know which to build.
  const byUser = new Map();   // app_user_id → the member's human seats
  for (const m of members) {
    if (!m.app_user_id || !m.enrolled || m.controller === 'ai') continue;
    if (!byUser.has(m.app_user_id)) byUser.set(m.app_user_id, []);
    byUser.get(m.app_user_id).push(m);
  }
  const list = (xs) => (xs.length <= 2 ? xs.join(' and ') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
  const rows = [];
  for (const [uid, seats] of byUser) {
    const missing = seats.filter((m) => !entered.has(m.sleeper_roster_id));
    if (!missing.length) continue;
    const names = seats.length > 1 ? list(missing.map((m) => m.team_name ?? `Seat ${m.sleeper_roster_id}`)) : null;
    const body = names
      ? (band === 'last' ? `No squad yet for ${names} in ${league.name} for week ${week} — ${tail}.` : `${names} ${missing.length === 1 ? 'has' : 'have'} no week ${week} squad yet — ${tail}.`)
      : (band === 'last' ? `No squad yet in ${league.name} for week ${week} — ${tail}.` : `You haven’t built a week ${week} squad yet — ${tail}.`);
    rows.push({
      app_user_id: uid, kind: 'lineup',
      title: band === 'last' ? `⚠ Squads lock ${lockLabel} ET` : `🗓 ${league.name}: squads lock ${lockLabel} ET`,
      body,
      data: { league_id: league.id, open: 'league', roster_id: missing[0].sleeper_roster_id },
      dedupe_key: `contest-lock:${band}:${league.id}:${week}:${uid}`,
    });
  }
  return rows;
}
// ── RULED OUT, AND HE'S IN YOUR SQUAD (v0.669.0) ───────────────────────────
// Founder: "Should I be able to swap out dowdle since he was declared out?"
// The push that makes the kickoff lock matter: when the injury report moves a
// player to O or IR and a contest squad for the week holds him, his owner
// hears while there is still time — "swap him before 1:00 PM ET". Keyed on
// the week's injury row per squad, so one ruling pages once; a player ruled
// out after his kickoff pages nobody (nothing can be done).
/** PURE: the rows for one ruled-out player across the squads holding him. */
export function ruledOutRows(player, week, kickMs, holders, leagueNames, autoSub) {
  const kickLabel = new Date(kickMs).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
  return holders.filter((h) => h.app_user_id).map((h) => ({
    app_user_id: h.app_user_id, kind: 'status',   // v0.708.0: its own switch
    title: `⚠ ${player.name} is ${player.status === 'IR' ? 'on IR' : 'OUT'}`,
    body: `He’s in your ${leagueNames.get(h.league_id) ?? 'league'} squad for week ${week}. Swap him before ${kickLabel} ET${autoSub.get(h.league_id) ? ', or he’s swapped for you just before kickoff' : ' — after that his spot scores nothing'}.`,
    data: { league_id: h.league_id, open: 'league' },
    dedupe_key: `ruled-out:${h.league_id}:${week}:${player.slug}:${h.app_user_id}`,
  }));
}
async function detectRuledOut() {
  const { data: hurt } = await db().from('injury_status').select('player_slug, status, updated_at')
    .in('status', ['O', 'IR', 'o', 'ir']).gt('updated_at', sinceIso());
  if (!hurt?.length) return;
  const now = Date.now();
  // The week with games still to come is the one a squad can still be changed for.
  const { data: slate } = await db().from('nfl_slate').select('season, week, home, away, kickoff').not('kickoff', 'is', null).gt('kickoff', new Date(now).toISOString());
  if (!slate?.length) return;
  const weekOf = new Map(); // season → the earliest week with a game to come
  for (const g of slate) { const k = String(g.season); if (!weekOf.has(k) || g.week < weekOf.get(k)) weekOf.set(k, g.week); }
  const rows = [];
  for (const [season, week] of weekOf) {
    const kicks = new TeamMap();
    for (const g of slate) if (String(g.season) === season && g.week === week) for (const t of [g.home, g.away]) kicks.set(t, Math.min(kicks.get(t) ?? Infinity, Date.parse(g.kickoff)));
    const { data: leagues } = await db().from('league').select('id, name, contest_week, settings_json').in('kind', ['dfs', 'bullseye']).eq('season', season);
    const live = (leagues ?? []).filter((l) => l.contest_week == null || Number(l.contest_week) === week);
    if (!live.length) continue;
    const names = new Map(live.map((l) => [l.id, l.name]));
    const autoSub = new Map(live.map((l) => [l.id, l.settings_json?.auto_sub === true]));
    const { data: board } = await db().from('pod_salary').select('slug, name, team').eq('season', season).eq('week', week).in('slug', hurt.map((h) => h.player_slug));
    for (const b of board ?? []) {
      const kick = kicks.get(b.team);
      if (!Number.isFinite(kick) || kick <= now) continue;   // on a bye, or already kicked off
      const { data: holding } = await db().from('sleeper_lineup').select('league_id, roster_id')
        .in('league_id', live.map((l) => l.id)).eq('week', week).contains('starters_json', JSON.stringify([{ player_slug: b.slug }]));
      if (!holding?.length) continue;
      const owners = await ownersFor(holding.map((h) => [h.league_id, h.roster_id]));
      const holders = holding.map((h) => ({ league_id: h.league_id, app_user_id: owners.get(`${h.league_id}:${h.roster_id}`) ?? null }));
      const st = String(hurt.find((h) => h.player_slug === b.slug)?.status ?? 'O').toUpperCase();
      rows.push(...ruledOutRows({ slug: b.slug, name: b.name, status: st }, week, kick, holders, names, autoSub));
    }
  }
  if (rows.length) log(`ruled out: ${rows.length} squad${rows.length === 1 ? '' : 's'} told`);
  await enqueue(rows);
}
// ── SEASON LEAGUES: PLAYER STATUS AND THE LINEUP CHECK (v0.708.0) ───────────
// Founder: "Any app notification additions we could do? … player status,
// roster QC" → "Night before + 90 min before kick". detectRuledOut above only
// ever watched the weekly contest squads; a classic, drip or imported season
// league heard nothing when a starter went down. Three pushes, each only when
// something is wrong:
//   • 🚑 status: a starter is newly OUT, doubtful or on IR before his game;
//   • 🩺 the night check: 8 PM ET the evening before a seat's first game —
//     starters on a bye, out, doubtful or on IR, and spots left empty;
//   • ⚠ the 90-minute check: a starter still OUT/doubtful/IR as his game's
//     inactives post (inactives arrive as O on the injury feed).
const ISSUE_STATUS = new Set(['O', 'IR', 'D']);
const ISSUE_WORD = { O: 'OUT', IR: 'on IR', D: 'doubtful' };
const ET_PARTS = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
/** PURE: the instant of a wall-clock time in New York. */
function etToUtc(y, mo, d, h) {
  const guess = Date.UTC(y, mo - 1, d, h);
  const p = Object.fromEntries(ET_PARTS.formatToParts(new Date(guess)).map((x) => [x.type, x.value]));
  return guess + (guess - Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute));
}
/** PURE: 8 PM ET the evening before a kickoff. */
export function nightBeforeMs(kickMs) {
  const p = Object.fromEntries(ET_PARTS.formatToParts(new Date(kickMs)).map((x) => [x.type, x.value]));
  return etToUtc(+p.year, +p.month, +p.day - 1, 20);
}
const etLabel = (ms) => new Date(ms).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
/** PURE: what is wrong with one starter, or null. `kicks` is a TeamMap of the week's kickoffs. */
export function starterIssue(st, kicks, statusOf) {
  if (st.team && kicks.size && !kicks.has(st.team)) return 'on a bye';
  const s = String(statusOf.get(st.slug) ?? '').toUpperCase();
  return ISSUE_STATUS.has(s) ? ISSUE_WORD[s] : null;
}
/** PURE: 🚑 one starter newly out/doubtful/IR — a row per seat holding him, before his kickoff. */
export function seasonStatusRows(seats, hurt, kicks, week, now) {
  const rows = [];
  for (const seat of seats) for (const st of seat.starters) {
    const s = String(hurt.get(st.slug) ?? '').toUpperCase();
    if (!ISSUE_STATUS.has(s)) continue;
    const kick = st.team ? kicks.get(st.team) : undefined;
    if (!Number.isFinite(kick) || kick <= now) continue;
    rows.push({
      app_user_id: seat.uid, kind: 'status',
      title: `🚑 ${st.name} is ${ISSUE_WORD[s]}`,
      body: `He’s in your ${seat.league_name} lineup for week ${week}. Swap him before ${etLabel(kick)} ET.`,
      data: { league_id: seat.league_id, open: 'picks', roster_id: seat.roster_id },
      dedupe_key: `status:${seat.league_id}:${week}:${st.slug}:${s}:${seat.uid}:${seat.roster_id}`,
    });
  }
  return rows;
}
/** PURE: 🩺 the night-before check — one row per seat with anything wrong, once its first game's eve has come. */
export function rosterQcNightRows(seats, kicks, statusOf, week, now) {
  const rows = [];
  for (const seat of seats) {
    const ks = seat.starters.map((st) => (st.team ? kicks.get(st.team) : undefined)).filter((k) => Number.isFinite(k));
    if (!ks.length) continue;
    const first = Math.min(...ks);
    if (now < nightBeforeMs(first) || now >= first) continue;
    const bad = seat.starters.map((st) => ({ st, why: starterIssue(st, kicks, statusOf) })).filter((x) => x.why);
    const empties = seat.empties ?? 0;
    if (!bad.length && !empties) continue;
    const bits = bad.slice(0, 3).map((x) => `${x.st.name} ${x.why === 'on a bye' ? 'is on a bye' : `is ${x.why}`}`);
    if (bad.length > 3) bits.push(`${bad.length - 3} more`);
    if (empties) bits.push(`${empties} empty spot${empties === 1 ? '' : 's'}`);
    rows.push({
      app_user_id: seat.uid, kind: 'rosterqc',
      title: `🩺 ${seat.league_name}: lineup check`,
      body: `${bits.join(', ')}. Your first game kicks off ${etLabel(first)} ET.`,
      data: { league_id: seat.league_id, open: 'picks', roster_id: seat.roster_id },
      dedupe_key: `rosterqc:night:${seat.league_id}:${week}:${seat.uid}:${seat.roster_id}`,
    });
  }
  return rows;
}
const INACTIVES_MS = 90 * 60_000;
/** PURE: ⚠ the 90-minute check — a starter still out/doubtful/IR as his game's inactives post. */
export function rosterQcKickRows(seats, kicks, statusOf, week, now) {
  const rows = [];
  for (const seat of seats) for (const st of seat.starters) {
    const kick = st.team ? kicks.get(st.team) : undefined;
    if (!Number.isFinite(kick) || kick <= now || kick - now > INACTIVES_MS) continue;
    const s = String(statusOf.get(st.slug) ?? '').toUpperCase();
    if (!ISSUE_STATUS.has(s)) continue;
    rows.push({
      app_user_id: seat.uid, kind: 'rosterqc',
      title: `⚠ ${st.name} is ${ISSUE_WORD[s]} — kickoff in ${Math.max(1, Math.round((kick - now) / 60_000))} min`,
      body: `He’s starting for you in ${seat.league_name}. Swap him before ${etLabel(kick)} ET.`,
      data: { league_id: seat.league_id, open: 'picks', roster_id: seat.roster_id },
      dedupe_key: `rosterqc:kick:${seat.league_id}:${week}:${st.slug}:${seat.uid}:${seat.roster_id}`,
    });
  }
  return rows;
}

const WEEKLY_KINDS = new Set(['pod', 'weekly', 'dfs', 'bullseye']);   // core liveApi WEEKLY_KINDS: squad leagues, watched elsewhere
/** Every human seat's starters in the season leagues for a week:
 *  [{ league_id, league_name, roster_id, uid, starters: [{ slug, name, team }], empties }]. */
async function seasonSeats(season, week) {
  const { data: leagues } = await db().from('league').select('id, name, kind, provider, is_mock, settings_json').eq('season', String(season));
  const lgs = (leagues ?? []).filter((l) => !WEEKLY_KINDS.has(l.kind) && !l.is_mock);
  if (!lgs.length) return [];
  const byId = new Map(lgs.map((l) => [l.id, l]));
  const { data: ms } = await db().from('matchup').select('id, league_id, home_roster_id, away_roster_id, status')
    .in('league_id', [...byId.keys()]).eq('week', week).neq('status', 'final');
  if (!ms?.length) return [];
  const pairs = [];
  for (const m of ms) for (const r of [m.home_roster_id, m.away_roster_id]) if (r != null) pairs.push([m.league_id, r, m.id]);
  const owners = await ownersFor(pairs.map(([l, r]) => [l, r]));
  const seats = [];
  for (const [lid, rid, mid] of pairs) {
    const uid = owners.get(`${lid}:${rid}`);
    if (uid) seats.push({ league_id: lid, league_name: byId.get(lid).name ?? 'your league', roster_id: rid, uid, mid, starters: [], empties: 0 });
  }
  if (!seats.length) return [];
  // Their saved picks (classic: the 'wk' window; drip: a row per window). A null slug is a spot left empty.
  const { data: picks } = await db().from('sealed_pick').select('matchup_id, app_user_id, game_window, player_slug')
    .in('matchup_id', [...new Set(seats.map((x) => x.mid))]).in('app_user_id', [...new Set(seats.map((x) => x.uid))]);
  const bySeat = new Map();
  for (const p of picks ?? []) {
    const k = `${p.matchup_id}:${p.app_user_id}`;
    if (!bySeat.has(k)) bySeat.set(k, []);
    bySeat.get(k).push(p);
  }
  // Imported leagues without saved picks read their synced lineup's starters.
  const imported = lgs.filter((l) => (l.provider ?? 'sleeper') !== 'native').map((l) => l.id);
  const synced = new Map();
  if (imported.length) {
    const { data: sl } = await db().from('sleeper_lineup').select('league_id, roster_id, starters_json').in('league_id', imported).eq('week', week);
    for (const r of sl ?? []) synced.set(`${r.league_id}:${r.roster_id}`, r.starters_json ?? []);
  }
  for (const seat of seats) {
    const mine = bySeat.get(`${seat.mid}:${seat.uid}`) ?? [];
    const classic = (byId.get(seat.league_id).settings_json?.game_mode ?? 'drip') === 'classic';
    if (mine.length) {
      seat.starters = [...new Set(mine.filter((p) => p.player_slug).map((p) => p.player_slug))].map((slug) => ({ slug }));
      if (classic) seat.empties = mine.filter((p) => p.game_window === 'wk' && !p.player_slug).length;
    } else if (synced.has(`${seat.league_id}:${seat.roster_id}`)) {
      const raw = synced.get(`${seat.league_id}:${seat.roster_id}`);
      const pool = new Map((Array.isArray(raw) ? raw : []).map((e) => [e.player_slug ?? e.slug, e]));
      seat.starters = starterSlugs(raw).map((slug) => ({ slug, name: pool.get(slug)?.full, team: pool.get(slug)?.team }));
    }
  }
  // Names and teams from each league's pool where the lineup didn't carry them.
  const need = seats.filter((x) => x.starters.some((st) => !st.team || !st.name));
  if (need.length) {
    const { data: lp } = await db().from('league_pool').select('league_id, slug, full_name, team')
      .in('league_id', [...new Set(need.map((x) => x.league_id))]).in('slug', [...new Set(need.flatMap((x) => x.starters.map((st) => st.slug)))]);
    const meta = new Map((lp ?? []).map((r) => [`${r.league_id}:${r.slug}`, r]));
    for (const seat of need) for (const st of seat.starters) {
      const m = meta.get(`${seat.league_id}:${st.slug}`);
      st.name = st.name || m?.full_name || st.slug;
      st.team = st.team || m?.team || null;
    }
  }
  return seats.filter((x) => x.starters.length || x.empties);
}
/** The season's week with games still to come, and its kickoffs by team. */
async function upcomingWeek(now) {
  const { data: slate } = await db().from('nfl_slate').select('season, week, home, away, kickoff').not('kickoff', 'is', null).gt('kickoff', new Date(now).toISOString());
  const nfl = (slate ?? []).filter((g) => !isCollegeWeek(Number(g.week)));
  if (!nfl.length) return null;
  const first = nfl.reduce((a, g) => (g.week < a.week ? g : a));
  const season = String(first.season), week = first.week;
  const { data: all } = await db().from('nfl_slate').select('home, away, kickoff').eq('season', season).eq('week', week);
  const kicks = new TeamMap();
  for (const g of all ?? []) if (g.kickoff) for (const t of [g.home, g.away]) kicks.set(t, Math.min(kicks.get(t) ?? Infinity, Date.parse(g.kickoff)));
  return { season, week, kicks };
}
async function detectSeasonStatus() {
  const { data: hurt } = await db().from('injury_status').select('player_slug, status')
    .in('status', ['O', 'IR', 'D', 'o', 'ir', 'd']).gt('updated_at', sinceIso());
  if (!hurt?.length) return;
  const now = Date.now();
  const wk = await upcomingWeek(now);
  if (!wk) return;
  const seats = await seasonSeats(wk.season, wk.week);
  const rows = seasonStatusRows(seats, new Map(hurt.map((h) => [h.player_slug, h.status])), wk.kicks, wk.week, now);
  if (rows.length) log(`season status: ${rows.length} lineup${rows.length === 1 ? '' : 's'} told`);
  await enqueue(rows);
}
// The lineup check reads every season lineup, so it runs every 5 minutes, not every sweep.
let rosterQcAt = 0;
async function detectRosterQc() {
  const now = Date.now();
  if (now - rosterQcAt < 5 * 60_000) return;
  rosterQcAt = now;
  const wk = await upcomingWeek(now);
  if (!wk) return;
  const firstKick = Math.min(...wk.kicks.values());
  if (!Number.isFinite(firstKick) || now < nightBeforeMs(firstKick)) return;   // nothing to check before the week's first eve
  const seats = await seasonSeats(wk.season, wk.week);
  if (!seats.length) return;
  const slugs = [...new Set(seats.flatMap((x) => x.starters.map((st) => st.slug)))];
  const { data: inj } = slugs.length ? await db().from('injury_status').select('player_slug, status').in('player_slug', slugs) : { data: [] };
  const statusOf = new Map((inj ?? []).map((r) => [r.player_slug, r.status]));
  const rows = [...rosterQcNightRows(seats, wk.kicks, statusOf, wk.week, now), ...rosterQcKickRows(seats, wk.kicks, statusOf, wk.week, now)];
  if (rows.length) log(`lineup check: ${rows.length} push${rows.length === 1 ? '' : 'es'}`);
  await enqueue(rows);
}

async function detectContestLock() {
  const { data: slate } = await db().from('nfl_slate').select('season, week, kickoff').not('kickoff', 'is', null);
  const now = Date.now();
  const first = new Map(); // `${season}:${week}` → earliest kickoff ms
  for (const g of slate ?? []) {
    if (!contestSlateWeek(g.week)) continue;
    const k = `${g.season}:${g.week}`;
    const ms = Date.parse(g.kickoff);
    if (!first.has(k) || ms < first.get(k)) first.set(k, ms);
  }
  const due = [...first.entries()].map(([k, kick]) => [k, kick, contestLockBand(kick, now)]).filter(([, , band]) => band);
  if (!due.length) return;
  const rows = [];
  for (const [key, kick, band] of due) {
    const [season, weekStr] = key.split(':');
    const week = Number(weekStr);
    const { data: leagues } = await db().from('league').select('id, name, kind, season, contest_week, settings_json')
      .in('kind', ['dfs', 'bullseye']).eq('season', String(season));
    for (const lg of leagues ?? []) {
      if (lg.contest_week != null && Number(lg.contest_week) !== week) continue;
      const [{ data: mems }, { data: have }] = await Promise.all([
        db().from('league_membership').select('sleeper_roster_id, app_user_id, enrolled, controller, team_name').eq('league_id', lg.id),
        db().from('sleeper_lineup').select('roster_id').eq('league_id', lg.id).eq('week', week),
      ]);
      const entered = new Set((have ?? []).map((r) => r.roster_id));
      rows.push(...contestLockRows(lg, week, band, kick, mems ?? [], entered));
    }
  }
  if (rows.length) log(`contest lock: ${rows.length} reminder${rows.length === 1 ? '' : 's'}`);
  await enqueue(rows);
}

// ── sender ──────────────────────────────────────────────────────────────────
// Three channels, per device platform: 'web' rows hold a browser subscription
// JSON and go out via the Web Push protocol (webpush.js, VAPID creds); 'ios'
// rows hold an APNs device token and go straight to Apple (apns.js, a .p8
// key); every other platform is an FCM device token. A row is only marked sent once at
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

// A row every one of whose devices sits on a channel WITHOUT credentials is
// marked (error 'waiting-vapid' / 'waiting-fcm', sent_at still null) and left
// out of the next fetch while that channel is still credless (v0.392.0). It
// used to be skipped silently and re-fetched every sweep: with the outbox read
// oldest-first, fifty of them — a month of browser-only recipients and no
// VAPID key on the server — were the whole page, and every push behind them
// waited forever. The mark is also what my_push_log (0276) shows the manager.
const WAITING = { web: 'waiting-vapid', fcm: 'waiting-fcm', apns: 'waiting-apns' };

async function flush() {
  const token = await fcmAccessToken();
  const vapid = vapidKeys();
  const apns = apnsCreds();
  if (!token && !vapid && !apns) return; // no creds on any channel — leave the queue standing
  let q = db().from('push_outbox')
    .select('id, app_user_id, kind, title, body, data')
    .is('sent_at', null);
  if (!vapid) q = q.or(`error.is.null,error.neq.${WAITING.web}`);
  if (!token) q = q.or(`error.is.null,error.neq.${WAITING.fcm}`);
  if (!apns) q = q.or(`error.is.null,error.neq.${WAITING.apns}`);
  const { data: pending } = await q.order('id').limit(50);
  if (!pending?.length) return;
  const uids = [...new Set(pending.map((p) => p.app_user_id))];
  const { data: toks } = await db().from('push_token').select('token, app_user_id, platform, prefs').in('app_user_id', uids);
  const byUser = new Map();
  for (const t of toks ?? []) {
    if (!byUser.has(t.app_user_id)) byUser.set(t.app_user_id, []);
    byUser.get(t.app_user_id).push(t);
  }
  let sent = 0;
  for (const p of pending) {
    // A widget ping has no browser or iPhone to go to (the home-screen widget
    // is Android's): web and iOS devices are skipped for it.
    const devices = (byUser.get(p.app_user_id) ?? []).filter((t) => pushKindOn(t.prefs, p.kind) && !(p.kind === 'widget' && (t.platform === 'web' || t.platform === 'ios')));
    let attempted = devices.length === 0; // deviceless rows resolve immediately
    let waiting = null;
    // PER-DEVICE OUTCOMES (v0.392.2). One row can go to a phone and a browser;
    // keeping only the last error let a phone success hide a browser refusal
    // (founder: "getting the alerts on my phone but not in my desktop chrome").
    // The error column now names every device that refused, and how many
    // delivered — my_push_log reads it back to the manager verbatim.
    let ok = 0; const refused = [];
    for (const d of devices) {
      const ch = d.platform === 'web' ? 'web' : d.platform === 'ios' ? 'apns' : 'fcm';
      if (!{ web: vapid, apns, fcm: token }[ch]) { waiting = WAITING[ch]; continue; }
      attempted = true;
      const r = ch === 'web' ? await webPushSend(d.token, p)
        : ch === 'apns' ? await apnsSend(d.token, p)
        : await fcmSend(token, d.token, p);
      if (r.ok) { ok += 1; sent += 1; continue; }
      refused.push(`${{ web: 'browser', apns: 'iPhone', fcm: 'phone' }[ch]} refused: ${r.error}`);
      if (r.dead) await db().from('push_token').delete().eq('token', d.token);
    }
    if (!attempted) {
      // every device is on a credless channel — park it until that channel has keys
      await db().from('push_outbox').update({ error: waiting }).eq('id', p.id);
      continue;
    }
    const err = !devices.length ? 'no devices'
      : !refused.length ? null
      : `${ok ? `delivered to ${ok} · ` : ''}${refused.join(' · ')}`;
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
// ── THE HOME-SCREEN WIDGET (v0.421.0) ────────────────────────────────────
// While a matchup's state is being written it is live. Both owners get a
// silent, data-only push at most once per WIDGET_EVERY_MS (the dedupe key
// carries the time bucket), and the push carries NO score: the widget reads
// fresh on wake, so a push that arrives late can never paint a stale number.
async function detectWidget() {
  const since = new Date(Date.now() - 2 * 60_000).toISOString();
  const { data: states } = await db().from('matchup_state').select('matchup_id').gt('updated_at', since);
  const ids = [...new Set((states ?? []).map((s) => s.matchup_id))];
  if (!ids.length) return;
  const { data: ms } = await db().from('matchup').select('id, league_id, home_roster_id, away_roster_id').in('id', ids);
  if (!ms?.length) return;
  const owners = await ownersFor(ms.flatMap((m) => [[m.league_id, m.home_roster_id], [m.league_id, m.away_roster_id]]));
  const bucket = Math.floor(Date.now() / WIDGET_EVERY_MS);
  await enqueue(ms.flatMap((m) => [m.home_roster_id, m.away_roster_id].flatMap((rid) => {
    const uid = owners.get(`${m.league_id}:${rid}`);
    if (!uid) return [];
    return [{
      app_user_id: uid, kind: 'widget', title: 'Drip Fantasy', body: 'score update',
      data: { league_id: m.league_id, matchup_id: m.id, silent: '1' },
      dedupe_key: `widget:${m.id}:${rid}:${bucket}`,
    }];
  })));
}

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
export { flush as __flushForTest };

export async function sweepPush() {
  await detectChat().catch((e) => log('chat detector error', e.message));
  // @computer (v0.537.0): file the founder's tagged lines as GitHub issues; the
  // receipt push rides the same outbox as everything else.
  await sweepComputer().then(enqueue).catch((e) => log('computer sweep error', e.message));
  // …and a fixed ask's note back into the chat it came from (v0.562.0).
  await relayFixes().then(enqueue).catch((e) => log('computer relay error', e.message));
  // The dev room (v0.658.0, 0459): every tagged idea or bug becomes an issue.
  await sweepDevRoom().then(enqueue).catch((e) => log('dev-room sweep error', e.message));
  await detectMembers().catch((e) => log('members detector error', e.message));
  await detectTrades().catch((e) => log('trades detector error', e.message));
  await detectDraft().catch((e) => log('draft detector error', e.message));
  await detectWaivers().catch((e) => log('waivers detector error', e.message));
  await detectLineup().catch((e) => log('lineup detector error', e.message));
  await detectContestLock().catch((e) => log('contest lock detector error', e.message));
  await detectRuledOut().catch((e) => log('ruled-out detector error', e.message));
  await detectSeasonStatus().catch((e) => log('season status detector error', e.message));
  await detectRosterQc().catch((e) => log('lineup check detector error', e.message));
  try { await detectWidget(); } catch (e) { log('detectWidget', e.message); }
  await detectChopped().catch((e) => log('chopped detector error', e.message));
  await detectBitten().catch((e) => log('bitten detector error', e.message));
  await flush().catch((e) => log('flush error', e.message));
}
