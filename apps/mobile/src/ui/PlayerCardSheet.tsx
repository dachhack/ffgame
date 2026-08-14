// The player card, native — the web modal's sibling (src/app/playerCard.tsx),
// same module-level bus: any surface calls openPlayerCard({...}) and the host
// (mounted once in App) presents the sheet. Content comes from what core
// already knows: baked bio (tenure/college/jersey/age), the LIVE injury
// detail, this week's statline when the board has plays loaded, the baked
// 2025 season line, and the ★ favorite (0139, account-scoped so a star set
// here is lit on the web).
import { useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, Text, View } from 'react-native';
import type { Pos } from '@drip/core/types';
import { PLAYER_BIO, tenureLabel } from '@drip/core/data/playerBio';
import { injuryFor, injuryRowFor } from '@drip/core/data/injuries';
import { flagFor } from '@drip/core/data/commish';
import { displayTeam } from '@drip/core/data/playerTeam';
import { statsForName } from '@drip/core/data/players';
import { statlineAt, fmtStat } from '@drip/core/engine/sim';
import { headshot, teamLogo } from '@drip/core/data/media';
import { myFavorites, setFavorite } from '@drip/core/data/liveApi';
import { useTheme, MONO } from '../theme.native';
import { Mono } from './prims';
import { Overlay } from './Overlay';
import { InjuryBadge } from './rosterGroup';

export interface PlayerCardReq {
  slug: string; name: string; pos: string; team: string;
  week?: number; userId?: string;
}

let listener: ((p: PlayerCardReq) => void) | null = null;
export const openPlayerCard = (p: PlayerCardReq): void => { listener?.(p); };

const INJURY_LABEL: Record<string, string> = { O: 'Out', IR: 'Injured Reserve', D: 'Doubtful', Q: 'Questionable' };

export function PlayerCardHost() {
  const [req, setReq] = useState<PlayerCardReq | null>(null);
  useEffect(() => { listener = setReq; return () => { listener = null; }; }, []);
  if (!req) return null;
  return <PlayerCardSheet req={req} onClose={() => setReq(null)} />;
}

function PlayerCardSheet({ req, onClose }: { req: PlayerCardReq; onClose: () => void }) {
  const t = useTheme();
  const { slug, name, pos, team, week, userId } = req;
  // Prefer the live team layer (fresh bake + worker overrides, 0142) over
  // whatever the opening surface happened to know — see the web card.
  const showTeam = displayTeam(slug, team);
  const bio = PLAYER_BIO[slug];
  const tenure = tenureLabel(slug);
  const inj = week != null ? injuryRowFor(week, slug) : null;
  const injTag = week != null ? injuryFor(week, slug) : null;
  const season = statsForName(name, pos as Pos);
  const weekLine = (() => {
    if (week == null) return null;
    try {
      const p = { id: slug, name, full: name, pos: pos as Pos, team, stats: season };
      const s = statlineAt(p, week, Number.MAX_SAFE_INTEGER);
      const any = s.passYds || s.rushYds || s.recYds || s.carries || s.rec || s.targets || s.fg || s.xp || s.sacks || s.tackles;
      return any ? fmtStat(pos as Pos, s, true) : null;
    } catch { return null; }
  })();
  const seasonLine = season.games > 0
    ? `${season.games} G · ${Math.round(season.ppr)} PPR` + (
      pos === 'QB' ? ` · ${season.passYds} pass yd · ${season.passTds} TD`
      : pos === 'RB' ? ` · ${season.rushYds} ru yd · ${season.rushTds + season.recTds} TD`
      : pos === 'WR' || pos === 'TE' ? ` · ${season.receptions}/${season.targets}-${season.recYds} rec · ${season.recTds} TD`
      : '')
    : null;

  const [starred, setStarred] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    if (!userId) { setStarred(null); return; }
    myFavorites().then((f) => { if (alive) setStarred(f.has(slug)); });
    return () => { alive = false; };
  }, [slug, userId]);
  const toggleStar = () => {
    if (!userId || starred == null) return;
    const next = !starred;
    setStarred(next);
    setFavorite(userId, slug, next).catch(() => setStarred(!next));
  };

  const photo = headshot(slug);
  const logo = teamLogo(showTeam);
  const row = (label: string, value: string) => (
    <View key={label} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
      <Text style={{ fontFamily: MONO, width: 58, fontSize: 8.5, fontWeight: '700', letterSpacing: 1, color: t.faint, paddingTop: 1 }}>{label}</Text>
      <Text style={{ fontFamily: MONO, flex: 1, fontSize: 11, lineHeight: 15, color: t.text }}>{value}</Text>
    </View>
  );

  return (
    <Overlay visible title="Player card" subtitle={`${name.toUpperCase()} · ${pos} · ${team}`} onClose={onClose}>
      <ScrollView contentContainerStyle={{ padding: 14, gap: 12 }}>
        <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
          <View style={{ width: 54, height: 54, borderRadius: 27, overflow: 'hidden', backgroundColor: t.sh, alignItems: 'center', justifyContent: 'center' }}>
            {photo ? <Image source={{ uri: photo }} style={{ width: 54, height: 54 }} resizeMode="cover" />
              : logo ? <Image source={{ uri: logo }} style={{ width: 34, height: 34 }} resizeMode="contain" />
              : <Text style={{ fontFamily: MONO, fontSize: 12, color: t.faint }}>{pos}</Text>}
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
              <Text numberOfLines={1} style={{ fontSize: 17, fontWeight: '800', color: t.text, flexShrink: 1 }}>{name}</Text>
              {week != null && <InjuryBadge status={injuryFor(week, slug)} />}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 }}>
              <Mono size={9.5} weight="700">{pos}</Mono>
              {!!logo && <Image source={{ uri: logo }} style={{ width: 13, height: 13 }} resizeMode="contain" />}
              <Mono size={9.5} tone="dim">{showTeam || 'FA'}{bio?.num != null ? ` · #${bio.num}` : ''}</Mono>
            </View>
          </View>
          {userId && starred != null && (
            <Pressable onPress={toggleStar} hitSlop={10}>
              <Text style={{ fontSize: 24, color: starred ? '#E8B23A' : t.faint }}>{starred ? '★' : '☆'}</Text>
            </Pressable>
          )}
        </View>
        <View style={{ gap: 7, borderTopWidth: 1, borderTopColor: t.bd, paddingTop: 11 }}>
          {(tenure || bio?.college || bio?.age != null) ? row('CAREER', [tenure, bio?.college, bio?.age != null ? `age ${bio.age}` : null].filter(Boolean).join(' · ')) : null}
          {inj ? row('INJURY', `${INJURY_LABEL[inj.status] ?? inj.status}${inj.comment ? ` — ${inj.comment}` : ''}${inj.returnDate ? ` · est. return ${inj.returnDate}` : ''}`)
            : injTag ? row('INJURY', INJURY_LABEL[injTag] ?? injTag) : null}
          {flagFor(slug) ? row('COMMISH', `\u2691 ${flagFor(slug)}`) : null}
          {weekLine ? row('THIS WK', weekLine) : null}
          {seasonLine ? row('2025', seasonLine) : null}
        </View>
      </ScrollView>
    </Overlay>
  );
}
