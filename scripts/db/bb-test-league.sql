-- Founder: "Can I change my BB Test league to this?" (ONE GAME, 0527).
-- Read only: the league's sport, format, calendar, how many of its weeks
-- have started (the format locks once any has), and its spots.
\pset pager off
set search_path = public;
select l.id, l.name, l.sport, l.season, l.provider,
       l.settings_json -> 'sport' ->> 'format' as format,
       l.settings_json -> 'sport' ->> 'period_start' as period_start,
       (select count(*) from matchup m where m.league_id = l.id) as matchups,
       (select count(*) from matchup m where m.league_id = l.id and m.status <> 'scheduled') as started,
       (select min(m.week) from matchup m where m.league_id = l.id and m.status = 'scheduled') as next_week,
       (select count(*) from sport_slot_lock k join matchup m on m.id = k.matchup_id where m.league_id = l.id) as locks,
       (select status from draft d where d.league_id = l.id limit 1) as draft,
       jsonb_array_length(coalesce(l.settings_json -> 'roster_slots', '[]'::jsonb)) as spots,
       (select count(*) from jsonb_array_elements(coalesce(l.settings_json -> 'roster_slots', '[]'::jsonb)) s where (s ->> 'bb')::boolean) as bb_spots
  from league l
 where l.name ilike '%bb test%' or l.name ilike '%bbtest%'
 order by l.name;
