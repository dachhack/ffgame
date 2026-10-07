-- ═══════════════════════════════════════════════════════════════════════════
-- 0451 · THE TACO LOCKER.
--
-- Founder: "Let's add a Taco Locker feature. A commish can lock a team from
-- making trades or dropping players. We also leverage the AI team rules to
-- auto-set the best lineup for that team on Thursday AM est."
--
-- THE LOCK ALREADY EXISTED. 0320 gave the commissioner a per-team lock
-- (league_membership.wire_locked): team_lock_reason answers for the seat, and
-- every drop (drop_player), add (add_free_agent), claim (submit_waiver_claim,
-- process_waivers), and trade (propose_trade, propose_multi_trade, the
-- accept and review paths through _trade_lock_reason) asks it. The desk had
-- a plain "lock a team" button with no name and no chat line.
--
-- What this adds:
--   • a NAME — the reason reads "🌮 Taco Locker: …" (the old words stay
--     inside it, so every refusal that matched 'locked this team' still
--     matches);
--   • a CHAT CARD when a team goes in or comes out, the way the league-wide
--     wire lock posts one (commish_set_wire_lock);
--   • league_membership.taco_set_week — the last board week the worker set
--     the team's lineup for it (server/src/taco.js has the clock: once per
--     week, from Thursday 9:00 AM Eastern, as an AI seat is set).
-- Nothing else moves: the wire lock, force-moves, the trade review all stand.
-- ═══════════════════════════════════════════════════════════════════════════

alter table league_membership add column if not exists taco_set_week int;

create or replace function team_lock_reason(p_league_id uuid, p_roster_id int) returns text
  language sql stable security definer set search_path = public as $$
  select case when exists (select 1 from league_membership
                            where league_id = p_league_id and sleeper_roster_id = p_roster_id and wire_locked)
              then '🌮 Taco Locker: the commissioner has locked this team''s trades and drops' end;
$$;

create or replace function commish_lock_team(p_league_id uuid, p_roster_id int, p_locked boolean) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare was boolean; tname text;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then return jsonb_build_object('ok', false, 'error', 'commissioner only'); end if;
  select wire_locked, coalesce(nullif(team_name, ''), 'Team ' || p_roster_id) into was, tname
    from league_membership where league_id = p_league_id and sleeper_roster_id = p_roster_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such team'); end if;
  update league_membership set wire_locked = coalesce(p_locked, false)
   where league_id = p_league_id and sleeper_roster_id = p_roster_id;
  -- 0451: the league hears about it — once per change, not per tap.
  if coalesce(p_locked, false) <> coalesce(was, false) then
    perform _chat_house(p_league_id,
      case when coalesce(p_locked, false)
           then '🌮 ' || tname || ' is in the Taco Locker — no trades, no drops, and their best lineup is set for them every Thursday morning'
           else '🌮 ' || tname || ' is out of the Taco Locker' end,
      jsonb_build_object('kind', 'taco_locker', 'roster_id', p_roster_id, 'on', coalesce(p_locked, false)));
  end if;
  return jsonb_build_object('ok', true, 'roster_id', p_roster_id, 'locked', coalesce(p_locked, false));
end $$;
grant execute on function commish_lock_team(uuid, int, boolean) to authenticated;
