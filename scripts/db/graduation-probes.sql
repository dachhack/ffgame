-- 0367 probes: GRADUATION.
--
--   • THE CLASSIFICATION: every column in the schema that holds a player slug
--     is named here as live, history or feed. A new one fails this suite until
--     someone decides which it is — that is how graduation stays complete;
--   • a rostered devy player moves to his NFL slug with his team, his spot, his
--     keeper mark, queues, pending claims and pending trades; history keeps the
--     college slug; the pool trades a college row for an NFL row carrying the
--     Sleeper id; the alias and the league's record say so;
--   • an existing unrostered NFL row is reused, not duplicated;
--   • if another team rosters the NFL row, that league is left alone and the
--     conflict recorded; other leagues still graduate;
--   • a graduated player may leave his devy spot;
--   • only the worker may graduate anyone.
\set QUIET on
\pset pager off
-- A suite that dies mid-way must not print its closing PASS line (v0.451.0).
\set ON_ERROR_STOP on

create or replace function gr_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function gr_ok(r jsonb, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, false) is not true then raise exception 'PROBE FAIL % — got %', msg, r; end if; end $$;
create or replace function gr_as(u text) returns void language plpgsql as $$
begin perform set_config('app.uid', '00000000-0000-0000-0000-0000000038' || u, false); perform set_config('app.email', 'gr' || u || '@test.dev', false); end $$;

-- ══ gr0. THE CLASSIFICATION ═════════════════════════════════════════════════
do $$
declare known text[] := array[
  -- live: rewritten by graduate_college_player
  'league_pool.slug', 'native_roster.slug', 'keeper_pick.slug', 'contract.slug', 'salary_retention.slug',
  'rfa_tender.slug', 'player_flag.slug', 'draft_queue.slug', 'trade_signal.slug', 'auction_lot.slug',
  'draft.lot_slug', 'waiver_claim.add_slug', 'waiver_claim.drop_slug', 'favorite_player.player_slug',
  -- history: keeps the college slug
  'draft_pick.slug', 'draft_event.slug', 'league_txn.slug', 'dead_money.slug', 'vampire_steal.give_slug',
  'vampire_steal.take_slug', 'player_adjustment.slug', 'sealed_pick.player_slug', 'live_play.player_slug',
  -- the alias itself
  'player_alias.old_slug', 'player_alias.new_slug', 'college_graduation.new_slug',
  -- feed: NFL boards keyed by the feeds
  'adp_board.slug', 'dyn_board.slug', 'market_board.slug', 'player_market.slug', 'proj_board.slug',
  'trend_board.slug', 'player_depth.slug', 'player_team_override.slug', 'injury_status.player_slug',
  'pod_salary.slug', 'team_kdst.dst_slug', 'team_kdst.k_slug'];
  c text;
begin
  for c in
    select table_name || '.' || column_name from information_schema.columns
     where table_schema = 'public' and column_name ilike '%slug%'
       and table_name in (select table_name from information_schema.tables
                           where table_schema = 'public' and table_type = 'BASE TABLE')
       and table_name not like '\_%'
  loop
    if not (c = any(known)) then
      raise exception 'PROBE FAIL gr0 % holds a player slug and is not classified for graduation (0367) — add it to graduate_college_player or to the history/feed list here', c;
    end if;
  end loop;
end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000003801', 'gr01@test.dev'),
  ('00000000-0000-0000-0000-000000003802', 'gr02@test.dev')
  on conflict (id) do nothing;
insert into app_user (id, email) values
  ('00000000-0000-0000-0000-000000003801', 'gr01@test.dev'),
  ('00000000-0000-0000-0000-000000003802', 'gr02@test.dev')
  on conflict (id) do nothing;
update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
 where id in ('00000000-0000-0000-0000-000000003801', '00000000-0000-0000-0000-000000003802');
insert into app_admin (email, note) values ('gr01@test.dev', 'graduation probe admin') on conflict (email) do nothing;

