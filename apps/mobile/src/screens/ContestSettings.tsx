// A CONTEST LEAGUE'S SETTINGS SHEET, native (v0.679.0) — the web's twin
// (src/screens/ContestSettings.tsx): the classic hub's tile list for a weekly
// squad league, the panels that apply reused, the contest's own where the
// classic ones don't.
import { useEffect, useState } from 'react';
import { Alert, Pressable, Text, TextInput, View } from 'react-native';
import {
  leagueNote, setLeagueNote, leagueDues, chatMembers, playoffState, friendlyError,
  type ContestInfo, type DuesRow,
} from '@drip/core/data/liveApi';
import { CONTEST_WORD, CONTEST_FORMAT_WORD, CONTEST_LATE_WORD, CONTEST_DEADLINE_WORD, contestLateEntryDefault, contestSlotLabels } from '@drip/core/engine/contest';
import { classicSlotsFromSpec } from '@drip/core/engine/classic';
import { useTheme, MONO, fs } from '../theme.native';
import { tap } from '../ui/feedback';
import { Card, Chip, Mono } from '../ui/prims';
import { Overlay } from '../ui/Overlay';
import { ScoringView, RecruitView, ApiKeysView } from '../ui/LeagueInfo';
import { LeagueHistoryView } from '../ui/LeagueHistory';
import { PushPrefs } from '../ui/SettingsModal';

const n0 = (n: number) => n.toLocaleString('en-US');
type Panel = 'teams' | 'history' | 'scoring' | 'rules' | 'money' | 'alerts' | 'recruit' | 'api' | 'note' | null;
type Lg = { league_id?: string; commish?: boolean; bullseye?: ContestInfo; me?: { roster_id: number } | null };

function Tile({ title, sub, onPress, accent }: { title: string; sub: string; onPress: () => void; accent?: boolean }) {
  const t = useTheme();
  return (
    <Pressable onPress={() => { tap(); onPress(); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: t.surface, borderWidth: 1, borderColor: t.bd, borderLeftWidth: accent ? 3 : 1, borderLeftColor: accent ? t.you : t.bd, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 14 }}>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: fs(16), fontWeight: '700', color: t.text }}>{title}</Text>
        <Text style={{ fontFamily: MONO, fontSize: fs(9.5), color: t.faint, marginTop: 2 }}>{sub}</Text>
      </View>
      <Text style={{ fontFamily: MONO, fontSize: fs(13), color: t.faint }}>→</Text>
    </Pressable>
  );
}

