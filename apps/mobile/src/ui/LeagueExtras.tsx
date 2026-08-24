// League-wide panels for the team screen: standings, the playoff bracket, and
// the commissioner's player-move tools. Split out of Team.tsx so that file
// stays about the caller's own roster.
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  advancePlayoffs, autoGeneratePlayoffs, commishMovePlayer, commishRemovePlayer, friendlyError, generatePlayoffs, leaguePool,
  leagueStandings, nativeRosters, playoffState, setPlayoffRules,
  leagueContracts, setContractYears, franchiseTag, extendContract, rfaTender, rfaBid, rfaResolve, lockContracts,
  guillotineTick, guillotineState, vampireState, vampireSteal, commishRuleSteal,
  type GuillotineState, type VampireState,
  type LeaguePoolPlayer, type PlayoffState, type StandingsRow, type LeagueContracts,
} from '@drip/core/data/liveApi';
import { useTheme, MONO, fs } from '../theme.native';
import { tap, commit, warn } from './feedback';
import { Card, Chip, Mono, PosPill, PrimaryButton } from './prims';
import { Overlay } from './Overlay';
import { LabelInfo } from './InfoChip';

// ── Standings: wins, points, differential ────────────────────────────────────
type StandSort = 'record' | 'pf' | 'diff';

export function Standings({ leagueId, myRoster }: { leagueId: string; myRoster: number | null }) {
  const t = useTheme();
  const [rows, setRows] = useState<StandingsRow[] | null>(null);
  const [sort, setSort] = useState<StandSort>('record');

  useEffect(() => {
    leagueStandings(leagueId).then((r) => setRows(Array.isArray(r) ? r : [])).catch(() => setRows([]));
  }, [leagueId]);

  const sorted = useMemo(() => {
    const rs = [...(rows ?? [])];
    const diff = (r: StandingsRow) => r.pf - r.pa;
    if (sort === 'pf') rs.sort((a, b) => b.pf - a.pf || b.wins - a.wins);
    else if (sort === 'diff') rs.sort((a, b) => diff(b) - diff(a) || b.wins - a.wins);
    // 'record' keeps the server's order: wins desc, PF desc — the seeding order.
    return rs;
  }, [rows, sort]);

  // DIVISIONS (0215): active when every seat is labeled and ≥2 labels exist —
  // the same rule the server seeds playoffs by. The RECORD view groups by
  // division (each group already in the server's race order, so the top row of
  // a group IS its current winner); POINTS / DIFF stay one flat table, because
  // those sorts are cross-league questions.
  const divisions = useMemo(() => {
    const rs = rows ?? [];
    if (sort !== 'record' || rs.length === 0 || rs.some((r) => !r.division)) return null;
    const names = [...new Set(rs.map((r) => r.division as string))];
    if (names.length < 2) return null;
    return names.sort((a, b) => a.localeCompare(b))
      .map((name) => ({ name, teams: rs.filter((r) => r.division === name) }));
  }, [rows, sort]);

  if (rows === null) return <Card><ActivityIndicator color={t.you} /></Card>;
  if (rows.length === 0) return null;
  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <Mono size={9} tone="faint" track={0.12}>STANDINGS</Mono>
        <View style={{ flex: 1 }} />
        {(([['record', 'RECORD'], ['pf', 'POINTS'], ['diff', '± DIFF']] as const)).map(([id, label]) => (
          <Chip key={id} label={label} on={sort === id} onPress={() => { tap(); setSort(id); }} />
        ))}
      </View>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 8, paddingBottom: 3 }}>
        <Mono size={7.5} tone="faint" track={0.1} style={{ width: 18 }}>#</Mono>
        <Mono size={7.5} tone="faint" track={0.1} style={{ flex: 1 }}>TEAM</Mono>
        <Mono size={7.5} tone="faint" track={0.1} style={{ width: 44, textAlign: 'right' }}>W-L</Mono>
        <Mono size={7.5} tone="faint" track={0.1} style={{ width: 48, textAlign: 'right' }}>PF</Mono>
        <Mono size={7.5} tone="faint" track={0.1} style={{ width: 48, textAlign: 'right' }}>DIFF</Mono>
      </View>
      {(() => {
        const rowFor = (r: StandingsRow, label: string, leader: boolean) => {
          const d = Math.round((r.pf - r.pa) * 10) / 10;
          const me = r.roster_id === myRoster;
          return (
            <View key={r.roster_id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd }}>
              <Mono size={9} tone="faint" style={{ width: 18 }}>{label}</Mono>
              <Text numberOfLines={1} style={{ flex: 1, fontSize: fs(12), color: me ? t.you : t.text, fontWeight: me ? '700' : '400' }}>
                {r.team ?? `Roster ${r.roster_id}`}{leader ? ' ★' : ''}
              </Text>
              <Mono size={9.5} weight="700" style={{ width: 44, textAlign: 'right' }}>
                {r.wins}-{r.losses}{r.ties ? `-${r.ties}` : ''}
              </Mono>
              <Mono size={9.5} style={{ width: 48, textAlign: 'right' }}>{Math.round(r.pf * 10) / 10}</Mono>
              <Mono size={9.5} tone={d > 0 ? 'you' : d < 0 ? 'opp' : 'dim'} style={{ width: 48, textAlign: 'right' }}>
                {d > 0 ? '+' : ''}{d}
              </Mono>
            </View>
          );
        };
        if (!divisions) return sorted.map((r, i) => rowFor(r, String(i + 1), false));
        // Grouped: each division in the server's race order — the top row of a
        // group is its current winner (★), the seed the playoffs will protect.
        return divisions.map((g) => (
          <View key={g.name}>
            <Mono size={8} tone="dim" track={0.14} style={{ marginTop: 8, marginBottom: 2 }}>{g.name.toUpperCase()}</Mono>
            {g.teams.map((r, i) => rowFor(r, String(i + 1), i === 0))}
          </View>
        ));
      })()}
    </Card>
  );
}

