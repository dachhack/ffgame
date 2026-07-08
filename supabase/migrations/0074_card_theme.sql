-- 0074: per-league "card table" theme flag (super-admin controlled).
--
-- The card-table presentation of the live board (player cards dealt you-left /
-- opponent-right, sealed picks as face-down card backs) is gated per league:
-- league_pref.card_theme. Super admins flip it from the admin console; league
-- members read it so the board picks its presentation. Purely cosmetic — no
-- scoring, lock, or resolve behavior changes.

alter table league_pref add column if not exists card_theme boolean not null default false;

-- Member read via RPC rather than the table: league_pref RLS is member-only,
-- and the super admin flipping the flag may not be a member of the league.
create or replace function league_card_theme(p_league uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select card_theme from league_pref where league_id = p_league), false)
$$;

create or replace function admin_set_card_theme(p_league uuid, p_on boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  insert into league_pref (league_id, card_theme, updated_at) values (p_league, p_on, now())
    on conflict (league_id) do update set card_theme = excluded.card_theme, updated_at = now();
  return jsonb_build_object('ok', true, 'card_theme', p_on);
end $$;

grant execute on function league_card_theme(uuid) to authenticated;
grant execute on function admin_set_card_theme(uuid, boolean) to authenticated;
