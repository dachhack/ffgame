-- 0186 — THE LEAGUE REGISTER (transaction log)
--
-- Founder: the league menu needs a "league register (transaction log)". Every
-- in-season roster movement, in one league-visible list: who added whom, who
-- dropped whom, what cleared waivers, what was traded, what the commissioner
-- moved by hand.
--
-- WRITTEN BY A TRIGGER, NOT BY THE RPCs. Every one of those paths ends in the
-- same place — an insert, an update or a delete on native_roster — so one
-- trigger there catches all of them, including the ones added later, without
-- copying a single existing function body (add_free_agent, process_waivers,
-- execute_trade and the commish tools are untouched by this migration). The
-- `acquired` column already carries WHY a row arrived, which is exactly the
-- kind the register wants to print.
--
-- IN-SEASON ONLY, deliberately. The trigger no-ops unless the league's draft is
-- 'complete', which keeps four kinds of noise out of the register in one rule:
-- draft picks (the draft room is already their record), keeper seeding, pool
-- reseeds (whose cascade would otherwise log a delete per player), and the
-- rollover's copy into next season's league.
--
-- A TRADE IS AN UPDATE, not a drop-and-add: execute_trade moves players by
-- flipping native_roster.roster_id, so the register shows one 'trade' line per
-- player with the seat it came from, and never a phantom "dropped".

create table if not exists league_txn (
  id         bigint generated always as identity primary key,
  league_id  uuid not null references league(id) on delete cascade,
  at         timestamptz not null default now(),
  -- add | drop | waiver | trade | commish
  kind       text not null,
  roster_id  int  not null,
  slug       text not null,
  -- trade: the seat the player came FROM. Null for every other kind.
  from_roster int,
  -- auth.uid() of the writer; null when the worker (service role) did it,
  -- which is the normal case for a waiver run.
  actor      uuid
);
create index if not exists league_txn_league on league_txn(league_id, at desc, id desc);

alter table league_txn enable row level security;
-- League-visible history, like resolved waiver claims (0064). Writes are the
-- trigger's alone — no insert/update/delete policy exists, so even a member
-- who found the table could only read it.
drop policy if exists league_txn_read on league_txn;
create policy league_txn_read on league_txn for select using (is_league_member(league_id));

create or replace function log_native_roster_txn() returns trigger
  language plpgsql security definer set search_path = public as $$
declare lg uuid; rid int; sl text; knd text; frm int; st text;
begin
  if tg_op = 'DELETE' then lg := old.league_id; rid := old.roster_id; sl := old.slug;
  else lg := new.league_id; rid := new.roster_id; sl := new.slug; end if;

  -- In-season only (see the header). A league with no draft row at all logs
  -- nothing either, which is right: it has no season to register.
  select status into st from draft where league_id = lg;
  if st is distinct from 'complete' then return null; end if;

  if tg_op = 'INSERT' then
    -- 'draft'/'keeper' can't reach here (the gate above), so anything else
    -- that isn't a named transaction kind is a plain pickup.
    knd := case when new.acquired in ('waiver', 'trade', 'commish') then new.acquired else 'add' end;
  elsif tg_op = 'UPDATE' then
    -- Only a change of SEAT is a transaction. Taxi/IR moves (0164) update the
    -- `spot` column on the same seat and are not roster movement.
    if new.roster_id is not distinct from old.roster_id then return null; end if;
    knd := case when new.acquired = 'commish' then 'commish' else 'trade' end;
    frm := old.roster_id;
  else
    knd := 'drop';
  end if;

  insert into league_txn (league_id, kind, roster_id, slug, from_roster, actor)
  values (lg, knd, rid, sl, frm, auth.uid());
  return null;
end $$;

drop trigger if exists log_native_roster_txn on native_roster;
create trigger log_native_roster_txn
  after insert or update or delete on native_roster
  for each row execute function log_native_roster_txn();

-- The register itself. Newest first, team names resolved, and the winning bid
-- joined at READ time for waiver rows — process_waivers marks the claim won and
-- inserts the roster row in an order this migration deliberately doesn't depend
-- on, so the bid is looked up here rather than captured in the trigger.
create or replace function league_register(p_league_id uuid, p_limit int default 100)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare out_rows jsonb;
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  select coalesce(jsonb_agg(r order by r.at desc, r.id desc), '[]'::jsonb) into out_rows
  from (
    select t.id, t.at, t.kind, t.slug, t.roster_id, t.from_roster,
           m.team_name  as team,
           fm.team_name as from_team,
           case when t.kind = 'waiver' then (
             select w.bid from waiver_claim w
              where w.league_id = t.league_id and w.roster_id = t.roster_id
                and w.add_slug = t.slug and w.status = 'won'
              order by w.processed_at desc nulls last limit 1
           ) end as bid
      from league_txn t
      left join league_membership m
        on m.league_id = t.league_id and m.sleeper_roster_id = t.roster_id
      left join league_membership fm
        on fm.league_id = t.league_id and fm.sleeper_roster_id = t.from_roster
     -- A MOVE IS NOT A DROP. commish_move_player deletes the row and re-inserts
     -- it on the new seat, so the delete leg would otherwise print "dropped"
     -- one line above "commissioner moved". The same slug leaving and arriving
     -- inside ONE transaction is only ever a move -- now() is transaction-stable
     -- in Postgres, so those two rows share `at` exactly -- while a genuine
     -- add-and-drop swap (add_free_agent's p_drop_slug) names two DIFFERENT
     -- slugs and survives untouched.
     where t.league_id = p_league_id
       and not (t.kind = 'drop' and exists (
             select 1 from league_txn t2
              where t2.league_id = t.league_id and t2.slug = t.slug
                and t2.at = t.at and t2.kind <> 'drop'))
     order by t.at desc, t.id desc
     limit greatest(1, least(coalesce(p_limit, 100), 500))
  ) r;
  return jsonb_build_object('ok', true, 'rows', out_rows);
end $$;

grant execute on function league_register(uuid, int) to authenticated;
