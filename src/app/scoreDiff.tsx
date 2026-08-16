// ⚖ SCORE DIFF (0200.2, task #57) — the per-window instrument for the 8/15
// finding that the same matchup read 89.2/36.8 in the app (server matchup_state,
// the OFFICIAL score) and 62.3/34.1 on the web (client preview). Lays the
// client engine's settled per-slot banks beside the worker's published numbers
// so the diverging window/slot names itself instead of being argued about.
//
// Reading it:
//   · CLIENT = this board's engine, each slot's bank at its events' end
//     (no window bonuses — slot accounting only).
//   · SERVER = matchup_state.slot_scores (also bonus-free), plus the window
//     score itself, which DOES bake in the +5 window-win bonus — so
//     "server win − server slots" isolating to ~5 is the bonus, not a bug.
//   · A red Δ on a slot row is a real accounting divergence. A row one side
//     fields and the other doesn't ("—") is a KNOWLEDGE divergence — e.g. the
//     header-total rule skipping unopposed slots, or a seat the client can't
//     attribute.
// Collapsed by default; polls the server copy every 30s while open.
import { useEffect, useMemo, useState } from 'react';
import { getMatchup, getMatchupState, type WindowScore } from '@drip/core/data/liveApi';
import { banksAtClock, type buildMatchup } from '@drip/core/engine/matchup';

const num = (v: unknown) => Math.round((Number(v) || 0) * 10) / 10;
const SETTLED = 100_000; // clock far past any event → the slot's settled bank

interface SlotRow { slug: string; client: number | null; server: number | null }