export function ContestSettingsTiles({ lg, onGo }: { lg: Lg; onGo: (room: 'league' | 'commish') => void }) {
  const leagueId = lg.league_id!;
  const commish = !!lg.commish;
  const [open, setOpen] = useState<Panel>(null);
  const [note, setNote] = useState<{ text: string; canEdit: boolean } | null>(null);
  const [draft, setDraft] = useState('');
  const loadNote = () => leagueNote(leagueId).then((r) => { if (r.ok !== false) setNote({ text: r.text ?? '', canEdit: !!r.can_edit }); }).catch(() => {});
  useEffect(() => { void loadNote(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [leagueId]);
  const saveNote = async () => {
    const r = await setLeagueNote(leagueId, draft.trim() || null).catch((e) => ({ ok: false, error: friendlyError(e) }));
    if (r.ok) { setOpen(null); void loadNote(); } else Alert.alert('Couldn’t save', r.error ?? '');
  };
  const t = useTheme();
  return (
    <>
      {note && (note.text || note.canEdit) && (
        <Card style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
          <Mono size={9} tone="faint" weight="700" track={0.1}>LEAGUE NOTE</Mono>
          <Text style={{ flex: 1, fontSize: fs(13), color: note.text ? t.text : t.faint }}>{note.text || 'No note yet — dues, the group text, house rules.'}</Text>
          {note.canEdit && <Chip small dim label="✎ EDIT" onPress={() => { setDraft(note.text); setOpen('note'); }} />}
        </Card>
      )}
      <View style={{ gap: 8 }}>
        <Tile title="Teams & seats" sub="who's in · who owns which seat · dues paid" onPress={() => setOpen('teams')} />
        <Tile title="Standings" sub="table · playoff bracket — on LEAGUE" onPress={() => onGo('league')} />
        <Tile title="League history" sub="champions · all-time · records" onPress={() => setOpen('history')} />
        <Tile title="Scoring settings" sub="catalog · adjustments · scoped bonuses" onPress={() => setOpen('scoring')} />
        <Tile title="Squad & rules" sub="spots · budget · the lock · no-shows · playoffs" onPress={() => setOpen('rules')} />
        <Tile title="Dues & prizes" sub="what a seat costs · what the places win" onPress={() => setOpen('money')} />
        <Tile title="Alerts" sub="chat · lineups · playoffs" onPress={() => setOpen('alerts')} />
        <Tile title="Recruit" sub={commish ? 'invite link · board listing' : 'invite link'} onPress={() => setOpen('recruit')} />
        {commish && <Tile title="API keys" sub="let another tool run your team" onPress={() => setOpen('api')} />}
        {commish && <Tile title="Commissioner" sub="the contest · fix a week · playoffs · dues & prizes" onPress={() => onGo('commish')} accent />}
      </View>
      <Overlay visible={open === 'note'} title="League note" subtitle="THE STANDING WORD EVERY MEMBER SEES" onClose={() => setOpen(null)}>
        <View style={{ gap: 8 }}>
          <NoteField value={draft} onChange={setDraft} />
          <View style={{ flexDirection: 'row', gap: 8 }}><Chip on label="SAVE" onPress={() => { tap(); void saveNote(); }} /><Chip dim label="CANCEL" onPress={() => { tap(); setOpen(null); }} /></View>
        </View>
      </Overlay>
      <Overlay visible={open === 'teams'} title="👥 Teams & seats" subtitle="EVERY SEAT · ITS OWNER · DUES" onClose={() => setOpen(null)}><TeamsView leagueId={leagueId} h2h={lg.bullseye?.format === 'h2h'} /></Overlay>
      <Overlay visible={open === 'history'} title="🏛 League history" subtitle="CHAMPIONS · ALL-TIME · THE RECORD BOOK" onClose={() => setOpen(null)}><LeagueHistoryView leagueId={leagueId} /></Overlay>
      <Overlay visible={open === 'scoring'} title="⊞ Scoring settings" subtitle="HOW THIS LEAGUE TURNS PLAYS INTO POINTS" onClose={() => setOpen(null)}><ScoringView leagueId={leagueId} /></Overlay>
      <Overlay visible={open === 'rules'} title="🧢 Squad & rules" subtitle="SPOTS · BUDGET · THE LOCK · NO-SHOWS · PLAYOFFS" onClose={() => setOpen(null)}><RulesView leagueId={leagueId} b={lg.bullseye!} /></Overlay>
      <Overlay visible={open === 'money'} title="💵 Dues & prizes" subtitle="THE PLATFORM PRINTS IT, NEVER COLLECTS IT" onClose={() => setOpen(null)}><MoneyView leagueId={leagueId} b={lg.bullseye!} /></Overlay>
      <Overlay visible={open === 'alerts'} title="Alerts" subtitle="THIS LEAGUE · EVERY DEVICE" onClose={() => setOpen(null)}><PushPrefs leagueId={leagueId} /></Overlay>
      <Overlay visible={open === 'recruit'} title="📣 Recruit" subtitle={commish ? 'SEND A LINK · POST TO THE BOARD' : 'SEND A LINK TO A FRIEND'} onClose={() => setOpen(null)}><RecruitView leagueId={leagueId} commish={commish} /></Overlay>
      <Overlay visible={open === 'api'} title="🔑 API keys" subtitle="LET ANOTHER TOOL RUN YOUR TEAM" onClose={() => setOpen(null)}><ApiKeysView leagueId={leagueId} /></Overlay>
    </>
  );
}

function NoteField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const t = useTheme();
  // a plain TextInput, multiline, in the theme's colours
  return <TextInput value={value} onChangeText={onChange} multiline maxLength={600} placeholder="Dues, the group text, house rules…" placeholderTextColor={t.faint}
    style={{ color: t.text, borderWidth: 1, borderColor: t.bd, borderRadius: 6, padding: 10, fontSize: 14, backgroundColor: t.bg, minHeight: 90, textAlignVertical: 'top' }} />;
}

function TeamsView({ leagueId, h2h }: { leagueId: string; h2h: boolean }) {
  const t = useTheme();
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
  if (!rows) return <Mono size={9} tone="faint">Loading…</Mono>;
  return (
    <View style={{ gap: 2 }}>
      {rows.map((r) => (
        <View key={r.roster_id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, borderTopWidth: 1, borderTopColor: t.bd }}>
          <Mono size={9} tone="faint" style={{ width: 24 }}>{String(r.roster_id)}</Mono>
          <Text numberOfLines={1} style={{ flex: 1, fontSize: fs(13), color: t.text }}>{r.team ?? `Team ${r.roster_id}`}</Text>
          <Mono size={9} tone="faint" numberOfLines={1} style={{ flex: 1 }}>{r.enrolled ? (owners.get(r.roster_id) || 'a member') : h2h ? 'the CPU · open seat' : 'open seat'}</Mono>
          <Mono size={9} tone={r.paid ? 'you' : 'faint'}>{amount != null && r.enrolled ? (r.paid ? '✓ paid' : 'unpaid') : ''}</Mono>
        </View>
      ))}
      {!rows.length && <Mono size={9} tone="faint">No seats yet.</Mono>}
    </View>
  );
}

