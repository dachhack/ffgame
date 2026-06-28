-- 0037: global premium-tier config — which POSITIONS and POWER-UPS are free vs premium.
-- Edited from the super-admin control panel, read by the worker (gating) and the client
-- (paywall UI). Single-row table; defaults match server/src/premium.js constants.
create table if not exists premium_tier (
  id             boolean primary key default true check (id),     -- single-row guard
  free_positions text[] not null default array['QB','RB','WR','TE'],
  free_powerups  text[] not null default array['metric-swap','player-swap','momentum'],
  updated_at     timestamptz not null default now()
);
insert into premium_tier (id) values (true) on conflict (id) do nothing;

alter table premium_tier enable row level security;
-- Readable by everyone signed in (clients render locked/free state); writes are admin-only
-- via the function below (default-deny under RLS otherwise).
create policy premium_tier_read on premium_tier for select to authenticated using (true);

-- Read the current tier (the worker reads it via the service role; the client via this RPC).
create or replace function get_premium_tier() returns premium_tier
  language sql stable security definer set search_path = public as $$
  select * from premium_tier where id;
$$;

-- Super-admin setter. Pass either list as null to leave it unchanged.
create or replace function admin_set_premium_tier(p_free_positions text[], p_free_powerups text[])
  returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  update premium_tier
     set free_positions = coalesce(p_free_positions, free_positions),
         free_powerups  = coalesce(p_free_powerups,  free_powerups),
         updated_at     = now()
   where id;
  return jsonb_build_object('ok', true);
end $$;

grant execute on function get_premium_tier()                       to authenticated;
grant execute on function admin_set_premium_tier(text[], text[])   to authenticated;
