-- 0391: KICKOFF LEAGUE'S WAIVERS RUN WEDNESDAY MORNING (v0.561.7). A data migration.
--
-- The founder, from chat (#1043): "I think I have the waivers set to run
-- unintentionally. They should run on Weds AM after games."
--
-- Kickoff League never set 0337's per-day schedule (`waiver_days`), so the
-- legacy rule decided its run days (league_waiver_day_clears): with no
-- `waiver_clear_dow` the run visits EVERY day at the clear time. And 0311 made
-- every day a free-agency day. So the wire was open all week and the run still
-- cleared every night.
--
-- Now an explicit week (index 0 = Sunday, America/New_York):
--   Sun fa · Mon fa · Tue fa · Wed waivers_to_fa · Thu fa · Fri fa · Sat fa
--   • Wednesday: the ONE run, at the clear time, then free agents;
--   • every other day: free agents.
-- Not a `waivers` Tuesday: a waivers day RUNS too (0337 — a day clears iff it
-- is waivers or waivers_to_fa), which would make two runs a week. It isn't
-- needed either: a dropped player is held until the next run, so Monday
-- night's drops are claims for Wednesday, never Tuesday grabs.
-- A waivers_to_fa day with no clear time stays shut all day (0338), so a
-- league without one gets 3:00 AM ET (180); one it already has is kept.
-- Scoped to the newest league named Kickoff…; idempotent; a no-op without one.
do $$
declare lid uuid; had_days jsonb; cm int;
  days constant jsonb := '["fa","fa","fa","waivers_to_fa","fa","fa","fa"]';
begin
  select id, settings_json -> 'waiver_days' into lid, had_days
    from league where lower(name) like 'kickoff%' order by created_at desc limit 1;
  if lid is null then
    raise notice '0391: no Kickoff league here — nothing to do';
    return;
  end if;
  update league
     set settings_json = coalesce(settings_json, '{}'::jsonb)
       || jsonb_build_object('waiver_days', days)
       || case when nullif(settings_json ->> 'waiver_clear_min', '') is null
               then jsonb_build_object('waiver_clear_min', 180) else '{}'::jsonb end
   where id = lid;
  cm := league_waiver_clear_min(lid);
  if had_days is distinct from days then
    perform _chat_house(lid,
      '🗓️ Waiver schedule set: waivers run once a week, Wednesday at '
        || to_char(timestamp '2000-01-01' + make_interval(mins => cm), 'FMHH12:MI AM') || ' ET. '
        || 'Dropped players wait for that run; everyone else is a free agent all week.',
      jsonb_build_object('kind', 'waiver_days', 'days', days));
  end if;
  raise notice '0391: Kickoff league % — waiver_days % → %, clear at % min ET, today %, next open %',
    lid, coalesce(had_days::text, 'unset'), days, cm, league_waiver_day(lid, now()), fa_window_open(lid);
end $$;
