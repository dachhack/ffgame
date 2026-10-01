// DEVY SHARES (0387) — the web twin of apps/mobile/src/ui/DevyShares.tsx.
// Every team has 100 shares to put on college players, at most 20 on one.
// The first team to 20 holds his right; failing that, the only team in does,
// with 5 or more. A right reserves him in the rookie draft, at any of the
// holder's picks, once he turns pro.
import { useEffect, useMemo, useState } from 'react';
import { draftState, leagueGameMode, setDevyRounds } from '@drip/core/data/liveApi';
import { leagueCustomCollege, commishAddCustomCollege, commishRemoveCustomCollege, CUSTOM_COLLEGE_LEVELS, type CustomCollegeRow } from '@drip/core/data/liveApi';
import { allotDevyShares, devyMarket, devySharesState, devyLaunchState, placeDevyLaunchOrder, setLeagueDevyLaunch, commishDevyLaunchNow, friendlyError, type DevyLaunchState, type DevyLaunchPlayer, type DevyLaunchCfg, setLeagueDevyMode, setLeagueDevyStartCash, setLeagueDevyOpen, type DevyMarketRow, type DevySharePlayer, type DevySharesState } from '@drip/core/data/liveApi';
import { collegeClassLabel } from '@drip/core/data/college';
import { openPlayerCard } from '../app/playerCard';
import { ModalBackdrop } from '../app/ui';
import { teamBook, myStake, rightLine, lockLine, stakeLine, fmtPts, maxBuy, devyRulesText, stakesOf, DEEP_SEARCH_MIN, marketLines, shapeMarket, nextSort, marketSubline, MARKET_FILTERS, launchBanner, launchOrderMax, launchRulesText, slotLabel, DOW_LABELS, tradePreview, type MarketLine, type MarketSort, type MarketFilter } from '@drip/core/data/devyShares';

const chip = (on: boolean): React.CSSProperties => ({
  fontFamily: 'var(--mono, monospace)', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.04em', padding: '4px 9px',
  borderRadius: 999, border: `1px solid ${on ? 'var(--you)' : 'var(--bd)'}`, background: on ? 'var(--you)' : 'transparent',
  color: on ? 'var(--on-accent)' : 'var(--dim)', cursor: 'pointer',
});
const small: React.CSSProperties = { fontSize: 11.5, color: 'var(--dim)' };

