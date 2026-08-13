-- 0128: ILLEGAL ROSTERS LOSE POWER-UPS TOO — and the lockout says so properly.
--
-- The picks half of this lockout has existed since 0072: enforce_legal_roster
-- fires on every sealed_pick write and rejects managers whose native-league
-- roster is over its size or position limits. Two things were still wrong:
--
--   · POWER-UPS WEREN'T COVERED. Every application — arm_buff, arm_unlock,
--     hero_set_buffs, buy_extra_slot, apply_targeted, use_spy, and the
--     client's own upserts — lands in applied_state, and applied_state had no
--     trigger. A manager sitting on 16/15 players couldn't set a lineup but
--     could keep arming buffs onto the one the server still had. Attaching
--     the SAME trigger to applied_state closes that in one line, and because
--     an RPC's wallet spend and its applied_state insert share a transaction,
--     a blocked apply rolls the charge back too — no coin lost.
--
--   · THE MESSAGE UNDERSOLD IT. "fix your roster to set lineups" didn't
--     mention power-ups and didn't say the way out. The exception text IS the
--     user-facing message on both hosts (friendlyError passes it through, and
--     the web board surfaces autosave failures), so it now names both locks
--     and the exit.
--
-- Kept from 0072 deliberately:
--   · the admin exemption (is_admin() passes) — admins repairing a league
--     shouldn't be fighting the lockout. This is also why the lock can LOOK
--     missing to an admin testing their own league: it never applies to them.
--   · the worker skip (auth.uid() null) — locking, reveals, cleanup.
--   · drops always work: drops don't write these tables, and they're the way
--     back to legal.

create or replace function enforce_legal_roster() returns trigger
  language plpgsql security definer set search_path = public as $$
declare lg uuid; rid int; reason text;
begin
  if auth.uid() is null or is_admin() then return new; end if;
  select m.league_id into lg from matchup m where m.id = new.matchup_id;
  if lg is null or not is_native_league(lg) then return new; end if;
  select sleeper_roster_id into rid from league_membership
    where league_id = lg and app_user_id = new.app_user_id and enrolled
    order by sleeper_roster_id limit 1;
  if rid is null then return new; end if;
  reason := roster_illegal_reason(lg, rid);
  if reason is not null then
    raise exception 'Roster over its limits — %. Picks and power-ups are locked until it''s legal; drops always work (MY TEAM).', reason;
  end if;
  return new;
end $$;

-- The sealed_pick trigger (0072) picks up the new message through the shared
-- function. applied_state gets the same trigger — same columns, same check.
drop trigger if exists enforce_legal_roster on applied_state;
create trigger enforce_legal_roster before insert or update on applied_state
  for each row execute function enforce_legal_roster();
