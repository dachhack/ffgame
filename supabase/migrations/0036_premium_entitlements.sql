-- 0036: premium entitlements + the matchup-premium resolution rule.
--
-- Implements docs/premium-model.md, server-authoritative:
--   • $5 personal  → entitlement(user,  uid,    'personal', season)
--   • $30 league   → entitlement(league, lgid,  'league',   season)   (direct or via a split pool)
--   • split-pay    → unlock_pool / pool_contrib; when the pool funds it writes the league entitlement
--   • commish off  → league_pref.premium_disabled
--   • SPILLOVER    → not stored; it's the OR in matchup_premium() (facing a premium manager → premium)
--
-- The load-bearing rule (and the no-pay-to-win guarantee — every premium matchup is symmetric,
-- so premium is never an edge, only a richer experience):
--   premium(match) = NOT commishDisabled(league)
--                    AND ( leaguePremium OR userPremium(home) OR userPremium(away) )
--
-- Money flows Stripe → worker (service role) → grant_* / contribute_to_pool; clients never
-- grant themselves premium. Reads are member-scoped; the commish toggle is commissioner-gated.

-- ── Tables ───────────────────────────────────────────────────────────────────
create table if not exists entitlement (
  id           uuid primary key default gen_random_uuid(),
  subject_type text not null check (subject_type in ('user','league')),
  subject_id   uuid not null,                              -- app_user.id (user) or league.id (league)
  product      text not null check (product in ('personal','league')),
  season       text not null,
  source       text not null default 'stripe' check (source in ('stripe','split','grant')),
  stripe_ref   text,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz,                                -- null = no expiry; set for per-season
  unique (subject_type, subject_id, product, season)
);
create index if not exists entitlement_lookup on entitlement(subject_type, subject_id, product, season);

create table if not exists league_pref (
  league_id        uuid primary key references league(id) on delete cascade,
  premium_disabled boolean not null default false,         -- commish opt-out of premium matchups
  updated_at       timestamptz not null default now()
);

create table if not exists unlock_pool (
  id             uuid primary key default gen_random_uuid(),
  league_id      uuid not null references league(id) on delete cascade,
  season         text not null,
  target_cents   int  not null default 3000,               -- $30 league unlock
  collected_cents int not null default 0,
  status         text not null default 'open' check (status in ('open','funded','cancelled')),
  created_at     timestamptz not null default now(),
  unique (league_id, season)
);

create table if not exists pool_contrib (
  id           uuid primary key default gen_random_uuid(),
  pool_id      uuid not null references unlock_pool(id) on delete cascade,
  app_user_id  uuid references app_user(id) on delete set null,
  amount_cents int  not null check (amount_cents > 0),
  stripe_ref   text,
  created_at   timestamptz not null default now()
);

alter table entitlement  enable row level security;
alter table league_pref  enable row level security;
alter table unlock_pool  enable row level security;
alter table pool_contrib enable row level security;

-- Reads: you see your own user entitlements + your leagues' league-entitlements/prefs/pools.
-- No client writes (default-deny under RLS) — entitlements are written by the service role
-- after Stripe confirms, and the commish toggle goes through a commissioner-gated function.
create policy entitlement_read on entitlement for select to authenticated using (
  (subject_type = 'user'   and subject_id = auth.uid())
  or (subject_type = 'league' and is_league_member(subject_id))
);
create policy league_pref_read on league_pref for select to authenticated using (is_league_member(league_id));
create policy unlock_pool_read on unlock_pool for select to authenticated using (is_league_member(league_id));
create policy pool_contrib_read on pool_contrib for select to authenticated using (
  app_user_id = auth.uid()
  or exists (select 1 from unlock_pool p where p.id = pool_contrib.pool_id and is_league_member(p.league_id))
);

