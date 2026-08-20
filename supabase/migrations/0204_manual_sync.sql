-- 0204: A MANAGER CAN REFRESH THEIR OWN SLEEPER ROSTERS.
--
-- Founder: "Can we let users do a manual refresh?" — after asking what it would
-- cost to poll Sleeper every minute, or every twenty seconds.
--
-- WHY THIS, RATHER THAN A FASTER POLL. The worker mirrors Sleeper on a 6-hour
-- refresh guarded by an hourly check (`WEEKLY_SYNC_MS` / `SYNC_CHECK_MS`), and
-- a full pass costs roughly 1.8 seconds per league — so a 60-second cadence
-- stops fitting above ~33 leagues and a 20-second one above ~11. The thing a
-- fast poll would actually buy is a manager's late lineup change reaching us
-- before the spot locks, and that is a handful of moments a week, not 4,320
-- polls a day. A button spends the request exactly when someone cares.
--
-- AND FOR MOST LEAGUES IT IS NOT A CONVENIENCE, IT IS THE ONLY PATH. The
-- worker's auto-sync only touches leagues listed in `PILOT_LEAGUE_IDS`; every
-- other Sleeper league in the database has never been auto-synced at all and
-- moves only when someone runs the CLI by hand. This is the first mechanism
-- those leagues have.
--
-- ── THE SHAPE: A REQUEST, NOT AN RPC THAT DOES THE WORK ────────────────────
-- Postgres cannot call the Sleeper API, and the worker has no HTTP surface. So
-- the client asks, and the worker — which already ticks every 25 seconds for
-- plays — services the ask on its next pass with the SAME `syncWeek` the
-- automatic path uses. One code path, two triggers: the manual and the
-- scheduled refresh cannot drift apart, which is the failure this project keeps
-- finding in new clothes.
--
-- ── THE COOLDOWN IS THE WHOLE SAFETY STORY, SO IT LIVES HERE ───────────────
-- A button is one modified client away from being a loop. The cooldown is a
-- SQL check against the row's own timestamp rather than anything the caller
-- sends, so a hostile client gains nothing by lying: the worst it can do is ask
-- for a refresh that already happened. `requested_at` is set by the server
-- clock, never by the caller.
--
-- ── WHO MAY PRESS IT ───────────────────────────────────────────────────────
-- Any league member. This MIRRORS Sleeper into our database — it reads someone
-- else's source of truth and writes our copy of it. It cannot change a lineup,
-- move a player, or advantage the presser. Restricting it to the commissioner
-- would buy no safety the cooldown doesn't already provide, and would leave a
-- manager staring at a stale roster with no recourse.

-- One pending request per league at a time. A second press while one is queued
-- is not an error and does not stack — it is the same ask.
create table if not exists sync_request (
  league_id     uuid primary key references league(id) on delete cascade,
  requested_by  uuid references app_user(id) on delete set null,
  requested_at  timestamptz not null default now(),
  started_at    timestamptz,
  finished_at   timestamptz,
  ok            boolean,
  note          text
);

comment on table sync_request is
  'Manual Sleeper refresh queue (0204). One row per league; the worker claims it on its tick and runs the same syncWeek the scheduled path uses.';

alter table sync_request enable row level security;

-- Members read their own league's row so the button can show progress. Nobody
-- writes directly — the RPC below is the only door, so the cooldown cannot be
-- sidestepped by inserting a row with a flattering timestamp.
drop policy if exists sync_request_read on sync_request;
create policy sync_request_read on sync_request for select
  using (is_league_member(league_id) or is_league_commish(league_id) or is_admin());

-- How long a league must wait between manual refreshes. Sixty seconds is the
-- shortest interval at which a second pull could contain anything new: the
-- worker's own tick is 25s, and Sleeper lineups do not change faster than a
-- person can edit them.
create or replace function manual_sync_cooldown_s() returns int
  language sql immutable as $$ select 60 $$;

