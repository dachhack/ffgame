// A CONTEST LEAGUE'S SETTINGS SHEET, web (v0.679.0). Founder: "For the
// settings, let's mirror the options in classic leagues. Create all the sub
// sections where they make sense." The classic hub's ⚙ sheet
// (LeagueHubPage.tsx) is a list of tiles, each opening a panel; this is the
// same list for a weekly squad league, with the panels that apply reused as
// they are (history, scoring, alerts, recruit, API keys — every one of them
// member-gated, none native-only) and the ones that don't (rosters, draft,
// register, waivers) replaced by the contest's own: TEAMS & SEATS, SQUAD &
// RULES, DUES & PRIZES. STANDINGS points at the LEAGUE tab, which already
// holds the table and the bracket.
import { useEffect, useState, type CSSProperties } from 'react';
import {
  leagueNote, setLeagueNote, leagueDues, chatMembers, playoffState, friendlyError,
  type ContestInfo, type DuesRow,
} from '@drip/core/data/liveApi';
import { CONTEST_WORD, CONTEST_FORMAT_WORD, CONTEST_LATE_WORD, CONTEST_DEADLINE_WORD, contestLateEntryDefault, contestSlotLabels } from '@drip/core/engine/contest';
import { classicSlotsFromSpec } from '@drip/core/engine/classic';
import { Sheet } from '../app/ui';
import { ScoringPanel, RecruitPanel, ApiKeysPanel } from './LeagueInfo';
import { LeagueHistory } from './LeagueHistory';
import { NotifPrefsCard } from './NativeLeague';

const card: CSSProperties = { background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 10, padding: 14 };
const small: CSSProperties = { fontSize: 10, color: 'var(--faint)' };
const label: CSSProperties = { fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--faint)' };
const n0 = (n: number) => n.toLocaleString('en-US');
const tileStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 10, padding: '12px 14px', cursor: 'pointer', color: 'var(--text)', fontFamily: 'inherit' };

function Tile({ title, sub, onClick, accent }: { title: string; sub: string; onClick: () => void; accent?: boolean }) {
  return (
    <button onClick={onClick} style={{ ...tileStyle, ...(accent ? { borderLeft: '3px solid var(--you)' } : {}) }}>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span className="grotesk" style={{ display: 'block', fontSize: 16, fontWeight: 700 }}>{title}</span>
        <span className="mono" style={{ ...small, display: 'block', marginTop: 2 }}>{sub}</span>
      </span>
      <span className="mono" style={{ fontSize: 13, color: 'var(--faint)' }}>→</span>
    </button>
  );
}

type Panel = 'teams' | 'history' | 'scoring' | 'rules' | 'money' | 'alerts' | 'recruit' | 'api' | null;
type Lg = { league_id?: string; commish?: boolean; bullseye?: ContestInfo; me?: { roster_id: number } | null };

export function ContestSettingsTiles({ lg, onGo }: { lg: Lg; onGo: (room: 'league' | 'commish') => void }) {
  const leagueId = lg.league_id!;
  const commish = !!lg.commish;
  const [open, setOpen] = useState<Panel>(null);
  return (
    <>
      <NoteCard leagueId={leagueId} />
      <div style={{ display: 'grid', gap: 8 }}>
        <Tile title="Teams & seats" sub="who's in · who owns which seat · dues paid" onClick={() => setOpen('teams')} />
        <Tile title="Standings" sub="table · playoff bracket — on LEAGUE" onClick={() => onGo('league')} />
        <Tile title="League history" sub="champions · all-time · records" onClick={() => setOpen('history')} />
        <Tile title="Scoring settings" sub="catalog · adjustments · scoped bonuses" onClick={() => setOpen('scoring')} />
        <Tile title="Squad & rules" sub="spots · budget · the lock · no-shows · playoffs" onClick={() => setOpen('rules')} />
        <Tile title="Dues & prizes" sub="what a seat costs · what the places win" onClick={() => setOpen('money')} />
        <Tile title="Alerts" sub="chat · lineups · playoffs" onClick={() => setOpen('alerts')} />
        <Tile title="Recruit" sub={commish ? 'invite link · board listing' : 'invite link'} onClick={() => setOpen('recruit')} />
        {commish && <Tile title="API keys" sub="let another tool run your team" onClick={() => setOpen('api')} />}
        {commish && <Tile title="Commissioner" sub="the contest · fix a week · playoffs · dues & prizes" onClick={() => onGo('commish')} accent />}
      </div>
      {open === 'teams' && <Sheet title="👥 Teams & seats" subtitle="EVERY SEAT · ITS OWNER · DUES" onClose={() => setOpen(null)}><TeamsView leagueId={leagueId} h2h={lg.bullseye?.format === 'h2h'} /></Sheet>}
      {open === 'history' && <Sheet title="🏛 League history" subtitle="CHAMPIONS · ALL-TIME · THE RECORD BOOK" onClose={() => setOpen(null)}><LeagueHistory leagueId={leagueId} /></Sheet>}
      {open === 'scoring' && <Sheet title="⊞ Scoring settings" subtitle="HOW THIS LEAGUE TURNS PLAYS INTO POINTS" max={760} onClose={() => setOpen(null)}><ScoringPanel leagueId={leagueId} bare /></Sheet>}
      {open === 'rules' && <Sheet title="🧢 Squad & rules" subtitle="SPOTS · BUDGET · THE LOCK · NO-SHOWS · PLAYOFFS" onClose={() => setOpen(null)}><RulesView leagueId={leagueId} b={lg.bullseye!} /></Sheet>}
      {open === 'money' && <Sheet title="💵 Dues & prizes" subtitle="THE PLATFORM PRINTS IT, NEVER COLLECTS IT" onClose={() => setOpen(null)}><MoneyView leagueId={leagueId} b={lg.bullseye!} /></Sheet>}
      {open === 'alerts' && <Sheet title="🔔 Alerts" subtitle="WHAT PINGS THIS BROWSER" onClose={() => setOpen(null)}><NotifPrefsCard bare leagueId={leagueId} /></Sheet>}
      {open === 'recruit' && <Sheet title="📣 Recruit" subtitle={commish ? 'SEND A LINK · POST TO THE BOARD' : 'SEND A LINK TO A FRIEND'} onClose={() => setOpen(null)}><RecruitPanel leagueId={leagueId} commish={commish} bare /></Sheet>}
      {open === 'api' && <Sheet title="🔑 API keys" subtitle="LET ANOTHER TOOL RUN YOUR TEAM" onClose={() => setOpen(null)}><ApiKeysPanel leagueId={leagueId} bare /></Sheet>}
    </>
  );
}

