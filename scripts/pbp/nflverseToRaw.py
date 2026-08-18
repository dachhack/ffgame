"""nflverse play_by_play_<season>.csv  ->  scripts/pbp/raw/<game_id>.jsonl

The second way to fill raw/ (v0.286.0). sweep.mjs copies auto-saved Stathead
MCP dumps, which is how weeks 1-14 arrived; this reads the same data from
nflverse's own season release, which is what that MCP wraps:

    curl -L -o pbp2025.csv.gz \
      https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_2025.csv.gz
    gunzip -c pbp2025.csv.gz > pbp2025.csv
    python3 scripts/pbp/nflverseToRaw.py pbp2025.csv scripts/pbp/raw 15,16,17,18,19,20,21,22

Then extend expected.txt with the new game ids (the completeness guard reads
it) and run genRealPbp.mjs.

PROVEN EQUIVALENT, and it had to be: rebuilding weeks 1-14 through this path
reproduces the committed dumps on 31,079 of 31,085 plays. The residue is
upstream nflverse REVISIONS since the original pull -- a dozen re-scraped
kickoffs, five millisecond refinements to time_of_day, and one real correction
(2025_06_CHI_WAS play 3094 gained its fumble attribution). Weeks 1-14 are
therefore left as they were committed rather than re-cut underneath leagues
that have already played them.

Writes the same 31-column shape the MCP dumps had, so genRealPbp.mjs cannot
tell where a week came from.
"""
import csv, json, sys, os, collections

COLS = ["play_id","game_id","week","qtr","time","time_of_day","play_type","touchdown",
        "passer_player_id","rusher_player_id","receiver_player_id","yards_gained",
        "yards_after_catch","kicker_player_id","kicker_player_name","field_goal_result",
        "kick_distance","extra_point_result","posteam","defteam","sack","interception",
        "fumble_lost","fumble_recovery_1_team","safety","td_team","fumbled_1_player_id",
        "return_yards","kickoff_returner_player_id","punt_returner_player_id","return_touchdown"]
# Columns the dump carried as NUMBERS (everything else is a string, "" when empty).
NUM = {"play_id","week","qtr","touchdown","yards_gained","yards_after_catch","kick_distance",
       "sack","interception","fumble_lost","safety","return_yards","return_touchdown"}

if len(sys.argv) < 4:
    sys.exit('usage: nflverseToRaw.py <play_by_play.csv> <out-dir> <weeks,comma,separated>')
src, outdir = sys.argv[1], sys.argv[2]
weeks = {int(w) for w in sys.argv[3].split(',')}

def cell(k, v):
    if v is None or v == "" or v == "NA":
        return 0 if k in ("play_id","week","qtr") else ""
    if k in NUM:
        f = float(v)
        return int(f) if f == int(f) else f
    return v

def ran(r):
    """Did a play actually HAPPEN? nflverse keeps the nullified ones; the
    original Stathead dumps did not, and the difference is not cosmetic — a
    no_play still carries a time_of_day, so keeping them shifts the derived
    drive spans and wall-clock timeline (`poss`/`wall`/`ends` in the bake) even
    though the scoring never moves. Reproduce the old rule exactly:
      • play_type no_play / blank  = penalty, timeout, end of period
      • an extra_point with no result = the PAT was wiped by a penalty
    """
    pt = r.get('play_type') or ''
    if pt in ('', 'no_play'):
        return False
    if pt == 'extra_point' and not (r.get('extra_point_result') or ''):
        return False
    return True

games = collections.defaultdict(list)
csv.field_size_limit(10_000_000)
with open(src, newline='') as f:
    for r in csv.DictReader(f):
        if not r.get('week') or int(float(r['week'])) not in weeks:
            continue
        if not ran(r):
            continue
        games[r['game_id']].append({k: cell(k, r.get(k)) for k in COLS})

os.makedirs(outdir, exist_ok=True)
for gid, rows in games.items():
    rows.sort(key=lambda x: x['play_id'])
    with open(os.path.join(outdir, f'{gid}.jsonl'), 'w') as f:
        for row in rows:
            f.write(json.dumps(row, separators=(',', ':')) + '\n')
byweek = collections.Counter(g.split('_')[1] for g in games)
print(f"wrote {len(games)} games -> {outdir}")
print("by week:", "  ".join(f"{w}:{c}" for w, c in sorted(byweek.items())))
