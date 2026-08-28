-- 0250 probes: the admin stamp-week lever (the vampire/guillotine playtest).
--
-- The lever exists to complete sandbox weeks on demand, so what these pin is
-- (1) THE DOUBLE GATE — not an admin: refused; admin but no LIVE TEST flag:
-- refused — because this function writes finals and must never reach a real
-- league; (2) the stamp itself — every matchup final with scores, default
-- week walking forward, a stamped week refusing a second stamp; and (3) the
-- STORY KNOBS actually steering the formats: p_doom chooses the guillotine's
-- victim, p_favor opens (and its absence closes) the vampire's steal window.
\set QUIET on
\pset pager off
set client_min_messages = notice;

create or replace function sw_as(u text) returns void language plpgsql as $$
begin
  perform set_config('app.uid', '00000000-0000-0000-0000-0000000c0de' || u, false);
  perform set_config('app.email', 'sw' || u || '@test.dev', false);
end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000c0de1', 'sw1@test.dev')
on conflict (id) do nothing;

-- League shell + finished draft + schedule (the season-sim fixture, sw-flavored).
create or replace function _sw_league(nm text, pfx text, fmt text, wks int)
  returns uuid language plpgsql as $$
declare r jsonb; lid uuid; pool jsonb := '[]'::jsonb; t int; i int;
begin
  perform sw_as('1');
  r := create_native_league(nm, '2026', 4, 5, 60, 'snake');
  if not (r ->> 'ok')::boolean then raise exception 'SW FIXTURE: create failed — %', r; end if;
  lid := (r ->> 'league_id')::uuid;
  for i in 1..28 loop
    pool := pool || jsonb_build_object('slug', pfx || i, 'full', 'P ' || i, 'pos', 'RB', 'team', 'T');
  end loop;
  r := seed_league_pool(lid, pool);
  if not (r ->> 'ok')::boolean then raise exception 'SW FIXTURE: seed failed — %', r; end if;
  r := set_league_format(lid, fmt);
  if not (r ->> 'ok')::boolean then raise exception 'SW FIXTURE: format failed — %', r; end if;
  if fmt = 'vampire' then
    r := set_vampire(lid, 2);
    if not (r ->> 'ok')::boolean then raise exception 'SW FIXTURE: vampire seat failed — %', r; end if;
  end if;
  update draft set status = 'complete' where league_id = lid;
  for t in 1..4 loop
    for i in 1..5 loop
      insert into native_roster (league_id, roster_id, slug, acquired)
      values (lid, t, pfx || ((t - 1) * 5 + i), 'commish');
    end loop;
  end loop;
  r := native_generate_schedule(lid, wks);
  if not (r ->> 'ok')::boolean then raise exception 'SW FIXTURE: schedule failed — %', r; end if;
  return lid;
end $$;

