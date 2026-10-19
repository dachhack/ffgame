-- 0519 · MONDAY SHOWDOWN'S CAP TO $31,000 (v0.730.34)
--
-- Founder: "Farmer Casey can play a QB and Kittle … He says the app won't let
-- him." Under 0517's $30,000 cap with 0518's QB discount, Purdy ($6,600) +
-- Kittle ($5,900) + the cheapest RB, RB, WR, WR, K and DEF ($18,100) comes to
-- $30,600, $600 over. Asked to raise the cap or deepen the discount: "Make the
-- cap $31k". Only while WAS@SF hasn't kicked off and the cap is still $30,000;
-- the note is posted once.

do $$
declare lid uuid := 'ec3c4c2d-63a1-4f27-8844-a7d132e53a11'; lg league;
begin
  select * into lg from league where id = lid and name = 'Monday Showdown';
  if lg.id is null then raise notice 'Monday Showdown not found — nothing to do'; return; end if;
  if exists (select 1 from nfl_slate where season = '2026' and week = 6 and 'WAS' in (home, away) and kickoff is not null and kickoff <= now()) then
    raise notice 'Monday Showdown: WAS@SF has kicked off — nothing changed'; return;
  end if;
  if _contest_budget(lg) <> 30000 then raise notice 'Monday Showdown: cap is $% — nothing changed', _contest_budget(lg); return; end if;
  update league set settings_json = settings_json || '{"budget": 31000}'::jsonb where id = lid;
  raise notice 'Monday Showdown: cap $30,000 → $31,000';
  if not exists (select 1 from league_message where league_id = lid and kind = 'computer' and body like 'The cap is now $31,000%') then
    insert into league_message (league_id, author_id, kind, body, mentions)
    values (lid, null, 'computer', 'The cap is now $31,000, so a squad with Purdy and Kittle fits. QBs are still $2,000 off.', '{}');
  end if;
end $$;
