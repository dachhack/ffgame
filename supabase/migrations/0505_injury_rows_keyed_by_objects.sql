-- 0505: THE INJURY ROWS KEYED BY A WHOLE OBJECT, GONE.
--
-- v0.489.0's poller keyed Sleeper's designations by playerIndex's meta object
-- instead of its slug, and the upsert stored that object as text:
-- player_slug = '{"slug":"brock-bowers","full":"Brock Bowers",...}'. v0.489.x
-- fixed the key, but the rows it had already written stayed. On Oct 14
-- (scripts/db/injury-stale-rows.sql) they were 1,050 of the table's 1,742 NFL
-- rows (267 O, 261 IR), all last written 2026-09-23.
--
-- No reader can match them: every lookup joins on the plain slug, so they
-- tag nobody. They only cost space, and the poller's prune never cleared
-- them: its read stopped at PostgREST's first 1,000 rows (paged since
-- v0.712.2), and its `.in()` delete may not cope with keys full of quotes and
-- commas.
--
-- Delete them, and refuse the shape from now on. Every real key is a plain
-- slug ("brock-bowers", "c-4433", "nba-1966"), none of which starts with "{".

delete from injury_status where player_slug like '{%';

alter table injury_status drop constraint if exists injury_status_slug_not_object;
alter table injury_status add constraint injury_status_slug_not_object
  check (left(player_slug, 1) <> '{');
