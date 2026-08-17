-- 0180 — A SEAT NOBODY CLAIMED GETS AN AGENT OF ITS OWN.
--
-- The durable half of the unclaimed-seat decision (v0.248.0 was the computed
-- half). `sealed_pick.app_user_id` is NOT NULL and references app_user, so a
-- seat with no claimed manager has nowhere to store a lineup: the worker's
-- auto-slot skips it, nothing ever locks, and "who started" is recomputed
-- rather than recorded. In the founder's own leagues that is seven seats of
-- eight. v0.248.0 computed those lineups at scoring time — correct, but
-- floating: a projection re-bake mid-week silently changes a lineup, kickoff
-- seals have nothing to seal, and a past week's board re-derives rather than
-- remembers.
--
-- THE DESIGN: one synthetic user per unclaimed seat — an AGENT — mapped here.
-- The worker (which already mints auth users via the admin API for the test
-- league) provisions them and writes sealed_pick rows AS the agent. From that
-- moment every rule built for a manager applies unchanged: the per-player
-- kickoff seal freezes rows, the boards read them like any seat's, the
-- resolver scores them, and history is stored, not recomputed.
--
-- WHY A MAPPING TABLE AND NOT THE MEMBERSHIP ROW. Everything that offers a
-- seat — native_join, the league board, the waiting room, every "open seats"
-- count — keys on `league_membership.app_user_id IS NULL`. Seating the agent
-- THERE would make every league read as full, and auditing that query surface
-- is exactly the kind of sweep that ships a miss. The membership row stays
-- NULL; the agent lives beside it, and only the worker and the resolver ever
-- look.
--
-- WHY ONE AGENT PER SEAT, not a house bot: sealed_pick's unique key is
-- (matchup_id, app_user_id, game_window, roster_slot), and seat attribution
-- (assignSealedRows) tells home from away BY AUTHOR — one shared bot holding
-- both sides of a matchup would collide with itself on the key and be
-- unattributable on the board.
--
-- THE CLAIM. When a human takes the seat (any path — they all update
-- league_membership.app_user_id), the trigger below hands them the agent's
-- rows: locked history keeps scoring continuity under their name, unlocked
-- rows arrive as a set lineup they can adjust, and the mapping is retired so
-- the agent never writes again. Transferring only app_user_id is exempt from
-- enforce_window_lock BY ITS OWN RULE (an update that changes none of
-- player/metric/window/slot passes, 0178:143), so locked rows transfer
-- without fighting the late-swap guard. On a RE-claim, rows the human still
-- has from an earlier stay win over the agent's (their own decisions), and
-- the agent's colliding rows are dropped; the distinct-spots bound keeps the
-- slot-cap trigger satisfied throughout.
--
-- The agent's auth/app_user row is deliberately NOT deleted on claim —
-- sealed_pick cascades from app_user, so deleting the agent after transfer is
-- safe but pointless, and keeping it lets a re-vacated seat reuse the same
-- identity instead of minting users forever.

create table if not exists seat_agent (
  league_id     uuid not null references league(id) on delete cascade,
  roster_id     int  not null,
  agent_user_id uuid not null references app_user(id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (league_id, roster_id),
  unique (agent_user_id)   -- one agent speaks for one seat, ever
);

-- Server-only: RLS on, no policies. Clients never read or write this — the
-- worker (service role) bypasses, and the transfer trigger below is SECURITY
-- DEFINER. An agent is plumbing, not a member.
alter table seat_agent enable row level security;

create or replace function transfer_agent_lineups() returns trigger
  language plpgsql security definer set search_path = public as $$
declare agent uuid;
begin
  -- Only the claim transition: NULL → a real user. Vacating a seat (user →
  -- NULL) deliberately does nothing — the departed manager's rows stay as the
  -- record of what scored, exactly as they do today.
  if new.app_user_id is null then return new; end if;
  if tg_op = 'UPDATE' and old.app_user_id is not distinct from new.app_user_id then return new; end if;
  if tg_op = 'UPDATE' and old.app_user_id is not null then return new; end if;

  select agent_user_id into agent from seat_agent
    where league_id = new.league_id and roster_id = new.sleeper_roster_id;
  if agent is null then return new; end if;

  -- Hand over every agent row in this league whose spot the human does not
  -- already hold. The collision case is a RE-claim: their old rows are their
  -- own decisions and win.
  update sealed_pick sp set app_user_id = new.app_user_id
    where sp.app_user_id = agent
      and sp.matchup_id in (select id from matchup where league_id = new.league_id)
      and not exists (
        select 1 from sealed_pick x
         where x.matchup_id = sp.matchup_id and x.app_user_id = new.app_user_id
           and x.game_window = sp.game_window and x.roster_slot = sp.roster_slot);
  delete from sealed_pick sp
    where sp.app_user_id = agent
      and sp.matchup_id in (select id from matchup where league_id = new.league_id);

  -- Retire the mapping — the seat is managed now. (The agent user remains,
  -- inert; a later vacancy re-links it rather than minting another.)
  delete from seat_agent where league_id = new.league_id and roster_id = new.sleeper_roster_id;
  return new;
end $$;

drop trigger if exists transfer_agent_lineups on league_membership;
create trigger transfer_agent_lineups after insert or update of app_user_id on league_membership
  for each row execute function transfer_agent_lineups();
