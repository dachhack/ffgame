// The two-column play log — your player's plays on the left, theirs on the
// right, the clock down the middle, cumulative totals on the outer edges.
//
// Ported from the web's TwoColLog (Matchup.tsx). The shape is the point: a
// duel reads as two tickers running against each other, and the running bank at
// each edge is what turns a list of plays into a scoreboard you can follow
// without adding anything up yourself.
//
// Dropped from the web version, deliberately, because they are desktop
// affordances that a phone either can't use or already has: the single-line
// nowrap desktop row (a phone wraps), the bigText scaling (RN honours the OS
// font-size setting itself), and the sticky auto-scroll (the web log lives in a
// fixed-height scroller; here the log sits in the page's own scroll, so there
// is nothing to stick to).
//
// KEPT because they carry meaning: the per-minute drip ticks are hidden by
// default and revealed by the MINUTES toggle — they are how a metric accrues
// between plays, and showing them always would bury the plays. Newest-first is
// a toggle for the same reason it is on the web: watching live you want the
// bottom, reviewing afterwards you want the top.
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { PbpEvent, EffectType } from '@drip/core/types';
import { gamesInWindow } from '@drip/core/data/nflSlate';
import { gameFeedFor, type TeamGameFeed } from '@drip/core/data/gameFeed';
import { useTheme, MONO, type Theme, type FxKey } from '../theme.native';
import { Mono } from './prims';
import { Overlay } from './Overlay';

/** Strips the team prefix the engine puts on a play string ("KC: 12 yd rush"). */
const actionText = (play: string): string => play.replace(/^[A-Z]{2,3}( D| TD)?:\s*/, '');

const fmtClock = (c: number): string => `${Math.floor(c / 60)}:${String(Math.floor(c % 60)).padStart(2, '0')}`;

/** Effect badge colour. `EffectType` carries one member the theme has no token
 *  for — `cold` — which the web paints with the `stop` colour; same here, so a
 *  STREAK COLD badge doesn't silently fall through to plain grey. */
const fxColor = (t: Theme, type: EffectType): string =>
  t.fx[(type === 'cold' ? 'stop' : type) as FxKey] ?? t.dim;

