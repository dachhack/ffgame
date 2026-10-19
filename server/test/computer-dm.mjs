// @COMPUTER ANSWERS IN A DM (v0.730.20, 0509). Founder, after an ask in a
// Gridiron Gang DM was filed but nothing came back in the DM: "I'd like it to
// log an issue and respond that the message was received." The sweep files a
// DM ask from COMPUTER_USERS and posts the house reply into that DM, as a line
// with no author; the DM push detector stays quiet about that line.
// GitHub is faked; the database is an in-memory double (computer-dev.mjs's).
import { __setClientForTest } from '../src/supabase.js';

let fails = 0;
const ok = (label, cond, got) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${!cond && got !== undefined ? ` — got ${JSON.stringify(got)}` : ''}`); if (!cond) fails++; };

const now = Date.now();
const iso = (msAgo) => new Date(now - msAgo).toISOString();
const TH = 'thread-1', OTHER = 'thread-2';
const T = {
  dm_thread: [{ id: TH, league_id: 'L', user_lo: 'u-founder', user_hi: 'u-pal' }, { id: OTHER, league_id: 'L', user_lo: 'u-pal', user_hi: 'u-zed' }],
  dm_message: [
    { id: 1, thread_id: TH, author_id: 'u-pal', body: 'i used double or nothing', caption: null, created_at: iso(120_000) },
    { id: 2, thread_id: TH, author_id: 'u-founder', body: '@computer the power ups disappeared', caption: null, created_at: iso(60_000) },
    // someone NOT in COMPUTER_USERS asking in their own DM: not filed, no reply
    { id: 3, thread_id: OTHER, author_id: 'u-pal', body: '@computer hello?', caption: null, created_at: iso(50_000) },
  ],
  league_message: [],
  dev_room_message: [],
  league: [{ id: 'L', name: 'Gridiron Gang' }],
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

// GitHub: issues open as #201…
const opened = [];
globalThis.fetch = async (url, init = {}) => {
  if (init.method === 'POST' && /\/issues$/.test(String(url))) {
    opened.push(JSON.parse(init.body));
    return { ok: true, json: async () => ({ number: 200 + opened.length }) };
  }
  return { ok: true, json: async () => [] };
};
process.env.GH_ISSUES_TOKEN = 'test';
process.env.COMPUTER_USERS = 'u-founder';

const { sweepComputer } = await import('../src/computer.js');

const receipts = await sweepComputer();
ok('one issue: the founder\'s DM ask', opened.length === 1, opened.map((o) => o.title));
ok('the issue names the DM\'s league', /DM in Gridiron Gang/.test(opened[0]?.body ?? ''), opened[0]?.body);
const reply = T.dm_message.filter((m) => m.kind === 'computer');
ok('one house reply, in the ask\'s own DM', reply.length === 1 && reply[0].thread_id === TH, reply);
ok('authored by nobody, naming the issue', reply[0]?.author_id === null && /\(#201\)$/.test(reply[0]?.body ?? ''), reply[0]);
ok('nothing posted in the other DM', !T.dm_message.some((m) => m.thread_id === OTHER && m.kind === 'computer'));
ok('the asker still gets the push receipt', receipts.length === 1 && receipts[0].app_user_id === 'u-founder', receipts);

await sweepComputer();
ok('a second sweep neither files nor replies again', opened.length === 1 && T.dm_message.filter((m) => m.kind === 'computer').length === 1);

// The push detector skips an authorless DM line (no "New direct message" for Computer).
const pushSrc = (await import('node:fs')).readFileSync(new URL('../src/push.js', import.meta.url), 'utf8');
ok('push.js skips a DM line with no author', /if \(!t \|\| !d\.author_id\) continue;/.test(pushSrc));

if (fails) { console.log(`\nFAIL — ${fails} assertion(s) failed.`); process.exit(1); }
console.log('\nPASS — @computer answers in a DM.');
