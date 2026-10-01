// THE DEVY PLAYER CARD, native (0406) — the web collegeCard.tsx's sibling,
// presented by the same PlayerCardHost for any c-<espn_id> slug. Data comes
// from core (collegeCard.ts): ESPN's bio, seasons, game log and news when the
// card opens, and our side — the devy market price and StatHead's devy
// profile — from college_player_card. A part that can't be reached simply
// doesn't render.
import { useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, Text, View } from 'react-native';
import {
  loadCollegeEspn, loadCollegeGameLog, statheadEvalRows, storedSeasonRows, collegeFactStrip,
  type CollegeBio, type CollegeOverview, type CollegeGameRow, type DevyFormat,
} from '@drip/core/data/collegeCard';
import { collegeEspnId, collegeClassLabel, isCustomCollegeId } from '@drip/core/data/college';
import { collegeHeadshot, collegeLogo } from '@drip/core/data/media';
import { collegePlayerCard, leagueGameMode, nativeRosters, matchupTeams, type CollegePlayerCard } from '@drip/core/data/liveApi';
import { leagueSuperflex } from '@drip/core/engine/classic';
import { kickoffLabel } from '@drip/core/data/nflSlate';
import { useTheme, MONO } from '../theme.native';
import { Mono } from './prims';
import { Overlay } from './Overlay';
import { tap } from './feedback';
import { openLink } from './openLink';

export interface CollegeCardReq { slug: string; name: string; pos: string; team: string; leagueId?: string }

