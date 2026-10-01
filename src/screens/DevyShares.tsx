// DEVY SHARES (0387) — the web twin of apps/mobile/src/ui/DevyShares.tsx.
// Every team has 100 shares to put on college players, at most 20 on one.
// The first team to 20 holds his right; failing that, the only team in does,
// with 5 or more. A right reserves him in the rookie draft, at any of the
// holder's picks, once he turns pro.
import { useEffect, useMemo, useState } from 'react';
import { allotDevyShares, devyMarket, devySharesState, friendlyError, proposeMultiTrade, setLeagueDevyMode, setLeagueDevyStartCash, setLeagueDevyOpen, type DevyMarketRow, type DevySharePlayer, type DevySharesState } from '@drip/core/data/liveApi';
import { collegeClassLabel } from '@drip/core/data/college';
import { openPlayerCard } from '../app/playerCard';
import { teamBook, myStake, rightLine, lockLine, stakeLine, fmtPts, maxBuy, marketRowDetail, DEEP_SEARCH_MIN } from '@drip/core/data/devyShares';

const chip = (on: boolean): React.CSSProperties => ({
  fontFamily: 'var(--mono, monospace)', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.04em', padding: '4px 9px',
  borderRadius: 999, border: `1px solid ${on ? 'var(--you)' : 'var(--bd)'}`, background: on ? 'var(--you)' : 'transparent',
  color: on ? 'var(--on-accent)' : 'var(--dim)', cursor: 'pointer',
});
const small: React.CSSProperties = { fontSize: 11.5, color: 'var(--dim)' };

