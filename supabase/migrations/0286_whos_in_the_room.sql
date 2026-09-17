-- 0286: WHO IS ACTUALLY IN THE DRAFT ROOM (v0.397.0).
--
-- Founder, after a live draft: "Also need an indicator on the draft board if a
-- team is active in the draft and not absent in the draft room."
--
-- 0285 made a timed-out seat go on autodraft, which answers "this manager left"
-- one pick too late — after the room has already sat through a full clock. This
-- answers it BEFORE: the board says who has the room open right now, so the
-- commissioner can see the seat about to burn a clock and flip it early, and so
-- nine people know whether they are waiting on a person or on nobody.
--
-- A HEARTBEAT, NOT A CONNECTION. There is no socket to lose; every client
-- already polls. draft_here() marks the caller present and hands back everyone
-- else's last beat in the same round trip — one call, no extra fetch, and the
-- answer is a TIMESTAMP rather than a boolean so the client decides what stale
-- means (and a client that dies mid-draft fades out on its own instead of
-- lying "here" forever, which is what a connection flag would do).
--
-- SEATS, NOT PEOPLE. Presence is keyed by (league, app_user) because that is
-- who is holding a phone, and reported by seat because that is what the board
-- draws, taking the freshest beat of everyone who may act as it. So a
-- co-manager (0125's team_manager, which owns_roster honours and a first cut
-- of this file did not) keeps the seat lit; one person in two leagues has a
-- row in each.

create table if not exists draft_presence (
  league_id   uuid not null references league(id) on delete cascade,
  app_user_id uuid not null references app_user(id) on delete cascade,
  roster_id   int,
  seen_at     timestamptz not null default now(),
  primary key (league_id, app_user_id)
);
create index if not exists draft_presence_league on draft_presence(league_id, seen_at);
alter table draft_presence enable row level security;
drop policy if exists draft_presence_read on draft_presence;
create policy draft_presence_read on draft_presence for select using (is_league_member(league_id) or is_admin());

-- I am here; who else is? Members only. A spectator (admin, or a member with no
-- seat) marks presence with a null roster and simply does not light a seat.
create or replace function draft_here(p_league_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare my_seat int;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not signed in'); end if;
  if not (is_league_member(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  -- THE SEAT I MAY ACT AS — the same two places owns_roster looks (0125).
  -- Reading only league_membership would leave a CO-MANAGER lighting nothing
  -- while sitting in the room, which is the one case the seat is likeliest to
  -- be shared; the presence probe caught exactly that.
  select sleeper_roster_id into my_seat from league_membership
    where league_id = p_league_id and app_user_id = auth.uid() and enrolled
    order by sleeper_roster_id limit 1;
  if my_seat is null then
    select roster_id into my_seat from team_manager
      where league_id = p_league_id and app_user_id = auth.uid()
      order by roster_id limit 1;
  end if;
  insert into draft_presence (league_id, app_user_id, roster_id, seen_at)
    values (p_league_id, auth.uid(), my_seat, now())
    on conflict (league_id, app_user_id) do update set seen_at = now(), roster_id = excluded.roster_id;
  -- One row per SEAT, carrying its freshest beat: a seat two people share is
  -- here while either of them is.
  return jsonb_build_object('ok', true, 'server_now', now(), 'here', coalesce((
    select jsonb_agg(jsonb_build_object('roster_id', s.roster_id, 'seen_at', s.seen_at,
                                        'secs', floor(extract(epoch from (now() - s.seen_at)))::int)
                     order by s.roster_id)
    from (select roster_id, max(seen_at) as seen_at from draft_presence
           where league_id = p_league_id and roster_id is not null
             and seen_at > now() - interval '10 minutes'
           group by roster_id) s), '[]'::jsonb));
end $$;
grant execute on function draft_here(uuid) to authenticated;

-- Housekeeping: a beat older than a day is from a draft that is long over.
-- Runs off the same sweep the worker already makes, via draft_tick's caller.
create or replace function _sweep_draft_presence() returns void
  language sql security definer set search_path = public as $$
  delete from draft_presence where seen_at < now() - interval '1 day';
$$;
revoke all on function _sweep_draft_presence() from public, anon, authenticated;
