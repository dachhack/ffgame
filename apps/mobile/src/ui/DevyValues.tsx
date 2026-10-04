// DEVY VALUES in the gear (v0.601.0, 0417) — any signed-in player, any league.
// Founder: "put regularly updated devy base value in the options chip so
// players in any league can see fresh devy values for 1QB and SF" … "a
// refreshed on date as well". The web twin is src/app/DevyValues.tsx.
import { useEffect, useState } from 'react';
import { Linking, Pressable, Share, Text, TextInput, View } from 'react-native';
import { devyBaseValues, devyBaseValuesCsv } from '@drip/core/data/liveApi';
import { DEVY_VALUE_POSITIONS, STATHEAD_DEVY_URL, devyCsvName, devyValueSub, fmtValue, refreshedLabel, type DevyValueRow } from '@drip/core/data/devyValues';
import { useTheme, MONO, alpha } from '../theme.native';
import { Mono } from './prims';
import { tap } from './feedback';

const PAGE = 100;

export function DevyValues() {
  const t = useTheme();
  const [sort, setSort] = useState<'sf' | '1qb'>('sf');
  const [pos, setPos] = useState<string>('ALL');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<DevyValueRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [asOf, setAsOf] = useState<string | null>(null);
  const [err, setErr] = useState(false);
  const [csvBusy, setCsvBusy] = useState(false);
  // v0.602.0: the list as CSV. No file-sharing module is in the binary (and an
  // OTA can't add one), so the CSV goes out as text through the share sheet:
  // save it to Files or Drive, or send it.
  const shareCsv = async () => {
    setCsvBusy(true);
    try {
      const csv = await devyBaseValuesCsv(sort, pos === 'ALL' ? null : pos);
      await Share.share({ title: devyCsvName(sort, pos, asOf), message: csv });
    } catch { setErr(true); } finally { setCsvBusy(false); }
  };

  const load = (offset: number) => {
    let live = true;
    devyBaseValues({ sort, pos: pos === 'ALL' ? null : pos, q: q.trim().length >= 2 ? q : null, limit: PAGE, offset })
      .then((p) => {
        if (!live) return;
        setErr(false); setAsOf(p?.as_of ?? null); setTotal(p?.total ?? 0);
        setRows((prev) => (offset ? [...(prev ?? []), ...(p?.rows ?? [])] : (p?.rows ?? [])));
      })
      .catch(() => { if (live) { setErr(true); if (!offset) setRows([]); } });
    return () => { live = false; };
  };
  useEffect(() => { setRows(null); const id = setTimeout(() => load(0), q ? 300 : 0); return () => clearTimeout(id); }, [sort, pos, q]); // eslint-disable-line react-hooks/exhaustive-deps

  const chip = (on: boolean) => ({
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, borderWidth: 1,
    borderColor: on ? t.you : t.bd, backgroundColor: on ? alpha(t.you, 14) : t.bg,
  });
  return (
    <View style={{ gap: 10 }}>
      <Text style={{ fontSize: 12.5, lineHeight: 18, color: t.dim }}>
        What a devy share is worth, from StatHead's composite rankings. 1QB is the devy market's price; SF is the same scale on the superflex rank.
      </Text>
      <Mono size={10} weight="700" tone="dim" track={0.08}>{refreshedLabel(asOf).toUpperCase()}</Mono>
      <View style={{ flexDirection: 'row', gap: 16, flexWrap: 'wrap' }}>
        <Pressable onPress={() => { tap(); void Linking.openURL(STATHEAD_DEVY_URL); }} hitSlop={6}>
          <Text style={{ fontFamily: MONO, fontSize: 11, fontWeight: '700', color: t.you }}>StatHead devy rankings ↗</Text>
        </Pressable>
        <Pressable onPress={() => { tap(); void shareCsv(); }} disabled={csvBusy} hitSlop={6}>
          <Text style={{ fontFamily: MONO, fontSize: 11, fontWeight: '700', color: t.you }}>{csvBusy ? 'Preparing CSV…' : `⬆ Share CSV (${pos === 'ALL' ? 'all' : pos})`}</Text>
        </Pressable>
      </View>
      <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
        {(['sf', '1qb'] as const).map((s) => (
          <Pressable key={s} onPress={() => { tap(); setSort(s); }} style={chip(sort === s)}>
            <Text style={{ fontFamily: MONO, fontSize: 10, fontWeight: '700', color: sort === s ? t.you : t.dim }}>SORT {s.toUpperCase()}</Text>
          </Pressable>
        ))}
        {DEVY_VALUE_POSITIONS.map((p) => (
          <Pressable key={p} onPress={() => { tap(); setPos(p); }} style={chip(pos === p)}>
            <Text style={{ fontFamily: MONO, fontSize: 10, fontWeight: '700', color: pos === p ? t.you : t.dim }}>{p}</Text>
          </Pressable>
        ))}
      </View>
      <TextInput value={q} onChangeText={setQ} placeholder="search a player or school" placeholderTextColor={t.faint}
        autoCorrect={false} autoCapitalize="none"
        style={{ borderWidth: 1, borderColor: t.bd, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 7, color: t.text, fontSize: 13 }} />
      <View style={{ flexDirection: 'row', paddingHorizontal: 2 }}>
        <Text style={{ flex: 1, fontFamily: MONO, fontSize: 9, fontWeight: '700', letterSpacing: 0.8, color: t.faint }}>PLAYER</Text>
        <Text style={{ width: 56, textAlign: 'right', fontFamily: MONO, fontSize: 9, fontWeight: '700', letterSpacing: 0.8, color: sort === '1qb' ? t.you : t.faint }}>1QB</Text>
        <Text style={{ width: 56, textAlign: 'right', fontFamily: MONO, fontSize: 9, fontWeight: '700', letterSpacing: 0.8, color: sort === 'sf' ? t.you : t.faint }}>SF</Text>
      </View>
      {rows == null ? <Text style={{ color: t.dim, fontSize: 12.5 }}>Loading…</Text>
        : err && !rows.length ? <Text style={{ color: t.dim, fontSize: 12.5 }}>Couldn't load devy values. Try again in a moment.</Text>
        : !rows.length ? <Text style={{ color: t.dim, fontSize: 12.5 }}>No players match.</Text>
        : rows.map((r) => (
          <View key={r.espn_id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: alpha(t.bd, 60) }}>
            <Text style={{ width: 34, fontFamily: MONO, fontSize: 11, fontWeight: '700', color: t.dim }}>{sort === 'sf' ? (r.rank_sf ?? '—') : r.rank_1qb}</Text>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ fontSize: 13.5, fontWeight: '700', color: t.text }}>{r.name}</Text>
              <Text numberOfLines={1} style={{ fontSize: 11, color: t.dim }}>{devyValueSub(r)}</Text>
            </View>
            <Text style={{ width: 56, textAlign: 'right', fontFamily: MONO, fontSize: 12.5, fontWeight: '700', color: t.text }}>{fmtValue(r.value_1qb)}</Text>
            <Text style={{ width: 56, textAlign: 'right', fontFamily: MONO, fontSize: 12.5, fontWeight: '700', color: t.text }}>{fmtValue(r.value_sf)}</Text>
          </View>
        ))}
      {!!rows && rows.length < total && (
        <Pressable onPress={() => { tap(); load(rows.length); }} style={[chip(false), { alignSelf: 'center', marginTop: 4 }]}>
          <Text style={{ fontFamily: MONO, fontSize: 10, fontWeight: '700', color: t.dim }}>SHOW MORE · {rows.length} OF {total}</Text>
        </Pressable>
      )}
    </View>
  );
}
