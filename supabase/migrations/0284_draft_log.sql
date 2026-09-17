-- 0284: THE DRAFT LOG (v0.396.0).
--
-- Founder, mid-draft: "We also need a draft log."
--
-- The board shows what the draft IS; nothing shows what HAPPENED. A pick that
-- was undone is simply gone. A forced pick looks like any other. A pause, a
-- resume, an edit, a seat flipped to autodraft — none of it leaves a mark, so
-- the morning-after question ("who took him, and was that the commissioner?")
-- has no answer but memory.
--
-- SHAPE: one append-only table, written by TRIGGERS on the rows the draft
-- already writes. Not by editing the eight RPCs that make picks, undo them,
-- force them, edit them, pause, resume and reset — 0179's argument, again: a
-- rule on the table cannot be bypassed by the path nobody remembered, and a
-- copied function body is how the last two bugs of this kind shipped. The
-- actor is auth.uid() at write time (null = the worker), so the same insert
-- reads "pick", "forced by the commissioner" or "autopick" from who did it.
--
-- WHAT IS AND IS NOT LOGGED. Every pick, autopick, auction award and
-- nomination; every removal (an undo, or a pick cleared by edit), every
-- edit, every reset; start, pause, resume, complete; and every autodraft
-- toggle made by a person. NOT individual auction bids — a lot can take
-- forty of them and the award already carries the price. The timeout event
-- itself arrives with 0285, which is the change that needed this file first.

create table if not exists draft_event (
  id         bigint generated always as identity primary key,
  league_id  uuid not null references league(id) on delete cascade,
  at         timestamptz not null default now(),
  kind       text not null,
  roster_id  int,
  slug       text,
  overall    int,
  round      int,
  price      int,
  actor      uuid,                      -- auth.uid() when written; null = the worker
  detail     jsonb not null default '{}'::jsonb
);
create index if not exists draft_event_league on draft_event(league_id, id);
alter table draft_event enable row level security;
drop policy if exists draft_event_read on draft_event;
create policy draft_event_read on draft_event for select using (is_league_member(league_id) or is_admin());

-- The one writer. Security definer so a trigger fired under an ordinary
-- member's RPC can still append.
create or replace function _draft_log(p_league_id uuid, p_kind text, p_roster int default null,
    p_slug text default null, p_overall int default null, p_round int default null,
    p_price int default null, p_detail jsonb default '{}'::jsonb)
  returns void language sql security definer set search_path = public as $$
  insert into draft_event (league_id, kind, roster_id, slug, overall, round, price, actor, detail)
  values (p_league_id, p_kind, p_roster, p_slug, p_overall, p_round, p_price, auth.uid(), coalesce(p_detail, '{}'::jsonb));
$$;
revoke all on function _draft_log(uuid, text, int, text, int, int, int, jsonb) from public, anon, authenticated;

-- ── picks ───────────────────────────────────────────────────────────────────
-- 'won'      an auction award (the tick inserts auto = false WITH a price);
-- 'autopick' the clock ran out, the seat is on autodraft, or nobody sits there;
-- 'forced'   a person who is not this seat's manager made the pick — the
--            commissioner's FORCE PICK / assign; a co-manager reads the same
--            way, which is honest: someone else picked for the seat;
-- 'pick'     the manager, by hand.
create or replace function _draft_log_pick() returns trigger
  language plpgsql security definer set search_path = public as $$
declare owner uuid; k text;
begin
  select app_user_id into owner from league_membership
    where league_id = new.league_id and sleeper_roster_id = new.roster_id;
  k := case
    when new.price is not null then 'won'
    when new.auto then 'autopick'
    when auth.uid() is not null and owner is distinct from auth.uid() then 'forced'
    else 'pick' end;
  perform _draft_log(new.league_id, k, new.roster_id, new.slug, new.overall, new.round, new.price);
  return new;
end $$;
drop trigger if exists draft_log_pick on draft_pick;
create trigger draft_log_pick after insert on draft_pick
  for each row execute function _draft_log_pick();

-- An edit changes the slug in place (0194): log where it came from.
create or replace function _draft_log_edit() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.slug is distinct from old.slug then
    perform _draft_log(new.league_id, 'edit', new.roster_id, new.slug, new.overall, new.round, null,
      jsonb_build_object('from', old.slug));
  end if;
  return new;
end $$;
drop trigger if exists draft_log_edit on draft_pick;
create trigger draft_log_edit after update of slug on draft_pick
  for each row execute function _draft_log_edit();

-- A single removed row is an undo (or a pick cleared by edit). Many rows
-- vanishing at once is a RESET, and the draft row's own transition logs that
-- one — so a statement that wipes the board leaves one line, not forty.
create or replace function _draft_log_removed() returns trigger
  language plpgsql security definer set search_path = public as $$