/** The league note (0141): the commissioner's standing word at the top of the sheet. */
function NoteCard({ leagueId }: { leagueId: string }) {
  const [note, setNote] = useState<{ text: string; canEdit: boolean } | null>(null);
  const load = () => leagueNote(leagueId).then((r) => { if (r.ok !== false) setNote({ text: r.text ?? '', canEdit: !!r.can_edit }); }).catch(() => {});
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [leagueId]);
  if (!note || (!note.text && !note.canEdit)) return null;
  const edit = async () => {
    const t = window.prompt('League note — the standing word every member sees here:', note.text);
    if (t == null) return;
    const r = await setLeagueNote(leagueId, t.trim() || null).catch((e) => ({ ok: false, error: friendlyError(e) }));
    if (r.ok) void load(); else window.alert(r.error ?? 'Couldn’t save.');
  };
  return (
    <div style={{ ...card, display: 'flex', gap: 10, alignItems: 'baseline' }}>
      <span className="mono" style={label}>LEAGUE NOTE</span>
      <span style={{ flex: 1, fontSize: 13, color: note.text ? 'var(--text)' : 'var(--faint)', whiteSpace: 'pre-wrap' }}>{note.text || 'No note yet — dues, the group text, house rules.'}</span>
      {note.canEdit && <button onClick={() => void edit()} className="mono" style={{ ...small, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--you)' }}>✎ edit</button>}
    </div>
  );
}

function TeamsView({ leagueId, h2h }: { leagueId: string; h2h: boolean }) {
  const [rows, setRows] = useState<DuesRow[] | null>(null);
  const [amount, setAmount] = useState<number | null>(null);
  const [owners, setOwners] = useState<Map<number, string>>(new Map());
  useEffect(() => {
    leagueDues(leagueId).then((r) => { if (r.ok) { setRows(r.teams ?? []); setAmount(r.amount ?? null); } }).catch(() => setRows([]));
    chatMembers(leagueId).then((r) => {
      if (!r.ok) return;
      const names = new Map((r.members ?? []).map((m) => [m.id, m.name]));
      setOwners(new Map((r.seats ?? []).map((s) => [s.roster, names.get(s.user) ?? ''])));
    }).catch(() => {});
  }, [leagueId]);
  if (!rows) return <div className="mono" style={small}>Loading…</div>;
  return (
    <div style={{ display: 'grid', gap: 2 }}>
      {rows.map((t) => (
        <div key={t.roster_id} className="mono" style={{ display: 'grid', gridTemplateColumns: '36px minmax(0,1fr) minmax(0,1fr) 60px', gap: 8, fontSize: 12, padding: '6px 0', borderTop: '1px solid var(--bd)' }}>
          <span style={{ color: 'var(--faint)' }}>{t.roster_id}</span>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.team ?? `Team ${t.roster_id}`}</span>
          <span style={{ color: 'var(--faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.enrolled ? (owners.get(t.roster_id) || 'a member') : h2h ? 'the CPU · open seat' : 'open seat'}</span>
          <span style={{ textAlign: 'right', color: t.paid ? 'var(--you)' : 'var(--faint)' }}>{amount != null && t.enrolled ? (t.paid ? '✓ paid' : 'unpaid') : ''}</span>
        </div>
      ))}
      {!rows.length && <span className="mono" style={small}>No seats yet.</span>}
    </div>
  );
}

function RulesView({ leagueId, b }: { leagueId: string; b: ContestInfo }) {
  const [po, setPo] = useState<{ teams: number; start: number } | null>(null);
  useEffect(() => { playoffState(leagueId).then((s) => { if (s.ok) setPo({ teams: s.playoff_teams, start: s.playoff_start_week }); }).catch(() => {}); }, [leagueId]);
  const slots = classicSlotsFromSpec(((b as unknown as { slots?: unknown }).slots as never) ?? null) ?? [];
  const labels = contestSlotLabels(slots);
  const h2h = b.format === 'h2h';
  const rows: [string, string][] = [
    ['WINS BY', CONTEST_WORD[b.contest]],
    ['PLAYS', `${CONTEST_FORMAT_WORD[b.format]}${b.span === 'week' ? ` · week ${b.week} only` : ' · all season'}`],
    ['SQUAD', slots.length ? `${slots.length} spots — ${slots.map((d) => labels[d.slot]).join(', ')}` : `${b.spots} spots`],
    ['BUDGET', b.budget ? `$${n0(b.budget)} per squad` : 'no cap'],
    ['MIN SPEND', b.min_spend ? `$${n0(b.min_spend)}` : 'none'],
    ...(b.contest === 'bullseye' ? [['THE CARD', `${b.variant === 'total' ? 'one team total' : 'a target per spot'} · radius ${b.radius}`] as [string, string]] : []),
    ['THE LOCK', 'each player locks at his own kickoff; swap him until then'],
    ['RULED OUT', b.auto_sub ? 'swapped for you just before his game if you haven’t' : 'yours to swap; left in, his spot scores nothing'],
    ['NO SQUAD BY LOCK', CONTEST_LATE_WORD[b.late_entry ?? contestLateEntryDefault(b.format)]],
    ['ENTRIES', CONTEST_DEADLINE_WORD[b.entry_deadline ?? 'open']],
    ...(h2h && b.span === 'season' ? [['PLAYOFFS', po ? (po.teams ? `top ${po.teams} from week ${po.start}` : 'none') : '…'] as [string, string]] : []),
  ];
  return (
    <div style={{ display: 'grid', gap: 2 }}>
      {rows.map(([k, v]) => (
        <div key={k} className="mono" style={{ display: 'grid', gridTemplateColumns: '130px minmax(0,1fr)', gap: 8, fontSize: 12, padding: '6px 0', borderTop: '1px solid var(--bd)' }}>
          <span style={{ color: 'var(--faint)', fontWeight: 700, letterSpacing: '0.06em' }}>{k}</span>
          <span style={{ textTransform: 'none' }}>{v.toLowerCase() === v ? v : v}</span>
        </div>
      ))}
      <span className="mono" style={{ ...small, paddingTop: 6 }}>The commissioner sets these under COMMISH.</span>
    </div>
  );
}

function MoneyView({ leagueId, b }: { leagueId: string; b: ContestInfo }) {
  const [rows, setRows] = useState<DuesRow[]>([]);
  useEffect(() => { leagueDues(leagueId).then((r) => { if (r.ok) setRows((r.teams ?? []).filter((t) => t.enrolled)); }).catch(() => {}); }, [leagueId]);
  const paid = rows.filter((t) => t.paid).length;
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div>
        <div className="mono" style={label}>DUES</div>
        <div style={{ fontSize: 13, marginTop: 4 }}>{b.dues_amount != null ? `$${n0(b.dues_amount)}${b.dues_note ? ` — ${b.dues_note}` : ''}` : 'No dues set.'}</div>
        {b.dues_amount != null && rows.length > 0 && (
          <div style={{ display: 'grid', gap: 2, marginTop: 6 }}>
            <span className="mono" style={small}>{`${paid} of ${rows.length} paid`}</span>
            {rows.map((t) => <div key={t.roster_id} className="mono" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '4px 0', borderTop: '1px solid var(--bd)' }}><span>{t.team ?? `Team ${t.roster_id}`}</span><span style={{ color: t.paid ? 'var(--you)' : 'var(--faint)' }}>{t.paid ? '✓ paid' : 'unpaid'}</span></div>)}
          </div>
        )}
      </div>
      <div>
        <div className="mono" style={label}>PRIZES</div>
        {(b.prizes?.length ?? 0) > 0
          ? (b.prizes ?? []).map((p, i) => <div key={i} className="mono" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '4px 0', borderTop: '1px solid var(--bd)' }}><span>{p.label}</span><span style={{ fontWeight: 700 }}>{p.prize}</span></div>)
          : <div className="mono" style={{ ...small, marginTop: 4 }}>No prizes listed yet.</div>}
      </div>
    </div>
  );
}
