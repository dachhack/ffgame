// THE WEEKLY MATCHUP AUDIT (v0.430.0) — who actually played the week.
//
// Founder: "Let's create a weekly audit of matchups for me. I'd love to know
// how active each team and league is. What moves were from the computer vs
// player vs AI players. Were slots left empty or out players started. What
// waiver pickups were player vs AI. Etc"
//
// The database builds the payload (admin_week_audit, migration 0302) from
// rows the game already writes; this module is the shared READING of it —
// the shape, the labels, the activity grade and a plain-text rendering — so
// the admin panel, the worker's CLI and the check script all say the same
// thing about the same week.

/** Who put a player in a slot / made a move. See 0302 for the rules. */
export type AuditSource = 'player' | 'admin' | 'auto' | 'agent' | 'ai' | 'commish' | 'system';
/** What kind of seat this is. */
export type SeatKind = 'human' | 'ai' | 'agent' | 'empty';

export interface AuditFlagged { slug: string; source: AuditSource | string }
export interface AuditLineup {
  expected: number; fielded: number; empty: number;
  sources: Partial<Record<AuditSource, number>>;
  out_started: AuditFlagged[];
  bye_started: AuditFlagged[];
}
export interface AuditActivity {
  active: boolean;
  pick_edits: number;
  txns: Partial<Record<AuditSource, number>>;
  txn_kinds: Record<string, number>;
  claims: Record<string, number>;   // by status: pending / won / lost / cancelled
  claims_n: number;
  chat: number;
  shop: number;
  shop_coin: number | string;
  last_active_at: string | null;
  last_seen_at: string | null;
}
export interface AuditTeam {
  roster_id: number; team: string; kind: SeatKind | string; controller: string;
  enrolled: boolean; manager: string | null;
  result: 'W' | 'L' | 'T' | 'bye' | null;
  opp: number | null; pf: number | string | null; pa: number | string | null; matchup_status: string | null;
  lineup: AuditLineup;
  activity: AuditActivity;
}
export interface AuditSeats { total: number; human: number; ai: number; agent: number; empty: number; active: number }
export interface AuditLeagueLineup {
  expected: number; fielded: number; empty: number; out_started: number; bye_started: number;
  sources: Partial<Record<AuditSource, number>>;
}
export interface AuditLeagueActivity {
  pick_edits: number;
  txns: Partial<Record<AuditSource, number>>;
  txn_kinds?: Record<string, number>;
  claims: Partial<Record<AuditSource, number>>;
  claims_won: Partial<Record<AuditSource, number>>;
  chat: number; shop: number;
}
export interface AuditLeague {
  league_id: string; name: string; provider: string; game_mode: string; format: string; lineup_policy: string;
  matchups: number; finals: number;
  seats: AuditSeats;
  lineup: AuditLeagueLineup;
  activity: AuditLeagueActivity;
  teams: AuditTeam[];
}
export interface WeekAudit {
  ok: boolean; error?: string; note?: string;
  v?: 1; week: number | null; season: string | null;
  window?: { from: string; to: string };
  slate_loaded?: boolean;
  injury_as_of?: string | null;
  totals?: {
    leagues: number; matchups: number; finals: number;
    seats: AuditSeats; lineup: AuditLeagueLineup; activity: AuditLeagueActivity;
  };
  leagues: AuditLeague[];
}

export const SOURCE_LABEL: Record<AuditSource, string> = {
  player: 'Player', admin: 'Admin', auto: 'Computer', agent: 'Auto-managed', ai: 'AI', commish: 'Commish', system: 'System',
};
export const SOURCE_ORDER: AuditSource[] = ['player', 'auto', 'agent', 'ai', 'admin', 'commish', 'system'];
export const SEAT_LABEL: Record<SeatKind, string> = { human: 'human', ai: '🤖 AI', agent: 'auto-managed', empty: 'empty' };

const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/** "3 player · 2 computer · 1 AI" — the buckets that are non-zero, in a fixed order. */
export function sourcesLine(sources: Partial<Record<AuditSource, number>> | null | undefined): string {
  if (!sources) return '—';
  const parts = SOURCE_ORDER.filter((k) => num(sources[k]) > 0).map((k) => `${num(sources[k])} ${SOURCE_LABEL[k].toLowerCase()}`);
  return parts.length ? parts.join(' · ') : '—';
}

/** The share of fielded slots a person actually set — the one number that
 *  says how much of the league is playing itself. */
export function humanShare(sources: Partial<Record<AuditSource, number>> | null | undefined): number | null {
  if (!sources) return null;
  const total = SOURCE_ORDER.reduce((a, k) => a + num(sources[k]), 0);
  if (!total) return null;
  return Math.round((num(sources.player) / total) * 100);
}

export type ActivityGrade = 'active' | 'set-and-forget' | 'idle' | 'bot' | 'open';
/** How engaged a seat was this week:
 *  - bot: an AI or auto-managed seat — never "active", never "idle" either;
 *  - open: an empty seat, nobody anywhere;
 *  - active: a human did more than one kind of thing (edits + a move, chat, a
 *    purchase) or touched their lineup more than a couple of times;
 *  - set-and-forget: a human did something, once;
 *  - idle: a human seat the computer played for. */