do $$
declare r jsonb; a uuid; b uuid; c uuid; code text; tid uuid;
begin
  perform gr_as('01');
  -- Three devy leagues holding the same college player, c-93801.
  r := create_native_league('Grad A', '2024', 2, 8, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  a := (r ->> 'league_id')::uuid; code := r ->> 'invite_code';
  perform gr_as('02'); perform gr_ok(native_join(code, 'GR-2'), 'gr join a'); perform gr_as('01');
  r := create_native_league('Grad B', '2024', 2, 8, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  b := (r ->> 'league_id')::uuid;
  r := create_native_league('Grad C', '2024', 2, 8, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  c := (r ->> 'league_id')::uuid;
  perform gr_ok(set_league_position_access(a, '["COLLEGE"]'::jsonb), 'gr a college');
  perform gr_ok(set_league_position_access(b, '["COLLEGE"]'::jsonb), 'gr b college');
  perform gr_ok(set_league_position_access(c, '["COLLEGE"]'::jsonb), 'gr c college');
  perform gr_ok(set_league_roster_shape(a, 2, 0, 0, 0, 2), 'gr a devy');
  perform gr_ok(set_league_roster_shape(b, 2, 0, 0, 0, 2), 'gr b devy');
  perform gr_ok(set_league_roster_shape(c, 2, 0, 0, 0, 2), 'gr c devy');
  perform gr_ok(seed_league_pool(a, '[{"slug":"c-93801","full":"Future Star","pos":"WR"},{"slug":"gr-vet","full":"Gr Vet","pos":"WR","team":"BUF"}]'::jsonb), 'gr pool a');
  -- B already has the NFL row (unrostered); C has it rostered by the other team.
  perform gr_ok(seed_league_pool(b, '[{"slug":"c-93801","full":"Future Star","pos":"WR"},{"slug":"future-star","full":"Future Star","pos":"WR","team":"NYG","sleeper_id":"s93801"}]'::jsonb), 'gr pool b');
  perform gr_ok(seed_league_pool(c, '[{"slug":"c-93801","full":"Future Star","pos":"WR"},{"slug":"future-star","full":"Future Star","pos":"WR","team":"NYG","sleeper_id":"s93801"}]'::jsonb), 'gr pool c');

  insert into native_roster (league_id, roster_id, slug) values (a, 1, 'c-93801'), (a, 2, 'gr-vet'),
                                                               (b, 1, 'c-93801'),
                                                               (c, 1, 'c-93801'), (c, 2, 'future-star');
  -- Live rows in A: a keeper mark, a queue, a pending claim, a pending trade.
  insert into keeper_pick (league_id, roster_id, slug) values (a, 1, 'c-93801');
  insert into draft_queue (league_id, roster_id, slug, pos) values (a, 2, 'c-93801', 1);
  insert into waiver_claim (league_id, roster_id, add_slug, drop_slug, status) values (a, 2, 'gr-vet', 'c-93801', 'pending');
  insert into trade_proposal (league_id, from_roster, to_roster, give, get, status)
    values (a, 1, 2, '["c-93801"]'::jsonb, '["gr-vet"]'::jsonb, 'pending') returning id into tid;
  insert into trade_leg (trade_id, league_id, roster_id, send)
    values (tid, a, 1, '[{"slug":"c-93801","to":2}]'::jsonb);
  -- History in A: a register line, and an OLD trade that must not change.
  insert into league_txn (league_id, kind, roster_id, slug) values (a, 'add', 1, 'c-93801');
  insert into trade_proposal (league_id, from_roster, to_roster, give, get, status)
    values (a, 1, 2, '["c-93801"]'::jsonb, '[]'::jsonb, 'rejected');
  insert into favorite_player (app_user_id, player_slug) values ('00000000-0000-0000-0000-000000003801', 'c-93801');

  -- ══ gr1. ONLY THE WORKER ═════════════════════════════════════════════════
  perform gr_true(not has_function_privilege('authenticated', 'graduate_college_player(text, text, text, text, text, text)', 'execute'),
    'gr1 a signed-in user cannot graduate anyone');
  perform gr_true(exists (select 1 from graduation_candidates() where espn_id = '93801' and leagues = 3),
    'gr1a the worklist names him once, across three leagues');

  -- ══ gr2. GRADUATE ════════════════════════════════════════════════════════
  r := graduate_college_player('93801', 'future-star', 'Future Star', 'WR', 'NYG', 's93801');
  perform gr_ok(r, 'gr2');
  perform gr_true((r ->> 'leagues')::int = 2 and (r ->> 'conflicts')::int = 1, 'gr2 two leagues done, one conflict: ' || r::text);

  -- League A: a fresh NFL row, and everything live moved.
  perform gr_true((select sleeper_id = 's93801' and espn_id = '93801' and team = 'NYG' and level = 'nfl'
                     from league_pool where league_id = a and slug = 'future-star'), 'gr2a A gets an NFL pool row with the ids');
  perform gr_true(not exists (select 1 from league_pool where league_id = a and slug = 'c-93801'), 'gr2b the college row is gone');
  perform gr_true((select roster_id = 1 and spot = 'devy' from native_roster where league_id = a and slug = 'future-star'),
    'gr2c same team, still in his devy spot');
  perform gr_true(exists (select 1 from keeper_pick where league_id = a and slug = 'future-star'), 'gr2d keeper mark moved');
  perform gr_true(exists (select 1 from draft_queue where league_id = a and roster_id = 2 and slug = 'future-star'), 'gr2e queue moved');
  perform gr_true((select drop_slug from waiver_claim where league_id = a and add_slug = 'gr-vet') = 'future-star', 'gr2f pending claim moved');
  perform gr_true((select give from trade_proposal where id = tid) = '["future-star"]'::jsonb, 'gr2g pending trade moved');
  perform gr_true((select send from trade_leg where trade_id = tid) = '[{"slug":"future-star","to":2}]'::jsonb, 'gr2h its leg moved');
  perform gr_true(exists (select 1 from league_txn where league_id = a and slug = 'c-93801'), 'gr2i the register keeps history');
  perform gr_true(exists (select 1 from trade_proposal where league_id = a and status = 'rejected' and give = '["c-93801"]'::jsonb),
    'gr2j an old trade keeps history');
  perform gr_true(current_slug('c-93801') = 'future-star', 'gr2k the alias reads old as new');
  perform gr_true(exists (select 1 from favorite_player where player_slug = 'future-star')
    and not exists (select 1 from favorite_player where player_slug = 'c-93801'), 'gr2l a favorite follows him');

  -- League B: the existing NFL row is reused.
  perform gr_true((select count(*) from league_pool where league_id = b and sleeper_id = 's93801') = 1, 'gr2m B keeps one NFL row');
  perform gr_true((select roster_id from native_roster where league_id = b and slug = 'future-star') = 1, 'gr2n B moved him onto it');

  -- League C: left alone.
  perform gr_true(exists (select 1 from native_roster where league_id = c and slug = 'c-93801' and roster_id = 1)
    and exists (select 1 from native_roster where league_id = c and slug = 'future-star' and roster_id = 2),
    'gr2o C is untouched when two teams hold him');
  perform gr_true((select status = 'conflict' and note like 'Team 1 holds him as a devy player%'
                     from college_graduation where espn_id = '93801' and league_id = c), 'gr2p and the conflict is recorded');
  perform gr_true((select status from college_graduation where espn_id = '93801' and league_id = a) = 'done', 'gr2q A recorded done');

  -- ══ gr3. OUT OF DEVY ═════════════════════════════════════════════════════
  delete from native_roster where league_id = a and roster_id = 1 and slug <> 'future-star';
  r := set_roster_spot(a, 'future-star', 'active');
  perform gr_ok(r, 'gr3 a graduate may leave his devy spot');
  r := set_roster_spot(a, 'future-star', 'devy');
  perform gr_true((r ->> 'ok')::boolean is false, 'gr3a and cannot go back');

  -- A second run finds nothing left in A or B.
  r := graduate_college_player('93801', 'future-star', 'Future Star', 'WR', 'NYG', 's93801');
  perform gr_true((r ->> 'leagues')::int = 0, 'gr4 re-running is harmless');

  delete from league_pool where league_id in (a, b, c);
  delete from favorite_player where player_slug = 'future-star';
  raise notice 'graduation probes done';
end $$;

select 'ALL GRADUATION PROBES PASSED' as result;
