-- 0124: league_listing_state — the commissioner's own read of the board row.
--
-- league_board() deliberately filters to listings with a claimable seat: a full
-- league on a recruitment board is noise. But that makes it the WRONG read for
-- "is my league public?" — a commissioner whose league just filled would see it
-- vanish from the board and conclude it was unlisted, when the row is still
-- open and the next dropped seat would put it straight back. The settings
-- toggle needs the row's actual state, not the board's view of it.
--
-- Commish/admin only: the listing is the league's public face, and whether it
-- is on or off the board is the commissioner's dial (0123's post/close pair —
-- this is just the read those writes never needed until a toggle had to render
-- its current position).

create or replace function league_listing_state(p_league_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare li league_listing%rowtype;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  select * into li from league_listing where league_id = p_league_id;
  return jsonb_build_object('ok', true,
    'listed', coalesce(li.open, false),
    'blurb', coalesce(li.blurb, ''),
    'seats_open', (select count(*) from league_membership m
                    where m.league_id = p_league_id and m.app_user_id is null and not m.enrolled));
end $$;

grant execute on function league_listing_state(uuid) to authenticated;
