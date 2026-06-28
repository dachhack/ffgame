-- 0038: make split-pay contributions idempotent on the Stripe reference, so a retried
-- Stripe webhook (they retry on any non-2xx, and sometimes on success) can't double-count
-- a contribution. grant_personal / grant_league are already idempotent (ON CONFLICT).
create or replace function contribute_to_pool(p_league uuid, p_season text, p_uid uuid, p_cents int, p_ref text) returns text
  language plpgsql security definer set search_path = public as $$
declare pid uuid; total int; tgt int; st text;
begin
  -- Already processed this Stripe event? Return the pool's current status, no-op.
  if p_ref is not null and exists (select 1 from pool_contrib where stripe_ref = p_ref) then
    return coalesce((select status from unlock_pool where league_id = p_league and season = p_season), 'open');
  end if;
  insert into unlock_pool (league_id, season) values (p_league, p_season)
    on conflict (league_id, season) do nothing;
  select id, target_cents, status into pid, tgt, st from unlock_pool where league_id = p_league and season = p_season;
  if st <> 'open' then return st; end if;
  insert into pool_contrib (pool_id, app_user_id, amount_cents, stripe_ref) values (pid, p_uid, p_cents, p_ref);
  update unlock_pool set collected_cents = collected_cents + p_cents where id = pid
    returning collected_cents into total;
  if total >= tgt then
    update unlock_pool set status = 'funded' where id = pid;
    perform grant_league(p_league, p_season, 'split', 'pool:' || pid::text);
    return 'funded';
  end if;
  return 'open';
end $$;
