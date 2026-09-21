-- 0326: THE PUBLIC READ API — the league, readable by anything that can make
-- an HTTP request.
--
-- The gap list's fourth priority, and the reason it is on the list: "the
-- Sleeper ecosystem (KTC, DynastyProcess, ffscrapr) exists because of its free
-- read API." Nobody builds a valuation tool, a Discord bot or a spreadsheet
-- against a platform they have to log into first.
--
-- THE SHAPE. Every endpoint is one SQL function here, named api_*, returning
-- the whole response as jsonb. The edge function (supabase/functions/public-api)
-- is a router and nothing else: path in, function name out, JSON back. That
-- split is deliberate — the API's shape is a contract written in one file
-- rather than an accident of which columns a query happened to select.
--
-- OPT-IN, PER LEAGUE. settings_json.public_api. Off for a private league until
-- its commissioner turns it on; ON by default for the public formats (pods,
-- weekly showdowns, DFS), which are already open to anyone with the link.
-- Sleeper is public-by-default and that is why its ecosystem is big; it is
-- also a decision none of its users made. A league that has not opted in is
-- 404 — indistinguishable from one that does not exist, so the API cannot be
-- used to test whether a league id is real.
--
-- WHAT IS NEVER IN IT, and why each one would be a real leak:
--   · SEALED PICKS before their window reveals. Drip's whole game is hidden
--     picks; an endpoint that served them early would be an exploit with a URL.
--     api_lineups asks window_revealed() — the same question the app asks.
--   · PENDING waiver claims and their bids. Blind bidding stops being blind
--     the moment an outsider can poll it. Settled claims only, with the
--     winning bid, which the league already announces in chat.
--   · TRADE OFFERS in flight. League members see negotiations; the internet
--     does not. Completed, vetoed and expired deals only.
--   · Email addresses, claim emails, invite codes, chat, DMs, dues.
--   · Anything that writes. A write API needs per-user consent and is a
--     different project, not a flag on this one.
--
-- scripts/check-public-api.mjs pins both halves: every route the edge function
-- names exists here, and no api_ function mentions a forbidden column.

