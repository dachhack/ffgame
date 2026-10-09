-- 0457: A CLAIMED SEAT IS HUMAN (v0.655.1).
--
-- Founder: "Can we allow commish to set unclaimed seats as AI controlled?"
-- set_team_controller (0022) has always accepted an open seat, and the web's
-- seat list shows 🤖 on every row; the app's SEATS sheet now does too. What
-- was missing is the way back: none of the claim paths (native_join,
-- admin_assign_roster, commish_claim_roster, claim_my_rosters,
-- claim_platform_seat, the imports) touch `controller`, so a person who
-- claimed a 🤖 seat arrived on auto-pilot: the AI re-planning their lineup
-- every tick, spending their coin, drafting for them.
--
-- The rule, at the row: when a seat goes from nobody to somebody and it was
-- 🤖, it becomes 👤. No flow seats a person straight onto auto-pilot (the
-- mock draft and practice room bots are never claimed; rollovers insert new
-- rows), and the person can hand it back to the AI themselves, as any
-- manager can, once they are in it.
create or replace function _claimed_seat_is_human() returns trigger
  language plpgsql as $$
begin
  if old.app_user_id is null and new.app_user_id is not null
     and new.controller = 'ai' then
    new.controller := 'human';
    new.controller_set_at := now();
    new.controller_set_by := new.app_user_id;
  end if;
  return new;
end $$;
drop trigger if exists claimed_seat_is_human on league_membership;
create trigger claimed_seat_is_human before update of app_user_id on league_membership
  for each row execute function _claimed_seat_is_human();
