// DEVY SHARES (0387) — the app's sheet. Every team has 100 shares to put on
// college players, at most 20 on one. The first team to 20 holds his right;
// failing that, the only team in does, with 5 or more. A right reserves him
// in the rookie draft, at any of the holder's picks, once he turns pro.
// Three views: MINE (my stakes), LEAGUE (every stake, every right), ADD (the
// college directory, to put shares on someone new).
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { allotDevyShares, collegeDirectory, devySharesState, friendlyError, type CollegeDirectoryRow, type DevySharePlayer, type DevySharesState } from '@drip/core/data/liveApi';
import { collegeSlug, collegeClassLabel } from '@drip/core/data/college';
import { sharesUsed, myStake, rightLine, lockLine } from '@drip/core/data/devyShares';
import { useTheme, MONO } from '../theme.native';
import { Overlay } from './Overlay';
import { Chip, Mono, PosPill } from './prims';
import { tap, commit, warn } from './feedback';

type View3 = 'mine' | 'league' | 'add';

export function DevySharesSheet({ visible, leagueId, myRoster, onClose }: {
  visible: boolean; leagueId: string; myRoster: number | null; onClose: () => void;
}) {
  const t = useTheme();
  const [st, setSt] = useState<DevySharesState | null>(null);
  const [view, setView] = useState<View3>('mine');
  const [dir, setDir] = useState<CollegeDirectoryRow[] | null>(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const load = () => devySharesState(leagueId).then(setSt).catch(() => {});
  useEffect(() => { if (visible) void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [visible, leagueId]);
  useEffect(() => {
    if (visible && view === 'add' && !dir) collegeDirectory(['QB', 'RB', 'WR', 'TE'], 800).then((r) => setDir(Array.isArray(r) ? r : [])).catch(() => setDir([]));
  }, [visible, view, dir]);

  const rules = st?.rules ?? { budget: 100, max: 20, floor: 5 };
  const budget = sharesUsed(st, myRoster);
  const bySlug = useMemo(() => new Map((st?.players ?? []).map((p) => [p.slug, p])), [st]);
  const mine = (st?.players ?? []).filter((p) => myStake(p, myRoster) > 0);
  const locked = !!st?.locked;

  const set = async (slug: string, n: number) => {
    if (myRoster == null || busy) return;
    setBusy(true); setMsg(null);
    try {
      const r = await allotDevyShares(leagueId, myRoster, slug, Math.max(0, Math.min(rules.max, n)));
      if (!r.ok) { warn(); setMsg(`✗ ${friendlyError(r.error ?? 'failed')}`); return; }
      commit(); await load();
    } catch (e) { warn(); setMsg(`✗ ${friendlyError(e instanceof Error ? e.message : String(e))}`); }
    finally { setBusy(false); }
  };

  const stakeControls = (slug: string, cur: number) => (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
      {cur > 0 && <Chip label="−5" disabled={busy || locked} onPress={() => { tap(); void set(slug, cur - 5); }} />}
      {cur > 0 && <Chip label="−1" disabled={busy || locked} onPress={() => { tap(); void set(slug, cur - 1); }} />}
      <Chip label="+1" disabled={busy || locked || cur >= rules.max} onPress={() => { tap(); void set(slug, cur + 1); }} />
      <Chip label="+5" disabled={busy || locked || cur >= rules.max} onPress={() => { tap(); void set(slug, cur + 5); }} />
      <Chip label={`MAX ${rules.max}`} on disabled={busy || locked || cur >= rules.max} onPress={() => { tap(); void set(slug, rules.max); }} />
      {cur > 0 && <Chip label="REMOVE" dim disabled={busy || locked} onPress={() => { tap(); void set(slug, 0); }} />}
    </View>
  );

  const playerRow = (p: DevySharePlayer, controls: boolean) => {
    const cur = myStake(p, myRoster);
    const yours = p.right?.roster_id === myRoster && myRoster != null;
    return (
      <View key={p.slug} style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: t.bd }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {!!p.pos && <PosPill pos={p.pos} />}
          <Text numberOfLines={1} style={{ flex: 1, fontSize: 14, fontWeight: '700', color: t.text }}>{p.name ?? p.slug}</Text>
          {cur > 0 && <Mono size={12} weight="700" tone={yours ? 'you' : 'text'}>{cur}</Mono>}
        </View>
        <Mono size={9} tone="faint" style={{ marginTop: 2 }}>
          {[p.school, p.class_year ? collegeClassLabel(p.class_year) : null, p.graduated_to ? 'TURNED PRO' : null].filter(Boolean).join(' · ')}
        </Mono>
        <Mono size={9.5} tone={yours ? 'you' : 'dim'} style={{ marginTop: 3 }}>{rightLine(p, myRoster, rules.floor, rules.max)}</Mono>
        <Mono size={9} tone="faint" style={{ marginTop: 2 }}>
          {p.holders.map((h) => `${h.team} ${h.shares}`).join(' · ')}
        </Mono>
        {controls && myRoster != null && !p.graduated_to && stakeControls(p.slug, cur)}
      </View>
    );
  };

  const addList = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (dir ?? [])
      .filter((r) => !needle || r.full.toLowerCase().includes(needle) || (r.school_abbr ?? '').toLowerCase().includes(needle))
      .slice(0, 60);
  }, [dir, q]);

  return (
    <Overlay visible={visible} title="Devy shares" onClose={onClose}
      subtitle={myRoster != null ? `YOURS ${budget.used}/${budget.budget} · ${budget.free} FREE` : 'THE LEAGUE’S STAKES'}>
      <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ padding: 14, gap: 8 }} keyboardShouldPersistTaps="handled">
        <Mono size={9.5} tone="dim" style={{ lineHeight: 14 }}>
          {`Put up to ${rules.max} shares on a college player. First team to ${rules.max} holds his right; if you're the only team in, ${rules.floor}+ holds it. His right reserves him for you in the rookie draft, at any of your picks. Shares come back once he's drafted into the NFL and the rookie draft is done. ${lockLine(st)}`}
        </Mono>
        <View style={{ flexDirection: 'row', gap: 6, marginTop: 4 }}>
          {(['mine', 'league', 'add'] as const).map((v) => (
            <Chip key={v} label={v === 'mine' ? `MINE (${mine.length})` : v === 'league' ? `LEAGUE (${st?.players?.length ?? 0})` : '+ ADD'} on={view === v}
              onPress={() => { tap(); setView(v); }} />
          ))}
        </View>
        {!!msg && <Mono size={9.5} tone="opp">{msg}</Mono>}
        {st && !st.ok && <Mono size={9.5} tone="opp">{st.error ?? 'Couldn’t load the shares.'}</Mono>}

        {view === 'mine' && (mine.length
          ? mine.map((p) => playerRow(p, true))
          : <Mono size={9.5} tone="faint" style={{ marginTop: 8 }}>No shares placed yet. Tap + ADD to put some on a college player.</Mono>)}

        {view === 'league' && ((st?.players ?? []).length
          ? (st?.players ?? []).map((p) => playerRow(p, false))
          : <Mono size={9.5} tone="faint" style={{ marginTop: 8 }}>Nobody in the league has placed shares yet.</Mono>)}

        {view === 'add' && (<>
          <TextInput value={q} onChangeText={setQ} placeholder="Search college players or schools…" placeholderTextColor={t.faint}
            style={{ borderWidth: 1, borderColor: t.bd, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, color: t.text, fontFamily: MONO, fontSize: 12 }} />
          {!dir && <Mono size={9.5} tone="faint">Loading college players…</Mono>}
          {addList.map((r) => {
            const slug = collegeSlug(r.espn_id);
            const held = bySlug.get(slug);
            if (held) return playerRow(held, true);
            return (
              <View key={slug} style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: t.bd }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <PosPill pos={r.pos} />
                  <Text numberOfLines={1} style={{ flex: 1, fontSize: 14, fontWeight: '700', color: t.text }}>{r.full}</Text>
                  {r.ppg != null && <Mono size={10} tone="dim">{Number(r.ppg).toFixed(1)} PPG</Mono>}
                </View>
                <Mono size={9} tone="faint" style={{ marginTop: 2 }}>
                  {[r.school_abbr, r.class_year ? collegeClassLabel(r.class_year) : null].filter(Boolean).join(' · ')} · nobody in yet
                </Mono>
                {myRoster != null && stakeControls(slug, 0)}
              </View>
            );
          })}
        </>)}
      </ScrollView>
    </Overlay>
  );
}
