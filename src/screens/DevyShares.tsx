// DEVY SHARES (0387) — the web twin of apps/mobile/src/ui/DevyShares.tsx.
// Every team has 100 shares to put on college players, at most 20 on one.
// The first team to 20 holds his right; failing that, the only team in does,
// with 5 or more. A right reserves him in the rookie draft, at any of the
// holder's picks, once he turns pro.
import { useEffect, useMemo, useState } from 'react';
import { allotDevyShares, devyMarket, devySharesState, friendlyError, setLeagueDevyMode, setLeagueDevyStartCash, setLeagueDevyOpen, type DevyMarketRow, type DevySharePlayer, type DevySharesState } from '@drip/core/data/liveApi';
import { collegeClassLabel } from '@drip/core/data/college';
import { openPlayerCard } from '../app/playerCard';
import { teamBook, myStake, rightLine, lockLine, stakeLine, fmtPts, maxBuy, devyRulesText, stakesOf, DEEP_SEARCH_MIN } from '@drip/core/data/devyShares';

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
  const [rulesOpen, setRulesOpen] = useState(false);
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
  /** INVEST (v0.576.0): one line a player — position, name, school, price,
   *  what you hold, +1 / +5. The name opens his devy card. */
  const investRow = (r: DevyMarketRow) => {
    const held = bySlug.get(r.slug);
    const cur = held ? myStake(held, myRoster) : 0;
    const mineH = held?.holders.find((h) => h.roster_id === myRoster);
    const price = held?.price ?? r.price;
    const room = maxBuy(cur, Number(mineH?.cost ?? 0), price, rules.max, rules.max_spend);
    const can = (k: number) => myRoster != null && !locked && !busy && room > 0 && Math.min(k, room) * price <= book.cash + 1e-9;
    return (
      <div key={r.slug} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: '1px solid var(--bd)' }}>
        <span className="mono" style={{ width: 22, fontSize: 10, fontWeight: 700, color: 'var(--dim)' }}>{r.pos}</span>
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          <span role="button" title="Player card" style={{ fontWeight: 700, color: 'var(--text)', cursor: 'pointer' }}
            onClick={() => openPlayerCard({ slug: r.slug, name: r.name, pos: r.pos, team: r.school ?? '', leagueId })}>{r.name} <span style={{ ...small, fontWeight: 400 }}>{r.school ?? ''}{r.fcs ? ' FCS' : ''} ⓘ</span></span>
        </span>
        {cur > 0 && <span className="mono" style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--you)' }}>{held?.right?.roster_id === myRoster ? '★' : ''}{cur}sh</span>}
        <span className="mono" style={{ fontSize: 11, fontWeight: 700, color: 'var(--dim)', minWidth: 34, textAlign: 'right' }}>{fmtPts(price)}</span>
        {myRoster != null && room > 0 && <button style={chip(false)} disabled={!can(1)} onClick={() => void set(r.slug, cur + 1)}>+1</button>}
        {myRoster != null && room > 1 && <button style={chip(false)} disabled={!can(5)} onClick={() => void set(r.slug, cur + Math.min(5, room))}>+{Math.min(5, room)}</button>}
        {myRoster != null && room <= 0 && cur > 0 && <span className="mono" style={{ fontSize: 10, color: 'var(--you)' }}>MAX</span>}
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
      {/* THE HEADER (v0.576.0): the book on one line, the rules behind the ⓘ,
          a lock or freeze only when one applies. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span className="mono" style={{ flex: 1, fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--you)' }}>
          {myRoster != null ? `CASH ${fmtPts(book.cash)} · STAKES WORTH ${fmtPts(book.value)} · ${book.shares} SHARES` : 'THE LEAGUE’S STAKES'}
        </span>
        <button className="mono" title="How the devy market works" onClick={() => setRulesOpen((o) => !o)}
          style={{ background: 'none', border: '1px solid var(--bd)', borderRadius: 10, width: 20, height: 20, fontSize: 11, color: 'var(--dim)', cursor: 'pointer', padding: 0 }}>ⓘ</button>
      </div>
      {rulesOpen && <div style={{ ...small, whiteSpace: 'pre-line', margin: '0 0 8px', lineHeight: 1.5 }}>{devyRulesText(rules, st)}</div>}
      {(st.locked || st.frozen || st.current === false) && <div className="mono" style={{ fontSize: 10.5, color: 'var(--warn, #c66)', marginBottom: 6 }}>{st.current === false ? 'Last season’s league — read only.' : lockLine(st)}</div>}
      <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
        <button style={chip(view === 'mine')} onClick={() => setView('mine')}>MINE ({mine.length})</button>
        <button style={chip(view === 'league')} onClick={() => setView('league')}>LEAGUE ({st.players?.length ?? 0})</button>
        <button style={chip(view === 'add')} onClick={() => setView('add')}>INVEST</button>
      </div>
      {msg && <div className="mono" style={{ fontSize: 11, color: msg.startsWith('✗') ? 'var(--opp)' : 'var(--you)' }}>{msg}</div>}
      {view === 'mine' && (mine.length ? mine.map((p) => row(p, true)) : <div style={small}>No shares yet. Use INVEST to find a college player before everyone else does.</div>)}
      {view === 'league' && ((st.players ?? []).length ? (st.players ?? []).map((p) => row(p, false)) : <div style={small}>Nobody in the league has bought shares yet.</div>)}
      {view === 'add' && (<>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search any college QB, RB, WR, TE or school…"
          style={{ width: '100%', boxSizing: 'border-box', padding: '6px 9px', border: '1px solid var(--bd)', borderRadius: 6, background: 'var(--bg)', color: 'var(--text)' }} />
        {!market && <div style={small}>Loading the market…</div>}
        {market && market.length === 0 && !deep && <div style={small}>No prices yet: they appear after the first weekly stats update.</div>}
        {deep && deep.length === 0 && <div style={small}>No college QB, RB, WR or TE matches that.</div>}
        {addList.map((r) => investRow(r))}
      </>)}
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

/** DEVY STAKES (v0.576.0, founder: "have the league owned devy shares in the
 *  other team roster views") — under whichever team's roster is on screen:
 *  the college players it holds shares in, ★ for a right it holds. Reads the
 *  league's devy book itself so the roster card needs nothing threaded in. */
export function DevyStakesList({ leagueId, rid, mine, onInvest }: {
  leagueId: string; rid: number | null; mine: boolean; onInvest?: () => void;
}) {
  const [st, setSt] = useState<DevySharesState | null>(null);
  useEffect(() => { devySharesState(leagueId).then(setSt).catch(() => {}); }, [leagueId, rid]);
  if (!st?.ok || !st.on || rid == null) return null;
  const stakes = stakesOf(st, rid);
  const book = teamBook(st, rid);
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="mono" style={{ flex: 1, fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', color: 'var(--faint)' }}>
          DEVY STAKES ({stakes.length}) · {fmtPts(book.value)} WORTH{mine ? ` · ${fmtPts(book.cash)} CASH` : ''}
        </span>
        {mine && onInvest && <button className="mono" onClick={onInvest} style={{ background: 'none', border: 'none', color: 'var(--you)', fontWeight: 700, fontSize: 10.5, cursor: 'pointer' }}>INVEST ›</button>}
      </div>
      {stakes.length === 0 && <div style={{ ...small, marginTop: 6 }}>{mine ? 'No shares yet — INVEST to scout college players.' : 'No devy shares.'}</div>}
      {stakes.map((x) => (
        <div key={x.p.slug} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: '1px solid var(--bd)' }}>
          <span className="mono" style={{ width: 22, fontSize: 10, fontWeight: 700, color: 'var(--dim)' }}>{x.p.pos}</span>
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            <span role="button" title="Player card" style={{ fontWeight: 600, color: 'var(--text)', cursor: 'pointer' }}
              onClick={() => openPlayerCard({ slug: x.p.slug, name: x.p.name ?? x.p.slug, pos: x.p.pos ?? '', team: x.p.school ?? '', leagueId })}>
              {x.p.name ?? x.p.slug} <span style={{ ...small, fontWeight: 400 }}>{x.p.school ?? ''} ⓘ</span>
            </span>
          </span>
          {x.right && <span className="mono" style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--you)' }}>★ RIGHT</span>}
          <span className="mono" style={{ fontSize: 11, fontWeight: 700, color: 'var(--dim)' }}>{x.shares} sh</span>
        </div>
      ))}
    </div>
  );
}