export function CollegeCardSheet({ req, onClose }: { req: CollegeCardReq; onClose: () => void }) {
  const t = useTheme();
  const { slug, name, pos, leagueId } = req;
  const espnId = collegeEspnId(slug) ?? '';
  const [card, setCard] = useState<CollegePlayerCard | null>(null);
  const [bio, setBio] = useState<CollegeBio | null>(null);
  const [ov, setOv] = useState<CollegeOverview | null>(null);
  const [espnDown, setEspnDown] = useState(false);
  const [fmt, setFmt] = useState<DevyFormat>('1qb');
  const [owner, setOwner] = useState<string | null | undefined>(undefined);
  const [tab, setTab] = useState<'summary' | 'seasons' | 'log'>('summary');
  const [log, setLog] = useState<CollegeGameRow[] | null>(null);
  const [logErr, setLogErr] = useState(false);

  useEffect(() => {
    let dead = false;
    setCard(null); setBio(null); setOv(null); setEspnDown(false); setLog(null); setLogErr(false); setOwner(undefined); setTab('summary');
    collegePlayerCard(espnId).then((c) => { if (!dead) setCard(c); }).catch(() => { if (!dead) setCard({ ok: false }); });
    // 0410: ESPN has nothing on a commissioner's custom player — don't ask.
    if (!isCustomCollegeId(espnId)) loadCollegeEspn(espnId, pos).then((r) => {
      if (dead) return;
      setBio(r.bio); setOv(r.overview); setEspnDown(!r.bio && !r.overview);
    }).catch(() => { if (!dead) setEspnDown(true); });
    if (leagueId) {
      leagueGameMode(leagueId).then((g) => { if (!dead && g.ok) setFmt(leagueSuperflex(g) ? 'sf' : '1qb'); }).catch(() => {});
      nativeRosters(leagueId).then(async (rows) => {
        const held = rows.find((r) => r.slug === slug);
        if (dead) return;
        if (!held) { setOwner(null); return; }
        const teams = await matchupTeams(leagueId, [held.roster_id]).catch(() => ({} as Record<number, { team_name: string }>));
        if (!dead) setOwner(teams[held.roster_id]?.team_name ?? `Roster ${held.roster_id}`);
      }).catch(() => {});
    }
    return () => { dead = true; };
  }, [espnId, slug, pos, leagueId]);

  useEffect(() => {
    if (tab !== 'log' || log !== null) return;
    if (isCustomCollegeId(espnId)) { setLog([]); return; }   // 0410: no feed
    let dead = false;
    loadCollegeGameLog(espnId, pos).then((r) => { if (!dead) setLog(r); }).catch(() => { if (!dead) setLogErr(true); });
    return () => { dead = true; };
  }, [tab, log, espnId, pos]);

  const school = card?.school ?? req.team;
  const abbr = card?.school_abbr ?? req.team;
  const evalRows = statheadEvalRows(card?.stathead?.card, pos, fmt);
  const seasons = ov?.seasons?.length ? ov.seasons : storedSeasonRows(card);
  const facts = collegeFactStrip(card, bio, fmt);
  const cls = bio?.classLabel ?? (card?.class_year ? collegeClassLabel(card.class_year) : null);
  const photo = bio?.headshot ?? collegeHeadshot(espnId);
  const logo = collegeLogo(abbr);
  const row = (label: string, value: string) => (
    <View key={label} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
      <Text style={{ fontFamily: MONO, width: 74, fontSize: 8.5, fontWeight: '700', letterSpacing: 1, color: t.faint, paddingTop: 1 }}>{label}</Text>
      <Text style={{ fontFamily: MONO, flex: 1, fontSize: 11, lineHeight: 15, color: t.text }}>{value}</Text>
    </View>
  );
  const cell = (w: number | undefined, s: string, tone: string = t.text, bold = false, right = false) => (
    <Text style={{ fontFamily: MONO, width: w, flex: w ? undefined : 1, fontSize: 9.5, lineHeight: 13, color: tone, fontWeight: bold ? '700' : '400', textAlign: right ? 'right' : 'left' }}>{s}</Text>
  );

  return (
    <Overlay visible title="Player card" subtitle={`${(card?.name ?? name).toUpperCase()} · ${pos} · ${abbr}`} onClose={onClose}>
      <ScrollView contentContainerStyle={{ padding: 14, gap: 12 }}>
        <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
          <View style={{ width: 54, height: 54, borderRadius: 27, overflow: 'hidden', backgroundColor: t.sh, alignItems: 'center', justifyContent: 'center' }}>
            {photo ? <Image source={{ uri: photo }} style={{ width: 54, height: 54 }} resizeMode="cover" />
              : logo ? <Image source={{ uri: logo }} style={{ width: 34, height: 34 }} resizeMode="contain" />
              : <Text style={{ fontFamily: MONO, fontSize: 12, color: t.faint }}>{pos}</Text>}
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ fontSize: 17, fontWeight: '800', color: t.text }}>{card?.name ?? name}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3, flexWrap: 'wrap' }}>
              <Mono size={9.5} weight="700">{pos}</Mono>
              {!!logo && <Image source={{ uri: logo }} style={{ width: 13, height: 13 }} resizeMode="contain" />}
              <Mono size={9.5} tone="dim">
                {school}{card?.division === 'FCS' ? ' · FCS' : card?.conference ? ` · ${card.conference}` : ''}{bio?.jersey ? ` · #${bio.jersey}` : ''}
              </Mono>
              {card?.declared && <Mono size={9} weight="700" tone="warn">DECLARED</Mono>}
            </View>
          </View>
        </View>

        <View style={{ flexDirection: 'row', borderTopWidth: 1, borderBottomWidth: 1, borderColor: t.bd, paddingVertical: 9 }}>
          {facts.map(([k, v]) => (
            <View key={k} style={{ flex: 1, alignItems: 'center' }}>
              <Mono size={8} tone="faint" weight="700" track={0.12}>{k}</Mono>
              <Text style={{ fontSize: 14, fontWeight: '800', color: t.text, marginTop: 2 }}>{v}</Text>
            </View>
          ))}
        </View>

        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          {([['summary', 'SUMMARY'], ['seasons', 'SEASONS'], ['log', 'GAME LOG']] as const).map(([id, label]) => (
            <Pressable key={id} onPress={() => { tap(); setTab(id); }}
              style={{ borderWidth: 1, borderRadius: 6, paddingHorizontal: 11, paddingVertical: 6, borderColor: tab === id ? t.you : t.bd, backgroundColor: tab === id ? t.bg : 'transparent' }}>
              <Mono size={9} weight="700" tone={tab === id ? 'you' : 'dim'}>{label}</Mono>
            </Pressable>
          ))}
        </View>

        {tab === 'summary' && (
          <View style={{ gap: 7 }}>
            {card?.graduated_to ? row('TURNED PRO', 'drafted into the NFL — his card now lives under his NFL name') : null}
            {card?.custom ? row('ADDED BY', `the commissioner · ${card.level ?? 'custom'} · no stats feed, so he scores nothing until he reaches FBS`) : null}
            {card && card.active === false && !card.graduated_to ? row('STATUS', 'left college') : null}
            {evalRows.length > 0 && (
              <View style={{ borderBottomWidth: 1, borderBottomColor: t.bd, paddingBottom: 8, gap: 6 }}>
                <Mono size={8} tone="faint" weight="700" track={0.12}>{`🔬 EVALUATION · STATHEAD${fmt === 'sf' ? ' · SUPERFLEX' : ''}`}</Mono>
                {evalRows.map((r) => row(r.label, r.value))}
              </View>
            )}
            {card?.market ? row('DEVY PRICE', `${card.market.price} a share${card.market.rank ? ` · #${card.market.rank} in college` : ' · unpriced (the floor)'}${card.market.youth ? ' · young riser' : ''}${card.market.frozen ? ' · frozen for the offseason' : ''}`) : null}
            {owner !== undefined ? row('ROSTERED', owner ? `⇄ ${owner}` : 'nobody in this league holds him') : null}
            {ov?.next?.short ? row('NEXT UP', `${ov.next.short}${ov.next.date && Number.isFinite(Date.parse(ov.next.date)) ? ` · ${kickoffLabel(Date.parse(ov.next.date))}` : ''}`) : null}
            {bio?.hometown || cls ? row('BIO', [cls, bio?.hometown].filter(Boolean).join(' · ')) : null}
            {seasons[0] ? row(seasons[0].season, `${seasons[0].line}${seasons[0].pts != null ? ` · ${seasons[0].pts} PPR` : ''}`) : null}
            {(ov?.news ?? []).length > 0 && (
              <View style={{ borderTopWidth: 1, borderTopColor: t.bd, paddingTop: 6 }}>
                <Mono size={8} tone="faint" weight="700" track={0.12}>📰 LATELY</Mono>
                {(ov?.news ?? []).slice(0, 4).map((n) => (
                  <Pressable key={n.id} disabled={!n.url} onPress={() => { if (n.url) { tap(); void openLink(n.url); } }}
                    style={({ pressed }) => ({ marginTop: 4, opacity: pressed ? 0.6 : 1 })}>
                    <Text numberOfLines={2} style={{ fontSize: 11, color: t.text, lineHeight: 15 }}>{n.headline}</Text>
                    <Mono size={8} tone="faint">
                      {n.at ? new Date(n.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''}{n.url ? ' · espn.com ↗' : ''}
                    </Mono>
                  </Pressable>
                ))}
              </View>
            )}
            {espnDown && <Mono size={9} tone="faint">ESPN didn’t answer, so news and bio are missing; the seasons are ours.</Mono>}
          </View>
        )}

        {tab === 'seasons' && (
          <View>
            {seasons.length === 0 && <Mono size={10} tone="faint">{ov || card ? 'No college stats yet — a recruit, or a player who hasn’t touched the ball.' : 'Loading…'}</Mono>}
            {seasons.map((s) => (
              <View key={s.season} style={{ flexDirection: 'row', gap: 8, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: t.bd }}>
                {cell(38, s.season, t.text, true)}
                {cell(undefined, s.line)}
                {s.pts != null ? cell(50, String(s.pts), t.you, true, true) : null}
              </View>
            ))}
            {seasons.length > 0 && <Mono size={9} tone="faint" style={{ marginTop: 8 }}>Season totals · PPR points</Mono>}
          </View>
        )}

        {tab === 'log' && (
          <View>
            {logErr && <Mono size={10} tone="opp">Couldn’t load his games from ESPN.</Mono>}
            {!logErr && log === null && <Mono size={10} tone="faint">Loading his season…</Mono>}
            {log?.length === 0 && <Mono size={10} tone="faint">No games played this season yet.</Mono>}
            {log?.map((g) => (
              <View key={g.id} style={{ flexDirection: 'row', gap: 6, paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: t.bd }}>
                {cell(24, String(g.week ?? '—'), t.text, true)}
                {cell(54, `${g.atVs === '@' ? '@' : 'vs'} ${g.opp ?? '—'}`, t.dim)}
                {cell(undefined, `${g.result ? `${g.result} ${g.score ?? ''} · ` : ''}${g.line}`)}
                {cell(38, String(g.pts), g.pts > 0 ? t.you : t.faint, true, true)}
              </View>
            ))}
            {!!log?.length && <Mono size={9} tone="faint" style={{ marginTop: 8 }}>This season · PPR points</Mono>}
          </View>
        )}
      </ScrollView>
    </Overlay>
  );
}
