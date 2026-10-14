-- 0504 probes (#1311): a claim isn't voided by an injury tag that changed
-- after it was filed; a roster over a hard limit still loses, and says why.
\set QUIET on
\pset pager off
\set ON_ERROR_STOP on

create or replace function tl_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function tl_ok(r jsonb, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, false) is not true then raise exception 'PROBE FAIL % — got %', msg, r; end if; end $$;
create or replace function tl_as(u text) returns void language plpgsql as $$
begin perform set_config('app.uid', '00000000-0000-0000-0000-0000000081' || u, false); perform set_config('app.email', 'tl' || u || '@test.dev', false); end $$;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000008101', 'tl01@test.dev'), ('00000000-0000-0000-0000-000000008102', 'tl02@test.dev') on conflict (id) do nothing;
insert into app_user (id, email) values ('00000000-0000-0000-0000-000000008101', 'tl01@test.dev'), ('00000000-0000-0000-0000-000000008102', 'tl02@test.dev') on conflict (id) do nothing;
update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb where id::text like '00000000-0000-0000-0000-0000000081%';

do $$
declare r jsonb; lid uuid; code text; pool jsonb := '[]'::jsonb; i int; d draft%rowtype; pick text;
        stash text; dropme text; cid uuid; free1 text; free2 text;
begin
  perform tl_as('01');
  r := create_native_league('Tag Lapse', '2026', 2, 6, 60);
  lid := (r ->> 'league_id')::uuid; code := r ->> 'invite_code';
  perform tl_as('02'); perform tl_ok(native_join(code, 'TL-2'), 'tl0 join'); perform tl_as('01');
  for i in 1..30 loop
    pool := pool || jsonb_build_object('slug', 'tl-' || lpad(i::text, 2, '0'), 'full', 'Tl ' || i,
      'pos', (array['QB','RB','WR','TE','RB','WR'])[1 + (i % 6)], 'team', 'BUF');
  end loop;
  perform tl_ok(seed_league_pool(lid, pool), 'tl0 pool');
  perform tl_ok(start_draft(lid, '[1,2]'::jsonb), 'tl0 start');
  loop
    select * into d from draft where league_id = lid; exit when d.status <> 'live';
    pick := native_autopick_slug(lid, draft_on_clock(d), d.rounds);
    perform tl_ok(native_exec_pick(lid, pick, true), 'tl0 pick');
  end loop;

  -- seat 1 stashes an Out player on IR — legal under IR/O
  select slug into stash from native_roster where league_id = lid and roster_id = 1 order by slug limit 1;
  select slug into dropme from native_roster where league_id = lid and roster_id = 1 and slug <> stash order by slug limit 1;
  insert into injury_status (player_slug, status) values (stash, 'O') on conflict (player_slug) do update set status = 'O';
  update native_roster set spot = 'ir' where league_id = lid and roster_id = 1 and slug = stash;
  perform tl_true(roster_illegal_reason(lid, 1) is null, 'tl1 an Out player on IR is legal');

  select lp.slug into free1 from league_pool lp where lp.league_id = lid
     and not exists (select 1 from native_roster nr where nr.league_id = lid and nr.slug = lp.slug) order by lp.slug limit 1;
  select lp.slug into free2 from league_pool lp where lp.league_id = lid and lp.slug <> free1
     and not exists (select 1 from native_roster nr where nr.league_id = lid and nr.slug = lp.slug) order by lp.slug limit 1;
  -- a 1-for-1 claim, filed while legal
  insert into waiver_claim (league_id, roster_id, add_slug, drop_slug) values (lid, 1, free1, dropme) returning id into cid;

  -- overnight the feed moves him to Doubtful
  update injury_status set status = 'D' where player_slug = stash;
  perform tl_true(roster_illegal_reason(lid, 1) like '%on IR but isn''t designated%', 'tl2 the roster is now illegal for the tag');
  perform tl_true(roster_hard_limit_reason(lid, 1) is null, 'tl2a but over no hard limit');
  perform process_waivers(lid);
  perform tl_true((select status from waiver_claim where id = cid) = 'won',
    'tl3 the claim still goes through (got ' || (select status || ' / ' || coalesce(note, '') from waiver_claim where id = cid) || ')');
  perform tl_true(exists (select 1 from native_roster where league_id = lid and roster_id = 1 and slug = free1)
    and not exists (select 1 from native_roster where league_id = lid and roster_id = 1 and slug = dropme), 'tl3a the swap landed');
  perform tl_true(roster_illegal_reason(lid, 1) like '%on IR but isn''t designated%', 'tl3b and the tag is still his to fix');

  -- a roster over its size still loses, and the note says why
  insert into native_roster (league_id, roster_id, slug, acquired)
    select lid, 2, lp.slug, 'commish' from league_pool lp where lp.league_id = lid
       and not exists (select 1 from native_roster nr where nr.league_id = lid and nr.slug = lp.slug)
       and lp.slug <> free2 order by lp.slug limit 1;
  select slug into dropme from native_roster where league_id = lid and roster_id = 2 order by slug limit 1;
  insert into waiver_claim (league_id, roster_id, add_slug, drop_slug) values (lid, 2, free2, dropme) returning id into cid;
  perform process_waivers(lid);
  perform tl_true((select status from waiver_claim where id = cid) = 'lost'
    and (select note from waiver_claim where id = cid) like 'roster over limits — roster holds 7 players (limit 6)%',
    'tl4 an oversized roster loses, with the reason (got ' || (select status || ' / ' || coalesce(note, '') from waiver_claim where id = cid) || ')');
  raise notice 'claim tag lapse probes done';
end $$;

select 'ALL CLAIM-TAG-LAPSE PROBES PASSED' as result;