// ── Cap sheet (0217–0220): every member's read of a contract league ──────────
// Renders NOTHING when the league plays without contracts, so it can mount
// unconditionally next to Standings. Payroll + room per team; tap a team to
// unfold its deals ($salary · years · how it was signed · the league's own
// market read), its retained-salary ghosts and its dead money. While the
// draft room is open, YOUR deals carry a length picker; in the OFFSEASON your
// expiring deals grow the front-office row — 🏷 TAG, ⤴ EXTEND, 🪧 TENDER —
// and open RFA tenders take rival bids and the owner's match-or-walk.
/** The cap sheet's compact chip (v0.354.6, founder: "These chips are a bit
 *  of a mess. we could make them smaller and aligned instead of wrapping") —
 *  the standard Chip at 15 deals × 9 chips wrapped into porridge. This one
 *  is sized so a deal's whole control set sits on ONE row each, and the
 *  fixed-width row label keeps every deal's chips in the same columns. */
function Mini({ label, on, disabled, onPress }: { label: string; on?: boolean; disabled?: boolean; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable disabled={disabled} onPress={onPress} hitSlop={4}
      style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: on ? t.you : t.bd, backgroundColor: on ? t.you : 'transparent', borderRadius: 5, paddingHorizontal: 7, paddingVertical: 3, opacity: disabled ? 0.5 : 1 }}>
      <Text style={{ fontFamily: MONO, fontSize: fs(8.5), fontWeight: '700', color: on ? t.onAccent : t.dim }}>{label}</Text>
    </Pressable>
  );
}

const CAP_ROW_LABEL_W = 84;

