-- 0392: KICKOFF LEAGUE'S WAIVERS RUN DAILY AT 4 AM ET (v0.561.9). A data migration.
--
-- The founder, from chat (#1047), refining 0391 the same afternoon: "waivers
-- should run daily at 4 am est every day with players held after their games
-- until the waiver run on Weds AM. Free Agency on Sunday and Monday after the
-- waivers run."
--
-- The week (index 0 = Sunday, America/New_York):
--   Sun waivers_to_fa · Mon waivers_to_fa · Tue–Sat waivers
--   • every day: the run clears at 4:00 AM ET (waiver_clear_min 240);
--   • Sunday and Monday: free agents once it has;
--   • Tuesday–Saturday: every unowned player is a claim.
-- And after games (waiver_game_hold_dow = 3, Wednesday — 0337's own default,
-- written down): from a week's first kickoff until Wednesday's run, a dropped
-- player is not a free agent whatever his own hold says.
-- Replaces 0391's once-a-week schedule. Scoped to the newest league named
-- Kickoff…; idempotent; a no-op without one.
do $$
declare lid uuid; had_days jsonb; had_cm text;
  days constant jsonb := '["waivers_to_fa","waivers_to_fa","waivers","waivers","waivers","waivers","waivers"]';
begin
  select id, settings_json -> 'waiver_days', settings_json ->> 'waiver_clear_min' into lid, had_days, had_cm
    from league where lower(name) like 'kickoff%' order by created_at desc limit 1;
  if lid is null then
    raise notice '0392: no Kickoff league here — nothing to do';
    return;
  end if;
  update league
     set settings_json = coalesce(settings_json, '{}'::jsonb)
       || jsonb_build_object('waiver_days', days, 'waiver_clear_min', 240, 'waiver_game_hold_dow', 3)
   where id = lid;
  if had_days is distinct from days or had_cm is distinct from '240' then
    perform _chat_house(lid,
      '🗓️ Waiver schedule updated: waivers run every day at 4:00 AM ET. Free agents open Sunday and Monday '
        || 'after the run; the rest of the week every pickup is a claim. A player dropped after his game '
        || 'stays on waivers until Wednesday''s run.',
      jsonb_build_object('kind', 'waiver_days', 'days', days));
  end if;
  raise notice '0392: Kickoff league % — waiver_days % → %, clear % → 240 min ET, game hold Wed, today %, open now %',
    lid, coalesce(had_days::text, 'unset'), days, coalesce(had_cm, 'unset'), league_waiver_day(lid, now()), fa_window_open(lid);
end $$;