export function DevySharesPanel({ leagueId, myRoster }: { leagueId: string; myRoster: number | null }) {
  const [st, setSt] = useState<DevySharesState | null>(null);
  // v0.577.0: the DEVY tab opens on the market.
  const [view, setView] = useState<'mine' | 'league' | 'add'>('add');
  const [filter, setFilter] = useState<MarketFilter>('ALL');
  const [sort, setSort] = useState<{ key: MarketSort; dir: 'asc' | 'desc' }>({ key: 'rank', dir: 'asc' });
  const [openOwners, setOpenOwners] = useState<string | null>(null);
  // v0.579.0: the purchase sheet.
  const [trade, setTrade] = useState<{ slug: string; mode: 'buy' | 'sell'; n: number } | null>(null);
  const [market, setMarket] = useState<DevyMarketRow[] | null>(null);
  const [q, setQ] = useState('');
  const [rulesOpen, setRulesOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  // 0407: new-player launches.
  const [ls, setLs] = useState<DevyLaunchState | null>(null);
  const [launchView, setLaunchView] = useState(false);
  const load = () => Promise.all([
    devySharesState(leagueId).then(setSt).catch(() => {}),
    devyLaunchState(leagueId, myRoster).then(setLs).catch(() => {}),
  ]);
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
  const addList = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const listed = new Set([...(ls?.open?.players ?? []), ...(ls?.pending ?? [])].map((x) => x.slug));
    const rows = (deep ?? (market ?? []).filter((r) => !needle || r.name.toLowerCase().includes(needle) || (r.school ?? '').toLowerCase().includes(needle)))
      .filter((r) => !listed.has(r.slug));
    return shapeMarket(marketLines(rows, st, myRoster), filter, sort.key, sort.dir).slice(0, 100);
  }, [market, q, deep, st, myRoster, filter, sort, ls]);
  const order = async (slug: string, n: number) => {
    if (myRoster == null || busy) return;
    setBusy(true); setMsg(null);
    try {
      const r = await placeDevyLaunchOrder(leagueId, myRoster, slug, n);
      if (!r.ok) { setMsg(`✗ ${friendlyError(r.error ?? 'failed')}`); return; }
      setMsg(n === 0 ? '✓ order cancelled' : `✓ sealed order: ${n} share${n === 1 ? '' : 's'} · ${fmtPts(Number(r.committed ?? 0))} committed this launch`);
      setLs(await devyLaunchState(leagueId, myRoster));
    } catch (e) { setMsg(`✗ ${friendlyError(e)}`); }
    finally { setBusy(false); }
  };
  if (!st?.ok || !st.on) return null;
  const banner = launchBanner(ls);
  const needleL = q.trim().toLowerCase();
  const launchPlayers = (ls?.open?.players ?? ls?.pending ?? []).filter((x) => (filter === 'ALL' || filter === 'OPEN' || x.pos === filter)
    && (!needleL || x.name.toLowerCase().includes(needleL) || (x.school ?? '').toLowerCase().includes(needleL)));
  const myOrders = (ls?.open?.players ?? []).filter((x) => (x.my_order ?? 0) > 0);
  const launchRow = (x: DevyLaunchPlayer) => {
    const open = !!ls?.open;
    const price = Number(x.price ?? 0);
    const mx = launchOrderMax(price, ls?.cfg);
    const cur = x.my_order ?? 0;
    const btn = (label: string, to: number, on = false) => (
      <button key={label} style={chip(on)} disabled={busy || to === cur || to < 0 || to > mx} onClick={() => void order(x.slug, to)}>{label}</button>
    );
    return (
      <div key={x.slug} style={{ display: 'grid', gridTemplateColumns: '24px minmax(0,1fr) 54px auto', gap: 8, alignItems: 'center', padding: '5px 0', borderBottom: '1px solid var(--bd)' }}>
        <span className="mono" style={{ fontSize: 10, fontWeight: 700, color: 'var(--dim)' }}>{x.pos}</span>
        <span style={{ minWidth: 0, overflow: 'hidden' }}>
          <span role="button" style={{ display: 'block', fontWeight: 700, color: 'var(--text)', cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
            onClick={() => openPlayerCard({ slug: x.slug, name: x.name, pos: x.pos, team: x.school ?? '', leagueId })}>{x.name} <span style={{ ...small, fontWeight: 400 }}>ⓘ</span></span>
          <span className="mono" style={{ display: 'block', fontSize: 9.5, color: 'var(--faint)' }}>
            {[x.school, x.fcs ? 'FCS' : null, x.class_year ? collegeClassLabel(x.class_year) : null, x.sh_rank ? `devy #${x.sh_rank}` : null].filter(Boolean).join(' · ')}</span>
        </span>
        <span className="mono" style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)', textAlign: 'right' }}>{open ? fmtPts(price) : ''}</span>
        {open && myRoster != null ? (
          <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            {btn('−', cur - 1)}
            <span className="mono" style={{ width: 22, textAlign: 'center', fontWeight: 700, color: cur ? 'var(--you)' : 'var(--faint)' }}>{cur}</span>
            {btn('+', cur + 1)}{btn('max', mx, cur === mx && mx > 0)}
          </span>
        ) : <span style={{ ...small, fontSize: 10 }}>{open ? '' : 'lists soon'}</span>}
      </div>
    );
  };
  const rules = { budget: 100, max: 20, floor: 5, cash_cap: 200, payout_cap: 3, max_spend: 60, min_spend: 15, refund: 0.5, ...(st.rules ?? {}) };
  const book = teamBook(st, myRoster);
  const mine = (st.players ?? []).filter((p) => myStake(p, myRoster) > 0);
  const locked = !!st.locked || st.current === false;

  const set = async (slug: string, n: number): Promise<boolean> => {
    if (myRoster == null || busy) return false;
    setBusy(true); setMsg(null);
    try {
      const r = await allotDevyShares(leagueId, myRoster, slug, Math.max(0, Math.min(rules.max, n)));
      if (!r.ok) { setMsg(`✗ ${friendlyError(r.error ?? 'failed')}`); return false; }
      setMsg(r.spent ? `✓ bought at ${fmtPts(Number(r.price))} a share: −${fmtPts(Number(r.spent))}` : r.received ? `✓ sold at ${fmtPts(Number(r.price))} a share: +${fmtPts(Number(r.received))}` : null);
      await load();
      return true;
    } catch (e) { setMsg(`✗ ${friendlyError(e)}`); return false; }
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
  /** INVEST (v0.576.0 → v0.579.0): price, the TO MAX bar, YOUR shares, an
   *  owners chip (who holds him, in a pop-up) and BUY, which opens the
   *  purchase sheet. */
  const COLS = '24px minmax(0,1fr) 54px 64px 36px 44px 52px';
  const investRow = (l: MarketLine) => {
    const r = l.row;
    const pct = (x: number) => `${Math.round(x * 100)}%`;
    return (
      <div key={r.slug} style={{ display: 'grid', gridTemplateColumns: COLS, gap: 8, alignItems: 'center', borderBottom: '1px solid var(--bd)', padding: '5px 0' }}>
        <span className="mono" style={{ fontSize: 10, fontWeight: 700, color: 'var(--dim)' }}>{r.pos}</span>
        <span style={{ minWidth: 0, overflow: 'hidden' }}>
          <span role="button" title="Player card" style={{ display: 'block', fontWeight: 700, color: 'var(--text)', cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
            onClick={() => openPlayerCard({ slug: r.slug, name: r.name, pos: r.pos, team: r.school ?? '', leagueId })}>{l.right?.mine ? '★ ' : ''}{r.name} <span style={{ ...small, fontWeight: 400 }}>ⓘ</span></span>
          <span className="mono" style={{ display: 'block', fontSize: 9.5, color: 'var(--faint)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{marketSubline(r)}</span>
        </span>
        <span className="mono" style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)', textAlign: 'right' }}>{fmtPts(l.price)}</span>
        <span title={l.lead >= 1 ? 'A stake is maxed — his right is owned' : `The leading stake is ${pct(l.lead)} of the way to maxing`}>
          <span style={{ display: 'block', position: 'relative', height: 6, borderRadius: 3, background: 'var(--bd)', overflow: 'hidden' }}>
            <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: pct(l.lead), background: l.leadMine ? 'var(--you)' : l.right ? 'var(--opp)' : 'var(--dim)' }} />
            {!l.leadMine && l.myProgress > 0 && <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: pct(l.myProgress), background: 'var(--you)' }} />}
          </span>
          <span className="mono" style={{ display: 'block', textAlign: 'center', fontSize: 9, color: l.lead >= 1 ? (l.leadMine ? 'var(--you)' : 'var(--opp)') : 'var(--faint)' }}>{l.lead >= 1 ? 'OWNED' : pct(l.lead)}</span>
        </span>
        <span className="mono" style={{ textAlign: 'center', fontSize: 11.5, fontWeight: 700, color: l.mine ? 'var(--you)' : 'var(--faint)' }}>{l.mine || '—'}</span>
        <button style={{ ...chip(false), padding: '2px 0' }} disabled={!l.owners.length} onClick={() => setOpenOwners(r.slug)} title="Who holds shares in him">
          {l.owners.length ? `👥${l.owners.length}` : '—'}</button>
        {myRoster != null
          ? <button style={{ ...chip(true), padding: '3px 0', fontWeight: 800 }} disabled={locked} onClick={() => setTrade({ slug: r.slug, mode: 'buy', n: 1 })}>BUY</button>
          : <span />}
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
          <span className="mono" style={{ fontWeight: 700, color: 'var(--you)' }}>{fmtPts(price)}/sh</span>
        </div>
        {mineH && <div className="mono" style={{ fontSize: 11.5, fontWeight: 700, color: Number(mineH.value) >= Number(mineH.cost) ? 'var(--you)' : 'var(--opp)' }}>YOU: {cur} shares · {stakeLine(mineH.cost, mineH.value)}</div>}
        <div className="mono" style={{ fontSize: 11, color: yours ? 'var(--you)' : 'var(--dim)', marginTop: 2 }}>{rightLine(p, myRoster, rules.floor, rules.max, rules.min_spend)}</div>
        <div className="mono" style={{ fontSize: 10.5, color: 'var(--faint)' }}>{p.holders.map((h) => `${h.team} ${h.shares}`).join(' · ')}</div>
        {p.active === false && !p.graduated_to && <div className="mono" style={{ fontSize: 10.5, color: 'var(--warn, #c66)' }}>LEFT COLLEGE — sell at his last price, or if he isn't drafted, {Math.round(rules.refund * 100)}% of what was paid comes back at the rookie draft</div>}
        {edit && myRoster != null && !p.graduated_to && controls(p.slug, cur, price, Number(mineH?.cost ?? 0), !!mineH?.maxed, p.active !== false)}
      </div>
    );
  };
  const head = (label: string, key: MarketSort | null, align: 'left' | 'center' | 'right' = 'center') => {
    const on = key != null && sort.key === key;
    return (
      <span key={label} className="mono" role={key ? 'button' : undefined} onClick={() => { if (key) setSort((c) => nextSort(c, key)); }}
        style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.06em', color: on ? 'var(--you)' : 'var(--faint)', textAlign: align, cursor: key ? 'pointer' : 'default', userSelect: 'none' }}>
        {label}{on ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
      </span>
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
      {/* v0.577.0: INVEST on the left, MINE and LEAGUE on the right. */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
        <button style={chip(view === 'add')} onClick={() => setView('add')}>INVEST</button>
        <span style={{ flex: 1 }} />
        <button style={chip(view === 'mine')} onClick={() => setView('mine')}>MINE ({mine.length})</button>
        <button style={chip(view === 'league')} onClick={() => setView('league')}>LEAGUE ({st.players?.length ?? 0})</button>
      </div>
      {msg && <div className="mono" style={{ fontSize: 11, color: msg.startsWith('✗') ? 'var(--opp)' : 'var(--you)' }}>{msg}</div>}
      {view === 'mine' && (mine.length ? mine.map((p) => row(p, true)) : <div style={small}>No shares yet. Use INVEST to find a college player before everyone else does.</div>)}
      {view === 'league' && ((st.players ?? []).length ? (st.players ?? []).map((p) => row(p, false)) : <div style={small}>Nobody in the league has bought shares yet.</div>)}
      {view === 'add' && (<>
        {banner && (
          <div style={{ border: `1px solid ${banner.tone === 'open' ? 'var(--you)' : 'var(--bd)'}`, borderRadius: 8, padding: 10, margin: '6px 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="mono" style={{ flex: 1, fontSize: 11, fontWeight: 700, color: banner.tone === 'open' ? 'var(--you)' : 'var(--text)' }}>{banner.title}</span>
              <button className="mono" title={launchRulesText(ls?.cfg)} onClick={() => window.alert(launchRulesText(ls?.cfg))}
                style={{ background: 'none', border: '1px solid var(--bd)', borderRadius: 10, width: 20, height: 20, fontSize: 11, color: 'var(--dim)', cursor: 'pointer', padding: 0 }}>ⓘ</button>
            </div>
            <div style={{ ...small, fontSize: 10.5, margin: '4px 0 6px' }}>{banner.sub}</div>
            <button style={chip(launchView)} onClick={() => setLaunchView((v) => !v)}>
              {launchView ? 'back to the market' : banner.tone === 'open' ? `order${myOrders.length ? ` (${myOrders.length} placed)` : ''}` : 'preview'}</button>
          </div>
        )}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search any college QB, RB, WR, TE or school…"
          style={{ width: '100%', boxSizing: 'border-box', padding: '6px 9px', border: '1px solid var(--bd)', borderRadius: 6, background: 'var(--bg)', color: 'var(--text)' }} />
        {!market && <div style={small}>Loading the market…</div>}
        {market && market.length === 0 && !deep && <div style={small}>No prices yet: they appear after the first weekly stats update.</div>}
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', margin: '6px 0' }}>
          {MARKET_FILTERS.map((f) => <button key={f.id} style={chip(filter === f.id)} onClick={() => setFilter(f.id)}>{f.label}</button>)}
        </div>
        {launchView && banner ? (<>
          {launchPlayers.length === 0 && <div style={small}>Nobody in this launch matches that.</div>}
          {launchPlayers.slice(0, 150).map((x) => launchRow(x))}
          {banner.tone === 'open' && <div style={{ ...small, fontSize: 10, marginTop: 4 }}>Orders are sealed: nobody sees yours. Price is the opening price.</div>}
        </>) : (<>
        {deep && deep.length === 0 && <div style={small}>No college QB, RB, WR or TE matches that.</div>}
        {addList.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 8, padding: '4px 0', borderBottom: '1px solid var(--bd)' }}>
            <span />{head('PLAYER', 'name', 'left')}{head('PRICE', 'price', 'right')}{head('TO MAX', 'lead')}{head('YOU', 'mine')}{head('OWN', 'owners')}<span />
          </div>
        )}
        {market && addList.length === 0 && !(deep && deep.length === 0) && <div style={small}>Nobody matches that filter.</div>}
        {addList.map((l) => investRow(l))}
        </>)}
      </>)}
      {popups()}
    </div>
  );

  /** Who owns him, and the purchase sheet (v0.579.0). */
  function popups() {
    const ownLine = openOwners ? addList.find((l) => l.row.slug === openOwners) ?? null : null;
    const tl = trade ? addList.find((l) => l.row.slug === trade.slug) ?? null : null;
    const tMine = tl?.held?.holders.find((h) => h.roster_id === myRoster);
    const tp = tl && trade ? tradePreview({ mode: trade.mode, n: trade.n, cur: tl.mine, cost: Number(tMine?.cost ?? 0), price: tl.price, cash: book.cash, rules }) : null;
    const ownersList = (l: MarketLine) => (
      <div>
        {l.owners.length === 0 && <div style={small}>Nobody holds shares in him yet.</div>}
        {l.owners.map((o) => (
          <div key={o.roster_id} className="mono" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 54px 72px 44px', gap: 8, fontSize: 11.5, padding: '2px 0',
            color: o.mine ? 'var(--you)' : 'var(--text)', fontWeight: o.right ? 700 : 400 }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.right ? '★ ' : ''}{o.team}</span>
            <span style={{ textAlign: 'right' }}>{o.shares} sh</span>
            <span style={{ textAlign: 'right' }}>{fmtPts(o.cost)} in</span>
            <span style={{ textAlign: 'right', color: o.progress >= 1 ? 'var(--opp)' : 'var(--faint)' }}>{Math.round(o.progress * 100)}%</span>
          </div>
        ))}
        <div style={{ ...small, fontSize: 10, marginTop: 4 }}>% = how close a stake is to maxing ({rules.max} shares or {rules.max_spend} points). First to 100% holds his right.</div>
      </div>
    );
    const box: React.CSSProperties = { width: 'min(420px, 92vw)', background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 8, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 };
    const stat = (k: string, v: string, color = 'var(--text)') => (
      <div style={{ flex: 1, textAlign: 'center' }}>
        <div className="mono" style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.12em', color: 'var(--faint)' }}>{k}</div>
        <div className="mono" style={{ fontSize: 15, fontWeight: 800, color, marginTop: 2 }}>{v}</div>
      </div>
    );
    return (<>
      {ownLine && (
        <ModalBackdrop onClick={() => setOpenOwners(null)} zIndex={95}>
          <div onClick={(e) => e.stopPropagation()} style={box}>
            <div className="grotesk" style={{ fontSize: 16, fontWeight: 700 }}>{ownLine.row.name} · owners</div>
            {ownersList(ownLine)}
          </div>
        </ModalBackdrop>
      )}
      {tl && trade && tp && (
        <ModalBackdrop onClick={() => setTrade(null)} zIndex={95}>
          <div onClick={(e) => e.stopPropagation()} style={box}>
            <div>
              <div className="grotesk" style={{ fontSize: 17, fontWeight: 700 }}>{tl.row.name}</div>
              <div className="mono" style={{ fontSize: 10, color: 'var(--faint)' }}>{tl.row.pos} · {marketSubline(tl.row)}</div>
            </div>
            <div style={{ display: 'flex', borderTop: '1px solid var(--bd)', borderBottom: '1px solid var(--bd)', padding: '8px 0' }}>
              {stat('PRICE', fmtPts(tl.price))}
              {stat('YOU HOLD', `${tl.mine} sh`, tl.mine ? 'var(--you)' : 'var(--text)')}
              {stat('CASH', fmtPts(book.cash))}
              {stat('LEADER', tl.lead >= 1 ? 'OWNED' : `${Math.round(tl.lead * 100)}%`, tl.leadMine ? 'var(--you)' : tl.right ? 'var(--opp)' : 'var(--text)')}
            </div>
            {tl.mine > 0 && (
              <div style={{ display: 'flex', gap: 6 }}>
                <button style={chip(trade.mode === 'buy')} onClick={() => setTrade({ ...trade, mode: 'buy', n: 1 })}>BUY</button>
                <button style={chip(trade.mode === 'sell')} onClick={() => setTrade({ ...trade, mode: 'sell', n: 1 })}>SELL</button>
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'center' }}>
              <button style={chip(false)} disabled={trade.n <= 1} onClick={() => setTrade({ ...trade, n: Math.max(1, trade.n - 1) })}>−</button>
              <span className="mono" style={{ minWidth: 70, textAlign: 'center', fontSize: 26, fontWeight: 800 }}>{tp.n}</span>
              <button style={chip(false)} disabled={tp.n >= (trade.mode === 'buy' ? Math.max(1, maxBuy(tl.mine, Number(tMine?.cost ?? 0), tl.price, rules.max, rules.max_spend)) : tl.mine)}
                onClick={() => setTrade({ ...trade, n: tp.n + 1 })}>+</button>
            </div>
            <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
              {[1, 5, 10].map((k) => <button key={k} style={chip(tp.n === k)} onClick={() => setTrade({ ...trade, n: k })}>{k}</button>)}
              {trade.mode === 'buy'
                ? <button style={chip(false)} disabled={tp.maxN < 1} onClick={() => setTrade({ ...trade, n: Math.max(1, tp.maxN) })}>max {tp.maxN}</button>
                : <button style={chip(false)} onClick={() => setTrade({ ...trade, n: tl.mine })}>all {tl.mine}</button>}
            </div>
            <div className="mono" style={{ border: '1px solid var(--bd)', borderRadius: 8, padding: 10, fontSize: 11, lineHeight: 1.6 }}>
              <div style={{ fontWeight: 700 }}>{trade.mode === 'buy' ? `Cost ${fmtPts(tp.amount)} · cash after ${fmtPts(tp.cashAfter)}` : `You get ${fmtPts(tp.amount)} · cash after ${fmtPts(tp.cashAfter)}`}</div>
              <div style={{ color: 'var(--dim)' }}>Your stake: {tl.mine} → {tp.sharesAfter} sh · {fmtPts(tp.costAfter)} in · {Math.round(tp.progressAfter * 100)}% to max</div>
              {tp.maxes && <div style={{ color: 'var(--you)', fontWeight: 700 }}>{tl.right && !tl.right.mine ? `★ This maxes your stake — but ${tl.right.team} already holds his right.` : '★ This maxes your stake. First to max holds his right.'}</div>}
              {tp.capped && <div style={{ color: 'var(--warn)' }}>Paid at the {rules.payout_cap}× cap on what you put in, not today's full price.</div>}
              {tp.why && <div style={{ color: 'var(--opp)' }}>{tp.why}</div>}
              {msg && msg.startsWith('✗') && <div style={{ color: 'var(--opp)' }}>{msg}</div>}
            </div>
            <button className="mono" disabled={busy || !tp.ok || locked}
              onClick={() => { void set(tl.row.slug, trade.mode === 'buy' ? tl.mine + tp.n : tl.mine - tp.n).then((ok) => { if (ok) setTrade(null); }); }}
              style={{ ...chip(true), borderRadius: 8, padding: '10px 0', fontSize: 12, fontWeight: 800, opacity: busy || !tp.ok || locked ? 0.5 : 1 }}>
              {busy ? 'WORKING…' : trade.mode === 'buy' ? `BUY ${tp.n} · ${fmtPts(tp.amount)}` : `SELL ${tp.n} · +${fmtPts(tp.amount)}`}</button>
            {locked && <div className="mono" style={{ fontSize: 10.5, color: 'var(--warn)' }}>{lockLine(st)}</div>}
            <div>
              <div className="mono" style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', color: 'var(--faint)', marginBottom: 4 }}>OWNERS</div>
              {ownersList(tl)}
            </div>
          </div>
        </ModalBackdrop>
      )}
    </>);
  }
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
      {on && <DevyLaunchRow leagueId={leagueId} />}
      {!on && <DevyRoundsRow leagueId={leagueId} />}
      {!on && <DevyCustomRow leagueId={leagueId} />}
    </div>
  );
}

/** THE DEVY DRAFT (0411), the commissioner's row: how many devy rounds end
 *  the draft — college players only, their picks traded like rookie picks. */
function DevyRoundsRow({ leagueId }: { leagueId: string }) {
  const [spots, setSpots] = useState<number | null>(null);
  const [n, setN] = useState(0);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    leagueGameMode(leagueId).then((g) => setSpots(g.ok ? g.shape?.devy ?? 0 : 0)).catch(() => setSpots(0));
    draftState(leagueId).then((d) => setN(d.devy_rounds ?? 0)).catch(() => {});
  }, [leagueId]);
  if (!spots) return null;
  const save = async (v: number) => {
    setBusy(true); setNote(null);
    try {
      const r = await setDevyRounds(leagueId, v);
      if (r.ok) { setN(v); setNote(v ? `✓ the draft ends with ${v} devy round${v === 1 ? '' : 's'}` : '✓ no devy rounds — devy spots fill from the wire'); }
      else setNote(`✗ ${friendlyError(r.error ?? 'failed')}`);
    } catch (e) { setNote(`✗ ${friendlyError(e)}`); }
    finally { setBusy(false); }
  };
  return (
    <div style={{ flexBasis: '100%', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 4 }}>
      <span className="mono" style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--dim)' }}
        title="The draft ends with this many DEVY ROUNDS: every pick in them is a college player, and none before them. In a dynasty league with rookie picks, devy picks are assets too — trade them like any pick. In the startup draft the devy rounds fill the devy spots; every year after, they're how teams restock after players turn pro.">DEVY ROUNDS</span>
      {Array.from({ length: Math.min(5, spots) + 1 }, (_, v) => (
        <button key={v} style={chip(n === v)} disabled={busy || n === v} onClick={() => void save(v)}>{v === 0 ? 'off' : v}</button>
      ))}
      {note && <span className="mono" style={{ fontSize: 11, color: note.startsWith('✗') ? 'var(--opp)' : 'var(--you)' }}>{note}</span>}
    </div>
  );
}