export function CapSheet({ leagueId, myRoster, isCommish = false }: { leagueId: string; myRoster: number | null; isCommish?: boolean }) {
  const t = useTheme();
  const [st, setSt] = useState<LeagueContracts | null>(null);
  const [names, setNames] = useState<Record<string, LeaguePoolPlayer>>({});
  const [open, setOpen] = useState<number | null>(myRoster);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [bidFor, setBidFor] = useState<string | null>(null);   // open bid form, by slug
  const [bidSalary, setBidSalary] = useState('');
  const [bidYears, setBidYears] = useState(1);

  const load = () => leagueContracts(leagueId).then((r) => {
    setSt(r);
    if (r.contracts) {
      leaguePool(leagueId)
        .then((ps) => setNames(Object.fromEntries(ps.map((p) => [p.slug, p]))))
        .catch(() => {});
    }
  }).catch(() => setSt({ contracts: false }));
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [leagueId]);

  const act = async (fn: () => Promise<{ ok: boolean; error?: string }>, done?: string) => {
    if (busy) return;
    setBusy(true); setNote(null);
    try {
      const r = await fn();
      if (r.ok) { commit(); if (done) setNote(done); await load(); }
      else { warn(); setNote(friendlyError(r.error ?? 'that didn’t work')); }
    } catch (e) { warn(); setNote(friendlyError(e)); }
    finally { setBusy(false); }
  };

  if (!st?.contracts) return null;
  const deals = st.deals ?? [];
  const yearsMax = st.years_max ?? 4;
  const canAssign = !st.locked;
  const offseason = !!st.offseason;
  const rules = st.rules;
  const tenders = st.tenders ?? [];
  const nameOf = (s: string) => names[s]?.full_name ?? s;
  const HOW: Record<string, string> = { auction: 'auction', rookie: 'rookie deal', draft: 'draft', waiver: 'waiver', fa: 'free agent', commish: 'commish' };
  return (
    <Card>
      <LabelInfo label="📜 CAP SHEET"
        info={'How deals are born: auction wins sign at the exact bid, waiver wins at their FAAB bid, free agents at the $1 minimum, startup picks at the rookie scale. A move that would land a team over the cap is refused whole.\n\nWhile the draft room is open, tap your own deals to set each length; after it closes only the commissioner can change one (rookie-scale lengths are always fixed).\n\n"$X ghost" is salary a team retained on a player it traded away. Red lines are dead money from cuts, charged for the deal\'s remaining life. "mkt $N" is HIS market price — the league’s value curve at his pool rank, scaled to the cap. Extensions discount off his market; the 🏷 tag prices off the top-5 positional salary average instead (the NFL’s own tag formula), so tagging a star costs star money.\n\nIn the OFFSEASON your expiring deals grow 🏷 TAG (one per team, at the market or a raise), ⤴ EXTEND (1–3yr at a discount of market), and 🪧 TENDER (RFA: rivals bid, you match or let him walk). Multi-year deals carry into next season at a year less; expiring deals walk unless kept one of those ways.'} />
      <Mono size={9} tone="dim" style={{ marginTop: 5 }}>
        ${st.salary_cap} cap · deals up to {st.years_max}yr · {deals.length} signed
        {offseason ? ' · OFFSEASON — tags, extensions & RFA are live' : ''}
      </Mono>
      {/* ── 0229 LOCK-TO-PLAY (founder: "teams can make roster moves if they
          'lock' all their contracts") — after the room closes, the wire stays
          shut for a team until its manager confirms the lengths as written. */}
      {myRoster != null && !st.my_locked && st.lock_deadline != null && Date.parse(st.lock_deadline) > Date.now() && (
        <View style={{ marginTop: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: t.warn, borderRadius: 7, padding: 10, gap: 8 }}>
          <Mono size={9} tone="warn" style={{ lineHeight: 14 }}>
            🔒 Waivers & free agency are closed for your team until you lock your contract lengths. Set each deal below, then lock. Unset deals stay 1 year — everything auto-locks {new Date(st.lock_deadline).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}.
          </Mono>
          <PrimaryButton label="🔒 LOCK MY CONTRACTS" disabled={busy}
            onPress={() => { tap(); void act(() => lockContracts(leagueId, myRoster), '✓ locked — your wire is open'); }} />
        </View>
      )}
      {!!note && <Mono size={9} tone={note.startsWith('✓') ? 'you' : 'opp'} style={{ marginTop: 4 }}>{note}</Mono>}
      <View style={{ marginTop: 8 }}>
        {(st.payrolls ?? []).map((p) => {
          const cap = p.cap ?? st.salary_cap ?? 0;
          const room = cap - p.payroll;
          const mine = p.roster_id === myRoster;
          const unfolded = open === p.roster_id;
          const team = deals.filter((d) => d.roster_id === p.roster_id);
          const ghosts = (st.retentions ?? []).filter((r) => r.roster_id === p.roster_id);
          const dead = (st.dead ?? []).filter((r) => r.roster_id === p.roster_id);
          const myTagUsed = team.some((d) => d.tagged);
          return (
            <View key={p.roster_id} style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd }}>
              <Pressable onPress={() => { tap(); setOpen(unfolded ? null : p.roster_id); }}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ fontSize: fs(12), color: mine ? t.you : t.text, fontWeight: mine ? '700' : '400' }}>
                    {p.team ?? `Roster ${p.roster_id}`}
                  </Text>
                  {!!p.cap_adjust && <Mono size={7.5} tone="faint">cap {p.cap_adjust > 0 ? '+' : ''}${p.cap_adjust} by trade</Mono>}
                </View>
                {(st.locks ?? []).some((l) => l.roster_id === p.roster_id && !l.locked) && (
                  <Mono size={8} tone="warn">🔓</Mono>
                )}
                <Mono size={9.5} weight="700" tone={room < 0 ? 'opp' : undefined} style={{ textAlign: 'right' }}>${p.payroll}/${cap}</Mono>
                <Mono size={8.5} tone={room < 0 ? 'opp' : 'faint'} style={{ width: 58, textAlign: 'right' }}>
                  {room < 0 ? `$${-room} over` : `$${room} room`}
                </Mono>
                <Mono size={9} tone="faint">{unfolded ? '▾' : '▸'}</Mono>
              </Pressable>
              {unfolded && team.map((d) => {
                // rookie-scale lengths are the scale's, never the manager's —
                // but the COMMISSIONER may correct any deal, any time (the
                // server has always allowed it; now the chips show for them)
                const pickable = (canAssign && mine && d.acquired !== 'rookie') || isCommish;
                const net = d.salary - (d.retained ?? 0);
                // the front office works EXPIRING deals in the offseason
                const frontOffice = offseason && mine && d.years === 1 && !d.tagged;
                const tendered = tenders.some((x) => x.slug === d.slug && x.status === 'open');
                const bargain = (d.mkt ?? 0) > d.salary;
                return (
                  <View key={d.slug} style={{ paddingVertical: 3, paddingLeft: 10 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Text numberOfLines={1} style={{ flex: 1, fontSize: fs(11), color: t.dim }}>
                        {d.tagged ? '🏷 ' : ''}{nameOf(d.slug)}{names[d.slug]?.pos ? ` · ${names[d.slug].pos}` : ''}
                      </Text>
                      <Mono size={9} weight="700">${net}·{d.years}yr</Mono>
                      {/* the value read: the league's own market vs the deal */}
                      {d.mkt != null && <Mono size={7.5} tone={bargain ? 'you' : 'faint'}>mkt ${d.mkt}</Mono>}
                      <Mono size={8} tone="faint" style={{ width: 64, textAlign: 'right' }}>{HOW[d.acquired] ?? d.acquired}</Mono>
                    </View>
                    {!!d.retained && (
                      <Mono size={7.5} tone="faint">${d.retained} of ${d.salary} retained by a former team</Mono>
                    )}
                    {pickable && (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3, marginBottom: 1 }}>
                        <View style={{ width: CAP_ROW_LABEL_W }}>
                          <LabelInfo label="LENGTH" title="Contract length"
                            info={'1YR is an expiring deal — after this season he walks unless tagged, extended or tendered. Expiring deals cut free: no dead money.\n\nA 2–4 year deal carries into next season at a year less, but cutting it early leaves part of the salary as dead money on your cap for the deal\u2019s remaining life (the % is a league setting).\n\nLonger deals are commitment: cheaper to keep, costlier to escape.'} />
                        </View>
                        {Array.from({ length: yearsMax }, (_, i) => i + 1).map((y) => (
                          <Mini key={y} label={`${y}YR`} on={d.years === y} disabled={busy}
                            onPress={() => { tap(); void act(() => setContractYears(leagueId, d.slug, y)); }} />
                        ))}
                      </View>
                    )}
                    {frontOffice && (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2, marginBottom: 2 }}>
                        <View style={{ width: CAP_ROW_LABEL_W }}>
                        <LabelInfo label="KEEP HIM" title="The front office"
                          info={'Three ways to keep an expiring player, all offseason-only:\n\n\ud83c\udff7 TAG — one per team per season. Signs him for one more year at the top-5 positional salary average (the NFL\u2019s own tag formula) or your salary plus the league\u2019s raise %, whichever is higher. Star money for star players.\n\n\u2934 EXTEND — 1\u20133 more years at a discount of HIS market (the value curve at his pool rank). Locking a bargain in before he reaches the open market is the whole play.\n\n\ud83e\udea7 RFA — tender him to restricted free agency: rivals bid a salary and length, and you keep the right to match their best offer exactly, or let him walk with it.'} />
                        </View>
                        {!myTagUsed && (
                          <Mini label="🏷 TAG" disabled={busy}
                            onPress={() => { tap(); void act(() => franchiseTag(leagueId, d.slug), `✓ ${nameOf(d.slug)} tagged`); }} />
                        )}
                        {!tendered && [1, 2, 3].map((y) => (
                          <Mini key={y} label={`+${y}YR`} disabled={busy}
                            onPress={() => { tap(); void act(() => extendContract(leagueId, d.slug, y), `✓ extended ${y}yr at ${rules?.ext_discount_pct ?? 85}% of market`); }} />
                        ))}
                        {rules?.rfa && !tendered && (
                          <Mini label="🪧 RFA" disabled={busy}
                            onPress={() => { tap(); void act(() => rfaTender(leagueId, d.slug), `✓ ${nameOf(d.slug)} tendered to RFA`); }} />
                        )}
                      </View>
                    )}
                  </View>
                );
              })}
              {unfolded && ghosts.map((g) => (
                <View key={`g-${g.slug}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 2, paddingLeft: 10 }}>
                  <Text numberOfLines={1} style={{ flex: 1, fontSize: fs(10.5), color: t.faint, fontStyle: 'italic' }}>
                    {nameOf(g.slug)} — retained on the way out
                  </Text>
                  <Mono size={8.5} tone="faint">${g.amount} ghost</Mono>
                </View>
              ))}
              {unfolded && dead.map((dm, i) => (
                <View key={`d-${dm.slug}-${i}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 2, paddingLeft: 10 }}>
                  <Text numberOfLines={1} style={{ flex: 1, fontSize: fs(10.5), color: t.opp, fontStyle: 'italic' }}>
                    {nameOf(dm.slug)} — dead money{dm.note ? ` (${dm.note})` : ''}
                  </Text>
                  <Mono size={8.5} tone="opp">${dm.amount}·{dm.years_left}yr</Mono>
                </View>
              ))}
              {unfolded && team.length === 0 && ghosts.length === 0 && dead.length === 0 && (
                <Mono size={8.5} tone="faint" style={{ paddingLeft: 10, paddingBottom: 5 }}>no deals on the books</Mono>
              )}
            </View>
          );
        })}
      </View>
      {/* ── The RFA board (0220): open tenders take bids; owners answer ── */}
      {offseason && tenders.filter((x) => x.status === 'open').length > 0 && (
        <View style={{ marginTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd, paddingTop: 8 }}>
          <LabelInfo label="🪧 RFA BOARD" title="Restricted free agency"
            info={'Tendered players take open bids: any rival offers a salary and a length. Bids must climb.\n\nWhen the owner answers, MATCH keeps the player at the best offer\u2019s exact terms (their cap must fit it) — LET WALK sends him to the bidder, deal and all.'} />
          {tenders.filter((x) => x.status === 'open').map((x) => {
            const ownerIsMe = x.roster_id === myRoster;
            const bidding = bidFor === x.slug;
            return (
              <View key={x.slug} style={{ paddingVertical: 5 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text numberOfLines={1} style={{ flex: 1, fontSize: fs(11.5), color: t.text }}>
                    {nameOf(x.slug)}
                  </Text>
                  <Mono size={8.5} tone={x.offer_salary ? 'warn' : 'faint'}>
                    {x.offer_salary ? `best offer $${x.offer_salary}·${x.offer_years}yr` : 'no offers yet'}
                  </Mono>
                </View>
                {!ownerIsMe && myRoster != null && !bidding && (
                  <Chip label="💰 MAKE AN OFFER" disabled={busy}
                    onPress={() => { tap(); setBidFor(x.slug); setBidSalary(String((x.offer_salary ?? 0) + 1)); setBidYears(x.offer_years ?? 1); }} />
                )}
                {!ownerIsMe && bidding && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                    <Mono size={8} tone="faint">$</Mono>
                    <TextInput value={bidSalary} keyboardType="number-pad" maxLength={5}
                      onChangeText={(v) => setBidSalary(v.replace(/[^0-9]/g, ''))}
                      style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 5, fontSize: fs(12), color: t.text, backgroundColor: t.bg, width: 58 }} />
                    {Array.from({ length: yearsMax }, (_, i) => i + 1).map((y) => (
                      <Chip key={y} label={`${y}YR`} on={bidYears === y} onPress={() => { tap(); setBidYears(y); }} />
                    ))}
                    <Chip label="✓ BID" disabled={busy || !parseInt(bidSalary, 10)}
                      onPress={() => {
                        tap(); setBidFor(null);
                        void act(() => rfaBid(leagueId, myRoster!, x.slug, parseInt(bidSalary, 10), bidYears), '✓ offer in');
                      }} />
                  </View>
                )}
                {ownerIsMe && x.offer_salary != null && (
                  <View style={{ flexDirection: 'row', gap: 6, marginTop: 4 }}>
                    <Chip label="✓ MATCH" disabled={busy}
                      onPress={() => { tap(); void act(() => rfaResolve(leagueId, x.slug, true), `✓ matched — ${nameOf(x.slug)} stays`); }} />
                    <Chip label="👋 LET WALK" disabled={busy}
                      onPress={() => { tap(); void act(() => rfaResolve(leagueId, x.slug, false), `✓ walked — the deal moved with him`); }} />
                  </View>
                )}
              </View>
            );
          })}
        </View>
      )}
      {/* only live STATE prints here — the rules live in the ⓘ */}
      {canAssign && (
        <Mono size={8.5} tone="dim" style={{ marginTop: 8 }}>
          The draft room is open — set each of your deals’ lengths above before it closes.
        </Mono>
      )}
    </Card>
  );
}