-- ── Resolution functions (read) ──────────────────────────────────────────────
create or replace function user_premium(p_uid uuid, p_season text) returns boolean
  language sql stable security definer set search_path = public as $$
  select p_uid is not null and exists (
    select 1 from entitlement e
    where e.subject_type = 'user' and e.subject_id = p_uid and e.product = 'personal'
      and e.season = p_season and (e.expires_at is null or e.expires_at > now())
  );
$$;

create or replace function league_premium(p_league uuid, p_season text) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from entitlement e
    where e.subject_type = 'league' and e.subject_id = p_league and e.product = 'league'
      and e.season = p_season and (e.expires_at is null or e.expires_at > now())
  );
$$;

-- The one rule. Both sides get premium when true (spillover = the OR on home/away).
create or replace function matchup_premium(m_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  with m as (
    select mu.league_id, l.season,
           hm.app_user_id as home_uid, am.app_user_id as away_uid
    from matchup mu
    join league l on l.id = mu.league_id
    left join league_membership hm on hm.league_id = mu.league_id and hm.sleeper_roster_id = mu.home_roster_id
    left join league_membership am on am.league_id = mu.league_id and am.sleeper_roster_id = mu.away_roster_id
    where mu.id = m_id
  )
  select coalesce(
    not coalesce((select premium_disabled from league_pref lp where lp.league_id = m.league_id), false)
    and (league_premium(m.league_id, m.season)
         or user_premium(m.home_uid, m.season)
         or user_premium(m.away_uid, m.season)),
    false)
  from m;
$$;

-- ── Mutations ────────────────────────────────────────────────────────────────
-- Commish toggle: only the league's commissioner may flip it (or the service role).
create or replace function set_league_premium_disabled(p_league uuid, p_disabled boolean) returns void
  language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from league where id = p_league and commissioner_id = auth.uid())
     and auth.role() <> 'service_role' then
    raise exception 'only the commissioner can change premium settings';
  end if;
  insert into league_pref (league_id, premium_disabled, updated_at)
    values (p_league, p_disabled, now())
    on conflict (league_id) do update set premium_disabled = excluded.premium_disabled, updated_at = now();
end $$;

-- Grants — SERVICE ROLE ONLY (called by the worker after Stripe confirms payment).
create or replace function grant_personal(p_uid uuid, p_season text, p_source text, p_ref text) returns void
  language sql security definer set search_path = public as $$
  insert into entitlement (subject_type, subject_id, product, season, source, stripe_ref)
    values ('user', p_uid, 'personal', p_season, coalesce(p_source,'stripe'), p_ref)
    on conflict (subject_type, subject_id, product, season) do update set stripe_ref = excluded.stripe_ref;
$$;

create or replace function grant_league(p_league uuid, p_season text, p_source text, p_ref text) returns void
  language sql security definer set search_path = public as $$
  insert into entitlement (subject_type, subject_id, product, season, source, stripe_ref)
    values ('league', p_league, 'league', p_season, coalesce(p_source,'stripe'), p_ref)
    on conflict (subject_type, subject_id, product, season) do update set stripe_ref = excluded.stripe_ref;
$$;

-- Split-pay: record a contribution; when the pool reaches target, fund it + grant the league.
-- Atomic. Service role only (Stripe webhook → worker).
create or replace function contribute_to_pool(p_league uuid, p_season text, p_uid uuid, p_cents int, p_ref text) returns text
  language plpgsql security definer set search_path = public as $$
declare pid uuid; total int; tgt int; st text;
begin
  insert into unlock_pool (league_id, season) values (p_league, p_season)
    on conflict (league_id, season) do nothing;
  select id, target_cents, status into pid, tgt, st from unlock_pool where league_id = p_league and season = p_season;
  if st <> 'open' then return st; end if;                         -- already funded/cancelled
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

grant execute on function user_premium(uuid, text)             to authenticated;
grant execute on function league_premium(uuid, text)          to authenticated;
grant execute on function matchup_premium(uuid)               to authenticated;
grant execute on function set_league_premium_disabled(uuid, boolean) to authenticated;
-- grant_*/contribute_to_pool are intentionally service-role only (no authenticated grant).