function RulesView({ leagueId, b }: { leagueId: string; b: ContestInfo }) {
  const t = useTheme();
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
    <View style={{ gap: 2 }}>
      {rows.map(([k, v]) => (
        <View key={k} style={{ flexDirection: 'row', gap: 8, paddingVertical: 6, borderTopWidth: 1, borderTopColor: t.bd }}>
          <Mono size={9} tone="faint" weight="700" track={0.06} style={{ width: 110 }}>{k}</Mono>
          <Text style={{ flex: 1, fontSize: fs(12.5), color: t.text }}>{v}</Text>
        </View>
      ))}
      <Mono size={8.5} tone="faint" style={{ marginTop: 6 }}>The commissioner sets these under COMMISH.</Mono>
    </View>
  );
}

function MoneyView({ leagueId, b }: { leagueId: string; b: ContestInfo }) {
  const t = useTheme();
  const [rows, setRows] = useState<DuesRow[]>([]);
  useEffect(() => { leagueDues(leagueId).then((r) => { if (r.ok) setRows((r.teams ?? []).filter((x) => x.enrolled)); }).catch(() => {}); }, [leagueId]);
  const paid = rows.filter((x) => x.paid).length;
  return (
    <View style={{ gap: 10 }}>
      <View>
        <Mono size={9} tone="faint" weight="700" track={0.1}>DUES</Mono>
        <Text style={{ fontSize: fs(13), color: t.text, marginTop: 4 }}>{b.dues_amount != null ? `$${n0(b.dues_amount)}${b.dues_note ? ` — ${b.dues_note}` : ''}` : 'No dues set.'}</Text>
        {b.dues_amount != null && rows.length > 0 && (
          <View style={{ gap: 2, marginTop: 6 }}>
            <Mono size={9} tone="faint">{`${paid} of ${rows.length} paid`}</Mono>
            {rows.map((x) => <View key={x.roster_id} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, borderTopWidth: 1, borderTopColor: t.bd }}><Text style={{ fontSize: fs(12.5), color: t.text }}>{x.team ?? `Team ${x.roster_id}`}</Text><Mono size={9} tone={x.paid ? 'you' : 'faint'}>{x.paid ? '✓ paid' : 'unpaid'}</Mono></View>)}
          </View>
        )}
      </View>
      <View>
        <Mono size={9} tone="faint" weight="700" track={0.1}>PRIZES</Mono>
        {(b.prizes?.length ?? 0) > 0
          ? (b.prizes ?? []).map((p, i) => <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, borderTopWidth: 1, borderTopColor: t.bd }}><Text style={{ fontSize: fs(12.5), color: t.text }}>{p.label}</Text><Text style={{ fontSize: fs(12.5), fontWeight: '700', color: t.text }}>{p.prize}</Text></View>)
          : <Mono size={9} tone="faint" style={{ marginTop: 4 }}>No prizes listed yet.</Mono>}
      </View>
    </View>
  );
}