/** CUSTOM COLLEGE PLAYERS (0410), the commissioner's row: add a player the
 *  directory doesn't have — a D2 star, a JUCO transfer, a signed recruit —
 *  into this league's pool, where teams claim or draft him like any other. */
function DevyCustomRow({ leagueId }: { leagueId: string }) {
  const [rows, setRows] = useState<CustomCollegeRow[]>([]);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [pos, setPos] = useState('RB');
  const [school, setSchool] = useState('');
  const [cls, setCls] = useState<number | null>(null);
  const [level, setLevel] = useState<string>('D2');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const load = () => leagueCustomCollege(leagueId).then((r) => setRows(Array.isArray(r) ? r : [])).catch(() => {});
  useEffect(() => { void load(); }, [leagueId]);
  const add = async () => {
    setBusy(true); setNote(null);
    try {
      const r = await commishAddCustomCollege(leagueId, { name, pos, school: school || null, cls, level });
      if (r.ok) { setNote(`✓ ${r.name} is in the pool — claim or draft him like anyone else`); setName(''); setSchool(''); setCls(null); await load(); }
      else setNote(`✗ ${friendlyError(r.error ?? 'failed')}`);
    } catch (e) { setNote(`✗ ${friendlyError(e)}`); }
    finally { setBusy(false); }
  };
  const remove = async (slug: string) => {
    setBusy(true); setNote(null);
    try {
      const r = await commishRemoveCustomCollege(leagueId, slug);
      setNote(r.ok ? '✓ removed from the pool' : `✗ ${friendlyError(r.error ?? 'failed')}`);
      if (r.ok) await load();
    } catch (e) { setNote(`✗ ${friendlyError(e)}`); }
    finally { setBusy(false); }
  };
  const input: React.CSSProperties = { padding: '3px 6px', border: '1px solid var(--bd)', borderRadius: 5, background: 'var(--bg)', color: 'var(--text)', fontSize: 12 };
  return (
    <div style={{ flexBasis: '100%', marginTop: 4 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className="mono" style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--dim)' }}
          title="Players the college directory doesn't have — D2, D3, NAIA, JUCO, a recruit. They go into this league's pool only. ESPN has no feed on them, so they score nothing; they're a devy stash until they reach FBS.">CUSTOM PLAYERS</span>
        <span className="mono" style={{ fontSize: 10.5, color: 'var(--faint)' }}>{rows.length ? `${rows.length} added` : 'none'}</span>
        <button style={chip(open)} onClick={() => setOpen(!open)}>{open ? 'close' : '+ add'}</button>
      </div>
      {open && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 6 }}>
          <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} style={{ ...input, width: 140 }} />
          {['QB', 'RB', 'WR', 'TE', 'K'].map((p) => <button key={p} style={chip(pos === p)} onClick={() => setPos(p)}>{p}</button>)}
          <input placeholder="School" value={school} onChange={(e) => setSchool(e.target.value)} style={{ ...input, width: 110 }} />
          {[1, 2, 3, 4].map((c) => <button key={c} style={chip(cls === c)} onClick={() => setCls(cls === c ? null : c)}>{collegeClassLabel(c)}</button>)}
          <select value={level} onChange={(e) => setLevel(e.target.value)} className="mono" style={input}>
            {CUSTOM_COLLEGE_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
          <button style={chip(true)} disabled={busy || name.trim().length < 3} onClick={() => void add()}>ADD</button>
        </div>
      )}
      {open && rows.map((r) => (
        <div key={r.slug} className="mono" style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 11, marginTop: 4 }}>
          <span style={{ fontWeight: 700, color: 'var(--text)' }}>{r.name}</span>
          <span style={{ color: 'var(--dim)' }}>{[r.pos, r.level, r.school, r.class_year ? collegeClassLabel(r.class_year) : null].filter(Boolean).join(' · ')}</span>
          <span style={{ color: 'var(--faint)' }}>{r.roster_id != null ? 'rostered' : 'in the pool'}</span>
          {r.roster_id == null && <button style={{ ...chip(false), color: 'var(--opp)' }} disabled={busy} onClick={() => void remove(r.slug)}>remove</button>}
        </div>
      ))}
      {note && <div className="mono" style={{ fontSize: 11, marginTop: 4, color: note.startsWith('✗') ? 'var(--opp)' : 'var(--you)' }}>{note}</div>}
    </div>
  );
}

