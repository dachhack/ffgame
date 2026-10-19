-- 0510 · THE CARDS A REFUSED PLAY KEPT (v0.730.21, #1372)
--
-- Asked from chat in Gridiron Gang (Oct 19): "Looks like the power ups
-- disappeared." Ops 071/072: seat 11 bought Grudge Match and Double or Nothing
-- on Oct 18 at 19:39 UTC, the board spent both cards seconds later
-- (consume_inventory), and neither is armed on its week 6 matchup. The web
-- board spent a card before apply_targeted answered, so a refused play kept
-- the card (fixed in the app, v0.730.21). This puts those two cards back in
-- seat 11's hand, by the books: purchases − armed plays − cards held. Only
-- what is owed is added, so the file is a no-op if the cards are back
-- already. Week 6's Monday night window is still open for them.
do $$
declare lg uuid := '798acff0-e0bb-4e11-9e1b-4a3bb29525bd'; seat int := 11; uid uuid;
        p text; bought int; armed int; held int; owed int;
begin
  select app_user_id into uid from league_membership where league_id = lg and sleeper_roster_id = seat;
  if uid is null then raise notice '0510: no such seat — nothing to do'; return; end if;
  foreach p in array array['double-or-nothing', 'grudge'] loop
    bought := powerup_purchases(lg, seat, p);
    armed := coalesce((select sum(targeted_applies(coalesce(a.payload_json -> 'targeted', '{}'::jsonb), p))::int
                         from applied_state a join matchup m on m.id = a.matchup_id
                        where a.app_user_id = uid and m.league_id = lg), 0);
    held := coalesce((select qty from team_inventory where league_id = lg and roster_id = seat and powerup_id = p), 0);
    owed := bought - armed - held;
    raise notice '0510: % bought % armed % held % → owed %', p, bought, armed, held, owed;
    if owed > 0 then perform bump_inventory(lg, seat, p, owed); end if;
  end loop;
end $$;
