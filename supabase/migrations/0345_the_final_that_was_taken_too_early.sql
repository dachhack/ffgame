-- ═══════════════════════════════════════════════════════════════════════════
-- 0345 · THE FINAL THAT WAS TAKEN TOO EARLY — a week can say it was scored
--        before its own last play landed
--
-- Founder, with the weekly report, the league page and the live matchup board
-- open together: "A lot of discrepancy across the weekly report and the
-- matchup results and summary views."
--
-- Three disagreements, ONE number. The report and the league page's matchups
-- and standings all read `matchup.home_final` / `away_final`; the board reads
-- the live engine. So the week reads 127.5–143.5 in two places and 162.50–
-- 160.50 in the third — which is, to the decimal, the failure v0.457.0 wrote
-- up: a week-2 stamp taken mid-Monday-night with the Rams game still on.
--
-- v0.457.0 fixed the CAUSE (a short scoreboard is no longer a finished week)
-- and left the EFFECT standing, on purpose: "Re-stamping stays an admin
-- errand, since it rewrites results." It is one now (`cli restamp`, and the
-- ⚠ Re-stamp workflow). This migration is the other half — making the
-- condition VISIBLE, because the check we had for it could never see it.
--
-- WHY `drifted` IS BLIND TO THIS, AND ALWAYS WAS. 0339 compares a stored
-- final against the sum of its own `matchup_state` window rows. Both are
-- written by the SAME resolve pass, in the same transaction-ish moment — the
-- final IS the sum of those rows. A stamp taken three hours early produces a
-- stored final and window rows that agree with each other perfectly and with
-- the football not at all. `drifted` catches a hand-edited score, or a partial
-- write; it cannot catch a whole week frozen early, which is the one failure
-- it was written in the aftermath of.
--
-- WHAT CAN SEE IT: THE CLOCK. `live_play.ingested_at` says when the week's
-- last play arrived; `matchup_state.updated_at` says when this matchup was
-- last scored. If plays landed AFTER the scoring, the stored final was
-- computed without them, whatever it agrees with. That is not an opinion
-- about the score — it is two timestamps in the wrong order.
--
-- The two-minute grace is for the ordinary race, not a tolerance for being
-- wrong: a live tick resolves and polls in the same breath, and a play landing
-- a few seconds behind a mid-week resolve is a tick doing its job. Hours late
-- is a week that closed without its last game.
--
-- A stat correction weeks later trips this too, and SHOULD: a final computed
-- before a correction landed is exactly as stale as one computed before the
-- Monday game. Both want the same errand.
--
-- The week's last play is read ONCE per week rather than once per matchup —
-- `live_play` is the biggest table here and the old shape would have scanned
-- it eight times for an eight-team league.
-- ═══════════════════════════════════════════════════════════════════════════

-- 0339's body, plus `stale`, `scored_at` and `last_play_at`. Everything else
-- is re-emitted unchanged so the whole function reads in one place.
create or replace function league_report_weeks(p_league_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare seas text;
begin
  if not (is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  select season into seas from league where id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such league'); end if;
  return jsonb_build_object('ok', true, 'season', seas, 'weeks', coalesce((
    select jsonb_agg(w order by w.week desc) from (
      with wks as (select distinct week from matchup where league_id = p_league_id),
           -- One pass over live_play for every week this league owns.
           plays as (
             select p.week, max(p.ingested_at) as at
               from live_play p
              where p.week in (select week from wks)
              group by p.week)
      select m.week,
             count(*) as matchups,
             count(*) filter (where m.status = 'final') as final,
             count(*) filter (where m.home_final is not null and m.away_final is not null) as stamped,
             -- A stored final that no longer matches the sum of its own window
             -- rows. 0.15 is the rounding the republish script uses, not a
             -- tolerance for being wrong.
             --
             -- It must HAVE window rows to disagree with. A matchup the
             -- resolver never published for — a hand-built final, a league
             -- that never ran live — sums to nothing, and reading that
             -- nothing as 0.0 would call every such week drifted. The
             -- republish script's own expression has this hole; it never
             -- showed because that script only ever walked resolved weeks.
             count(*) filter (where m.home_final is not null and m.away_final is not null
               and exists (select 1 from matchup_state s where s.matchup_id = m.id)
               and (
                 abs(coalesce((select sum(s.home_score) from matchup_state s where s.matchup_id = m.id), 0) - m.home_final) > 0.15
              or abs(coalesce((select sum(s.away_score) from matchup_state s where s.matchup_id = m.id), 0) - m.away_final) > 0.15
             )) as drifted,
             -- STAMPED BEFORE THE WEEK'S LAST PLAY LANDED. The clock, not the
             -- arithmetic — see the header. Needs window rows for the same
             -- reason `drifted` does: a matchup the resolver never ran has no
             -- scoring instant to be early.
             count(*) filter (where m.home_final is not null and m.away_final is not null
               and exists (select 1 from matchup_state s where s.matchup_id = m.id)
               and (select at from plays where plays.week = m.week)
                     > (select max(s.updated_at) from matchup_state s where s.matchup_id = m.id)
                       + interval '2 minutes'
             ) as stale,
             -- When this week was last scored, and when its last play arrived.
             -- A commissioner staring at a `stale` count deserves the two
             -- timestamps that produced it rather than a bare accusation.
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
