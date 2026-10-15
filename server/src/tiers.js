// TIERS INSIDE A LEAGUE (0507, v0.728.0) — the worker's half. Founder: "Lets
// also make within season within league relegation." Every league with tiers
// on is asked to advance: tiers_advance moves a period's bottom and top
// teams between adjacent tiers once its last week is final, logs it, tells
// the league, and builds the next period inside the tiers. Idempotent per
// period; a league that refuses or errors is logged and the rest go on.
import { db } from './supabase.js';

export async function advanceLeagueTiers(log = () => {}) {
  const { data: lgs } = await db().from('league').select('id').eq('settings_json->tiers->>on', 'true');
  let moved = 0;
  for (const lg of lgs ?? []) {
    try {
      const { data, error } = await db().rpc('tiers_advance', { p_league_id: lg.id });
      if (error) { log('tiers', lg.id, error.message); continue; }
      if (data?.moved) { moved += Number(data.moved) || 0; log('tiers', lg.id, `after week ${data.after_week}:`, data.moved, 'moved'); }
      else if (data?.ok === false) log('tiers', lg.id, data.error);
    } catch (e) { log('tiers', lg.id, e.message); }
  }
  return moved;
}
