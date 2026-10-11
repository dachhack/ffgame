// @COMPUTER FROM THE DEV ROOM (v0.663.0, 0465). Founder: "allow at computer
// for everyone in dev chat." The worker's sweep files a dev room line that
// says @computer — from ANY member, while league chat and DMs stay gated on
// COMPUTER_USERS — posts the house reply into the room, and, when the issue
// closes, the fix card. GitHub is faked; the database is an in-memory double.
import { __setClientForTest } from '../src/supabase.js';

let fails = 0;
const ok = (label, cond, got) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${!cond && got !== undefined ? ` — got ${JSON.stringify(got)}` : ''}`); if (!cond) fails++; };

const now = Date.now();
const iso = (msAgo) => new Date(now - msAgo).toISOString();
const ROOM = 'room-1';
const T = {
  dev_room: [{ id: ROOM, name: 'Drip Dev' }],
  dev_room_message: [
    { id: 1, room_id: ROOM, author_id: 'u-amy', body: 'the waiver list is slow', caption: null, kind: 'text', created_at: iso(120_000) },
    { id: 2, room_id: ROOM, author_id: 'u-bob', body: '@computer why is the waiver list slow?', caption: null, kind: 'text', created_at: iso(60_000) },
    { id: 3, room_id: ROOM, author_id: 'u-bob', body: 'just chatting', caption: null, kind: 'text', created_at: iso(50_000) },
  ],
  league_message: [
    // a league line from someone NOT in COMPUTER_USERS — must not be filed
    { id: 9, league_id: 'L', author_id: 'u-bob', body: '@computer league ask', caption: null, created_at: iso(30_000) },
  ],
  dm_message: [],
  dm_thread: [],
  league: [],
  computer_ask: [],
};

function builder(name, preds = [], ord = null, lim = null) {
  const rows = () => {
    let r = (T[name] ?? []).filter((x) => preds.every((p) => p(x)));
    if (ord) r = [...r].sort((a, b) => (String(a[ord.c]) < String(b[ord.c]) ? -1 : 1) * (ord.asc ? 1 : -1));
    return lim != null ? r.slice(0, lim) : r;
  };
  const api = {
    select: () => api,
    eq: (c, v) => builder(name, [...preds, (r) => r[c] === v], ord, lim),
    in: (c, vs) => builder(name, [...preds, (r) => vs.includes(r[c])], ord, lim),
    gt: (c, v) => builder(name, [...preds, (r) => String(r[c]) > String(v)], ord, lim),
    lt: (c, v) => builder(name, [...preds, (r) => String(r[c]) < String(v)], ord, lim),
    is: (c, v) => builder(name, [...preds, (r) => (v === null ? r[c] == null : r[c] === v)], ord, lim),
    not: (c, op, v) => builder(name, [...preds, (r) => (op === 'is' && v === null ? r[c] != null : true)], ord, lim),
    order: (c, o) => builder(name, preds, { c, asc: o?.ascending !== false }, lim),
    limit: (n) => builder(name, preds, ord, n),
    maybeSingle: () => Promise.resolve({ data: rows()[0] ?? null, error: null }),
    then: (res, rej) => Promise.resolve({ data: rows(), error: null }).then(res, rej),
    insert: (row) => {
      const id = Math.max(0, ...(T[name] ?? []).map((r) => r.id ?? 0)) + 1;
      (T[name] ??= []).push({ id, created_at: new Date().toISOString(), ...row });
      const res = { error: null, data: { id } };
      return { ...Promise.resolve(res), then: (a, b) => Promise.resolve(res).then(a, b), select: () => ({ single: () => Promise.resolve(res) }) };
    },
    upsert: (row) => ({
      select: () => {
        const have = (T[name] ?? []).some((r) => r.source === row.source && r.message_id === row.message_id);
        if (have) return Promise.resolve({ data: [], error: null });
        (T[name] ??= []).push({ ...row, issue: null, relayed_at: null });
        return Promise.resolve({ data: [{ message_id: row.message_id }], error: null });
      },
    }),
    update: (patch) => {
      const p2 = [...preds];
      const chain = {
        eq: (c, v) => { p2.push((r) => r[c] === v); return chain; },
        then: (a, b) => { (T[name] ?? []).filter((x) => p2.every((p) => p(x))).forEach((x) => Object.assign(x, patch)); return Promise.resolve({ error: null }).then(a, b); },
      };
      return chain;
    },
    delete: () => {
      const p2 = [...preds];
      const chain = {
        eq: (c, v) => { p2.push((r) => r[c] === v); return chain; },
        then: (a, b) => { T[name] = (T[name] ?? []).filter((x) => !p2.every((p) => p(x))); return Promise.resolve({ error: null }).then(a, b); },
      };
      return chain;
    },
  };
  return api;
}
__setClientForTest({ from: (t) => builder(t) });

// GitHub: issues open as #101…; #101 later reads as closed.
const opened = [];
let closed = false;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (init.method === 'POST' && /\/issues$/.test(u)) {
    const b = JSON.parse(init.body);
    opened.push(b);
    return { ok: true, json: async () => ({ number: 100 + opened.length }) };
  }
  if (/\/issues\/101$/.test(u)) {
    return { ok: true, json: async () => ({ state: closed ? 'closed' : 'open', state_reason: 'completed', closed_at: new Date().toISOString(), title: '@computer: why is the waiver list slow?', html_url: 'https://github.com/x/y/issues/101' }) };
  }
  return { ok: true, json: async () => [] };   // comments / timeline: nothing
};
process.env.GH_ISSUES_TOKEN = 'test';
process.env.COMPUTER_USERS = 'u-someone-else';

const { sweepComputer, relayFixes } = await import('../src/computer.js');

const receipts = await sweepComputer();
ok('one issue: the dev room ask (any member), not the gated league line', opened.length === 1, opened.map((o) => o.title));
ok('the issue is the question', opened[0]?.title === '@computer: why is the waiver list slow?', opened[0]?.title);
ok('the issue names the dev room', /dev room "Drip Dev"/.test(opened[0]?.body ?? ''), opened[0]?.body);
ok('it carries the chat before the ask', /the waiver list is slow/.test(opened[0]?.body ?? ''));
ok('claimed once, as source dev', T.computer_ask.length === 1 && T.computer_ask[0].source === 'dev' && T.computer_ask[0].issue === 101, T.computer_ask);
const reply = T.dev_room_message.find((m) => m.kind === 'computer');
ok('the house reply posts into the room, authored by nobody', !!reply && reply.room_id === ROOM && reply.author_id === null && /\(#101\)$/.test(reply.body), reply);
ok('the asker gets a receipt', receipts.length === 1 && receipts[0].app_user_id === 'u-bob', receipts);

await sweepComputer();
ok('a second sweep files nothing again', opened.length === 1, opened.length);

closed = true;
await relayFixes(now + 10 * 60_000);
const card = T.dev_room_message.filter((m) => m.kind === 'computer').at(-1);
ok('when the issue closes, the fix card posts into the room', card && card !== reply && card.fix?.issue === 101 && /#101/.test(card.body), card);
ok('and the ask is marked relayed', !!T.computer_ask[0].relayed_at);

if (fails) { console.log(`\nFAIL — ${fails} assertion(s) failed.`); process.exit(1); }
console.log('\nPASS — @computer works from the dev room, for everyone.');
