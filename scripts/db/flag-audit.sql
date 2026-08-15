-- Companion #5: every commissioner player flag in every league, with rules.
-- The live-matchup grid showed the zeroed seats are EXACTLY the seats whose
-- lineup contains josh-allen, both leagues, server-side only — the signature
-- of a flag rule scaling one player's scoring. Read-only. Run via dbquery.yml.

select l.name as league, pf.slug, pf.label, pf.rules
from player_flag pf
join league l on l.id = pf.league_id
order by l.name, pf.slug;