export function ScoreDiffPanel({ matchupId, rosterId, windows }: {
  matchupId: string;
  rosterId: number;
  windows: ReturnType<typeof buildMatchup>['windows'];
}) {
  const [open, setOpen] = useState(false);
  const [states, setStates] = useState<WindowScore[] | null>(null);
  const [youAreHome, setYouAreHome] = useState<boolean | null>(null);

  useEffect(() => {
    if (!open) return;
    let dead = false;
    getMatchup(matchupId).then((m) => { if (m && !dead) setYouAreHome(m.home_roster_id === rosterId); }).catch(() => {});
    const load = () => { getMatchupState(matchupId).then((s) => { if (!dead) setStates(s); }).catch(() => {}); };
    load();
    const t = setInterval(load, 30_000);
    return () => { dead = true; clearInterval(t); };
  }, [open, matchupId, rosterId]);

  const rows = useMemo(() => {
    if (!states || youAreHome == null) return null;
    const meSide = youAreHome ? 'home' : 'away';
    const out: {
      win: string; you: SlotRow[]; them: SlotRow[];
      clientYou: number; clientThem: number;
      serverYouSlots: number; serverThemSlots: number;
      serverYouWin: number; serverThemWin: number;
    }[] = [];
    const winIds = new Set<string>([...windows.map((w) => w.window.id), ...states.map((s) => s.game_window)]);
    for (const win of winIds) {
      const rw = windows.find((w) => w.window.id === win);
      const st = states.find((s) => s.game_window === win);
      const sideRows = (mine: boolean): SlotRow[] => {
        const bySlug = new Map<string, SlotRow>();
        for (const s of rw?.slots ?? []) {
          const half = mine ? s.you : s.their;
          if (!half) continue;
          const bank = banksAtClock(s.events, SETTLED);
          const v = num(mine ? bank.you : bank.their);
          const cur = bySlug.get(half.player.id);
          bySlug.set(half.player.id, { slug: half.player.id, client: (cur?.client ?? 0) + v, server: cur?.server ?? null });
        }
        const srvSide = mine === (meSide === 'home') ? 'home' : 'away';
        for (const r of st?.slot_scores ?? []) {
          if (r.side !== srvSide || !r.slug) continue;
          const cur = bySlug.get(r.slug);
          bySlug.set(r.slug, { slug: r.slug, client: cur?.client ?? null, server: (cur?.server ?? 0) + num(r.score) });
        }
        return [...bySlug.values()].sort((a, b) => Math.abs((b.client ?? 0) - (b.server ?? 0)) - Math.abs((a.client ?? 0) - (a.server ?? 0)));
      };
      const you = sideRows(true), them = sideRows(false);
      const sum = (rs: SlotRow[], k: 'client' | 'server') => num(rs.reduce((n, r) => n + (r[k] ?? 0), 0));
      out.push({
        win,
        you, them,
        clientYou: sum(you, 'client'), clientThem: sum(them, 'client'),
        serverYouSlots: sum(you, 'server'), serverThemSlots: sum(them, 'server'),
        serverYouWin: num(meSide === 'home' ? st?.home_score : st?.away_score),
        serverThemWin: num(meSide === 'home' ? st?.away_score : st?.home_score),
      });
    }
    return out.sort((a, b) => a.win.localeCompare(b.win));
  }, [states, youAreHome, windows]);

  const grand = useMemo(() => {
    if (!rows) return null;
    const t = { cy: 0, ct: 0, sy: 0, st: 0, wy: 0, wt: 0 };
    for (const r of rows) { t.cy += r.clientYou; t.ct += r.clientThem; t.sy += r.serverYouSlots; t.st += r.serverThemSlots; t.wy += r.serverYouWin; t.wt += r.serverThemWin; }
    return { cy: num(t.cy), ct: num(t.ct), sy: num(t.sy), st: num(t.st), wy: num(t.wy), wt: num(t.wt) };
  }, [rows]);

  const d = (a: number | null, b: number | null) => num((a ?? 0) - (b ?? 0));
  const tone = (delta: number) => (Math.abs(delta) > 0.05 ? 'var(--opp)' : 'var(--dim)');
  const cell: React.CSSProperties = { padding: '2px 7px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' };

  return (
    <div style={{ margin: '10px 0', border: '1px dashed var(--bd)', borderRadius: 6 }}>
      <button onClick={() => setOpen((v) => !v)} className="mono"
        style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: '7px 11px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: 'var(--faint)', fontSize: 9, fontWeight: 700, letterSpacing: '0.1em' }}>
        <span>⚖ SCORE DIFF · client engine vs server</span>
        <span>{grand ? `Δ you ${d(grand.cy, grand.sy) >= 0 ? '+' : ''}${d(grand.cy, grand.sy)} · opp ${d(grand.ct, grand.st) >= 0 ? '+' : ''}${d(grand.ct, grand.st)}` : ''} {open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="mono" style={{ padding: '0 11px 10px', fontSize: 10, overflowX: 'auto' }}>
          {!rows && <div style={{ color: 'var(--faint)' }}>loading server state…</div>}
          {rows?.map((r) => {
            const dy = d(r.clientYou, r.serverYouSlots), dt = d(r.clientThem, r.serverThemSlots);
            return (
              <div key={r.win} style={{ margin: '7px 0', borderTop: '1px solid var(--bd)', paddingTop: 6 }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <b style={{ letterSpacing: '0.08em' }}>{r.win.toUpperCase()}</b>
                  <span>client {r.clientYou}–{r.clientThem}</span>
                  <span>server slots {r.serverYouSlots}–{r.serverThemSlots}</span>
                  <span style={{ color: 'var(--faint)' }}>server win {r.serverYouWin}–{r.serverThemWin}</span>
                  <span style={{ color: tone(Math.abs(dy) + Math.abs(dt)) }}>Δ {dy >= 0 ? '+' : ''}{dy} / {dt >= 0 ? '+' : ''}{dt}</span>
                </div>
                {(Math.abs(dy) > 0.05 || Math.abs(dt) > 0.05) && (
                  <table style={{ marginTop: 4, borderCollapse: 'collapse' }}>
                    <tbody>
                      {[...r.you.map((s) => ({ ...s, side: 'you' })), ...r.them.map((s) => ({ ...s, side: 'opp' }))]
                        .filter((s) => Math.abs(d(s.client, s.server)) > 0.05 || s.client == null || s.server == null)
                        .map((s, i) => (
                          <tr key={`${s.side}-${s.slug}-${i}`} style={{ color: tone(d(s.client, s.server)) }}>
                            <td style={{ ...cell, textAlign: 'left', color: 'var(--faint)' }}>{s.side}</td>
                            <td style={{ ...cell, textAlign: 'left' }}>{s.slug}</td>
                            <td style={cell}>{s.client ?? '—'}</td>
                            <td style={cell}>{s.server ?? '—'}</td>
                            <td style={cell}>Δ {d(s.client, s.server)}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                )}
              </div>
            );
          })}
          {grand && (
            <div style={{ marginTop: 7, borderTop: '1px solid var(--bd)', paddingTop: 6, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <b>TOTAL</b>
              <span>client {grand.cy}–{grand.ct}</span>
              <span>server slots {grand.sy}–{grand.st}</span>
              <span style={{ color: 'var(--faint)' }}>server official {grand.wy}–{grand.wt}</span>
            </div>
          )}
          <div style={{ marginTop: 5, color: 'var(--faint)', fontSize: 8.5, lineHeight: 1.5 }}>
            client = this board's engine, slots settled at their events' end · server slots = matchup_state.slot_scores ·
            server win/official includes the +5 window bonuses · a "—" means only one engine fields that slot · refreshes every 30s while open
          </div>
        </div>
      )}
    </div>
  );
}
