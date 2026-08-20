-- 0208 probes: "League Full" — the commissioner's door on the waiting room.
--
-- Worth probing rather than eyeballing because the interesting cases are all
-- about who must NOT be affected: an existing manager, a league with a seat
-- free, a platform league, and the people already queued. A flag that closes
-- more than it was meant to is far worse than one that closes nothing.
\set QUIET on
\pset pager off
set client_min_messages = notice;

-- Own ids and own setter: every suite in this run shares one database, and the
-- common probe_as() lives in a 16-value namespace other suites already use.
create or replace function wl_as(u text) returns void language plpgsql as $$
begin
  perform set_config('app.uid', '00000000-0000-0000-0000-0000000d0a0' || u, false);
  perform set_config('app.email', 'wl' || u || '@test.dev', false);
end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000d0a01', 'wl1@test.dev'),
  ('00000000-0000-0000-0000-0000000d0a02', 'wl2@test.dev'),
  ('00000000-0000-0000-0000-0000000d0a03', 'wl3@test.dev')
on conflict (id) do nothing;

do $$
declare
  lg     uuid;
  plat   uuid;
  u_a    uuid := '00000000-0000-0000-0000-0000000d0a01';
  u_b    uuid := '00000000-0000-0000-0000-0000000d0a02';
  u_c    uuid := '00000000-0000-0000-0000-0000000d0a03';
  r      jsonb;
  got    record;
  n      int;
begin
  insert into app_user (id, email) values (u_a, 'wl1@test.dev'), (u_b, 'wl2@test.dev'), (u_c, 'wl3@test.dev')
    on conflict (id) do nothing;

  -- A native league with ONE seat, already taken by u_a → it is full.
  insert into league (id, sleeper_league_id, name, season, provider, invite_code, commissioner_id)
  values (gen_random_uuid(), 'WAITLIST-DOOR-PROBE', 'Kickoff League', '2026', 'native', 'D00R0001', u_a)
  returning id into lg;
  insert into league_membership (league_id, sleeper_roster_id, app_user_id, enrolled, team_name)
  values (lg, 1, u_a, true, 'Team 1');

  -- 1. THE DEFAULT IS UNCHANGED. A new league waitlists, exactly as 0125 did.
  if not (select waitlist_open from league where id = lg) then
    raise exception 'PROBE FAIL: waitlist_open must default to TRUE — closing must be opt-in';
  end if;
  perform wl_as('2');
  r := native_join('D00R0001', 'Late Arrival');
  if (r ->> 'status') <> 'waitlisted' then
    raise exception 'PROBE FAIL: an open waiting room should waitlist, got %', r;
  end if;

  -- 2. CLOSING THE DOOR. Commissioner only.
  perform wl_as('3');
  r := set_league_waitlist(lg, false);
  if (r ->> 'ok')::boolean then raise exception 'PROBE FAIL: a non-commissioner closed the waiting room'; end if;
  perform wl_as('1');
  r := set_league_waitlist(lg, false);
  if not (r ->> 'ok')::boolean then raise exception 'PROBE FAIL: the commissioner could not close it: %', r; end if;

  -- 3. CLOSING DOES NOT EVICT. u_b queued in step 1 and must still be there —
  --    the flag governs new arrivals, not the people already waiting.
  if (r ->> 'waiting')::int <> 1 then
    raise exception 'PROBE FAIL: closing reported % waiting, expected the 1 already queued', r ->> 'waiting';
  end if;
  select count(*) into n from league_join where league_id = lg and app_user_id = u_b;
  if n <> 1 then raise exception 'PROBE FAIL: closing the door threw someone out of the queue'; end if;

  -- 4. THE DOOR IS SHUT for a new arrival.
  perform wl_as('3');
  r := native_join('D00R0001', 'Too Late');
  if (r ->> 'ok')::boolean then raise exception 'PROBE FAIL: a closed waiting room still accepted a joiner: %', r; end if;
  if (r ->> 'status') <> 'full' then raise exception 'PROBE FAIL: refusal should carry status=full, got %', r; end if;
  if (select count(*) from league_join where league_id = lg and app_user_id = u_c) <> 0 then
    raise exception 'PROBE FAIL: a refused joiner was queued anyway';
  end if;

  -- 5. THE BACK DOOR IS SHUT TOO. join_league writes the same table.
  r := join_league('D00R0001');
  if (r ->> 'ok')::boolean then raise exception 'PROBE FAIL: join_league walked around the closed door: %', r; end if;

  -- 6. AN EXISTING MANAGER IS NEVER LOCKED OUT. u_a holds a team; a closed
  --    waiting room must not turn their own league away.
  perform wl_as('1');
  r := native_join('D00R0001');
  if (r ->> 'status') <> 'enrolled' then
    raise exception 'PROBE FAIL: a closed door locked out an existing manager: %', r;
  end if;

  -- 7. A FREE SEAT BEATS THE FLAG. Closing the waiting room is not closing the
  --    league: open a seat and the next arrival is seated immediately.
  insert into league_membership (league_id, sleeper_roster_id, enrolled) values (lg, 2, false);
  perform wl_as('3');
  r := native_join('D00R0001', 'Seat Two');
  if (r ->> 'status') <> 'enrolled' then
    raise exception 'PROBE FAIL: a closed waiting room blocked a FREE SEAT: %', r;
  end if;

  -- 8. PLATFORM LEAGUES ARE UNTOUCHED — "no open seat" means something else
  --    there, and refusing would break the normal ESPN/Yahoo pool join.
  insert into league (id, sleeper_league_id, name, season, provider, invite_code, waitlist_open)
  values (gen_random_uuid(), 'WAITLIST-PLAT-PROBE', 'Sleeper League', '2026', 'sleeper', 'D00R0002', false)
  returning id into plat;
  perform wl_as('2');
  r := join_league('D00R0002');
  if not (r ->> 'ok')::boolean then
    raise exception 'PROBE FAIL: the flag broke a PLATFORM league join: %', r;
  end if;

  -- 9. THE PREVIEW SAYS IT BEFORE THE SIGN-UP (the point of the whole thing).
  select * into got from league_by_invite('D00R0001');
  if got.waitlist_open then raise exception 'PROBE FAIL: the preview reports the door open when it is shut'; end if;
  if got.seats_open <> 0 then raise exception 'PROBE FAIL: preview seats_open = %, expected 0', got.seats_open; end if;
  select * into got from league_by_invite('D00R0002');
  if got.seats_open is null then raise exception 'PROBE FAIL: seats_open must be a number, not null'; end if;

  delete from league_join where league_id = lg;
  delete from league_membership where league_id in (lg, plat);
  delete from league where id in (lg, plat);
  delete from app_user where id in (u_a, u_b, u_c);
  raise notice 'waitlist-door probes done';
end $$;
select 'ALL WAITLIST-DOOR PROBES PASSED' as result;
