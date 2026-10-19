-- 0516 · MONDAY SHOWDOWN: SQUADS CLEARED, BUDGET CUT (v0.730.31)
--
-- Founder, commissioner of Monday Showdown (week 6, only WAS@SF to play):
-- "I need to unset all spots and decrease the salary to 20k or 25k". With one
-- game on the board, the $50,000 cap lets both seats take everyone good.
--
-- Each seat has 8 spots and every player costs at least $3,000, so $20,000
-- can't hold a squad. The founder then chose $30,000 ("Or 30k"), if the
-- cheapest legal squad from WAS and SF fits under it, else that squad's
-- cost plus $5,000, rounded up to the next $1,000. If no legal squad exists,
-- the budget is left alone (a notice says why), and it is never raised. A
-- minimum spend above the new cap is cleared. Both week-6 squads are deleted
-- (as 0514 did) so the seats build again under the new cap. A seat with no
-- squad by kickoff is auto-built from that game (v0.730.28). One league, by id.
-- Re-runnable: the note is posted once.

do $$
declare lid uuid := 'ec3c4c2d-63a1-4f27-8844-a7d132e53a11'; lg league; spots jsonb; i int; used text[] := '{}';
        pick record; cheapest int := 0; cap int; n int;
begin
  select * into lg from league where id = lid and name = 'Monday Showdown';
  if lg.id is null then raise notice 'Monday Showdown not found — nothing to do'; return; end if;
  if exists (select 1 from matchup where league_id = lid and week = 6 and status <> 'scheduled') then
    raise notice 'Monday Showdown week 6 is no longer scheduled — nothing changed'; return;
  end if;

  -- the cheapest squad from tonight's game: the narrowest spots first (a greedy
  -- pick, so it can overstate the true cheapest a little — never understate)
  spots := _contest_slots(lg);
  for i in (select ord from jsonb_array_elements(spots) with ordinality s(spot, ord) order by jsonb_array_length(spot -> 'pos'), ord) loop
    select ps.slug, ps.salary into pick from pod_salary ps
     where ps.season = '2026' and ps.week = 6 and ps.team in ('WAS', 'SF') and not ps.slug = any (used)
       and upper(ps.pos) in (select upper(x) from jsonb_array_elements_text(spots -> (i::int - 1) -> 'pos') x)
     order by ps.salary, ps.slug limit 1;
    if pick.slug is null then cheapest := null; exit; end if;
    used := array_append(used, pick.slug); cheapest := cheapest + pick.salary;
  end loop;
  cap := case when cheapest is null then null when cheapest <= 30000 then 30000 else ((cheapest + 5000 + 999) / 1000) * 1000 end;
  raise notice 'Monday Showdown: % spots, cheapest WAS/SF squad $%, new budget %', jsonb_array_length(spots), cheapest, coalesce('$' || cap, 'unchanged');
  -- never a raise; with no cut (or no legal squad) the squads are still cleared
  if cap >= _contest_budget(lg) then cap := null; end if;

  if cap is not null then
  update league set settings_json = coalesce(settings_json, '{}'::jsonb) || jsonb_build_object('budget', cap)
       || case when coalesce(nullif(settings_json ->> 'min_spend', '')::int, 0) > cap then '{"min_spend": 0}'::jsonb else '{}'::jsonb end
   where id = lid;
  end if;
  delete from sleeper_lineup where league_id = lid and week = 6;
  get diagnostics n = row_count;
  raise notice 'Monday Showdown: % week-6 squad(s) cleared', n;
  delete from matchup_state ms using matchup m where ms.matchup_id = m.id and m.league_id = lid and m.week = 6;
  if not exists (select 1 from league_message where league_id = lid and kind = 'computer' and body like 'The commissioner %cleared both squads%') then
    insert into league_message (league_id, author_id, kind, body, mentions)
    values (lid, null, 'computer',
      'The commissioner ' || coalesce('cut the budget to $' || to_char(cap, 'FM999,999') || ' and ', '') || 'cleared both squads. Build yours again from WAS and SF before tonight''s 8:15pm ET kickoff. A team with no squad by kickoff gets one built for it.', '{}');
  end if;
end $$;
