-- 0188: LEAVING A LEAGUE, AND DELETING ONE.
--
-- Founder: "we need a way for players to leave a league and a way for commish
-- to delete the league." Two doors out, on two different permissions — and the
-- only two irreversible things a member can do to their own membership.
--
-- WHAT LEAVING IS. A seat is "open" when `app_user_id is null and not enrolled`
-- (native_join and join_from_board both look for exactly that), and 0042's
-- admin_assign_roster already vacates one with exactly the update below. So
-- leaving is not a new concept — it is the existing vacate, performed by the
-- person in the seat instead of by an admin.
--
-- THE ROSTER STAYS. Deliberately: the seat keeps its team name and its players,
-- so the next manager inherits a real team rather than an empty one mid-season,
-- and the league's schedule still has somebody to play. A departure is a change
-- of manager, not a deletion of a team.
--
-- CO-MANAGERS ARE THE OTHER KIND OF MEMBER (0125). A co-manager holds no seat —
-- they steer someone else's — so THEIR leave is just dropping their own
-- team_manager row, and it must not vacate the owner's seat. One RPC handles
-- both because a member should not have to know which kind they are.
--
-- THE COMMISSIONER CANNOT LEAVE. They would orphan the league: every commish
-- RPC is `commissioner_id = auth.uid()`, so a league whose commissioner walked
-- away has no one who can fill the empty seat, rule a trade, or delete it. They
-- delete it instead — which is the second half of this migration.
--
-- DELETING IS COMMISH-ONLY AND TYPED. 0044's admin_delete_league has existed
-- since the beginning with the comment "commissioners cannot nuke a league";
-- this is the deliberate loosening of that, and it pays for it with a typed
-- confirmation. Every child table references league(id) on delete cascade, so
-- one delete takes the whole tree — memberships, matchups, picks, rosters,
-- wallets, the register. There is no undo, which is the entire reason the name
-- has to be typed.

-- ─────────────────────────────────────────────────────────────────────────────
-- leave_league(p_league_id)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function leave_league(p_league_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare
  seat int;
  co   boolean;
  nm   text;
begin
  select name into nm from league where id = p_league_id;
  if nm is null then return jsonb_build_object('ok', false, 'error', 'league not found'); end if;

  -- The commissioner's way out is delete, not leave. Checked FIRST so a
  -- commissioner who also holds a seat gets the honest reason rather than
  -- silently vacating and stranding their own league.
  if exists (select 1 from league where id = p_league_id and commissioner_id = auth.uid()) then
    return jsonb_build_object('ok', false, 'error',
      'you commission this league — hand it to someone else or delete it');
  end if;

  select sleeper_roster_id into seat from league_membership
    where league_id = p_league_id and app_user_id = auth.uid()
    order by sleeper_roster_id limit 1;

  select exists (select 1 from team_manager
    where league_id = p_league_id and app_user_id = auth.uid()) into co;

  if seat is null and not co then
    return jsonb_build_object('ok', false, 'error', 'you are not in this league');
  end if;

  -- CO-MANAGER ONLY: drop the co-manager rows and stop. The owner keeps the
  -- seat, the team, and every pick either of them made.
  if seat is null then
    delete from team_manager where league_id = p_league_id and app_user_id = auth.uid();
    return jsonb_build_object('ok', true, 'league', nm, 'as', 'comanager');
  end if;

  -- SEAT HOLDER: vacate, exactly as admin_assign_roster does (0042).
  update league_membership
     set app_user_id = null, enrolled = false, claim_email = null
   where league_id = p_league_id and app_user_id = auth.uid();

  -- The co-managers of a seat whose owner has gone are steering nothing; a
  -- seat must be genuinely free for the next person to claim.
  delete from team_manager where league_id = p_league_id and roster_id = seat;

  -- And withdraw any waiting-room request of theirs, so leaving doesn't leave
  -- them queued to be assigned back in.
  delete from league_join where league_id = p_league_id and app_user_id = auth.uid();

  return jsonb_build_object('ok', true, 'league', nm, 'as', 'manager', 'roster_id', seat);
end $$;
grant execute on function leave_league(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- commish_delete_league(p_league_id, p_confirm)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function commish_delete_league(p_league_id uuid, p_confirm text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare nm text; others int;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  select name into nm from league where id = p_league_id;
  if nm is null then return jsonb_build_object('ok', false, 'error', 'league not found'); end if;

  -- The typed name. Compared with whitespace collapsed and case ignored, so a
  -- commissioner is proving INTENT rather than passing a spelling test — but a
  -- mistyped or empty confirmation still stops the delete dead.
  if lower(btrim(regexp_replace(coalesce(p_confirm, ''), '\s+', ' ', 'g'))) is distinct from
     lower(btrim(regexp_replace(nm,                     '\s+', ' ', 'g')))
     or btrim(coalesce(p_confirm, '')) = '' then
    return jsonb_build_object('ok', false, 'error',
      format('type the league name exactly to delete it: %s', nm));
  end if;

  select count(*)::int into others from league_membership
    where league_id = p_league_id and enrolled and app_user_id is not null
      and app_user_id <> auth.uid();

  -- One delete; league(id) cascades through every child table (0044).
  delete from league where id = p_league_id;
  return jsonb_build_object('ok', true, 'name', nm, 'removed_members', others);
end $$;
grant execute on function commish_delete_league(uuid, text) to authenticated;
