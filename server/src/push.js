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
//   chat    — an @mention names you, or a DM lands in your thread.
//   trades  — a trade offer is created with you as the recipient.
//   waivers — your waiver claim processed to WON or LOST.
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

/** One sweep: detect everything, then deliver. Called on its own interval. */
export async function sweepPush() {
  await detectChat().catch((e) => log('chat detector error', e.message));
  await detectTrades().catch((e) => log('trades detector error', e.message));
  await detectDraft().catch((e) => log('draft detector error', e.message));
  await detectWaivers().catch((e) => log('waivers detector error', e.message));
  await detectLineup().catch((e) => log('lineup detector error', e.message));
  await flush().catch((e) => log('flush error', e.message));
}
