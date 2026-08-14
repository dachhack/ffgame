-- 0140: TRADE SIGNALS — the trade block and interest marks for native leagues.
--
-- Two one-tap signals, both league-visible (that is the point — they exist to
-- start conversations the propose modal is too heavy to start):
--   • 'block': a manager flags THEIR OWN rostered player as available ("I'd
--     listen to offers"). The league's shared trade block.
--   • 'want': a manager flags ANOTHER team's player as one they'd trade for.
--     Visible to everyone, most usefully to the player's current owner.
--
-- A signal is a standing fact, not a message — rows are tiny, unique per
-- (seat, player, kind), and carry no free text (trade notes already exist on
-- the proposal itself).
--
-- STALENESS BY READ, NOT BY TRIGGER. Players move constantly (drops, waivers,
-- trades, commish tools). Rather than chase every mutation path with cleanup,
-- the read function joins native_roster and returns only signals whose premise
-- still holds: a block is real while the player is still on the blocker's
-- roster; a want is real while the player is rostered by someone other than
-- the wanter (if the wanter lands the player, the interest is satisfied; if
-- the player hits waivers, the claim wire is the venue, not the trade block).
-- Stale rows simply stop appearing — and become valid again if the player
-- comes back, which is the right behavior for "I'd listen on X" after a
-- commish undo.

create table if not exists trade_signal (
  league_id  uuid not null references league(id) on delete cascade,
  roster_id  int  not null,                    -- the signaling seat
  slug       text not null,
  kind       text not null check (kind in ('block', 'want')),
  created_at timestamptz not null default now(),
  primary key (league_id, roster_id, slug, kind)
);
create index if not exists trade_signal_league on trade_signal(league_id, kind);
alter table trade_signal enable row level security;
drop policy if exists trade_signal_read on trade_signal;
create policy trade_signal_read on trade_signal for select using (is_league_member(league_id));

-- Toggle a signal. Writes go through here (not RLS) so ownership and the
-- signal's premise are checked in one place: block = must be MY player,
-- want = must be SOMEONE ELSE'S player. Turning a signal off never errors on
-- absence — "make it so" semantics, same as the favorites star.
create or replace function set_trade_signal(p_league_id uuid, p_roster_id int, p_slug text, p_kind text, p_on boolean)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare holder int;
begin
  if not (owns_roster(p_league_id, p_roster_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'not your seat');
  end if;
  if p_kind not in ('block', 'want') then
    return jsonb_build_object('ok', false, 'error', 'kind must be block or want');
  end if;
  if not p_on then
    delete from trade_signal
      where league_id = p_league_id and roster_id = p_roster_id and slug = p_slug and kind = p_kind;
    return jsonb_build_object('ok', true, 'on', false);
  end if;
  select nr.roster_id into holder from native_roster nr
    where nr.league_id = p_league_id and nr.slug = p_slug;
  if holder is null then
    return jsonb_build_object('ok', false, 'error', 'player is not on a roster in this league');
  end if;
  if p_kind = 'block' and holder <> p_roster_id then
    return jsonb_build_object('ok', false, 'error', 'you can only put your own players on the block');
  end if;
  if p_kind = 'want' and holder = p_roster_id then
    return jsonb_build_object('ok', false, 'error', 'that player is already on your roster');
  end if;
  insert into trade_signal (league_id, roster_id, slug, kind)
    values (p_league_id, p_roster_id, p_slug, p_kind)
    on conflict do nothing;
  return jsonb_build_object('ok', true, 'on', true);
end $$;

-- Every live signal in the league (any member — signals are public record,
-- like trades). holder_roster is the player's CURRENT seat, so the client
-- never joins rosters itself to find who to propose to.
create or replace function trade_signals(p_league_id uuid)
  returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_league_member(p_league_id) or is_admin()) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'kind', ts.kind, 'roster_id', ts.roster_id, 'slug', ts.slug,
      'holder_roster', nr.roster_id, 'created_at', ts.created_at)
      order by ts.kind, ts.created_at)
    from trade_signal ts
    join native_roster nr on nr.league_id = ts.league_id and nr.slug = ts.slug
    where ts.league_id = p_league_id
      and ((ts.kind = 'block' and nr.roster_id = ts.roster_id)
        or (ts.kind = 'want'  and nr.roster_id <> ts.roster_id))), '[]'::jsonb);
end $$;

grant execute on function set_trade_signal(uuid, int, text, text, boolean) to authenticated;
grant execute on function trade_signals(uuid) to authenticated;
