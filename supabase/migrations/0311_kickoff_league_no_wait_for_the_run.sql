-- 0311: THE KICKOFF LEAGUE'S ADD MARKET DOES NOT WAIT FOR THE RUN (v0.433.8).
--
-- 0310 landed with this in migrate.yml's log:
--
--   0310: Kickoff league 5ae08e35-… — fa_mode open → open, open now: f,
--   18 pending claim(s) re-stamped
--
-- Free agency was ALREADY 'open'. What shut it was the after-waivers gate
-- (0127): fa_after_waivers_dow lists today, so instant adds stay closed until
-- today's waiver run has cleared (fa_window_open: `faw @> today and nowmin <
-- waiver_clear_min`). That is the console's "FA AFTER WAIVERS" day picker —
-- "On checked days, instant adds stay closed until that day's waiver run has
-- cleared" — and it is exactly what the founder is asking to lift: "I need
-- the turn free agency on for kick off league … Right now."
--
-- So the gate comes off: fa_after_waivers_dow = [] (0287: an empty list is
-- NEVER wait), the days it held printed as a NOTICE so the commissioner can
-- put them back from the console if the gate was wanted on other days. The
-- run itself (waiver_clear_min / waiver_clear_dow) is untouched: pending
-- claims still settle there. Scoped to the newest league named Kickoff…;
-- idempotent; a no-op without one.
do $$
declare lid uuid; had jsonb; open_after boolean;
begin
  select id, settings_json -> 'fa_after_waivers_dow' into lid, had
    from league where lower(name) like 'kickoff%' order by created_at desc limit 1;
  if lid is null then
    raise notice '0311: no Kickoff league here — nothing to do';
    return;
  end if;
  update league set settings_json = coalesce(settings_json, '{}'::jsonb) || '{"fa_after_waivers_dow": []}'::jsonb where id = lid;
  open_after := fa_window_open(lid);
  raise notice '0311: Kickoff league % — fa_after_waivers_dow % → [], fa_mode %, open now: %, next waiver run %',
    lid, coalesce(had::text, 'unset'), league_fa_mode(lid), open_after, coalesce(next_waiver_run(lid)::text, 'none');
end $$;