do $$
declare lid uuid; vlid uuid; r jsonb; n int; doomed int; victim int; opp2 int;
begin
  perform sw_as('1');
  insert into app_user (id, email) values ('00000000-0000-0000-0000-0000000c0de1', 'sw1@test.dev')
  on conflict (id) do nothing;
  update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
    where id = '00000000-0000-0000-0000-0000000c0de1';

  lid := _sw_league('Stamp Guillotine', 'swg-', 'guillotine', 4);

  -- ══ THE DOUBLE GATE ═══════════════════════════════════════════════════════
  -- Commissioner, but not an admin → the door stays shut.
  r := admin_stamp_week(lid);
  if (r ->> 'ok')::boolean or (r ->> 'error') <> 'forbidden' then
    raise exception 'SW1 FAIL: a non-admin stamped a week — %', r;
  end if;
  -- Admin, but the league is not a LIVE TEST sandbox → still shut.
  insert into app_admin (email) values ('sw1@test.dev') on conflict do nothing;
  r := admin_stamp_week(lid);
  if (r ->> 'ok')::boolean or position('sandbox' in (r ->> 'error')) = 0 then
    raise exception 'SW2 FAIL: stamped without the LIVE TEST flag — %', r;
  end if;

  -- ══ THE STAMP ═════════════════════════════════════════════════════════════
  r := admin_set_test_live(lid, true);
  if not (r ->> 'ok')::boolean then raise exception 'SW3 FAIL: live-test flip refused — %', r; end if;
  r := admin_stamp_week(lid);   -- no week given: the earliest unstamped (1)
  if not (r ->> 'ok')::boolean or (r ->> 'week')::int <> 1 or (r ->> 'stamped')::int < 1 then
    raise exception 'SW3 FAIL: default stamp did not take week 1 — %', r;
  end if;
  select count(*) into n from matchup
    where league_id = lid and week = 1
      and (status <> 'final' or home_final is null or away_final is null);
  if n <> 0 then raise exception 'SW3 FAIL: week 1 still has % unstamped matchups', n; end if;

  -- The guillotine fired with the stamp: exactly one seat fell.
  if (r ->> 'eliminated')::int <> 1 then
    raise exception 'SW4 FAIL: the blade did not fall with the stamp — %', r;
  end if;
  select count(*) into n from league_membership
    where league_id = lid and eliminated_week = 1;
  if n <> 1 then raise exception 'SW4 FAIL: expected 1 seat eliminated in week 1, found %', n; end if;

  -- ══ p_doom CHOOSES THE VICTIM ═════════════════════════════════════════════
  select min(sleeper_roster_id) into doomed from league_membership
    where league_id = lid and eliminated_week is null;
  r := admin_stamp_week(lid, null, null, doomed);
  if not (r ->> 'ok')::boolean or (r ->> 'week')::int <> 2 then
    raise exception 'SW5 FAIL: second stamp did not take week 2 — %', r;
  end if;
  if not exists (select 1 from league_membership
                 where league_id = lid and sleeper_roster_id = doomed and eliminated_week = 2) then
    raise exception 'SW5 FAIL: the doomed seat % survived week 2', doomed;
  end if;

  -- ══ A STAMPED WEEK REFUSES A SECOND STAMP ═════════════════════════════════
  r := admin_stamp_week(lid, 1);
  if (r ->> 'ok')::boolean then raise exception 'SW6 FAIL: week 1 stamped twice — %', r; end if;
  -- …and the default keeps walking forward.
  r := admin_stamp_week(lid);
  if not (r ->> 'ok')::boolean or (r ->> 'week')::int <> 3 then
    raise exception 'SW6 FAIL: default did not advance to week 3 — %', r;
  end if;

  -- ══ p_favor OPENS THE VAMPIRE'S WINDOW ════════════════════════════════════
  vlid := _sw_league('Stamp Vampire', 'swv-', 'vampire', 4);
  perform admin_set_test_live(vlid, true);
  r := admin_stamp_week(vlid, null, 2);          -- favor the vampire (seat 2)
  if not (r ->> 'ok')::boolean or not (r ->> 'vampire_won')::boolean then
    raise exception 'SW7 FAIL: favoring the vampire did not win its matchup — %', r;
  end if;
  select case when home_roster_id = 2 then away_roster_id else home_roster_id end
    into victim from matchup where league_id = vlid and week = 1 and 2 in (home_roster_id, away_roster_id);
  r := vampire_steal(vlid, 'swv-' || ((victim - 1) * 5 + 1), 'swv-6');
  if not (r ->> 'ok')::boolean then
    raise exception 'SW7 FAIL: the steal window did not open on a stamped win — %', r;
  end if;

  -- ══ …AND ITS ABSENCE CLOSES IT ════════════════════════════════════════════
  select case when home_roster_id = 2 then away_roster_id else home_roster_id end
    into opp2 from matchup where league_id = vlid and week = 2 and 2 in (home_roster_id, away_roster_id);
  r := admin_stamp_week(vlid, null, opp2);       -- favor the OPPONENT: vampire loses
  if not (r ->> 'ok')::boolean or (r ->> 'vampire_won')::boolean then
    raise exception 'SW8 FAIL: favoring the opponent still let the vampire win — %', r;
  end if;
  r := vampire_steal(vlid, 'swv-' || ((opp2 - 1) * 5 + 1), 'swv-7');
  if (r ->> 'ok')::boolean then
    raise exception 'SW8 FAIL: a steal landed off a LOST week — %', r;
  end if;

  raise notice 'stamp-week probes done';
end $$;

select 'ALL STAMP-WEEK PROBES PASSED' as result;