export function PlayLog({ events, gameLabel, realOf, youName, theirName }: {
  events: PbpEvent[];
  /** e.g. "KC · DAL" — which games these plays come from. */
  gameLabel?: string;
  /** Wall-clock label for an event, when the caller can supply one. */
  realOf?: (ev: PbpEvent) => string;
  youName?: string;
  theirName?: string;
}) {
  const t = useTheme();
  const [minutes, setMinutes] = useState(false);
  const [newestTop, setNewestTop] = useState(false);
  const [detail, setDetail] = useState<PbpEvent | null>(null);

  const rows = useMemo(() => {
    const filtered = minutes ? events : events.filter((e) => !e.drip);
    // Same caps as the web: enough history to scroll back through, bounded so a
    // full game's minute ticks don't build a list nobody scrolls.
    const slice = filtered.slice(minutes ? -220 : -90);
    return newestTop ? [...slice].reverse() : slice;
  }, [events, minutes, newestTop]);

  if (!events.length) return null;

  const toggle = (on: boolean, label: string, onPress: () => void) => (
    <Pressable
      onPress={onPress}
      style={{
        paddingHorizontal: 9, paddingVertical: 4, borderRadius: 5,
        backgroundColor: on ? t.you : t.surface,
        borderWidth: StyleSheet.hairlineWidth, borderColor: on ? t.you : t.bd,
      }}
    >
      <Text style={{ fontFamily: MONO, fontSize: 9, fontWeight: '700', letterSpacing: 0.5, color: on ? t.onAccent : t.dim }}>{label}</Text>
    </Pressable>
  );

  return (
    <View style={{ marginTop: 8 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6, marginBottom: 6 }}>
        {toggle(!minutes, 'PLAYS', () => setMinutes(false))}
        {toggle(minutes, 'MINUTES', () => setMinutes(true))}
        {toggle(newestTop, newestTop ? 'NEWEST ↑' : 'NEWEST ↓', () => setNewestTop((v) => !v))}
      </View>

      <View style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 6, overflow: 'hidden' }}>
        {rows.map((ev, i) => (
          <Row key={`${ev.clock}-${i}`} ev={ev} realOf={realOf} onPress={() => setDetail(ev)} last={i === rows.length - 1} />
        ))}
      </View>

      {/* Reconciliation line (0192.1): drip earns between plays (buffs ride
          the ticks), so PLAYS mode's edges end short of the card. This is the
          bank NOW, from the unfiltered tail — it always matches the card. */}
      {events.length > 0 && (() => {
        const last = events[events.length - 1];
        const lastShown = rows.length ? (newestTop ? rows[0] : rows[rows.length - 1]) : null;
        const gap = !minutes && lastShown != null
          && (last.youBank - lastShown.youBank > 0.05 || last.theirBank - lastShown.theirBank > 0.05);
        return (
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 5, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: t.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 5 }}>
            <Text style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: '700', color: t.you }}>{last.youBank.toFixed(1)}</Text>
            <Text style={{ flex: 1, fontFamily: MONO, fontSize: 8, letterSpacing: 0.8, color: t.faint, textAlign: 'center' }}>
              ◈ BANK NOW{gap ? ' · DRIP EARNS BETWEEN PLAYS — SEE MINUTES' : ''}
            </Text>
            <Text style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: '700', color: t.opp }}>{last.theirBank.toFixed(1)}</Text>
          </View>
        );
      })()}
      <Mono size={7.5} tone="faint" track={0.12} style={{ textAlign: 'center', marginTop: 6 }}>
        CUMULATIVE TOTALS ON THE EDGES · {minutes ? 'MINUTE-BY-MINUTE DRIP' : 'PLAYS'} · GAME CLOCK ORDER
        {gameLabel ? ` · ${gameLabel.toUpperCase()}` : ''} · TAP A PLAY FOR DETAILS
      </Mono>

      <Overlay
        visible={!!detail}
        title={detail ? actionText(detail.play) : ''}
        subtitle={detail ? `${fmtClock(detail.clock)}${realOf && detail ? ` · ${realOf(detail)}` : ''} · ${detail.side === 'you' ? (youName ?? 'YOU') : (theirName ?? 'THEM')}` : undefined}
        onClose={() => setDetail(null)}
      >
        <ScrollView contentContainerStyle={{ padding: 16, gap: 10 }}>
          {!!detail && (
            <>
              {detail.delta > 0 && (
                <Text style={{ fontSize: 15, fontWeight: '800', color: detail.side === 'you' ? t.you : t.opp }}>
                  +{detail.delta.toFixed(1)}
                </Text>
              )}
              {!!detail.mult && <Mono size={11} weight="700" style={{ color: t.fx.mult }}>×{detail.mult.toFixed(2)} multiplier in effect</Mono>}
              {!!detail.effect && <Mono size={11} weight="700" style={{ color: fxColor(t, detail.effect.type) }}>{detail.effect.text}</Mono>}
              {!!detail.buffNote && <Mono size={11} weight="700" tone="warn">⚡ {detail.buffNote}</Mono>}
              {!!detail.coin && <Mono size={11} weight="700" tone="warn">◆ {(detail.coinAmt ?? 0) || 'event of note'} — earns drip coin</Mono>}
              <View style={{ height: 1, backgroundColor: t.bd, marginVertical: 4 }} />
              <Mono size={10} tone="dim">
                Running totals after this play — you {detail.youBank.toFixed(1)} · them {detail.theirBank.toFixed(1)}
              </Mono>
            </>
          )}
        </ScrollView>
      </Overlay>
    </View>
  );
}

function Row({ ev, realOf, onPress, last }: {
  ev: PbpEvent; realOf?: (ev: PbpEvent) => string; onPress: () => void; last: boolean;
}) {
  const t = useTheme();
  const mine = ev.side === 'you';
  const accent = mine ? t.you : t.opp;

  const badges = (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5, justifyContent: mine ? 'flex-end' : 'flex-start' }}>
      {ev.delta > 0 && <Text style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: '700', color: accent }}>+{ev.delta.toFixed(1)}</Text>}
      {/* Suppressed when a 'mult' effect badge already carries the number. */}
      {!!ev.mult && ev.effect?.type !== 'mult' && (
        <Text style={{ fontFamily: MONO, fontSize: 8.5, fontWeight: '700', color: t.fx.mult }}>×{ev.mult.toFixed(2)}</Text>
      )}
      {!!ev.effect && (
        <Text style={{ fontFamily: MONO, fontSize: 8, fontWeight: '700', color: fxColor(t, ev.effect.type) }}>{ev.effect.text}</Text>
      )}
      {!!ev.buffNote && <Text style={{ fontFamily: MONO, fontSize: 8, fontWeight: '700', color: t.warn }}>⚡ {ev.buffNote}</Text>}
    </View>
  );

  const action = (
    <View style={{ flex: 1, minWidth: 0, opacity: ev.drip ? 0.62 : 1, gap: 2 }}>
      <Text numberOfLines={2} style={{ fontSize: 10.5, color: t.text, textAlign: mine ? 'right' : 'left' }}>{actionText(ev.play)}</Text>
      {badges}
    </View>
  );

  return (
    <Pressable
      onPress={onPress}
      style={{
        flexDirection: 'row', alignItems: 'center', gap: 6,
        paddingHorizontal: 8, paddingVertical: 6,
        borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth, borderBottomColor: t.bd,
        backgroundColor: ev.sig ? t.surface : 'transparent',
      }}
    >
      {/* Outer edges: the running bank for each side, so the duel's state is
          readable straight down the margins. */}
      <Text style={{ fontFamily: MONO, width: 28, fontSize: 9, fontWeight: '700', textAlign: 'left', color: mine ? t.you : t.faint, opacity: 0.85 }}>
        {ev.youBank.toFixed(1)}
      </Text>

      {mine ? action : <View style={{ flex: 1 }} />}

      <View style={{ width: 42, alignItems: 'center' }}>
        <Text style={{ fontFamily: MONO, fontSize: 8.5, color: t.dim }}>{fmtClock(ev.clock)}</Text>
        {!!realOf && <Text style={{ fontFamily: MONO, fontSize: 7.5, color: t.faint }}>{realOf(ev)}</Text>}
      </View>

      {mine ? <View style={{ flex: 1 }} /> : action}

      <Text style={{ fontFamily: MONO, width: 28, fontSize: 9, fontWeight: '700', textAlign: 'right', color: !mine ? t.opp : t.faint, opacity: 0.85 }}>
        {ev.theirBank.toFixed(1)}
      </Text>
    </Pressable>
  );
}


