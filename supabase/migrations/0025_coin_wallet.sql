-- 0025: persistent coin WALLET (M3) — the earn half of the economy. Until now the
-- weekly drip-coin take lived only on the matchup row (home_coin/away_coin) and was
-- never banked. This adds a per-team running balance plus an append-only ledger,
-- credited by the worker when a matchup goes final. Spending lands in M4.
--
-- Keyed by (league_id, roster_id) — the TEAM, not app_user — so AI-controlled
-- teams (which have no app_user) accrue and spend exactly like human teams.

create table if not exists team_wallet (
  league_id   uuid not null references league(id) on delete cascade,
  roster_id   int  not null,
  coins       numeric not null default 0,
  updated_at  timestamptz not null default now(),
  primary key (league_id, roster_id)
);

-- Append-only audit of every coin change. idem_key makes credits idempotent: a
-- final matchup may re-resolve many times, but each side earns once. The invariant
-- sum(delta) per team == team_wallet.coins must always hold (tested in M4).
create table if not exists coin_ledger (
  id          bigint generated always as identity primary key,
  league_id   uuid not null references league(id) on delete cascade,
  roster_id   int  not null,
  matchup_id  uuid references matchup(id) on delete set null,
  week        int,
  delta       numeric not null,
  reason      text not null,
  idem_key    text unique,
  created_at  timestamptz not null default now()
);
create index if not exists coin_ledger_team on coin_ledger(league_id, roster_id);

-- Reads: any enrolled member of the league may see its teams' balances + ledger
-- (drives the board + shop). NO write policies — only the service-role worker and
-- the SECURITY DEFINER credit/spend functions ever mutate these (clients cannot).
alter table team_wallet enable row level security;
create policy wallet_read on team_wallet for select using (
  exists (select 1 from league_membership lm where lm.league_id = team_wallet.league_id and lm.app_user_id = auth.uid())
);
alter table coin_ledger enable row level security;
create policy ledger_read on coin_ledger for select using (
  exists (select 1 from league_membership lm where lm.league_id = coin_ledger.league_id and lm.app_user_id = auth.uid())
);

-- Credit a team's wallet once for an earn event. Atomic: the ledger insert (guarded
-- by idem_key) and the balance bump happen together, so a re-resolve never double-
-- credits and a partial failure never loses a credit. Worker-only (service role);
-- not granted to authenticated.
create or replace function credit_wallet(p_league_id uuid, p_roster_id int, p_matchup_id uuid, p_week int, p_delta numeric, p_reason text default 'earn')
  returns jsonb language plpgsql security definer set search_path = public as $$
declare n int; key text;
begin
  if p_delta is null then return jsonb_build_object('ok', false, 'error', 'null delta'); end if;
  key := p_matchup_id::text || ':' || p_reason || ':' || p_roster_id;
  insert into coin_ledger (league_id, roster_id, matchup_id, week, delta, reason, idem_key)
    values (p_league_id, p_roster_id, p_matchup_id, p_week, p_delta, p_reason, key)
    on conflict (idem_key) do nothing;
  get diagnostics n = row_count;
  if n > 0 then
    insert into team_wallet (league_id, roster_id, coins) values (p_league_id, p_roster_id, p_delta)
      on conflict (league_id, roster_id) do update set coins = team_wallet.coins + p_delta, updated_at = now();
  end if;
  return jsonb_build_object('ok', true, 'credited', n > 0);
end $$;

-- Both sides' banked balances for a matchup (board display). Participant/admin only.
create or replace function matchup_wallets(p_matchup_id uuid)
  returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'home', (select w.coins from team_wallet w join matchup m on m.id = p_matchup_id
              where w.league_id = m.league_id and w.roster_id = m.home_roster_id),
    'away', (select w.coins from team_wallet w join matchup m on m.id = p_matchup_id
              where w.league_id = m.league_id and w.roster_id = m.away_roster_id)
  ) where is_matchup_participant(p_matchup_id) or is_admin();
$$;

-- credit_wallet mints coins and trusts its caller, so it must be worker-only.
-- Postgres grants EXECUTE to PUBLIC by default — revoke that and hand it solely to
-- the service role the worker authenticates as. (matchup_wallets is read-only and
-- gates participants internally, so it's safe to expose to authenticated.)
revoke all on function credit_wallet(uuid, int, uuid, int, numeric, text) from public;
grant execute on function credit_wallet(uuid, int, uuid, int, numeric, text) to service_role;
grant execute on function matchup_wallets(uuid) to authenticated;