export function activityGrade(t: Pick<AuditTeam, 'kind' | 'activity'>): ActivityGrade {
  if (t.kind === 'ai' || t.kind === 'agent') return 'bot';
  if (t.kind === 'empty') return 'open';
  const a = t.activity;
  const kinds = [a.pick_edits > 0, num(a.txns?.player) > 0 || a.claims_n > 0, a.chat > 0, a.shop > 0].filter(Boolean).length;
  if (kinds >= 2 || a.pick_edits >= 3) return 'active';
  if (kinds === 1) return 'set-and-forget';
  return 'idle';
}
export const GRADE_LABEL: Record<ActivityGrade, string> = {
  active: 'ACTIVE', 'set-and-forget': 'SET & FORGET', idle: 'IDLE', bot: 'BOT', open: 'OPEN',
};

/** The league-level one-liner: "4 of 8 humans active · 61% player-set · 5 empty · 1 out · 2 bye". */
export function leagueLine(l: AuditLeague): string {
  const parts: string[] = [];
  parts.push(`${l.seats.active} of ${l.seats.human} human${l.seats.human === 1 ? '' : 's'} active`);
  const share = humanShare(l.lineup.sources);
  if (share != null) parts.push(`${share}% player-set`);
  if (l.lineup.empty) parts.push(`${l.lineup.empty} empty slot${l.lineup.empty === 1 ? '' : 's'}`);
  if (l.lineup.out_started) parts.push(`${l.lineup.out_started} OUT started`);
  if (l.lineup.bye_started) parts.push(`${l.lineup.bye_started} on bye started`);
  return parts.join(' · ');
}

/** "week 3 · 4 leagues · 21 of 40 humans active · 58% player-set". */
export function auditHeadline(a: WeekAudit): string {
  if (!a.ok) return a.error ?? 'audit failed';
  if (a.week == null || !a.totals) return a.note ?? 'nothing to audit';
  const t = a.totals;
  const parts = [`week ${a.week}`, `${t.leagues} league${t.leagues === 1 ? '' : 's'}`,
    `${t.seats.active} of ${t.seats.human} humans active`];
  const share = humanShare(t.lineup.sources);
  if (share != null) parts.push(`${share}% player-set`);
  if (t.lineup.empty) parts.push(`${t.lineup.empty} empty`);
  if (t.lineup.out_started) parts.push(`${t.lineup.out_started} OUT started`);
  return parts.join(' · ');
}

const pad = (s: string, n: number) => (s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length));
const score = (v: unknown) => (v == null ? '—' : num(v).toFixed(1));

/** A plain-text rendering for a terminal or a chat message. */
export function auditText(a: WeekAudit): string {
  const out: string[] = [];
  out.push(`WEEKLY MATCHUP AUDIT — ${auditHeadline(a)}`);
  if (!a.ok || a.week == null || !a.totals) return out.join('\n');
  if (a.window) out.push(`window ${a.window.from.slice(0, 16)} → ${a.window.to.slice(0, 16)}${a.slate_loaded === false ? ' · no slate loaded (byes not judged)' : ''}`);
  const t = a.totals;
  out.push(`moves: ${sourcesLine(t.activity.txns)} · claims: ${sourcesLine(t.activity.claims)} (won: ${sourcesLine(t.activity.claims_won)}) · chat ${t.activity.chat} · shop ${t.activity.shop}`);
  for (const l of a.leagues) {
    out.push('');
    out.push(`${l.name} [${l.game_mode}${l.format !== 'standard' ? '/' + l.format : ''} · ${l.provider}] — ${leagueLine(l)}`);
    out.push(`  slots ${sourcesLine(l.lineup.sources)} · moves ${sourcesLine(l.activity.txns)} · claims ${sourcesLine(l.activity.claims)}`);
    for (const tm of l.teams) {
      const g = GRADE_LABEL[activityGrade(tm)];
      const flags: string[] = [];
      if (tm.lineup.empty) flags.push(`${tm.lineup.empty} empty`);
      if (tm.lineup.out_started.length) flags.push(`OUT: ${tm.lineup.out_started.map((x) => x.slug).join(', ')}`);
      if (tm.lineup.bye_started.length) flags.push(`BYE: ${tm.lineup.bye_started.map((x) => x.slug).join(', ')}`);
      const res = tm.result === 'bye' ? 'bye' : tm.result ? `${tm.result} ${score(tm.pf)}–${score(tm.pa)}` : `${score(tm.pf)}–${score(tm.pa)}`;
      const act = tm.kind === 'human'
        ? `edits ${tm.activity.pick_edits} · moves ${num(tm.activity.txns?.player)} · claims ${tm.activity.claims_n} · chat ${tm.activity.chat} · shop ${tm.activity.shop}`
        : `moves ${num(tm.activity.txns?.ai) + num(tm.activity.txns?.agent)} · claims ${tm.activity.claims_n}`;
      out.push(`  ${pad(tm.team, 22)} ${pad(g, 13)} ${pad(res, 14)} ${pad(sourcesLine(tm.lineup.sources), 34)} ${act}${flags.length ? ' · ' + flags.join(' · ') : ''}`);
    }
  }
  return out.join('\n');
}
