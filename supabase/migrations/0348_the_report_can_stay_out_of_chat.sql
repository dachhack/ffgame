-- ═══════════════════════════════════════════════════════════════════════════
-- 0348 · THE REPORT CAN STAY OUT OF CHAT — the commissioner's switch
--
-- Founder: "Let's also give the commish option to turn off reports posting in
-- chat."
--
-- The weekly report is TWO things that have been one since v0.391.0: a stored
-- write-up (`league_report`, which the pop-up renders and the console rebuilds)
-- and a line in league chat announcing it. Some leagues want the second; a
-- league that talks in chat all week does not want the house interrupting it
-- every Tuesday at 4 AM.
--
-- SO THE SWITCH TURNS OFF THE ANNOUNCEMENT, NOT THE REPORT. `report_chat =
-- false` keeps building and storing every week's write-up — the report screen
-- still opens it, the history is still there, the commissioner's console still
-- rebuilds it — and simply does not post the chat line. Turning it off must
-- not quietly stop RECORDING the season; a setting that deletes history when
-- you meant to quiet a notification is a trap.
--
-- AND A REPOST IS STILL A REPOST. When a commissioner presses ↻ REPOST they are
-- asking for this week, now, on purpose — the forced path (0277/0339) posts the
-- line whatever the standing setting says, because an explicit act is not a
-- schedule. The console says so, so nobody presses it expecting silence.
--
-- Default TRUE, and read through a function rather than off the raw key, so a
-- league that predates the setting keeps the behaviour it already had.
-- ═══════════════════════════════════════════════════════════════════════════

-- Does this league want its weekly report announced in chat?
create or replace function league_report_chat(p_league_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  -- coalesce, not `= true`: the key is absent for every league older than this
  -- migration, and an absent key is SQL NULL. An OR/comparison chain over NULL
  -- answers NULL, every caller reads NULL as a no, and the whole fleet would
  -- have gone quiet on a default nobody chose. (0343 learned this the
  -- expensive way on `league_waiver_day_clears`.)
  select coalesce((select (l.settings_json ->> 'report_chat')::boolean
                     from league l where l.id = p_league_id), true);
$$;
grant execute on function league_report_chat(uuid) to authenticated, anon;

create or replace function commish_set_report_chat(p_league_id uuid, p_on boolean) returns jsonb
  language plpgsql security definer set search_path = public as $$
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  update league set settings_json = coalesce(settings_json, '{}'::jsonb)
      || jsonb_build_object('report_chat', coalesce(p_on, true))
    where id = p_league_id;
  return jsonb_build_object('ok', true, 'report_chat', coalesce(p_on, true));
end $$;
grant execute on function commish_set_report_chat(uuid, boolean) to authenticated;

-- ── the console's week list carries the setting ────────────────────────────
-- 0345's body, plus `report_chat`, so the panel can render the switch and the
-- per-week lines from the one call it already makes.
create or replace function league_report_weeks(p_league_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare seas text;
begin
  if not (is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  select season into seas from league where id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such league'); end if;
  return jsonb_build_object('ok', true, 'season', seas,
    'report_chat', league_report_chat(p_league_id),
    'weeks', coalesce((
    select jsonb_agg(w order by w.week desc) from (
      with wks as (select distinct week from matchup where league_id = p_league_id),
           plays as (
             select p.week, max(p.ingested_at) as at
               from live_play p
              where p.week in (select week from wks)
              group by p.week)
      select m.week,
             count(*) as matchups,
             count(*) filter (where m.status = 'final') as final,
             count(*) filter (where m.home_final is not null and m.away_final is not null) as stamped,
             count(*) filter (where m.home_final is not null and m.away_final is not null
               and exists (select 1 from matchup_state s where s.matchup_id = m.id)
               and (
                 abs(coalesce((select sum(s.home_score) from matchup_state s where s.matchup_id = m.id), 0) - m.home_final) > 0.15
              or abs(coalesce((select sum(s.away_score) from matchup_state s where s.matchup_id = m.id), 0) - m.away_final) > 0.15
             )) as drifted,
             count(*) filter (where m.home_final is not null and m.away_final is not null
               and exists (select 1 from matchup_state s where s.matchup_id = m.id)
               and (select at from plays where plays.week = m.week)
                     > (select max(s.updated_at) from matchup_state s where s.matchup_id = m.id)
                       + interval '2 minutes'
             ) as stale,
             (select max(s.updated_at) from matchup_state s
               where s.matchup_id in (select m2.id from matchup m2
                 where m2.league_id = p_league_id and m2.week = m.week)) as scored_at,
             (select at from plays where plays.week = m.week) as last_play_at,
             exists (select 1 from league_report r where r.league_id = p_league_id and r.week = m.week) as report,
             (select max(g.created_at) from league_message g
               where g.league_id = p_league_id and g.kind = 'report' and g.report_week = m.week) as posted_at,
             nfl_week_complete(m.week, seas) as week_state,
             (select jsonb_build_object('requested_at', q.requested_at, 'done_at', q.done_at, 'error', q.error)
                from report_request q where q.league_id = p_league_id and q.week = m.week
                order by q.id desc limit 1) as request
        from matchup m
       where m.league_id = p_league_id
       group by m.week
    ) w), '[]'::jsonb));
end $$;
grant execute on function league_report_weeks(uuid) to authenticated;
