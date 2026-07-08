-- 0077: read the card-table flag by a league's SLEEPER id, so the vs-AI demo
-- (a Sleeper league loaded client-side, with no DB matchup / liveCtx) can wear
-- the card theme when that league is a card-table pilot league. The demo user
-- may be signed out, so this is granted to anon as well — card_theme is a
-- cosmetic flag, not sensitive, and there's no league data returned, just a bool.

create or replace function league_card_theme_by_sleeper(p_sleeper text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select lp.card_theme
    from league l
    join league_pref lp on lp.league_id = l.id
    where l.sleeper_league_id = p_sleeper
    order by lp.updated_at desc
    limit 1
  ), false)
$$;

grant execute on function league_card_theme_by_sleeper(text) to anon, authenticated;
