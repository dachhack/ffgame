-- 0518 · MONDAY SHOWDOWN: QBs $2,000 OFF, AS A $32,000 CAP (v0.730.33)
--
-- Founder, over tonight's WAS@SF board: "Let's discount QBs in this league by
-- $2000". The board (pod_salary) is shared by every league, and there is no
-- per-league price adjustment. But this league's squad is QB, RB, RB, WR, WR,
-- TE, K, DEF: exactly one QB spot and no flex. So $2,000 off every QB takes
-- exactly $2,000 off every possible squad, which is the same as raising the
-- cap from $30,000 to $32,000. Squads already saved stay legal. The board
-- still shows the QBs' listed prices; the chat note explains. Only while
-- WAS@SF hasn't kicked off and the cap is still 0517's $30,000; the note is
-- posted once.

do $$
declare lid uuid := 'ec3c4c2d-63a1-4f27-8844-a7d132e53a11'; lg league;
begin
  select * into lg from league where id = lid and name = 'Monday Showdown';
  if lg.id is null then raise notice 'Monday Showdown not found — nothing to do'; return; end if;
  if exists (select 1 from nfl_slate where season = '2026' and week = 6 and 'WAS' in (home, away) and kickoff is not null and kickoff <= now()) then
    raise notice 'Monday Showdown: WAS@SF has kicked off — nothing changed'; return;
  end if;
  if _contest_budget(lg) <> 30000 or jsonb_array_length(_contest_slots(lg)) <> 8
     or (select count(*) from jsonb_array_elements(_contest_slots(lg)) s where s -> 'pos' ? 'QB') <> 1
     or exists (select 1 from jsonb_array_elements(_contest_slots(lg)) s where s -> 'pos' ? 'QB' and jsonb_array_length(s -> 'pos') > 1) then
    raise notice 'Monday Showdown: cap %, or not one QB-only spot — nothing changed', _contest_budget(lg); return;
  end if;
  update league set settings_json = settings_json || '{"budget": 32000}'::jsonb where id = lid;
  raise notice 'Monday Showdown: budget $30,000 → $32,000 (QBs $2,000 off)';
  if not exists (select 1 from league_message where league_id = lid and kind = 'computer' and body like 'QBs are $2,000 off tonight%') then
    insert into league_message (league_id, author_id, kind, body, mentions)
    values (lid, null, 'computer',
      'QBs are $2,000 off tonight. Every squad has one QB, so the cap went up from $30,000 to $32,000 instead. The board still shows the QBs'' listed prices: Purdy $8,600 plays as $6,600, Daniels $6,500 as $4,500.', '{}');
  end if;
end $$;