/** NEW-PLAYER LAUNCHES (0407), the commissioner's row: on/off, the weekly
 *  slot, the windows, the order cap and LAUNCH NOW. */
function DevyLaunchRow({ leagueId }: { leagueId: string }) {
  const [ls, setLs] = useState<DevyLaunchState | null>(null);
  const [cfg, setCfg] = useState<DevyLaunchCfg | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const load = () => devyLaunchState(leagueId).then((r) => { setLs(r); if (r.cfg) setCfg(r.cfg); }).catch(() => {});
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [leagueId]);
  if (!cfg || !ls?.can_edit) return null;
  const save = async (patch: Partial<DevyLaunchCfg>) => {
    setBusy(true); setNote(null);
    try {
      const r = await setLeagueDevyLaunch(leagueId, patch);
      if (r.ok && r.cfg) { setCfg(r.cfg); setNote('✓ saved'); } else setNote(`✗ ${friendlyError(r.error ?? 'failed')}`);
    } catch (e) { setNote(`✗ ${friendlyError(e)}`); }
    finally { setBusy(false); }
  };
  const now = async () => {
    setBusy(true); setNote(null);
    try {
      const r = await commishDevyLaunchNow(leagueId);
      if (r.ok) { setNote('✓ launch open — the league chat says so'); void load(); } else setNote(`✗ ${friendlyError(r.error ?? 'failed')}`);
    } catch (e) { setNote(`✗ ${friendlyError(e)}`); }
    finally { setBusy(false); }
  };
  const num = (label: string, v: number, lo: number, hi: number, by: number, key: keyof DevyLaunchCfg, show: string) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <span className="mono" style={{ fontSize: 10.5, color: 'var(--dim)' }}>{label}</span>
      <button style={chip(false)} disabled={busy || v - by < lo} onClick={() => void save({ [key]: v - by } as Partial<DevyLaunchCfg>)}>−</button>
      <span className="mono" style={{ minWidth: 52, textAlign: 'center', fontSize: 11, fontWeight: 700 }}>{show}</span>
      <button style={chip(false)} disabled={busy || v + by > hi} onClick={() => void save({ [key]: v + by } as Partial<DevyLaunchCfg>)}>+</button>
    </span>
  );
  return (
    <div style={{ flexBasis: '100%', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 6, paddingTop: 6, borderTop: '1px solid var(--bd)' }}>
      <span className="mono" style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--dim)' }} title={launchRulesText(cfg)}>NEW-PLAYER LAUNCHES ⓘ</span>
      <button style={chip(cfg.on)} disabled={busy || cfg.on} onClick={() => void save({ on: true })}>on</button>
      <button style={chip(!cfg.on)} disabled={busy || !cfg.on} onClick={() => void save({ on: false })}>off</button>
      {cfg.on && <>
        <span style={{ display: 'inline-flex', gap: 3 }}>
          {DOW_LABELS.map((d, i) => <button key={d} style={chip(cfg.dow === i)} disabled={busy} onClick={() => void save({ dow: i })}>{d.toLowerCase()}</button>)}
        </span>
        {num('hour', cfg.hour, 0, 23, 1, 'hour', slotLabel({ dow: cfg.dow, hour: cfg.hour }).split(' ').slice(1).join(' '))}
        {num('window', cfg.window_h, 12, 336, 12, 'window_h', `${cfg.window_h}h`)}
        {num('catch-up', cfg.catchup_h, 24, 720, 24, 'catchup_h', `${cfg.catchup_h / 24} days`)}
        {num('order cap', cfg.cap, 1, 20, 1, 'cap', `${cfg.cap} sh`)}
        <button style={chip(false)} disabled={busy || !!ls.open || !ls.pending_count || !!ls.locked} onClick={() => void now()}>launch now</button>
        <span className="mono" style={{ fontSize: 10.5, color: 'var(--faint)' }}>
          {ls.open ? 'a launch is open' : ls.locked ? 'market locked — a catch-up opens when it reopens' : `${ls.pending_count ?? 0} waiting · next ${slotLabel(cfg)}`}</span>
      </>}
      {!cfg.on && <span style={{ ...small, fontSize: 10.5 }}>off: new college players are buyable the moment they appear</span>}
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