// ── 🔪 Guillotine (0221): the cutline, the fallen, the frenzy ────────────────
// Renders nothing outside guillotine leagues. Mounting POKES the blade — the
// tick is idempotent and any member's league load may run it (the
// autoGeneratePlayoffs pattern), so eliminations land without a cron.
export function GuillotineCard({ leagueId, myRoster }: { leagueId: string; myRoster: number | null }) {
  const t = useTheme();
  const [st, setSt] = useState<GuillotineState | null>(null);

  useEffect(() => {
    guillotineTick(leagueId).catch(() => {})
      .then(() => guillotineState(leagueId)).then(setSt)
      .catch(() => setSt({ guillotine: false }));
  }, [leagueId]);

  if (!st?.guillotine) return null;
  const alive = st.alive ?? [];
  const fallen = st.fallen ?? [];
  const frenzy = st.frenzy ?? [];
  return (
    <Card>
      <LabelInfo label="🔪 THE CUTLINE"
        info={'Guillotine rules: each week, the lowest-scoring team still alive is ELIMINATED — its whole roster is released to waivers (the frenzy), where the big FAAB budget decides who lands the spoils.\n\nThere are no head-to-head stakes; the only standing that matters is staying off the floor. A tie at the bottom dies by the weaker season. The last team standing wins.\n\nEliminated teams keep their seat at the table — chat, the pots — but can never add a player again.'} />
      {st.champion != null ? (
        <Mono size={11} weight="700" tone="you" style={{ marginTop: 6 }}>
          🏆 {alive[0]?.team ?? `Roster ${st.champion}`} — the last one standing
        </Mono>
      ) : (
        <Mono size={9} tone="dim" style={{ marginTop: 5 }}>
          {alive.length} alive · week {st.week ?? '—'} · the lowest score falls
        </Mono>
      )}
      <View style={{ marginTop: 8 }}>
        {alive.map((a, i) => {
          const doomed = st.champion == null && i === 0;
          const mine = a.roster_id === myRoster;
          return (
            <View key={a.roster_id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd }}>
              <Text style={{ fontSize: fs(12), width: 18, textAlign: 'center' }}>{doomed ? '🔪' : ''}</Text>
              <Text numberOfLines={1} style={{ flex: 1, fontSize: fs(12), color: mine ? t.you : doomed ? t.opp : t.text, fontWeight: mine || doomed ? '700' : '400' }}>
                {a.team ?? `Roster ${a.roster_id}`}
              </Text>
              <Mono size={9.5} weight="700" tone={doomed ? 'opp' : undefined}>{Math.round(a.pts * 10) / 10}</Mono>
            </View>
          );
        })}
      </View>
      {frenzy.length > 0 && (
        <View style={{ marginTop: 10 }}>
          <Mono size={9} tone="warn" weight="700" track={0.12}>💰 THE FRENZY — released to waivers</Mono>
          {frenzy.slice(0, 12).map((p) => (
            <View key={p.slug} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 3 }}>
              <Text numberOfLines={1} style={{ flex: 1, fontSize: fs(11), color: t.text }}>{p.full_name} · {p.pos}</Text>
              <Mono size={8} tone="faint">#{p.rank}</Mono>
            </View>
          ))}
          {frenzy.length > 12 && <Mono size={8.5} tone="faint">…and {frenzy.length - 12} more on the wire</Mono>}
        </View>
      )}
      {fallen.length > 0 && (
        <Mono size={8.5} tone="faint" style={{ marginTop: 8, lineHeight: fs(13) }}>
          Fallen: {fallen.map((f) => `${f.team ?? `Roster ${f.roster_id}`} (wk ${f.week})`).join(' · ')}
        </Mono>
      )}
    </Card>
  );
}

