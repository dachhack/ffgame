-- 0133: members sync THEMSELVES — the claim flow and the worker, not a button.
--
-- The failure this kills, verbatim from a league chat: "it says im not in the
-- league when I try to claim team." Joins happen on Sleeper; Drip's copy of the
-- member list refreshed only when the commissioner pressed ⟳ refresh members
-- (0105). Everyone who joined the Sleeper league after the last press bounced
-- off redeem_invite's membership lookup until the commissioner noticed, went to
-- the Setup tab, and pressed the button again. During a join rush — the hour
-- before a draft, exactly when it matters — that made the commissioner a
-- human cron job.
--
-- Same shape as 0132's allowance: the button stays, the system stops needing it.
--   • `_upsert_membership_rows` — the ONE guarded write. 0105's semantics
--     verbatim: app_user_id keeps any existing link, `enrolled` only ever goes
--     false→true, so no path through here can unseat anybody. The worker's
--     importLeague previously used a raw client upsert with NEITHER guard — a
--     re-import could clobber links; it now calls this instead.
--   • `admin_upsert_memberships` — same name, same gate, now a shell over the
--     chokepoint. Commish-side callers don't change.
--   • `request_member_sync(code)` — the poke. Any signed-in holder of the
--     league's invite code (that is: anyone far enough into the claim flow to
--     have hit the failure) stamps member_sync_requested_at; the worker's next
--     tick (~25s) re-pulls the member list from Sleeper and the claimant's
--     retry goes through. The RPC deliberately does NOT accept member rows —
--     an invite code is a weak credential, and accepting a caller-supplied
--     roster→owner mapping on it would let any code holder seat themselves
--     anywhere. The code only asks; the worker fetches from Sleeper itself.
--
-- Worker side is server/src/poll/members.js: poked leagues on the next tick,
-- every sleeper-provider league on a slow safety-net cadence.

-- Sync bookkeeping. Distinct from league.synced_at, which is the weekly
-- schedule/lineup mirror — the two cadences have nothing to do with each other.
alter table league add column if not exists member_synced_at timestamptz;
alter table league add column if not exists member_sync_requested_at timestamptz;

-- ─────────────────────────────────────────────────────────────────────────────
-- The chokepoint. Body is 0105's insert, verbatim; no permission check of its
-- own — callers are the gated shell below and the worker (service_role).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function _upsert_membership_rows(p_league_id uuid, p_members jsonb)
  returns jsonb language plpgsql security definer set search_path = public as $$
begin
  insert into league_membership (league_id, sleeper_roster_id, sleeper_owner_id, team_name, app_user_id, enrolled)
  select p_league_id, (e->>'roster_id')::int, e->>'owner_id', e->>'team_name', au.id, au.id is not null
  from jsonb_array_elements(p_members) e
  left join app_user au on au.sleeper_user_id = e->>'owner_id'
  on conflict (league_id, sleeper_roster_id) do update set
    sleeper_owner_id = excluded.sleeper_owner_id,
    team_name = excluded.team_name,
    app_user_id = coalesce(league_membership.app_user_id, excluded.app_user_id),
    enrolled = (league_membership.enrolled or excluded.enrolled);
  update league set member_synced_at = now() where id = p_league_id;
  return jsonb_build_object('ok', true, 'count', jsonb_array_length(p_members));
end $$;
revoke all on function _upsert_membership_rows(uuid, jsonb) from public;
grant execute on function _upsert_membership_rows(uuid, jsonb) to service_role;

-- The commissioner-facing shell: the 0105 gate, then the chokepoint.
create or replace function admin_upsert_memberships(p_league_id uuid, p_members jsonb)
  returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not (is_admin() or is_league_commish(p_league_id)) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  return _upsert_membership_rows(p_league_id, p_members);
end $$;
grant execute on function admin_upsert_memberships(uuid, jsonb) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- The poke. Rate-limited to one standing request per 20s per league so a retry
-- loop (or a stampede of joiners) collapses into one Sleeper fetch.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function request_member_sync(p_code text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lg league%rowtype;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not signed in'); end if;
  select * into lg from league where invite_code = upper(trim(p_code));
  if not found then return jsonb_build_object('ok', false, 'error', 'invalid code'); end if;
  -- Only Sleeper-backed leagues have an upstream member list to pull.
  if coalesce(lg.provider, 'sleeper') <> 'sleeper' then
    return jsonb_build_object('ok', false, 'error', 'not a Sleeper league');
  end if;
  update league set member_sync_requested_at = now()
    where id = lg.id
      and (member_sync_requested_at is null or member_sync_requested_at < now() - interval '20 seconds');
  return jsonb_build_object('ok', true, 'league_id', lg.id);
end $$;
grant execute on function request_member_sync(text) to authenticated;

-- The worker's shopping list: which leagues need a member pull this tick.
-- Poked leagues (request newer than last sync) plus any CURRENT-SEASON sleeper
-- league whose last pull is older than the safety-net cadence the worker passes
-- in. Season-scoped on purpose: old seasons' rows never age back into the sweep,
-- so the worker isn't polling Sleeper forever for leagues nobody plays.
create or replace function member_sync_due(p_stale_minutes int, p_season text)
  returns table (league_id uuid, sleeper_league_id text) language sql security definer set search_path = public as $$
  select id, sleeper_league_id from league
  where coalesce(provider, 'sleeper') = 'sleeper'
    and (
      (member_sync_requested_at is not null and (member_synced_at is null or member_synced_at < member_sync_requested_at))
      or (season = p_season and (member_synced_at is null or member_synced_at < now() - make_interval(mins => p_stale_minutes)))
    );
$$;
revoke all on function member_sync_due(int, text) from public;
grant execute on function member_sync_due(int, text) to service_role;

-- Failure back-off, worker-only: a league whose Sleeper fetch errored still gets
-- its clock stamped, so a deleted upstream league degrades to the slow cadence
-- instead of re-fetching (with retries) every 25-second tick. The trade is that
-- a transiently-failed pull also waits out the cadence — acceptable, because a
-- fresh poke always re-arms the fast path.
create or replace function member_sync_touch(p_league_id uuid)
  returns void language sql security definer set search_path = public as $$
  update league set member_synced_at = now() where id = p_league_id;
$$;
revoke all on function member_sync_touch(uuid) from public;
grant execute on function member_sync_touch(uuid) to service_role;
