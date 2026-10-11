// ONE WEEK PER LEAGUE, ACROSS SCREENS (v0.666.2, refs #1204). Founder: "have
// the team page changes mirrored in the matchup and any matchup changes
// mirrored in the team page." Both draw the same board (ClassicBoard) on the
// same stored picks — the one thing that could differ was WHICH WEEK each
// was looking at, because every board kept its own week arrows. A week
// chosen on either is remembered here, per league, for the session, so the
// other opens on it. In memory on purpose: a fresh launch opens on the
// league's own week, as before.
const weeks = new Map<string, number>();
export const rememberedWeek = (leagueId: string): number | null => weeks.get(leagueId) ?? null;
export const rememberWeek = (leagueId: string, week: number | null): void => { if (week == null) weeks.delete(leagueId); else weeks.set(leagueId, week); };
