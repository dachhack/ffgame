-- REPAIR (v0.431.0): the Extra Slot the founder played on Turf Warriors' SUN
-- 1PM window that never landed anywhere the board reads.
--
-- Founder: "I don't see the extra slot I added." → "Turf Warriors 1pm window
-- I added a slot."
--
-- Before 0304 the app's hand ARMed the Extra Slot card into the buff list
-- (nothing reads it) and consumed the card; the web wrote its own hero_applied
-- blob without touching the cap. Either way the card is gone and the slot is
-- not recorded. This writes the record 0304's apply_extra_slot would have
-- written, for the founder's seat in Turf Warriors on the league's current
-- (first non-final) regular week: applied_state.extra (the cap),
-- applied_state.extraSlots.early = 1 (the app), hero_applied.extraSlots.early
-- = 1 (the web board) — and drops the phantom 'extra-slot' buff if the app
-- filed one. No card is consumed (it already was). Idempotent: a second run
-- changes nothing.
--
-- Run via dbquery.yml with allow_writes ON. Read-only it prints the BEFORE
-- rows and then fails at the first write, which is the safe dry run.
\pset pager off

\echo === BEFORE ===
select l.name as league, m.week, m.status, lm.team_name,
       a.payload_json ->> 'extra' as extra, a.payload_json -> 'extraSlots' as extra_slots, a.payload_json -> 'buffs' as buffs,
       h.payload_json -> 'extraSlots' as hero_extra_slots
  from league l
  join league_membership lm on lm.league_id = l.id
  join app_user u on u.id = lm.app_user_id and u.email = 'mlporritt@gmail.com'
  join matchup m on m.league_id = l.id and (lm.sleeper_roster_id in (m.home_roster_id, m.away_roster_id))
  left join applied_state a on a.matchup_id = m.id and a.app_user_id = u.id
  left join hero_applied h on h.matchup_id = m.id and h.app_user_id = u.id
 where l.name = 'Turf Warriors' and l.season = '2026' and m.week < 100 and m.status <> 'final'
 order by m.week;

do $$
declare
  uid uuid; lg uuid; mid uuid; wk int; rid int;
  xs jsonb; bf jsonb; hb jsonb; total int;
begin
  select id into uid from app_user where email = 'mlporritt@gmail.com';
  if uid is null then raise exception 'no app_user for the founder'; end if;
  select l.id into lg from league l where l.name = 'Turf Warriors' and l.season = '2026';
  if lg is null then raise exception 'no league named Turf Warriors (2026)'; end if;
  select lm.sleeper_roster_id into rid from league_membership lm where lm.league_id = lg and lm.app_user_id = uid;
  if rid is null then raise exception 'the founder holds no seat in Turf Warriors'; end if;
  -- The league's current week: the first regular week not yet final.
  select m.id, m.week into mid, wk from matchup m
   where m.league_id = lg and m.week < 100 and m.status <> 'final' and rid in (m.home_roster_id, m.away_roster_id)
   order by m.week limit 1;
  if mid is null then raise exception 'no open matchup for that seat'; end if;

  select coalesce(payload_json -> 'extraSlots', '{}'::jsonb), coalesce(payload_json -> 'buffs', '[]'::jsonb)
    into xs, bf from applied_state where matchup_id = mid and app_user_id = uid;
  xs := coalesce(xs, '{}'::jsonb); bf := coalesce(bf, '[]'::jsonb);
  -- ONE slot on SUN 1PM ('early'): never fewer than one, never a second from
  -- a re-run.
  xs := jsonb_set(xs, '{early}', to_jsonb(greatest(coalesce((xs ->> 'early')::int, 0), 1)));
  select coalesce(sum(v.value::int), 0) into total from jsonb_each_text(xs) v;
  -- The phantom buff the app's old ARM filed, if any.
  bf := coalesce((select jsonb_agg(b) from jsonb_array_elements_text(bf) b where b <> 'extra-slot'), '[]'::jsonb);

  insert into applied_state (matchup_id, app_user_id, week, payload_json)
    values (mid, uid, wk, jsonb_build_object('extra', total, 'extraSlots', xs, 'buffs', bf))
  on conflict (matchup_id, app_user_id) do update
    set payload_json = coalesce(applied_state.payload_json, '{}'::jsonb)
                       || jsonb_build_object('extra', total, 'extraSlots', xs, 'buffs', bf),
        week = wk, updated_at = now();

  select coalesce(payload_json, '{}'::jsonb) into hb from hero_applied where matchup_id = mid and app_user_id = uid;
  hb := jsonb_set(coalesce(hb, '{}'::jsonb), '{extraSlots}', xs);
  insert into hero_applied (matchup_id, app_user_id, payload_json) values (mid, uid, hb)
  on conflict (matchup_id, app_user_id) do update set payload_json = hb, updated_at = now();

  raise notice 'repaired: Turf Warriors week % roster % — extra %, extraSlots %, buffs %', wk, rid, total, xs, bf;
end $$;

\echo === AFTER ===
select l.name as league, m.week, m.status, lm.team_name,
       a.payload_json ->> 'extra' as extra, a.payload_json -> 'extraSlots' as extra_slots, a.payload_json -> 'buffs' as buffs,
       h.payload_json -> 'extraSlots' as hero_extra_slots
  from league l
  join league_membership lm on lm.league_id = l.id
  join app_user u on u.id = lm.app_user_id and u.email = 'mlporritt@gmail.com'
  join matchup m on m.league_id = l.id and (lm.sleeper_roster_id in (m.home_roster_id, m.away_roster_id))
  left join applied_state a on a.matchup_id = m.id and a.app_user_id = u.id
  left join hero_applied h on h.matchup_id = m.id and h.app_user_id = u.id
 where l.name = 'Turf Warriors' and l.season = '2026' and m.week < 100 and m.status <> 'final'
 order by m.week;
