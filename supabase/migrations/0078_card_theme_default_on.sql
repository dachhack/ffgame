-- 0078: make the card-table theme the DEFAULT for every league, and add a
-- global lever for the generic front-door demo.
--
-- Per-league: league_card_theme now reads coalesce(card_theme, TRUE) — a league
-- is carded unless a super admin explicitly opts it out (sets card_theme=false
-- for the "simple view"). Same for the by-sleeper demo lookup.
--
-- Front-door demo: a single global flag (demo_pref, one row) drives the baked
-- demo board's presentation, default carded, super-admin reversible to simple.

-- ── Per-league: default ON ───────────────────────────────────────────────────
create or replace function league_card_theme(p_league uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select card_theme from league_pref where league_id = p_league), true)
$$;

create or replace function league_card_theme_by_sleeper(p_sleeper text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select lp.card_theme
    from league l
    join league_pref lp on lp.league_id = l.id
    where l.sleeper_league_id = p_sleeper
    order by lp.updated_at desc
    limit 1
  ), true)
$$;

-- ── Global front-door demo lever ─────────────────────────────────────────────
create table if not exists demo_pref (
  id         boolean primary key default true check (id),   -- singleton row
  card_theme boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into demo_pref (id) values (true) on conflict (id) do nothing;

create or replace function demo_card_theme() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select card_theme from demo_pref where id), true)
$$;

create or replace function admin_set_demo_card_theme(p_on boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  insert into demo_pref (id, card_theme, updated_at) values (true, p_on, now())
    on conflict (id) do update set card_theme = excluded.card_theme, updated_at = now();
  return jsonb_build_object('ok', true, 'card_theme', p_on);
end $$;

-- Signed-out visitors see the front-door demo, so the read is anon-granted.
grant execute on function league_card_theme(uuid)            to authenticated;
grant execute on function league_card_theme_by_sleeper(text) to anon, authenticated;
grant execute on function demo_card_theme()                  to anon, authenticated;
grant execute on function admin_set_demo_card_theme(boolean) to authenticated;