export function DevySharesPanel({ leagueId, myRoster }: { leagueId: string; myRoster: number | null }) {
  const [st, setSt] = useState<DevySharesState | null>(null);
  const [view, setView] = useState<'mine' | 'league' | 'add' | 'trade'>('mine');
  const [market, setMarket] = useState<DevyMarketRow[] | null>(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const load = () => devySharesState(leagueId).then(setSt).catch(() => {});
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [leagueId]);
  useEffect(() => {
    if (view === 'add') devyMarket(leagueId, 1000).then((r) => setMarket(Array.isArray(r) ? r : [])).catch(() => setMarket([]));
  }, [view, leagueId, st]);
  // 0404: past two letters the search covers every college player.
  const [deep, setDeep] = useState<DevyMarketRow[] | null>(null);
  useEffect(() => {
    const needle = q.trim();
    if (view !== 'add' || needle.length < DEEP_SEARCH_MIN) { setDeep(null); return; }
    let live = true;
    const h = setTimeout(() => {
      devyMarket(leagueId, 60, needle).then((r) => { if (live) setDeep(Array.isArray(r) ? r : []); }).catch(() => { if (live) setDeep([]); });
    }, 250);
    return () => { live = false; clearTimeout(h); };
  }, [q, view, leagueId]);
  const bySlug = useMemo(() => new Map((st?.players ?? []).map((p) => [p.slug, p])), [st]);
  const addList = useMemo(() => {
    if (deep) return deep;
    const needle = q.trim().toLowerCase();
    return (market ?? []).filter((r) => !needle || r.name.toLowerCase().includes(needle) || (r.school ?? '').toLowerCase().includes(needle)).slice(0, 60);
  }, [market, q, deep]);
  if (!st?.ok || !st.on) return null;
  const rules = { budget: 100, max: 20, floor: 5, cash_cap: 200, payout_cap: 3, max_spend: 60, min_spend: 15, refund: 0.5, ...(st.rules ?? {}) };
  const book = teamBook(st, myRoster);
  const mine = (st.players ?? []).filter((p) => myStake(p, myRoster) > 0);
  const locked = !!st.locked || st.current === false;

  const set = async (slug: string, n: number) => {
    if (myRoster == null || busy) return;
    setBusy(true); setMsg(null);
    try {
      const r = await allotDevyShares(leagueId, myRoster, slug, Math.max(0, Math.min(rules.max, n)));
      if (!r.ok) setMsg(`✗ ${friendlyError(r.error ?? 'failed')}`);
      else {
        setMsg(r.spent ? `✓ bought at ${r.price} a share: −${fmtPts(Number(r.spent))}` : r.received ? `✓ sold at ${r.price} a share: +${fmtPts(Number(r.received))}` : null);
        await load();
      }
    } catch (e) { setMsg(`✗ ${friendlyError(e)}`); }
    finally { setBusy(false); }
  };
  const controls = (slug: string, cur: number, price: number, cost: number, maxed: boolean, active: boolean) => {
    const room = maxBuy(cur, cost, price, rules.max, rules.max_spend);
    const buy = (k: number) => Math.min(k, room);
    const afford = (k: number) => active && buy(k) > 0 && buy(k) * price <= book.cash + 1e-9;
    const pts = (k: number) => fmtPts(Math.round(buy(k) * price * 100) / 100);
    const sell = (to: number) => {
      if (maxed && to < cur && !window.confirm('This stake is maxed. Selling any of it drops you out of line for his right, and buying back puts you behind anyone else who is maxed. Sell?')) return;
      void set(slug, to);
    };
    return (
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 5, alignItems: 'center' }}>
        {cur > 0 && <button style={chip(false)} disabled={busy || locked} onClick={() => sell(Math.max(0, cur - 5))}>sell 5</button>}
        {cur > 0 && <button style={chip(false)} disabled={busy || locked} onClick={() => sell(cur - 1)}>sell 1</button>}
        {active && room > 0 && <button style={chip(false)} disabled={busy || locked || !afford(1)} onClick={() => void set(slug, cur + 1)}>+1 · {pts(1)}</button>}
        {active && room > 1 && <button style={chip(false)} disabled={busy || locked || !afford(5)} onClick={() => void set(slug, cur + buy(5))}>+{buy(5)} · {pts(5)}</button>}
        {active && room > 0 && <button style={chip(true)} disabled={busy || locked || !afford(room)} onClick={() => void set(slug, cur + room)}>max +{room} · {pts(room)}</button>}
        {maxed && <span className="mono" style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--you)' }}>MAXED</span>}
        {cur > 0 && <button style={chip(false)} disabled={busy || locked} onClick={() => sell(0)}>sell all</button>}
      </div>
    );
  };
  const row = (p: DevySharePlayer, edit: boolean) => {
    const cur = myStake(p, myRoster);
    const mineH = p.holders.find((h) => h.roster_id === myRoster);
    const yours = myRoster != null && p.right?.roster_id === myRoster;
    const price = p.price ?? 1;
    return (
      <div key={p.slug} style={{ padding: '8px 0', borderBottom: '1px solid var(--bd)' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
          <span style={{ fontWeight: 700, color: 'var(--text)', flex: 1 }}><span role="button" title="Player card" style={{ cursor: 'pointer', textDecoration: 'underline dotted' }}
            onClick={() => openPlayerCard({ slug: p.slug, name: p.name ?? p.slug, pos: p.pos ?? '', team: p.school ?? '', leagueId })}>{p.name ?? p.slug}</span> <span style={small}>{[p.pos, p.school, p.class_year ? collegeClassLabel(p.class_year) : null, p.rank ? `#${p.rank} in college` : 'unranked', p.graduated_to ? 'TURNED PRO' : null].filter(Boolean).join(' · ')}</span></span>
          <span className="mono" style={{ fontWeight: 700, color: 'var(--you)' }}>{price}/sh</span>
        </div>
        {mineH && <div className="mono" style={{ fontSize: 11.5, fontWeight: 700, color: Number(mineH.value) >= Number(mineH.cost) ? 'var(--you)' : 'var(--opp)' }}>YOU: {cur} shares · {stakeLine(mineH.cost, mineH.value)}</div>}
        <div className="mono" style={{ fontSize: 11, color: yours ? 'var(--you)' : 'var(--dim)', marginTop: 2 }}>{rightLine(p, myRoster, rules.floor, rules.max, rules.min_spend)}</div>
        <div className="mono" style={{ fontSize: 10.5, color: 'var(--faint)' }}>{p.holders.map((h) => `${h.team} ${h.shares}`).join(' · ')}</div>
        {p.active === false && !p.graduated_to && <div className="mono" style={{ fontSize: 10.5, color: 'var(--warn, #c66)' }}>LEFT COLLEGE — sell at his last price, or if he isn't drafted, {Math.round(rules.refund * 100)}% of what was paid comes back at the rookie draft</div>}
        {edit && myRoster != null && !p.graduated_to && controls(p.slug, cur, price, Number(mineH?.cost ?? 0), !!mineH?.maxed, p.active !== false)}
      </div>
    );
  };
  return (
    <div style={{ marginTop: 14, borderTop: '1px solid var(--bd)', paddingTop: 10 }}>
      <div className="mono" style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', color: 'var(--faint)' }}>
        DEVY MARKET{myRoster != null ? ` · CASH ${fmtPts(book.cash)} · STAKES WORTH ${fmtPts(book.value)} · ${book.shares} SHARES` : ''}
      </div>
      <div style={{ ...small, margin: '4px 0 8px' }}>
        Buy shares in college players. Prices follow how they're playing, updated weekly in season and frozen from Jan 15 until the next season's first stats.
        A stake maxes at {rules.max} shares or {rules.max_spend} points spent; the first team to max holds his right, or if only one team has {rules.floor}+ shares and {rules.min_spend}+ points in, that team does.
        The right reserves him for you in the rookie draft. When he's drafted your shares pay the better of his college price and his draft round (R1 8, R2 6, R3 5, later 2), up to {rules.payout_cap}× what you paid.
        Selling pays today's price, up to {rules.payout_cap}× what you paid; cash tops out at {rules.cash_cap} from sales. {lockLine(st)}{st.frozen ? ' Prices are frozen for the offseason.' : ''}
        {st.current === false && <div style={{ color: 'var(--warn, #c66)' }}>This is last season's league. Shares move in the current season.</div>}
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
        <button style={chip(view === 'mine')} onClick={() => setView('mine')}>MINE ({mine.length})</button>
        <button style={chip(view === 'league')} onClick={() => setView('league')}>LEAGUE ({st.players?.length ?? 0})</button>
        <button style={chip(view === 'add')} onClick={() => setView('add')}>+ BUY</button>
        {myRoster != null && <button style={chip(view === 'trade')} onClick={() => setView('trade')}>⇄ TRADE</button>}
      </div>
      {msg && <div className="mono" style={{ fontSize: 11, color: msg.startsWith('✗') ? 'var(--opp)' : 'var(--you)' }}>{msg}</div>}
      {view === 'mine' && (mine.length ? mine.map((p) => row(p, true)) : <div style={small}>No shares yet. Use + BUY to find a college player before everyone else does.</div>)}
      {view === 'league' && ((st.players ?? []).length ? (st.players ?? []).map((p) => row(p, false)) : <div style={small}>Nobody in the league has bought shares yet.</div>)}
      {view === 'trade' && myRoster != null && <ShareTradeComposer leagueId={leagueId} st={st} myRoster={myRoster} onSent={(m) => { setMsg(m); setView('mine'); void load(); }} />}
      {view === 'add' && (<>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search college players or schools…"
          style={{ width: '100%', boxSizing: 'border-box', padding: '6px 9px', border: '1px solid var(--bd)', borderRadius: 6, background: 'var(--bg)', color: 'var(--text)' }} />
        {!market && <div style={small}>Loading the market…</div>}
        {market && market.length === 0 && !deep && <div style={small}>No prices yet: they appear after the first weekly stats update.</div>}
        {deep && deep.length === 0 && <div style={small}>No college QB, RB, WR or TE matches that.</div>}
        {!deep && <div style={small}>Type 2+ letters to search every college QB, RB, WR and TE, FCS included. Unpriced players cost 1 point a share.</div>}
        {addList.map((r) => {
          const held = bySlug.get(r.slug);
          if (held) return row({ ...held, price: held.price ?? r.price }, true);
          return (
            <div key={r.slug} style={{ padding: '8px 0', borderBottom: '1px solid var(--bd)' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                <span style={{ fontWeight: 700, color: 'var(--text)', flex: 1 }}><span role="button" title="Player card" style={{ cursor: 'pointer', textDecoration: 'underline dotted' }}
                  onClick={() => openPlayerCard({ slug: r.slug, name: r.name, pos: r.pos, team: r.school ?? '', leagueId })}>{r.name}</span> <span style={small}>{r.pos} · {marketRowDetail(r)} · nobody in yet</span></span>
                <span className="mono" style={{ fontWeight: 700, color: 'var(--you)' }}>{r.price}/sh</span>
              </div>
              {myRoster != null && controls(r.slug, 0, r.price, 0, false, true)}
            </div>
          );
        })}
      </>)}
    </div>
  );
}

/** SHARE TRADES (0397) — the app twin's composer. Files through the league's
 *  trade system, so it gets the same answer, ruling and vote as any trade. */
function ShareTradeComposer({ leagueId, st, myRoster, onSent }: {
  leagueId: string; st: DevySharesState; myRoster: number; onSent: (msg: string) => void;
}) {
  const teams = (st.teams ?? []).filter((x) => x.roster_id !== myRoster);
  const [partner, setPartner] = useState<number | null>(teams[0]?.roster_id ?? null);
  const [give, setGive] = useState<Record<string, number>>({});
  const [get, setGet] = useState<Record<string, number>>({});
  const [giveCash, setGiveCash] = useState('');
  const [getCash, setGetCash] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const stakesOf = (rid: number | null) => (st.players ?? []).filter((p) => !p.graduated_to)
    .map((p) => ({ p, h: p.holders.find((h) => h.roster_id === rid) }))
    .filter((x): x is { p: DevySharePlayer; h: NonNullable<typeof x.h> } => !!x.h);
  const side = (rid: number | null, val: Record<string, number>, setVal: (v: Record<string, number>) => void, cash: string, setCash: (v: string) => void, label: string) => (
    <div style={{ marginTop: 8 }}>
      <div className="mono" style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--faint)' }}>{label}</div>
      {stakesOf(rid).length === 0 && <div style={small}>No shares.</div>}
      {stakesOf(rid).map(({ p, h }) => (
        <div key={p.slug} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0' }}>
          <span style={{ flex: 1, color: 'var(--text)' }}>{p.name ?? p.slug} <span style={small}>{h.shares} held · {p.price ?? 1}/sh</span></span>
          <input type="number" min={0} max={h.shares} value={val[p.slug] ?? 0}
            onChange={(e) => setVal({ ...val, [p.slug]: Math.max(0, Math.min(h.shares, Math.floor(Number(e.target.value) || 0))) })}
            style={{ width: 56, padding: '3px 6px', border: '1px solid var(--bd)', borderRadius: 5, background: 'var(--bg)', color: 'var(--text)' }} />
        </div>
      ))}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
        <span className="mono" style={{ fontSize: 10.5, color: 'var(--dim)' }}>devy cash</span>
        <input value={cash} onChange={(e) => setCash(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="0"
          style={{ width: 64, padding: '3px 6px', border: '1px solid var(--bd)', borderRadius: 5, background: 'var(--bg)', color: 'var(--text)' }} />
        <span style={small}>has {fmtPts(teamBook(st, rid).cash)}</span>
      </div>
    </div>
  );
  const legOf = (rid: number, to: number, val: Record<string, number>, cash: string) => ({
    roster: rid,
    send_shares: Object.entries(val).filter(([, n]) => n > 0).map(([slug, n]) => ({ slug, shares: n, to })),
    send_devy_cash: Number(cash) > 0 ? [{ to, amount: Math.round(Number(cash) * 100) / 100 }] : [],
  });
  const propose = async () => {
    if (partner == null) return;
    const a = legOf(myRoster, partner, give, giveCash), b = legOf(partner, myRoster, get, getCash);
    if (!a.send_shares.length && !a.send_devy_cash.length && !b.send_shares.length && !b.send_devy_cash.length) { setErr('Pick something to trade.'); return; }
    setBusy(true); setErr(null);
    try {
      const r = await proposeMultiTrade(leagueId, [a, b]);
      if (!r.ok) setErr(`✗ ${friendlyError(r.error ?? 'failed')}`);
      else onSent(`✓ offer sent to ${teams.find((x) => x.roster_id === partner)?.team ?? 'them'} — they answer it in the trades list`);
    } catch (e) { setErr(`✗ ${friendlyError(e)}`); }
    finally { setBusy(false); }
  };
  return (
    <div>
      <div style={small}>
        Trade shares and devy cash with another team. Shares carry what they cost (so the 3× cap goes with them), and a whole maxed stake keeps its place in line for his right.
        It goes through the league's trade review like any trade. Shares trade during the January lock too, but not during a draft.
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
        {teams.map((x) => <button key={x.roster_id} style={chip(partner === x.roster_id)} onClick={() => { setPartner(x.roster_id); setGet({}); setGetCash(''); }}>{x.team}</button>)}
      </div>
      {side(myRoster, give, setGive, giveCash, setGiveCash, 'YOU SEND')}
      {partner != null && side(partner, get, setGet, getCash, setGetCash, `${(teams.find((x) => x.roster_id === partner)?.team ?? 'THEY').toUpperCase()} SEND`)}
      {err && <div className="mono" style={{ fontSize: 11, color: 'var(--opp)', marginTop: 6 }}>{err}</div>}
      <button style={{ ...chip(true), marginTop: 8 }} disabled={busy || partner == null} onClick={() => void propose()}>{busy ? 'sending…' : 'propose trade'}</button>
    </div>
  );
}

/** The commissioner's switch: devy SPOTS (a roster shelf) or SHARES (the
 *  market), and a new team's starting cash (0396). */
export function DevyModeRow({ leagueId }: { leagueId: string }) {
  const [on, setOn] = useState<boolean | null>(null);
  const [cash, setCash] = useState('100');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // 0399: when the market opens — only a question until the first draft is done
  const [openNow, setOpenNow] = useState(false);
  const [drafted, setDrafted] = useState(true);
  useEffect(() => { devySharesState(leagueId).then((r) => {
    setOn(!!r.on); setCash(String(r.start_cash ?? 100)); setOpenNow(!!r.open_now); setDrafted(r.drafted !== false);
  }).catch(() => setOn(null)); }, [leagueId]);
  if (on == null) return null;
  const pickOpen = async (open: 'now' | 'after_draft') => {
    setBusy(true); setNote(null);
    try {
      const r = await setLeagueDevyOpen(leagueId, open);
      if (r.ok) { setOpenNow(open === 'now'); setNote(open === 'now' ? '✓ the market is open — teams can buy shares now' : '✓ the market opens once the draft is done'); }
      else setNote(`✗ ${friendlyError(r.error ?? 'failed')}`);
    } catch (e) { setNote(`✗ ${friendlyError(e)}`); }
    finally { setBusy(false); }
  };
  const pick = async (mode: 'spots' | 'shares') => {
    if (!window.confirm(mode === 'shares'
      ? 'Turn on the devy market? College players leave the player pool, and every team gets its starting cash to buy shares. It can\'t change again during a draft, or from Jan 15 until the rookie draft once anyone holds shares.'
      : 'Back to devy spots? Every team\'s shares are sold at today\'s value and the cash stays with them. No one keeps a devy right.')) return;
    setBusy(true); setNote(null);
    try {
      const r = await setLeagueDevyMode(leagueId, mode);
      if (r.ok) { setOn(mode === 'shares'); setNote(mode === 'shares' ? '✓ devy market on — the league chat says so' : '✓ back to devy spots; every share was cashed out'); }
      else setNote(`✗ ${friendlyError(r.error ?? 'failed')}`);
    } catch (e) { setNote(`✗ ${friendlyError(e)}`); }
    finally { setBusy(false); }
  };
  const saveCash = async () => {
    setBusy(true); setNote(null);
    try {
      const r = await setLeagueDevyStartCash(leagueId, Number(cash));
      setNote(r.ok ? `✓ new teams start with ${r.start_cash}` : `✗ ${friendlyError(r.error ?? 'failed')}`);
    } catch (e) { setNote(`✗ ${friendlyError(e)}`); }
    finally { setBusy(false); }
  };
  return (
    <div style={{ marginTop: 8, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      <span className="mono" style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--dim)' }}
        title="SPOTS: college players sit in devy roster spots. SHARES: the devy market — teams buy shares in college players, priced weekly by how they play; the first to max a stake (20 shares or 60 points), or the only team with 5+ shares and 15+ points in, holds his rookie-draft right. Needs a snake or linear draft, DEVY spots at 0 and no college players on rosters.">DEVY</span>
      <button style={chip(!on)} disabled={busy || !on} onClick={() => void pick('spots')}>SPOTS</button>
      <button style={chip(on)} disabled={busy || on} onClick={() => void pick('shares')}>SHARES</button>
      {on && <>
        <span className="mono" style={{ fontSize: 10.5, color: 'var(--dim)' }} title="A team with no book yet starts with this; a team someone takes over keeps what it has.">new team cash</span>
        <input value={cash} onChange={(e) => setCash(e.target.value.replace(/[^0-9.]/g, ''))} style={{ width: 56, padding: '3px 6px', border: '1px solid var(--bd)', borderRadius: 5, background: 'var(--bg)', color: 'var(--text)' }} />
        <button style={chip(false)} disabled={busy} onClick={() => void saveCash()}>save</button>
      </>}
      {on && !drafted && <>
        <span className="mono" style={{ fontSize: 10.5, color: 'var(--dim)' }}
          title="Right away lets teams scout and buy before the startup draft (paused while it runs). Either way, every year after, shares lock from Jan 15 until the rookie draft.">market opens</span>
        <button style={chip(!openNow)} disabled={busy || !openNow} onClick={() => void pickOpen('after_draft')}>after the draft</button>
        <button style={chip(openNow)} disabled={busy || openNow} onClick={() => void pickOpen('now')}>right away</button>
      </>}
      {note && <span className="mono" style={{ fontSize: 11, color: note.startsWith('✗') ? 'var(--opp)' : 'var(--you)' }}>{note}</span>}
    </div>
  );
}
