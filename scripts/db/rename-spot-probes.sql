-- 0201 rename-a-spot probes.
--
--   • post-draft, a spot's LABEL may be changed — and only the label;
--   • a same-length save carrying only renames is accepted (the old guard
--     refused every one of them before the comparison loop even ran);
--   • changing what a spot ACCEPTS is still refused, as are best ball, the
--     per-spot filters and the zero-fill;
--   • the 0181 shrink hatch still works, and still refuses a grow;
--   • and pre-draft nothing changed at all.
\set QUIET on
\pset pager off

create or replace function assert_ok(r jsonb, msg text) returns void language plpgsql as $$
begin
  if coalesce((r ->> 'ok')::boolean, false) is not true then
    raise exception 'PROBE FAIL % — got %', msg, r;
  end if;
end $$;
create or replace function assert_err(r jsonb, needle text, msg text) returns void language plpgsql as $$
begin
  if coalesce((r ->> 'ok')::boolean, false) then raise exception 'PROBE FAIL % — expected error, got ok: %', msg, r; end if;
  if position(needle in coalesce(r ->> 'error', '')) = 0 then
    raise exception 'PROBE FAIL % — expected error like "%", got %', msg, needle, r;
  end if;
end $$;
create or replace function assert_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function probe_as(u text) returns void language plpgsql as $$
begin
  perform set_config('app.uid', '00000000-0000-0000-0000-00000000000' || u, false);
  perform set_config('app.email', u || '@test.dev', false);
end $$;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'a@test.dev')
on conflict (id) do nothing;

do $$
declare r jsonb; lid uuid;
begin
  insert into app_user (id, email) values ('00000000-0000-0000-0000-00000000000a', 'a@test.dev')
    on conflict (id) do nothing;
  update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
    where id = '00000000-0000-0000-0000-00000000000a';
  perform probe_as('a');

  r := create_native_league('Rename', '2024', 2, 8, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  perform assert_ok(r, 'rn0 classic league'); lid := (r ->> 'league_id')::uuid;

  -- ══ PRE-DRAFT: UNCHANGED ═════════════════════════════════════════════════
  perform assert_ok(set_league_classic_slots(lid,
    '[{"pos":["QB"],"label":"Signal Caller"},{"pos":["RB"]},{"pos":["RB","WR","TE"],"bb":true}]'::jsonb),
    'rn1 the lineup saves before the draft');
  perform assert_ok(set_league_classic_slots(lid,
    '[{"pos":["QB"],"label":"Signal Caller"},{"pos":["WR"]},{"pos":["RB","WR","TE"],"bb":true}]'::jsonb),
    'rn1a …and anything about it may still change');
  perform assert_ok(set_league_classic_slots(lid,
    '[{"pos":["QB"],"label":"Signal Caller"},{"pos":["RB"]},{"pos":["RB","WR","TE"],"bb":true}]'::jsonb),
    'rn1b put it back');

  -- ══ THE DRAFT SHUTS THE DOOR ═════════════════════════════════════════════
  update draft set status = 'complete' where league_id = lid;

  -- …except on the name. THE FOUNDER'S CASE: rename one spot, change nothing
  -- else, same number of spots.
  r := set_league_classic_slots(lid,
    '[{"pos":["QB"],"label":"Signal Caller"},{"pos":["RB"],"label":"Nate''s Revenge"},{"pos":["RB","WR","TE"],"bb":true}]'::jsonb);
  perform assert_ok(r, 'rn2 THE POINT: a spot may be renamed after the draft');
  perform assert_true((r -> 'slots' -> 1 ->> 'label') = 'Nate''s Revenge', 'rn2a …and the new name is what is stored');
  perform assert_true((r -> 'slots' -> 0 ->> 'label') = 'Signal Caller', 'rn2b …with the others untouched');
  -- Clearing a name is a rename too.
  r := set_league_classic_slots(lid,
    '[{"pos":["QB"]},{"pos":["RB"],"label":"Nate''s Revenge"},{"pos":["RB","WR","TE"],"bb":true}]'::jsonb);
  perform assert_ok(r, 'rn3 a name may also be REMOVED post-draft');
  perform assert_true((r -> 'slots' -> 0 ? 'label') = false, 'rn3a …and the spot goes back to its derived name');

  -- ══ AND NOTHING ELSE ═════════════════════════════════════════════════════
  perform assert_err(set_league_classic_slots(lid,
    '[{"pos":["QB"]},{"pos":["WR"],"label":"Nate''s Revenge"},{"pos":["RB","WR","TE"],"bb":true}]'::jsonb),
    'can only be RENAMED', 'rn4 what a spot ACCEPTS is still frozen');
  perform assert_err(set_league_classic_slots(lid,
    '[{"pos":["QB"]},{"pos":["RB"],"label":"Nate''s Revenge","bb":true},{"pos":["RB","WR","TE"],"bb":true}]'::jsonb),
    'can only be RENAMED', 'rn4a so is best ball');
  perform assert_err(set_league_classic_slots(lid,
    '[{"pos":["QB"]},{"pos":["RB"],"label":"Nate''s Revenge","zero_pts":10},{"pos":["RB","WR","TE"],"bb":true}]'::jsonb),
    'can only be RENAMED', 'rn4b so is the zero-fill — it decides points');
  perform assert_err(set_league_classic_slots(lid,
    '[{"pos":["QB"]},{"pos":["RB"],"label":"Nate''s Revenge","teams":["KC"]},{"pos":["RB","WR","TE"],"bb":true}]'::jsonb),
    'can only be RENAMED', 'rn4c and so is a per-spot filter');

  -- ══ THE SHRINK HATCH STILL WORKS ═════════════════════════════════════════
  r := set_league_classic_slots(lid, '[{"pos":["QB"]},{"pos":["RB"],"label":"Nate''s Revenge"}]'::jsonb);
  perform assert_ok(r, 'rn5 0181''s shrink from the end still works');
  perform assert_true(jsonb_array_length(r -> 'slots') = 2, 'rn5a …and the lineup really is shorter');
  perform assert_err(set_league_classic_slots(lid,
    '[{"pos":["QB"]},{"pos":["RB"],"label":"Nate''s Revenge"},{"pos":["TE"]}]'::jsonb),
    'rename spots, or shrink', 'rn6 a GROW is still refused');
  perform assert_err(set_league_classic_slots(lid, null),
    'locks once the draft starts', 'rn6a and so is clearing the spec');

  -- A rename AND a shrink in one save is fine — the surviving spots are still
  -- what they were apart from their names.
  perform assert_ok(set_league_classic_slots(lid, '[{"pos":["QB"],"label":"QB1"}]'::jsonb),
    'rn7 rename and shrink together');

  raise notice 'rename-spot probes done';
end $$;

select 'ALL RENAME-SPOT PROBES PASSED' as result;
