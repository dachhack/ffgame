-- 0154: LEAGUE SIGNALS — one badge RPC for the league's "needs a look" counts.
--
-- The polish round's consolidation: instead of a poll per badge, the client
-- asks once per league and gets every count its chips wear:
--   • polls_unvoted — open polls (last 14 days) the caller hasn't voted in;
--     voting or the poll aging out clears it.
--   • waiver_results — the caller's claims resolved (won/lost) since they
--     LAST OPENED the league — league_seen.last_at (0151) is the watermark,
--     so opening the league is what clears the dot. Never opened → a 7-day
--     window, which also caps how far back the badge can reach.
--   • commish {waiting, review} — commissioner only (null for members):
--     the waiting room (league_join rows with no enrolled seat) and trades
--     accepted but awaiting the commissioner's ruling (trade_review mode).

create or replace function league_signals(p_league_id uuid)
  returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  since timestamptz;
  polls int; waivers int; com jsonb := null;
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select count(*) into polls
    from league_message m
    where m.league_id = p_league_id and m.kind = 'poll'
      and m.author_id <> me          -- your own question is not a to-do
      and m.created_at > now() - interval '14 days'
      and not exists (select 1 from poll_vote v where v.message_id = m.id and v.app_user_id = me);

  since := greatest(
    coalesce((select ls.last_at from league_seen ls where ls.league_id = p_league_id and ls.app_user_id = me),
             now() - interval '7 days'),
    now() - interval '7 days');
  select count(*) into waivers
    from waiver_claim c
    where c.league_id = p_league_id and c.status in ('won', 'lost')
      and c.processed_at > since
      and c.roster_id in (
        select m.sleeper_roster_id from league_membership m
          where m.league_id = p_league_id and m.app_user_id = me
        union
        select tm.roster_id from team_manager tm
          where tm.league_id = p_league_id and tm.app_user_id = me);

  if is_league_commish(p_league_id) or is_admin() then
    com := jsonb_build_object(
      'waiting', (select count(*) from league_join j
                    where j.league_id = p_league_id
                      and not exists (select 1 from league_membership m
                                        where m.league_id = p_league_id
                                          and m.app_user_id = j.app_user_id and m.enrolled)),
      'review', case when league_trade_review(p_league_id) = 'commish'
                     then (select count(*) from trade_proposal t
                             where t.league_id = p_league_id and t.status = 'accepted')
                     else 0 end);
  end if;

  return jsonb_build_object('ok', true, 'polls_unvoted', polls, 'waiver_results', waivers, 'commish', com);
end $$;

grant execute on function league_signals(uuid) to authenticated;
