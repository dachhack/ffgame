-- Week 10, play by play (follows ops 090). The week's totals against an
-- outside play-by-play showed a missing Josh Allen rushing touchdown, a
-- missing Burrow-to-Chase Brown touchdown, catches credited to the wrong
-- teammate and yards the outside source does not have. Read only: every
-- offensive feed row of the week, keyed by play id, so each difference can be
-- matched to its play. NFL players only.
\pset pager off
\pset format csv
set search_path = public;
select game_id, pid, c, player_slug, k, y, td, coalesce("to", 0) as turnover, coalesce(sk, 0) as sk
  from live_play
 where week = 10 and k in ('pass', 'rush', 'rec', 'incomplete', 'tp_pass', 'tp_rush', 'tp_rec', 'fum', 'frtd')
 order by game_id, pid, k, player_slug;
