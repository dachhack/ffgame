// WHICH LEAGUES EACH TOOL READS (v0.718.0). Founder: "let's have an options
// chip for the tools bar so you can pick the leagues you want to apply to
// each tool." Kept per device (platform storage, synchronous) as the leagues a tool LEAVES OUT, so a league
// you join later is in every tool until you say otherwise. Pure + storage.
import { platform } from '../platform';

export type ToolId = 'preview' | 'lineup' | 'wire' | 'trades';
export const TOOL_IDS: ToolId[] = ['preview', 'lineup', 'wire', 'trades'];
export const TOOL_LABEL: Record<ToolId, string> = { preview: 'PREVIEW', lineup: 'LINEUP', wire: 'WAIVER TARGETS', trades: 'TRADE ZONE' };
/** tool → league ids it leaves out. */
export type ToolLeagueOff = Partial<Record<ToolId, string[]>>;

const KEY = 'drip.toolLeagues.v1';
export function parseToolLeagues(raw: string | null | undefined): ToolLeagueOff {
  try {
    const j = raw ? JSON.parse(raw) : null;
    if (!j || typeof j !== 'object') return {};
    const out: ToolLeagueOff = {};
    for (const t of TOOL_IDS) if (Array.isArray(j[t])) out[t] = (j[t] as unknown[]).filter((x): x is string => typeof x === 'string');
    return out;
  } catch { return {}; }
}
export function loadToolLeagues(): ToolLeagueOff {
  try { return parseToolLeagues(platform().storage.get(KEY)); } catch { return {}; }
}
export function saveToolLeagues(v: ToolLeagueOff): void {
  try { platform().storage.set(KEY, JSON.stringify(v)); } catch { /* a preference, not a record */ }
}
/** Flip one league in one tool. */
export function toggleToolLeague(v: ToolLeagueOff, tool: ToolId, leagueId: string): ToolLeagueOff {
  const off = new Set(v[tool] ?? []);
  if (off.has(leagueId)) off.delete(leagueId); else off.add(leagueId);
  return { ...v, [tool]: [...off] };
}
export const toolHas = (v: ToolLeagueOff, tool: ToolId, leagueId: string): boolean => !(v[tool] ?? []).includes(leagueId);
/** The items a tool reads: those whose league it doesn't leave out. */
export const forTool = <T extends { leagueId: string }>(v: ToolLeagueOff, tool: ToolId, items: T[]): T[] =>
  items.filter((x) => toolHas(v, tool, x.leagueId));
/** How many leagues the tools leave out, across all tools — the OPTIONS
 *  chip's count. `ids`: the leagues you're in now (one you left doesn't count). */
export const toolLeaguesOffCount = (v: ToolLeagueOff, ids?: string[]): number =>
  TOOL_IDS.reduce((n, t) => n + (v[t] ?? []).filter((id) => !ids || ids.includes(id)).length, 0);

/** The tools a league can feed (v0.721.0): every league previews and gets
 *  lineup alerts; waiver targets and the trade zone are for native leagues
 *  that aren't weekly contests. Options lists a league, then these. */
export const toolsForLeague = (l: { native: boolean; contest: boolean }): ToolId[] =>
  l.native && !l.contest ? TOOL_IDS : ['preview', 'lineup'];
export const TOOL_NAME: Record<ToolId, string> = { preview: 'Preview', lineup: 'Lineup', wire: 'Waiver targets', trades: 'Trade zone' };