// ── 🧛 Vampire (0222): the steal window and the commissioner's ruling ────────
export function VampireCard({ leagueId, myRoster, isCommish }: { leagueId: string; myRoster: number | null; isCommish: boolean }) {
  const t = useTheme();
  const [st, setSt] = useState<VampireState | null>(null);
  const [names, setNames] = useState<Record<string, LeaguePoolPlayer>>({});
  const [rosters, setRosters] = useState<{ roster_id: number; slug: string }[]>([]);
  const [take, setTake] = useState<string | null>(null);
  const [give, setGive] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = () => Promise.all([
    vampireState(leagueId).then(setSt),
    leaguePool(leagueId).then((ps) => setNames(Object.fromEntries(ps.map((p) => [p.slug, p])))).catch(() => {}),
    nativeRosters(leagueId).then((rs) => setRosters(rs.map((r) => ({ roster_id: r.roster_id, slug: r.slug })))).catch(() => {}),
  ]).catch(() => setSt({ vampire: false }));
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [leagueId]);

  const act = async (fn: () => Promise<{ ok: boolean; error?: string }>, done?: string) => {
    if (busy) return;
    setBusy(true); setNote(null);
    try {
      const r = await fn();
      if (r.ok) { commit(); if (done) setNote(done); setTake(null); setGive(null); await load(); }
      else { warn(); setNote(friendlyError(r.error ?? 'that didn’t work')); }
    } catch (e) { warn(); setNote(friendlyError(e)); }
    finally { setBusy(false); }
  };

  if (!st?.vampire) return null;
  const nameOf = (s: string) => names[s]?.full_name ?? s;
  const iAmVampire = st.seat != null && st.seat === myRoster;
  const windowOpen = !!st.won && !st.fed;
  const pending = (st.steals ?? []).filter((s) => s.status === 'pending');
  return (
    <Card>
      <LabelInfo label="🧛 THE VAMPIRE"
        info={'Vampire rules: one seat lives off wins alone. The vampire can\'t sign free agents or claim waivers — but when it WINS a matchup, it steals one player from the beaten team\'s active roster, giving one of its own back.\n\nOne steal per win, and only while the win is fresh (the latest completed week). When the commissioner has steal approval on, each steal parks as PENDING until they rule.\n\nEvery bite prints in the league register.'} />
      <Mono size={9} tone="dim" style={{ marginTop: 5 }}>
        {st.seat == null ? 'No vampire appointed yet — the commissioner picks the seat in ⚑ COMMISH.'
          : `Seat ${st.seat} feeds on wins${st.steal_review ? ' · steals need the commissioner’s approval' : ''}`}
      </Mono>
      {!!note && <Mono size={9} tone={note.startsWith('✓') ? 'you' : 'opp'} style={{ marginTop: 4 }}>{note}</Mono>}
      {/* the bite: vampire won the latest completed week and hasn't fed */}
      {iAmVampire && windowOpen && (
        <View style={{ marginTop: 8 }}>
          <Mono size={9.5} weight="700" tone="you">🩸 Fresh blood — you beat seat {st.victim} in week {st.week}. Pick your steal:</Mono>
          <Mono size={8} tone="faint" style={{ marginTop: 5 }}>TAKE FROM THE BEATEN TEAM</Mono>
          <View style={{ flexDirection: 'row', gap: 5, marginTop: 3, flexWrap: 'wrap' }}>
            {rosters.filter((r) => r.roster_id === st.victim).map((r) => (
              <Chip key={r.slug} label={nameOf(r.slug)} on={take === r.slug} onPress={() => { tap(); setTake(r.slug); }} />
            ))}
          </View>
          <Mono size={8} tone="faint" style={{ marginTop: 5 }}>GIVE BACK</Mono>
          <View style={{ flexDirection: 'row', gap: 5, marginTop: 3, flexWrap: 'wrap' }}>
            {rosters.filter((r) => r.roster_id === st.seat).map((r) => (
              <Chip key={r.slug} label={nameOf(r.slug)} on={give === r.slug} onPress={() => { tap(); setGive(r.slug); }} />
            ))}
          </View>
          <View style={{ marginTop: 8 }}>
            <PrimaryButton label={busy ? '…' : '🧛 SINK THE TEETH'} disabled={busy || !take || !give}
              onPress={() => { if (take && give) void act(() => vampireSteal(leagueId, take, give), st.steal_review ? '✓ declared — awaiting the ruling' : '✓ the steal is done'); }} />
          </View>
        </View>
      )}
      {iAmVampire && !windowOpen && st.seat != null && (
        <Mono size={8.5} tone="faint" style={{ marginTop: 6 }}>
          {st.fed ? 'This week’s win is already fed on.' : st.week == null ? 'No completed week yet.' : 'No fresh blood — win your matchup to steal.'}
        </Mono>
      )}
      {/* the commissioner's ruling (steal_review) */}
      {isCommish && pending.map((s) => (
        <View key={s.id} style={{ marginTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd, paddingTop: 6 }}>
          <Mono size={9} tone="warn" weight="700">⚑ PENDING STEAL — week {s.week}</Mono>
          <Mono size={9} tone="dim" style={{ marginTop: 2 }}>
            takes {nameOf(s.take)} from seat {s.victim}, gives back {nameOf(s.give)}
          </Mono>
          <View style={{ flexDirection: 'row', gap: 6, marginTop: 5 }}>
            <Chip label="✓ APPROVE" on disabled={busy} onPress={() => { tap(); void act(() => commishRuleSteal(leagueId, s.id, true), '✓ approved'); }} />
            <Chip label="✕ VETO" disabled={busy} onPress={() => { tap(); void act(() => commishRuleSteal(leagueId, s.id, false), '✓ vetoed'); }} />
          </View>
        </View>
      ))}
      {(st.steals ?? []).length > 0 && (
        <Mono size={8.5} tone="faint" style={{ marginTop: 8, lineHeight: fs(13) }}>
          Feeding history: {(st.steals ?? []).map((s) => `wk${s.week} ${nameOf(s.take)} (${s.status})`).join(' · ')}
        </Mono>
      )}
    </Card>
  );
}