// ── Window game log (live board) ─────────────────────────────────────────────
// The web's WindowGameLog, ported: every ingested play across the window's
// games — the whole game's story, not just the slotted players'. Sourced from
// the worker's game_feed rows (the board already polls them for the fields),
// newest first, scoring plays flagged with the running score. Collapsed by
// default — the founder's first multi-window live night on the web showed the
// expanded log pushing the cards below the fold; the play count ticks on the
// closed header so live is still legible.
export function WindowGameLog({ week, win }: { week: number; win: string }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const feeds = gamesInWindow(week, win as never)
    .map((g) => gameFeedFor(week, g.home))
    .filter((f): f is TeamGameFeed => !!f && f.plays.length > 0);
  // Dedupe by (game, clock, text): ESPN re-emits a play under a fresh id when
  // it restructures a drive; a reader's log must not repeat the line.
  const seenPlay = new Set<string>();
  const rows = feeds
    .flatMap((f) => f.plays.map((p) => ({ f, p })))
    .sort((a, b) => b.p.c - a.p.c)
    .filter(({ f, p }) => {
      const k = `${f.key}|${p.c}|${p.txt}`;
      if (seenPlay.has(k)) return false;
      seenPlay.add(k); return true;
    })
    .slice(0, 250);
  if (!feeds.length) return null;
  const qc = (c: number) => {
    const q = Math.min(5, Math.floor(c / 900) + 1);
    const r = Math.max(0, 900 - (c % 900));
    return `${q > 4 ? 'OT' : `Q${q}`} ${Math.floor(r / 60)}:${String(r % 60).padStart(2, '0')}`;
  };
  return (
    <View style={{ backgroundColor: t.bg, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 5, paddingHorizontal: 10, paddingVertical: 7, marginBottom: 9 }}>
      <Pressable onPress={() => setOpen((o) => !o)}
        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <Text style={{ fontFamily: MONO, fontSize: 8.5, fontWeight: '700', letterSpacing: 0.85, color: t.faint }}>📺 GAME LOG · every play, all games</Text>
        <Text style={{ fontFamily: MONO, fontSize: 8.5, fontWeight: '700', letterSpacing: 0.7, color: t.dim }}>
          {rows.length ? `${rows.length} PLAYS ${open ? '▾' : '▸'}` : ''}
        </Text>
      </Pressable>
      {open && (
        <ScrollView style={{ maxHeight: 220, marginTop: 6 }} nestedScrollEnabled>
          <View style={{ gap: 5, paddingRight: 4 }}>
            {rows.length === 0 && (
              <Mono size={9} tone="faint" track={0.08} style={{ textAlign: 'center', paddingVertical: 8 }}>— waiting on the first snap —</Mono>
            )}
            {rows.map(({ f, p }, i) => (
              <View key={`${f.key}:${p.pid ?? p.c}:${i}`} style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
                <Text style={{ fontFamily: MONO, fontSize: 8.5, fontWeight: '700', color: p.sc ? t.warn : t.faint, minWidth: 88 }}>
                  {feeds.length > 1 ? `${f.key} · ` : ''}{qc(p.c)}
                </Text>
                <Text style={{ flex: 1, minWidth: 0, fontSize: 11, lineHeight: 15, color: p.sc ? t.text : t.dim }}>
                  {p.txt}{p.sc ? <Text style={{ fontWeight: '700', color: t.warn }}> — {f.away} {p.as}–{p.hs} {f.home}</Text> : null}
                </Text>
              </View>
            ))}
          </View>
        </ScrollView>
      )}
    </View>
  );
}