/** Ask the worker to re-mirror this league from Sleeper.
 *
 *  Returns `{ok:true, queued:true}` when the ask is accepted, and
 *  `{ok:true, queued:false, retry_in:N}` when the league refreshed too
 *  recently — a refusal the button can render as "just refreshed, try again in
 *  N seconds" rather than an error, because nothing went wrong.
 *
 *  A request already queued and not yet finished returns queued:true again: the
 *  caller's intent is satisfied, and stacking rows would only give the worker
 *  more of the same work. */
create or replace function request_league_sync(p_league_id uuid) returns jsonb
  language plpgsql volatile security definer set search_path = public as $$
declare
  cool   int := manual_sync_cooldown_s();
  ex     sync_request%rowtype;
  waited int;
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  -- The league must actually be a Sleeper mirror. A native league has nothing
  -- upstream to refresh, and silently queueing work the worker would discard
  -- would read to the manager as "it did something".
  --
  -- KEYED ON `provider`, NOT on the id being blank: a native league is minted
  -- with a namespaced `native-<uuid>` in `sleeper_league_id` (0064) because the
  -- column is NOT NULL, so "has an id" is true for every league in the table
  -- and would have queued work for all of them.
  if not exists (select 1 from league l
                 where l.id = p_league_id and l.provider = 'sleeper'
                   and coalesce(l.sleeper_league_id, '') <> '') then
    return jsonb_build_object('ok', false, 'error', 'not a Sleeper league');
  end if;

  select * into ex from sync_request where league_id = p_league_id;

  -- Still in flight: the ask stands, so say yes rather than queueing it twice.
  if found and ex.finished_at is null then
    return jsonb_build_object('ok', true, 'queued', true, 'pending', true);
  end if;

  -- Cooldown measured from the last COMPLETED refresh, not the last request —
  -- a request that failed instantly should not lock the league out for a minute.
  if found and ex.finished_at is not null then
    waited := floor(extract(epoch from (now() - ex.finished_at)))::int;
    if waited < cool then
      return jsonb_build_object('ok', true, 'queued', false, 'retry_in', cool - waited);
    end if;
  end if;

  insert into sync_request (league_id, requested_by, requested_at, started_at, finished_at, ok, note)
  values (p_league_id, auth.uid(), now(), null, null, null, null)
  on conflict (league_id) do update
    set requested_by = excluded.requested_by,
        requested_at = now(),
        started_at = null, finished_at = null, ok = null, note = null;
  return jsonb_build_object('ok', true, 'queued', true, 'pending', false);
end $$;

grant execute on function request_league_sync(uuid) to authenticated;
grant execute on function manual_sync_cooldown_s() to authenticated;

/** What the button shows between presses: whether a refresh is in flight, when
 *  the last one finished, and how long until another may be asked for. */
create or replace function league_sync_state(p_league_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare ex sync_request%rowtype; cool int := manual_sync_cooldown_s(); waited int; mirrored boolean;
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  -- Whether the button belongs on screen AT ALL, answered in the call the
  -- button already makes. A native league has no upstream, and a control that
  -- only ever says "nothing to refresh" is worse than no control.
  select (l.provider = 'sleeper' and coalesce(l.sleeper_league_id, '') <> '')
    into mirrored from league l where l.id = p_league_id;
  select * into ex from sync_request where league_id = p_league_id;
  if not found then
    return jsonb_build_object('ok', true, 'sleeper', coalesce(mirrored, false),
      'pending', false, 'retry_in', 0);
  end if;
  waited := case when ex.finished_at is null then null
                 else floor(extract(epoch from (now() - ex.finished_at)))::int end;
  return jsonb_build_object(
    'ok', true,
    'sleeper', coalesce(mirrored, false),
    'pending', ex.finished_at is null,
    'last_at', ex.finished_at,
    'last_ok', ex.ok,
    'note', ex.note,
    'retry_in', case when waited is null then 0 else greatest(0, cool - waited) end);
end $$;

grant execute on function league_sync_state(uuid) to authenticated;