// ── Playoff controls — lives in the ⚑ League settings sheet ──────────────────
// Split from the bracket card below: editing is a settings decision, the
// bracket is a scoreboard. Both read the same playoff_state.
export function PlayoffControls({ leagueId, onChanged }: { leagueId: string; onChanged: () => void }) {
  const [st, setSt] = useState<PlayoffState | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const load = () => playoffState(leagueId).then(setSt).catch(() => {});
  useEffect(() => {
    void load();
    // The season closes itself (0162): once the last regular-season game is
    // final, any member's visit here builds round 1 — the advance poke's twin.
    autoGeneratePlayoffs(leagueId).then((r) => { if (r.ok && r.generated !== false) void load(); }).catch(() => {});
    /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [leagueId]);
  const run = async (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) => {
    if (busy) return;
    setBusy(true); setNote(null);
    try {
      const r = await fn();
      if (r.ok) { commit(); setNote(`✓ ${done}`); } else { warn(); setNote(friendlyError(r.error ?? 'failed')); }
    } catch (e) { warn(); setNote(friendlyError(e)); }
    finally { setBusy(false); void load(); onChanged(); }
  };
  if (!st || st.error) return null;
  return (
    <View>
      {!!note && <Mono size={9.5} tone={note.startsWith('✓') ? 'you' : 'opp'} style={{ marginTop: 4 }}>{note}</Mono>}
      {st.underway ? (
        <Mono size={9} tone="faint" style={{ marginTop: 6 }}>The bracket is underway — size and start week are locked.</Mono>
      ) : (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
            <Mono size={9} tone="faint">BRACKET</Mono>
            {[2, 4, 6, 8].map((n) => (
              <Chip key={n} label={`${n} TEAMS`} on={st.playoff_teams === n}
                onPress={() => { tap(); void run(() => setPlayoffRules(leagueId, n, null), `bracket of ${n}`); }} />
            ))}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
            <Mono size={9} tone="faint">STARTS WK</Mono>
            {[15, 16, 17].map((w) => (
              <Chip key={w} label={String(w)} on={st.playoff_start_week === w}
                onPress={() => { tap(); void run(() => setPlayoffRules(leagueId, null, w), `playoffs start week ${w}`); }} />
            ))}
          </View>
          <View style={{ marginTop: 8 }}>
            <PrimaryButton label={busy ? '…' : st.generated ? '↻ REGENERATE ROUND 1 (reseeds from standings)' : '⚡ GENERATE THE BRACKET'}
              disabled={busy} onPress={() => {
                tap();
                if (st.generated) {
                  Alert.alert('Regenerate round 1?', 'Reseeds from the current standings — any manual bracket state from the old round 1 is replaced.', [
                    { text: 'cancel', style: 'cancel' },
                    { text: 'regenerate', style: 'destructive', onPress: () => void run(() => generatePlayoffs(leagueId), 'round 1 rebuilt') },
                  ]);
                } else void run(() => generatePlayoffs(leagueId), 'bracket generated');
              }} />
          </View>
        </>
      )}
      {st.generated && st.champion == null && (
        <View style={{ marginTop: 8 }}>
          <PrimaryButton label={busy ? '…' : '⏭ ADVANCE (build the next round from finals)'} disabled={busy}
            onPress={() => { tap(); void run(() => advancePlayoffs(leagueId), 'advanced'); }} />
        </View>
      )}
      <Mono size={8.5} tone="faint" style={{ marginTop: 8, lineHeight: fs(13) }}>
        Seeding comes from the standings (wins, then points-for). The bracket itself shows on the MY TEAM screen for everyone.
      </Mono>
    </View>
  );
}

// ── Playoffs: the bracket (view only — the levers live in ⚑ League settings) ──
export function Playoffs({ leagueId }: { leagueId: string }) {
  const t = useTheme();
  const [st, setSt] = useState<PlayoffState | null>(null);

  useEffect(() => {
    playoffState(leagueId).then(setSt).catch(() => {});
  }, [leagueId]);

  if (!st || st.error) return null;
  const teamOf = (rid: number) => st.standings.find((s) => s.roster_id === rid)?.team ?? `Roster ${rid}`;
  const seedOf = (rid: number) => {
    const i = (st.seeds ?? []).indexOf(rid);
    return i >= 0 ? `#${i + 1} ` : '';
  };

  return (
    <Card>
      <Mono size={9} tone="faint" track={0.12}>🏆 PLAYOFFS</Mono>

      {st.champion != null && (
        <Mono size={11} tone="you" weight="700" style={{ marginTop: 6 }}>
          👑 {st.champion_team ?? teamOf(st.champion)} — league champion
        </Mono>
      )}

      {/* the bracket, round by round */}
      {st.matchups.length === 0 && (
        <Mono size={9.5} tone="faint" style={{ marginTop: 8 }}>
          No bracket yet — the commissioner generates it from ⚑ League settings when the regular season wraps.
        </Mono>
      )}
      {Array.from(new Set(st.matchups.map((m) => m.round))).sort((a, b) => a - b).map((round) => (
        <View key={round} style={{ marginTop: 8 }}>
          <Mono size={8.5} tone="faint" track={0.1}>ROUND {round}</Mono>
          {st.matchups.filter((m) => m.round === round).map((m) => (
            <View key={m.id} style={{ paddingVertical: 4, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd, marginTop: 3 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text numberOfLines={1} style={{ flex: 1, fontSize: fs(11.5), color: t.text }}>
                  {seedOf(m.home)}{teamOf(m.home)} vs {seedOf(m.away)}{teamOf(m.away)}
                </Text>
                {m.home_final != null && m.away_final != null
                  ? <Mono size={9.5} weight="700">{m.home_final}–{m.away_final}</Mono>
                  : <Mono size={8} tone={m.status === 'live' ? 'you' : 'faint'} track={0.06}>{m.status.toUpperCase()}</Mono>}
              </View>
              {(m.label || m.consolation) && (
                <Mono size={8} tone="faint" style={{ marginTop: 1 }}>{m.consolation ? 'consolation' : m.label}</Mono>
              )}
            </View>
          ))}
        </View>
      ))}
    </Card>
  );
}

// ── Commissioner player moves: any player, any roster, waivers, FA ───────────
export function CommishPlayers({ leagueId, onChanged }: { leagueId: string; onChanged: () => void }) {
  const t = useTheme();
  const [pool, setPool] = useState<LeaguePoolPlayer[]>([]);
  const [rosters, setRosters] = useState<{ roster_id: number; slug: string }[]>([]);
  const [teams, setTeams] = useState<Map<number, string>>(new Map());
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [moveFor, setMoveFor] = useState<LeaguePoolPlayer | null>(null);
  /** The move/waive/cut awaiting a yes (v0.293.1). One at a time; null = none. */
  const [ask, setAsk] = useState<null | { p: LeaguePoolPlayer; act: 'move' | 'waive' | 'cut'; toRoster?: number; toName?: string; from: string }>(null);
  /** 'all' = everyone rostered · 'fa' = the waiver wire · a roster id = one team. */
  const [view, setView] = useState<'all' | 'fa' | number>('all');

  const load = async () => {
    const [p, r, s] = await Promise.all([
      leaguePool(leagueId), nativeRosters(leagueId),
      leagueStandings(leagueId).then((x) => (Array.isArray(x) ? x : [])).catch(() => [] as StandingsRow[]),
    ]);
    setPool(p); setRosters(r);
    setTeams(new Map(s.map((row) => [row.roster_id, row.team ?? `Roster ${row.roster_id}`])));
  };
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [leagueId]);

  const bySlug = useMemo(() => new Map(rosters.map((r) => [r.slug, r.roster_id])), [rosters]);

  const run = async (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) => {
    if (busy) return;
    setBusy(true); setNote(null);
    try {
      const r = await fn();
      if (r.ok) { commit(); setNote(`✓ ${done}`); } else { warn(); setNote(friendlyError(r.error ?? 'failed')); }
    } catch (e) { warn(); setNote(friendlyError(e)); }
    finally { setBusy(false); await load(); onChanged(); }
  };

  // VIEW SELECTOR (v0.225.0, the web's v0.215.0 ported). A single flat list of
  // every rostered player meant answering "what does this manager actually
  // have" by reading a league-wide list and matching team names by eye, and
  // there was no way at all to browse who was AVAILABLE — a free agent could
  // only be reached by typing a name you already knew.
  //
  // SEARCH BEHAVIOUR IS PRESERVED DELIBERATELY: in the ALL view it still
  // reaches the whole pool, because that was the only route to a free agent
  // before this selector existed and muscle memory shouldn't break. Inside a
  // team or the wire it filters that set instead.
  const needle = q.trim().toLowerCase();
  const inView = (p: LeaguePoolPlayer) => {
    const rid = bySlug.get(p.slug);
    if (view === 'all') return needle ? true : rid != null;
    if (view === 'fa') return rid == null;
    return rid === view;
  };
  const rows = pool
    .filter((p) => inView(p) && (!needle || p.full_name.toLowerCase().includes(needle)))
    .slice(0, 40);
  const rosteredCount = pool.filter((p) => bySlug.has(p.slug)).length;
  const faCount = pool.length - rosteredCount;
  const teamIds = [...new Set(rosters.map((r) => r.roster_id))].sort((a, b) => a - b);

  return (
    <Card>
      <Mono size={9} tone="faint" track={0.12}>⚑ ROSTERS &amp; WAIVER WIRE</Mono>
      {!!note && <Mono size={9.5} tone={note.startsWith('✓') ? 'you' : 'opp'} style={{ marginTop: 4 }}>{note}</Mono>}
      <View style={{ flexDirection: 'row', gap: 5, flexWrap: 'wrap', marginTop: 7 }}>
        <Chip label="ALL ROSTERED" on={view === 'all'} onPress={() => { tap(); setView('all'); }} />
        <Chip label={`⏳ WAIVER WIRE (${faCount})`} on={view === 'fa'} onPress={() => { tap(); setView('fa'); }} />
        {teamIds.map((rid) => (
          <Chip key={rid} label={teams.get(rid) ?? `Roster ${rid}`} on={view === rid} onPress={() => { tap(); setView(rid); }} />
        ))}
      </View>
      <Mono size={8.5} tone="faint" style={{ marginTop: 6 }}>
        {view === 'all' ? `${rosteredCount} rostered across the league · search reaches free agents too`
          : view === 'fa' ? `${faCount} available — nobody's roster`
          : `${pool.filter((p) => bySlug.get(p.slug) === view).length} on ${teams.get(view as number) ?? `roster ${view}`}`}
      </Mono>
      <TextInput value={q} onChangeText={setQ}
        placeholder={view === 'all' ? 'Search the whole pool (free agents too)…' : 'Search this list…'}
        placeholderTextColor={t.faint}
        style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 8, fontSize: fs(12.5), color: t.text, backgroundColor: t.bg, marginTop: 8, marginBottom: 4 }} />
      {rows.length === 0 && (
        <Mono size={9.5} tone="faint" style={{ marginTop: 8 }}>
          {needle ? 'No player matches that search here.'
            : view === 'fa' ? 'Every player in the pool is on a roster.'
            : view === 'all' ? 'Nobody is rostered yet — the draft fills this.'
            : 'This team has no players yet.'}
        </Mono>
      )}
      {rows.map((p) => {
        const rid = bySlug.get(p.slug);
        return (
          <View key={p.slug} style={{ flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 5, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd }}>
            <PosPill pos={p.pos} size={8} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ fontSize: fs(12), color: t.text }}>{p.full_name}</Text>
              <Mono size={8} tone={rid != null ? 'dim' : 'faint'}>
                {rid != null ? teams.get(rid) ?? `Roster ${rid}` : 'free agent'}
              </Mono>
            </View>
            {/* ASK FIRST (v0.293.1, founder). ⏳ and ✂ used to fire on the tap —
                two unlabelled glyphs, side by side, taking a player off SOMEBODY
                ELSE'S roster with no way back. The move picker already asked
                "to whom", which is not the same as asking "are you sure". */}
            <Chip label="⇄ MOVE" onPress={() => { tap(); setMoveFor(p); }} />
            {rid != null && (
              <>
                <Chip label="⏳" onPress={() => { tap(); setAsk({ p, act: 'waive', from: teams.get(rid) ?? `Roster ${rid}` }); }} />
                <Chip label="✂" onPress={() => { tap(); setAsk({ p, act: 'cut', from: teams.get(rid) ?? `Roster ${rid}` }); }} />
              </>
            )}
          </View>
        );
      })}
      <Mono size={8.5} tone="faint" style={{ marginTop: 8, lineHeight: fs(13) }}>
        ⇄ move puts a player on any roster (clears waiver holds; position limits bypassed, roster size still enforced). ⏳ waives with the 24h claim hold; ✂ cuts straight to free agency.
      </Mono>

      <Overlay visible={!!moveFor} title={moveFor ? `Move ${moveFor.full_name} to…` : ''} onClose={() => setMoveFor(null)}>
        {[...teams.entries()].map(([rid, name]) => (
          <Pressable key={rid} disabled={busy}
            onPress={() => {
              const p = moveFor; setMoveFor(null);
              if (p) setAsk({ p, act: 'move', toRoster: rid, toName: name, from: bySlug.get(p.slug) != null ? (teams.get(bySlug.get(p.slug)!) ?? 'their team') : 'free agency' });
            }}
            style={{ paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.bd }}>
            <Text style={{ fontFamily: MONO, fontSize: fs(12.5), fontWeight: '700', color: t.you }}>{name}</Text>
          </Pressable>
        ))}
      </Overlay>

      {/* It names the PLAYER, the team losing him and the team getting him —
          "are you sure?" over a list of forty names is not a question anyone
          can answer. */}
      <Overlay visible={!!ask}
        title={ask?.act === 'move' ? 'Move this player?' : ask?.act === 'waive' ? 'Waive this player?' : 'Cut this player?'}
        onClose={() => setAsk(null)}>
        <View style={{ padding: 14, gap: 10 }}>
          <Text style={{ fontFamily: MONO, fontSize: fs(11), color: t.dim, lineHeight: fs(17) }}>
            {ask?.act === 'move' ? <>
              <Text style={{ color: t.text, fontWeight: '700' }}>{ask?.p.full_name}</Text> moves from{' '}
              <Text style={{ color: t.text, fontWeight: '700' }}>{ask?.from}</Text> to{' '}
              <Text style={{ color: t.you, fontWeight: '700' }}>{ask?.toName}</Text>. Waiver holds clear and position limits are bypassed.
            </> : ask?.act === 'waive' ? <>
              <Text style={{ color: t.text, fontWeight: '700' }}>{ask?.p.full_name}</Text> comes off{' '}
              <Text style={{ color: t.text, fontWeight: '700' }}>{ask?.from}</Text> and sits on waivers for 24 hours — anyone in the league can claim him.
            </> : <>
              <Text style={{ color: t.text, fontWeight: '700' }}>{ask?.p.full_name}</Text> comes off{' '}
              <Text style={{ color: t.text, fontWeight: '700' }}>{ask?.from}</Text> and becomes a free agent{' '}
              <Text style={{ color: t.opp, fontWeight: '700' }}>immediately</Text> — first come, first served.
            </>}
          </Text>
          <Mono size={9} tone="faint" style={{ lineHeight: fs(13) }}>This is another manager's roster. They are not asked.</Mono>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
            <Pressable onPress={() => { tap(); setAsk(null); }}
              style={{ flex: 1, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 6, paddingVertical: 11, alignItems: 'center' }}>
              <Mono size={10} weight="700" tone="dim">CANCEL</Mono>
            </Pressable>
            <Pressable disabled={busy}
              onPress={() => {
                const a = ask; setAsk(null);
                if (!a) return;
                if (a.act === 'move' && a.toRoster != null) void run(() => commishMovePlayer(leagueId, a.p.slug, a.toRoster!), `${a.p.full_name} → ${a.toName}`);
                else if (a.act !== 'move') void run(() => commishRemovePlayer(leagueId, a.p.slug, a.act === 'waive'), `${a.p.full_name} → ${a.act === 'waive' ? 'waivers (24h)' : 'free agent'}`);
              }}
              style={{ flex: 1, borderWidth: 1, borderColor: ask?.act === 'cut' ? t.opp : t.you, borderRadius: 6, paddingVertical: 11, alignItems: 'center', opacity: busy ? 0.5 : 1 }}>
              <Mono size={10} weight="700" tone={ask?.act === 'cut' ? 'opp' : 'you'}>
                {ask?.act === 'move' ? '⇄ MOVE HIM' : ask?.act === 'waive' ? '⏳ WAIVE HIM' : '✂ CUT HIM'}
              </Mono>
            </Pressable>
          </View>
        </View>
      </Overlay>
    </Card>
  );
}
