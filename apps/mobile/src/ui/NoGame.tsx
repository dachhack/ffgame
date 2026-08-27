// NO GAME THIS WEEK (v0.364.0).
//
// An odd-sized league sits one seat out every week — 0064's schedule pads the
// field with a ghost and skips that pair — and every screen here read the
// missing matchup row as "the schedule isn't ready yet", telling the manager
// their commissioner had not synced a season that was in fact generated
// correctly.
//
// `bye` is the whole distinction, and it is not knowable from one seat: both
// cases are "no matchup row". The league-wide answer comes from 0247's
// league_week_role, and the caller passes it down.
import { type ReactNode } from 'react';
import { View } from 'react-native';
import { fs } from '../theme.native';
import { Display, Mono } from './prims';

export function NoGame({ week, bye, children }: { week: number; bye: boolean; children?: ReactNode }) {
  return (
    <View style={{ padding: 24, gap: 10, alignItems: 'center' }}>
      <Display size={16}>{bye ? `Week ${week} · bye` : `No week ${week} matchup yet`}</Display>
      <Mono size={9.5} tone="faint" style={{ textAlign: 'center', lineHeight: fs(15) }}>
        {bye
          ? 'Your league has an odd number of teams, so one sits out each week and this week it’s yours. Nothing to set — your record and your roster carry over untouched.'
          : 'The rest of the league has no game this week either. Matchups appear once the commissioner generates the schedule.'}
      </Mono>
      {children}
    </View>
  );
}