declare g record; n int;
begin
  select count(*) into n from gone;
  if n = 1 then
    select * into g from gone;
    perform _draft_log(g.league_id, 'removed', g.roster_id, g.slug, g.overall, g.round, g.price);
  end if;
  return null;
end $$;
drop trigger if exists draft_log_removed on draft_pick;
create trigger draft_log_removed after delete on draft_pick
  referencing old table as gone
  for each statement execute function _draft_log_removed();

-- ── the draft itself: start / pause / resume / complete / reset ────────────
create or replace function _draft_log_draft() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if old.status = 'pending' and new.status = 'live' then
    perform _draft_log(new.league_id, 'start', null, null, null, null, null,
      jsonb_build_object('mode', new.mode, 'order', new.draft_order));
  elsif old.status = 'live' and new.status = 'complete' then
    perform _draft_log(new.league_id, 'complete', null, null, new.current_overall - 1);
  elsif old.status in ('live', 'complete') and new.status = 'pending' then
    perform _draft_log(new.league_id, 'reset');
  end if;
  if new.status = 'live' and old.paused is distinct from new.paused then
    perform _draft_log(new.league_id, case when new.paused then 'pause' else 'resume' end,
      null, null, new.current_overall);
  end if;
  return new;
end $$;
drop trigger if exists draft_log_draft on draft;
create trigger draft_log_draft after update on draft
  for each row execute function _draft_log_draft();

-- ── a person toggling autodraft, while the draft is on ─────────────────────
-- The TIMEOUT flip (0285) sets a transaction-local flag and writes its own,
-- richer line; this trigger stays quiet for it so the log says "ran out of
-- time" once rather than twice.
create or replace function _draft_log_autodraft() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.autodraft is distinct from old.autodraft
     and coalesce(current_setting('drip.timeout_flip', true), '') <> '1'
     and exists (select 1 from draft d where d.league_id = new.league_id and d.status = 'live') then
    perform _draft_log(new.league_id, case when new.autodraft then 'autodraft_on' else 'autodraft_off' end,
      new.sleeper_roster_id);
  end if;
  return new;
end $$;
drop trigger if exists draft_log_autodraft on league_membership;
create trigger draft_log_autodraft after update of autodraft on league_membership
  for each row execute function _draft_log_autodraft();

-- ── auction nominations ─────────────────────────────────────────────────────
create or replace function _draft_log_nominate() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  perform _draft_log(new.league_id, 'nominate', new.nominator, new.slug, null, null, new.bid);
  return new;
end $$;
drop trigger if exists draft_log_nominate on auction_lot;
create trigger draft_log_nominate after insert on auction_lot
  for each row execute function _draft_log_nominate();

-- ── the read ────────────────────────────────────────────────────────────────
-- Oldest first, from p_after (exclusive), so a client can poll for the tail.
-- Each line carries the names the client would otherwise look up: the seat's
-- team, the player's name and position, and who did it — 'server' for the
-- worker's clock, 'commish', or the acting seat.
create or replace function draft_log(p_league_id uuid, p_after bigint default 0, p_limit int default 300)
  returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_league_member(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  return jsonb_build_object('ok', true, 'events', coalesce((
    select jsonb_agg(jsonb_build_object(
        'id', e.id, 'at', e.at, 'kind', e.kind,
        'roster_id', e.roster_id, 'team', m.team_name,
        'slug', e.slug, 'player', p.full_name, 'pos', p.pos, 'nfl', p.team,
        'overall', e.overall, 'round', e.round, 'price', e.price,
        'actor_role', case
          when e.actor is null then 'server'
          when e.actor = l.commissioner_id then 'commish'
          else 'member' end,
        'actor_roster', am.sleeper_roster_id, 'actor_team', am.team_name,
        'detail', e.detail) order by e.id)
    from (select * from draft_event where league_id = p_league_id and id > coalesce(p_after, 0)
            order by id limit least(greatest(coalesce(p_limit, 300), 1), 1000)) e
    join league l on l.id = e.league_id
    left join league_membership m on m.league_id = e.league_id and m.sleeper_roster_id = e.roster_id
    left join league_pool p on p.league_id = e.league_id and p.slug = e.slug
    left join lateral (select sleeper_roster_id, team_name from league_membership x
                        where x.league_id = e.league_id and x.app_user_id = e.actor and x.enrolled
                        order by sleeper_roster_id limit 1) am on true
  ), '[]'::jsonb));
end $$;
grant execute on function draft_log(uuid, bigint, int) to authenticated;