-- ═══ 1. the switch ═══════════════════════════════════════════════════════════
-- A full league is off until its commissioner says otherwise; the public
-- formats are on unless they say otherwise.
create or replace function league_public_api(p_league_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((settings_json ->> 'public_api')::boolean,
                  coalesce(kind, 'league') <> 'league')
    from league where id = p_league_id and not coalesce(is_mock, false);
$$;
grant execute on function league_public_api(uuid) to authenticated;

create or replace function commish_set_public_api(p_league_id uuid, p_on boolean) returns jsonb
  language plpgsql security definer set search_path = public as $$
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  update league set settings_json = coalesce(settings_json, '{}'::jsonb)
      || jsonb_build_object('public_api', coalesce(p_on, false))
    where id = p_league_id;
  return jsonb_build_object('ok', true, 'public_api', league_public_api(p_league_id));
end $$;
grant execute on function commish_set_public_api(uuid, boolean) to authenticated;

-- Every api_ function opens with this. Null out = the caller gets a 404.
create or replace function _api_open(p_league_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce(league_public_api(p_league_id), false);
$$;

-- The seat, without the person: team name, avatar, division — never an email,
-- a claim email or a user id.
create or replace function _api_seat(p_league_id uuid, p_roster_id int) returns jsonb
  language sql stable security definer set search_path = public as $$
  select jsonb_build_object('roster_id', p_roster_id,
           'team', _txn_team(p_league_id, p_roster_id),
           'manager', (select nullif(btrim(coalesce(u.display_name, '')), '')
                         from league_membership m left join app_user u on u.id = m.app_user_id
                        where m.league_id = p_league_id and m.sleeper_roster_id = p_roster_id),
           'avatar', (select avatar_url from league_membership
                       where league_id = p_league_id and sleeper_roster_id = p_roster_id));
$$;

-- ═══ 2. the endpoints ════════════════════════════════════════════════════════
-- GET /v1/league/{id}
create or replace function api_league(p_league_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare d draft%rowtype; l league%rowtype;
begin
  if not _api_open(p_league_id) then return null; end if;
  select * into l from league where id = p_league_id;
  select * into d from draft where league_id = p_league_id;
  return jsonb_build_object(
    'league_id', l.id, 'name', l.name, 'season', l.season,
    'kind', coalesce(l.kind, 'league'), 'provider', l.provider,
    'format', league_format(p_league_id), 'game_mode', coalesce(l.settings_json ->> 'game_mode', 'drip'),
    'continuity', league_continuity(p_league_id),
    'teams', (select count(*)::int from league_membership where league_id = p_league_id),
    'current_week', league_live_week(p_league_id),
    'draft_status', coalesce(d.status, 'none'), 'roster_size', d.rounds,
    'scoring', league_scoring(p_league_id),
    'rules', jsonb_build_object(
      'waiver_mode', league_waiver_mode(p_league_id),
      'faab_budget', league_faab_budget(p_league_id),
      'trade_review', league_trade_review(p_league_id),
      'trade_deadline_week', league_trade_deadline_week(p_league_id),
      'median_game', league_median_game(p_league_id),
      'playoff_teams', (select nullif(l.settings_json ->> 'playoff_teams', '')::int),
      'pos_caps', league_pos_caps(p_league_id)),
    'champion', (select nullif(l.settings_json ->> 'playoff_champion', '')::int),
    'updated_at', l.synced_at);
end $$;

-- GET /v1/league/{id}/teams
create or replace function api_teams(p_league_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
begin
  if not _api_open(p_league_id) then return null; end if;
  return jsonb_build_object('league_id', p_league_id,
    'teams', coalesce((select jsonb_agg(_api_seat(p_league_id, m.sleeper_roster_id)
        || jsonb_build_object('division', m.division, 'enrolled', m.enrolled,
                              'eliminated_week', m.eliminated_week)
        order by m.sleeper_roster_id)
      from league_membership m where m.league_id = p_league_id), '[]'::jsonb));
end $$;

-- GET /v1/league/{id}/rosters
create or replace function api_rosters(p_league_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
begin
  if not _api_open(p_league_id) then return null; end if;
  return jsonb_build_object('league_id', p_league_id,
    'rosters', coalesce((select jsonb_agg(jsonb_build_object(
        'roster_id', t.rid, 'team', _txn_team(p_league_id, t.rid),
        'players', t.players) order by t.rid)
      from (
        select nr.roster_id as rid, jsonb_agg(jsonb_build_object(
            'slug', nr.slug, 'name', lp.full_name, 'pos', lp.pos, 'team', lp.team,
            'acquired', nr.acquired, 'spot', coalesce(nr.spot, 'active'),
            'espn_id', lp.espn_id,
            'contract', (select jsonb_build_object('salary', c.salary, 'years', c.years, 'tagged', c.tagged)
                           from contract c where c.league_id = p_league_id and c.slug = nr.slug))
            order by lp.pos, lp.full_name) as players
          from native_roster nr
          left join league_pool lp on lp.league_id = nr.league_id and lp.slug = nr.slug
         where nr.league_id = p_league_id group by nr.roster_id) t), '[]'::jsonb));
end $$;

-- GET /v1/league/{id}/standings
create or replace function api_standings(p_league_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
begin
  if not _api_open(p_league_id) then return null; end if;
  return jsonb_build_object('league_id', p_league_id, 'standings', league_standings(p_league_id));
end $$;

-- GET /v1/league/{id}/matchups?week=N
create or replace function api_matchups(p_league_id uuid, p_week int default null) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
begin
  if not _api_open(p_league_id) then return null; end if;
  return jsonb_build_object('league_id', p_league_id, 'week', p_week,
    'matchups', coalesce((select jsonb_agg(jsonb_build_object(
        'matchup_id', m.id, 'week', m.week,
        'home', jsonb_build_object('roster_id', m.home_roster_id, 'team', _txn_team(p_league_id, m.home_roster_id),
                                   'points', m.home_final),
        'away', jsonb_build_object('roster_id', m.away_roster_id, 'team', _txn_team(p_league_id, m.away_roster_id),
                                   'points', m.away_final),
        'status', m.status, 'lock_at', m.lock_at,
        'playoff', m.is_playoff, 'consolation', m.is_consolation,
        'playoff_round', m.playoff_round, 'label', m.playoff_label)
        order by m.week, m.home_roster_id)
      from matchup m where m.league_id = p_league_id
        and (p_week is null or m.week = p_week)), '[]'::jsonb));
end $$;

-- GET /v1/league/{id}/lineups?week=N
-- THE SECRET STAYS SEALED. A classic league's starters are league-public once
-- the week locks. A drip league's picks are only ever served for a window that
-- has REVEALED — window_revealed() is the same question the app asks before it
-- shows an opponent's pick, and asking it here is what stops this endpoint
-- being a way to read a hidden lineup before kickoff.
create or replace function api_lineups(p_league_id uuid, p_week int) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
begin
  if not _api_open(p_league_id) then return null; end if;
  if p_week is null then return jsonb_build_object('error', 'week required'); end if;
  return jsonb_build_object('league_id', p_league_id, 'week', p_week,
    'classic', coalesce((select jsonb_agg(jsonb_build_object(
        'roster_id', sl.roster_id, 'team', _txn_team(p_league_id, sl.roster_id),
        'starters', sl.starters_json) order by sl.roster_id)
      from sleeper_lineup sl
      where sl.league_id = p_league_id and sl.week = p_week
        and exists (select 1 from matchup m where m.league_id = p_league_id and m.week = p_week
                     and m.status in ('locked', 'live', 'final'))), '[]'::jsonb),
    'drip', coalesce((select jsonb_agg(jsonb_build_object(
        'matchup_id', sp.matchup_id, 'window', sp.game_window, 'slot', sp.roster_slot,
        'player', sp.player_slug, 'metric', sp.metric_id) order by sp.game_window, sp.roster_slot)
      from sealed_pick sp join matchup m on m.id = sp.matchup_id
      where m.league_id = p_league_id and m.week = p_week
        and sp.locked and coalesce(window_revealed(sp.matchup_id, sp.game_window), false)), '[]'::jsonb));
end $$;

-- GET /v1/league/{id}/transactions?after=&limit=
-- The register (0186): adds, drops, settled waiver wins WITH the winning bid,
-- trades, commissioner moves and the format events. Cursor is the row id.
create or replace function api_transactions(p_league_id uuid, p_after bigint default null, p_limit int default 100)
  returns jsonb language plpgsql stable security definer set search_path = public as $$
declare rows_ jsonb;
begin
  if not _api_open(p_league_id) then return null; end if;
  select coalesce(jsonb_agg(e order by (e ->> 'id')::bigint desc), '[]'::jsonb) into rows_ from (
    select jsonb_build_object('id', x.id, 'at', x.at, 'kind', x.kind,
             'roster_id', x.roster_id, 'team', _txn_team(p_league_id, x.roster_id),
             'slug', nullif(x.slug, ''), 'player', nullif(_txn_player(p_league_id, x.slug), ''),
             'from_roster', x.from_roster, 'bid', x.bid, 'note', x.note) as e
      from (select t.id, t.at, t.kind, t.roster_id, t.slug, t.from_roster, t.note,
                   (select w.bid from waiver_claim w
                     where w.league_id = t.league_id and w.roster_id = t.roster_id
                       and w.add_slug = t.slug and w.status = 'won' limit 1) as bid
              from league_txn t
             where t.league_id = p_league_id and (p_after is null or t.id < p_after)
             order by t.id desc limit least(greatest(coalesce(p_limit, 100), 1), 500)) x) q;
  return jsonb_build_object('league_id', p_league_id, 'transactions', rows_,
    'next_after', nullif((select min((e ->> 'id')::bigint) from jsonb_array_elements(rows_) e), 0));
end $$;

-- GET /v1/league/{id}/trades
-- SETTLED DEALS ONLY: a pending offer is a negotiation between two managers,
-- not news. Multi-team legs (0322) ride along, as does the vote a league floor
-- took (0321) — that one IS news, and the league already heard it in chat.
create or replace function api_trades(p_league_id uuid, p_limit int default 50) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
begin
  if not _api_open(p_league_id) then return null; end if;
  return jsonb_build_object('league_id', p_league_id,
    'trades', coalesce((select jsonb_agg(jsonb_build_object(
        'trade_id', t.id, 'status', t.status, 'at', coalesce(t.resolved_at, t.created_at),
        'from', jsonb_build_object('roster_id', t.from_roster, 'team', _txn_team(p_league_id, t.from_roster),
                                   'sends', t.give, 'picks', t.give_picks),
        'to', jsonb_build_object('roster_id', t.to_roster, 'team', _txn_team(p_league_id, t.to_roster),
                                 'sends', t.get, 'picks', t.get_picks),
        'cap_dollars', t.cap_dollars, 'faab_dollars', t.faab_dollars,
        'legs', (select jsonb_agg(jsonb_build_object(
                   'roster_id', l.roster_id, 'team', _txn_team(p_league_id, l.roster_id),
                   'send', l.send, 'send_picks', l.send_picks,
                   'send_faab', l.send_faab, 'send_cap', l.send_cap) order by l.roster_id)
                 from trade_leg l where l.trade_id = t.id),
        'vote', (select jsonb_build_object('vetoes', count(*) filter (where v.veto),
                          'allows', count(*) filter (where not v.veto))
                   from trade_vote v where v.trade_id = t.id having count(*) > 0))
        order by coalesce(t.resolved_at, t.created_at) desc)
      from (select * from trade_proposal
             where league_id = p_league_id and status in ('executed', 'vetoed', 'expired')
             order by coalesce(resolved_at, created_at) desc
             limit least(greatest(coalesce(p_limit, 50), 1), 200)) t), '[]'::jsonb));
end $$;

-- GET /v1/league/{id}/draft
create or replace function api_draft(p_league_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare d draft%rowtype;
begin
  if not _api_open(p_league_id) then return null; end if;
  select * into d from draft where league_id = p_league_id;
  if not found then return jsonb_build_object('league_id', p_league_id, 'draft', null); end if;
  return jsonb_build_object('league_id', p_league_id,
    'draft', jsonb_build_object('status', d.status, 'mode', d.mode, 'rounds', d.rounds,
      'seconds_per_pick', d.pick_seconds, 'budget', d.budget, 'start_at', d.start_at,
      'order', d.draft_order, 'pick_owners', d.pick_owners,
      'on_the_clock', case when d.status = 'live' then d.current_overall end,
      'started_at', d.started_at, 'completed_at', d.completed_at),
    'picks', coalesce((select jsonb_agg(jsonb_build_object(
        'overall', p.overall, 'round', p.round, 'roster_id', p.roster_id,
        'team', _txn_team(p_league_id, p.roster_id), 'slug', p.slug,
        'player', _txn_player(p_league_id, p.slug), 'auto', p.auto,
        'price', p.price, 'at', p.made_at) order by p.overall)
      from draft_pick p where p.league_id = p_league_id), '[]'::jsonb));
end $$;

-- GET /v1/league/{id}/picks — tradeable future pick assets
create or replace function api_picks(p_league_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
begin
  if not _api_open(p_league_id) then return null; end if;
  return jsonb_build_object('league_id', p_league_id,
    'picks', coalesce((select jsonb_agg(jsonb_build_object(
        'season', a.season, 'round', a.round, 'kind', a.kind,
        'original_roster', a.original_roster, 'original_team', _txn_team(p_league_id, a.original_roster),
        'owner_roster', a.owner_roster, 'owner_team', _txn_team(p_league_id, a.owner_roster),
        'traded', a.owner_roster <> a.original_roster)
        order by a.season, a.round, a.original_roster)
      from pick_asset a where a.league_id = p_league_id), '[]'::jsonb));
end $$;

-- GET /v1/league/{id}/players — the league's pool, with the crosswalk id a
-- third-party tool needs to join to anything else.
create or replace function api_players(p_league_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
begin
  if not _api_open(p_league_id) then return null; end if;
  return jsonb_build_object('league_id', p_league_id,
    'players', coalesce((select jsonb_agg(jsonb_build_object(
        'slug', lp.slug, 'name', lp.full_name, 'pos', lp.pos, 'team', lp.team,
        'rank', lp.rank, 'exp', lp.exp, 'espn_id', lp.espn_id,
        'roster_id', (select nr.roster_id from native_roster nr
                       where nr.league_id = p_league_id and nr.slug = lp.slug))
        order by lp.rank nulls last, lp.full_name)
      from league_pool lp where lp.league_id = p_league_id), '[]'::jsonb));
end $$;

-- GET /v1/league/{id}/history and /awards — 0324 and 0325, already shaped.
create or replace function api_history(p_league_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare h jsonb;
begin
  if not _api_open(p_league_id) then return null; end if;
  h := league_history(p_league_id);
  -- THE MANAGER LINE CARRIES A USER ID (0324 keys on app_user_id so a seat
  -- that changed hands keeps two honest lines). That id is ours, not the
  -- internet's: it is replaced here by a stable opaque handle, which still
  -- lets a tool group a manager's rows without being handed an account
  -- identifier it could look for anywhere else.
  if h ? 'managers' then
    h := jsonb_set(h, '{managers}', coalesce((
      select jsonb_agg((m - 'app_user_id') || jsonb_build_object(
               'manager', substr(md5(coalesce(m ->> 'manager', '')), 1, 12)))
        from jsonb_array_elements(h -> 'managers') m), '[]'::jsonb));
  end if;
  return jsonb_build_object('league_id', p_league_id, 'history', h);
end $$;

create or replace function api_awards(p_league_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
begin
  if not _api_open(p_league_id) then return null; end if;
  return jsonb_build_object('league_id', p_league_id, 'awards', league_awards(p_league_id, 25));
end $$;

grant execute on function api_league(uuid) to authenticated;
grant execute on function api_teams(uuid) to authenticated;
grant execute on function api_rosters(uuid) to authenticated;
grant execute on function api_standings(uuid) to authenticated;
grant execute on function api_matchups(uuid, int) to authenticated;
grant execute on function api_lineups(uuid, int) to authenticated;
grant execute on function api_transactions(uuid, bigint, int) to authenticated;
grant execute on function api_trades(uuid, int) to authenticated;
grant execute on function api_draft(uuid) to authenticated;
grant execute on function api_picks(uuid) to authenticated;
grant execute on function api_players(uuid) to authenticated;
grant execute on function api_history(uuid) to authenticated;
grant execute on function api_awards(uuid) to authenticated;

-- ═══ 3. two guards learn the public league ═══════════════════════════════════
-- _may_read_history (0324) and league_awards (0325) gate on membership, which
-- is right for the app and wrong for an API whose whole caller is anonymous.
-- A league that has opted in has opted its history and its trophies in too —
-- they are the two things a league most wants to show off.
create or replace function _may_read_history(p_league_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select is_admin() or coalesce(league_public_api(p_league_id), false) or exists (
    select 1 from unnest(_lineage_ids(p_league_id)) x(id)
     where is_league_member(x.id) or is_league_commish(x.id));
$$;
grant execute on function _may_read_history(uuid) to authenticated;

create or replace function league_awards(p_league_id uuid, p_weeks int default 6) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()
          or coalesce(league_public_api(p_league_id), false)) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  return jsonb_build_object('ok', true,
    'awards', coalesce((select jsonb_agg(jsonb_build_object(
        'key', d.key, 'name', d.name, 'icon', d.icon, 'metric', d.metric,
        'direction', d.direction, 'only_result', d.only_result, 'coin', d.coin,
        'sort', d.sort, 'is_default', d.is_default) order by d.sort, d.key)
      from _league_award_defs(p_league_id) d), '[]'::jsonb),
    'badges', coalesce((select jsonb_agg(jsonb_build_object(
        'key', b.key, 'name', b.name, 'icon', b.icon, 'note', b.note, 'sort', b.sort)
        order by b.sort, b.key)
      from league_badge b where b.league_id = p_league_id), '[]'::jsonb),
    'grants', coalesce((select jsonb_agg(jsonb_build_object(
        'key', g.key, 'roster_id', g.roster_id, 'season', g.season, 'note', g.note,
        'team', _txn_team(p_league_id, g.roster_id),
        'icon', (select b.icon from league_badge b where b.league_id = p_league_id and b.key = g.key),
        'name', (select b.name from league_badge b where b.league_id = p_league_id and b.key = g.key))
        order by g.granted_at desc)
      from league_badge_grant g where g.league_id = p_league_id), '[]'::jsonb),
    'weeks', coalesce((select jsonb_agg(jsonb_build_object(
        'week', x.week,
        'wins', (select jsonb_agg(jsonb_build_object(
            'key', w.key, 'name', w.name, 'icon', w.icon, 'roster_id', w.roster_id,
            'team', _txn_team(p_league_id, w.roster_id), 'value', w.value)
            order by w.key)
          from league_award_win w where w.league_id = p_league_id and w.week = x.week))
        order by x.week desc)
      from (select distinct week from league_award_win
             where league_id = p_league_id order by week desc limit greatest(p_weeks, 1)) x), '[]'::jsonb),
    'counts', coalesce((select jsonb_agg(jsonb_build_object(
        'roster_id', c.roster_id, 'team', _txn_team(p_league_id, c.roster_id),
        'key', c.key, 'icon', c.icon, 'name', c.name, 'n', c.n)
        order by c.n desc, c.roster_id)
      from (select w.roster_id, w.key, max(w.icon) as icon, max(w.name) as name, count(*)::int as n
              from league_award_win w where w.league_id = p_league_id
             group by w.roster_id, w.key) c), '[]'::jsonb));
end $$;
grant execute on function league_awards(uuid, int) to authenticated;

-- ═══ 4. the meter ════════════════════════════════════════════════════════════
-- A token bucket per caller, in one table. The edge function is the only
-- caller (service role), and it hands over whatever the request's client IP
-- was — so a burst from one address cannot drain the API for everyone else.
-- Rows are tiny and self-cleaning: anything untouched for an hour is swept on
-- the next call that notices it.
create table if not exists api_meter (
  ip        text primary key,
  tokens    numeric not null,
  last_at   timestamptz not null default now()
);
alter table api_meter enable row level security;   -- no policies: nobody reads this but the definer

-- Returns the tokens left after taking one, or -1 when the bucket is empty.
-- Defaults: 600 a minute, bursting to 120.
create or replace function api_take_token(p_ip text, p_rate numeric default 10, p_burst numeric default 120)
  returns numeric language plpgsql security definer set search_path = public as $$
declare t numeric; last timestamptz; refill numeric;
begin
  if p_ip is null or btrim(p_ip) = '' then return p_burst; end if;   -- unknown caller: let it through
  delete from api_meter where last_at < now() - interval '1 hour';
  select tokens, last_at into t, last from api_meter where ip = p_ip for update;
  if not found then
    insert into api_meter (ip, tokens, last_at) values (p_ip, p_burst - 1, now())
      on conflict (ip) do update set tokens = greatest(api_meter.tokens - 1, -1), last_at = now();
    return p_burst - 1;
  end if;
  refill := least(p_burst, t + extract(epoch from (now() - last)) * p_rate);
  if refill < 1 then
    update api_meter set tokens = refill, last_at = now() where ip = p_ip;
    return -1;
  end if;
  update api_meter set tokens = refill - 1, last_at = now() where ip = p_ip;
  return refill - 1;
end $$;
revoke all on function api_take_token(text, numeric, numeric) from public, anon, authenticated;
grant execute on function api_take_token(text, numeric, numeric) to service_role;

-- GET /v1/health — and the one place that says what this API is.
create or replace function api_health() returns jsonb
  language sql stable security definer set search_path = public as $$
  select jsonb_build_object('ok', true, 'api', 'drip-public', 'version', 'v1',
    'public_leagues', (select count(*)::int from league l
                        where coalesce((l.settings_json ->> 'public_api')::boolean,
                                       coalesce(l.kind, 'league') <> 'league')
                          and not coalesce(l.is_mock, false)),
    'now', now());
$$;
revoke all on function api_health() from public, anon;
grant execute on function api_health() to service_role, authenticated;


-- ═══ 5. the console reads the switch ═════════════════════════════════════════
-- roster_rules: 0321's body, reporting whether this league is public.
create or replace function roster_rules(p_league_id uuid)
  returns jsonb language plpgsql stable security definer set search_path = public as $$
declare d draft%rowtype;
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into d from draft where league_id = p_league_id;
  if not found then return jsonb_build_object('error', 'not a native league'); end if;
  return jsonb_build_object('ok', true, 'rounds', d.rounds, 'draft_status', d.status,
    'pos_caps', league_pos_caps(p_league_id),
    'fa_mode', league_fa_mode(p_league_id),   -- 0287
    'waiver_mode', league_waiver_mode(p_league_id),
    'faab_budget', league_faab_budget(p_league_id),
    'trade_review', league_trade_review(p_league_id),
    'waiver_clear_min', (select nullif(settings_json ->> 'waiver_clear_min', '')::int from league where id = p_league_id),
    'waiver_clear_dow', (select settings_json -> 'waiver_clear_dow' from league where id = p_league_id),
    'fa_after_waivers_dow', (select settings_json -> 'fa_after_waivers_dow' from league where id = p_league_id),
    'waiver_hold_days', (select coalesce(nullif(settings_json ->> 'waiver_hold_days', '')::int, 1) from league where id = p_league_id),
    'fa_start_min', (select nullif(settings_json ->> 'fa_start_min', '')::int from league where id = p_league_id),
    'fa_end_min', (select nullif(settings_json ->> 'fa_end_min', '')::int from league where id = p_league_id),
    -- The taxi squad's own rules (0196), and whether it is shut right now.
    'taxi_max_exp', (select nullif(settings_json -> 'taxi' ->> 'max_exp', '')::int from league where id = p_league_id),
    'taxi_lock', league_taxi_lock(p_league_id),
    'taxi_locked_now', taxi_is_locked(p_league_id),
    'taxi_lock_at', league_week1_kickoff(p_league_id),
    -- Which designations qualify for an IR spot (0198), so a screen can gate
    -- the button instead of discovering the rule from a red error.
    'ir_tags', to_jsonb(league_ir_tags(p_league_id)),
    -- …and for an OUT spot (0307), the week-to-week sibling.
    'out_tags', to_jsonb(league_out_tags(p_league_id)),
    -- 0213: may unclaimed seats work the wire? The screen needs the CURRENT
    -- value to render the switch, and absent means on, so it cannot be read
    -- off settings_json directly without duplicating that default.
    'agent_waivers', league_agent_waivers(p_league_id),
    -- 0319: the Sleeper parity knobs.
    'faab_min_bid', league_faab_min_bid(p_league_id),
    'fa_dow', (select settings_json -> 'fa_dow' from league where id = p_league_id),
    'trade_deadline_week', league_trade_deadline_week(p_league_id),
    'trade_deadline_passed', trade_deadline_error(p_league_id) is not null,
    -- 0320: the commissioner's desk.
    'wire_lock', league_wire_lock(p_league_id),
    'locked_rosters', (select coalesce(jsonb_agg(sleeper_roster_id order by sleeper_roster_id), '[]'::jsonb)
                         from league_membership where league_id = p_league_id and wire_locked),
    'median_game', league_median_game(p_league_id),
    'dues_amount', (select nullif(settings_json ->> 'dues_amount', '')::int from league where id = p_league_id),
    'dues_note', (select settings_json ->> 'dues_note' from league where id = p_league_id),
    -- 0321: the trade floor. veto_votes is the EFFECTIVE bar (the stored
    -- number, or the majority it falls back to), and veto_votes_set says
    -- which of the two the console is looking at.
    'trade_review_hours', league_trade_review_hours(p_league_id),
    'trade_veto_votes', league_trade_veto_votes(p_league_id),
    'trade_veto_votes_set', (select nullif(settings_json ->> 'trade_veto_votes', '')::int from league where id = p_league_id),
    'trade_offer_days', league_trade_offer_days(p_league_id),
    'faab_trading', league_faab_trading(p_league_id),
    -- 0326: is this league served by the anonymous public read API?
    'public_api', coalesce(league_public_api(p_league_id), false));
end $$;
grant execute on function roster_rules(uuid) to authenticated;
