-- 0223 — THE BOARD TELLS THE TRUTH ABOUT THE LEAGUE.
--
-- Founder: "when you post a league on the recruiting board it tells the
-- details of the type of league and any special scoring rules. We also want
-- commish to list any dues when posting. Let's make sure we still have a way
-- to check out all of the league without actually joining it."
--
-- Three touches, no new machinery:
--   · league_listing grows `dues` — FREE TEXT ("$50, Venmo before the
--     draft"), because the platform doesn't move money and shouldn't pretend
--     to; the listing is the commissioner's word, printed where joiners
--     decide. post_league_listing takes it (null keeps, '' clears).
--   · league_board rows carry the league's IDENTITY: game (drip/classic),
--     continuity (redraft…contract dynasty), format (guillotine/vampire),
--     the salary cap when contracts are on, reception scoring, a custom-
--     scoring flag, and the dues — enough to know what you'd be joining
--     from the card alone.
--   · league_preview — the LOOK-BEFORE-YOU-JOIN read that has existed since
--     0156 (anyone may read a league with an open listing, in full, without
--     taking a seat) — now answers with the same identity block plus the
--     whole contract rulebook, so "check out all of the league" includes
--     everything 0217–0222 added. The join stays a separate, deliberate tap.
--
-- LINEAGE: post_league_listing/league_board current bodies are 0123's,
-- league_preview's is 0161's — patched from those, and the 2-param
-- post_league_listing signature is dropped before the 3-param lands.

alter table league_listing add column if not exists dues text;

-- ── post v2: the dues ride the listing ───────────────────────────────────────
drop function if exists post_league_listing(uuid, text);
create or replace function post_league_listing(p_league_id uuid, p_blurb text default null, p_dues text default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lg league%rowtype;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not signed in'); end if;
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  select * into lg from league where id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'league not found'); end if;
  if lg.provider <> 'native' then
    return jsonb_build_object('ok', false, 'error', 'only native leagues can be posted — others recruit with their invite links');
  end if;
  insert into app_user (id) values (auth.uid()) on conflict (id) do nothing;
  insert into league_listing (league_id, created_by, blurb, dues)
    values (p_league_id, auth.uid(), left(coalesce(p_blurb, ''), 280), nullif(left(coalesce(p_dues, ''), 120), ''))
  on conflict (league_id) do update
    set open = true, updated_at = now(),
        blurb = case when p_blurb is null then league_listing.blurb else left(p_blurb, 280) end,
        dues  = case when p_dues  is null then league_listing.dues  else nullif(left(p_dues, 120), '') end;
  return jsonb_build_object('ok', true);
end $$;
grant execute on function post_league_listing(uuid, text, text) to authenticated;

-- ── One identity block, shared by the board and the preview ──────────────────
-- What KIND of league this is, in the vocabulary the platform now speaks:
-- game, continuity, format, contracts, reception scoring, custom scoring.
create or replace function _league_identity(p_league_id uuid) returns jsonb
  language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'game_mode', coalesce(l.settings_json ->> 'game_mode', 'drip'),
    'continuity', league_continuity(l.id),
    'format', league_format(l.id),
    'contracts', contracts_on(l.id),
    'salary_cap', case when contracts_on(l.id) then league_salary_cap(l.id) end,
    'ppr', coalesce((l.settings_json ->> 'ppr')::numeric, 1),
    -- "special scoring rules": any per-metric override away from the defaults
    'scoring_custom', coalesce(jsonb_typeof(l.settings_json -> 'scoring') = 'object'
      and l.settings_json -> 'scoring' <> '{}'::jsonb, false),
    'vampire_seat', case when league_format(l.id) = 'vampire' then vampire_seat(l.id) end)
  from league l where l.id = p_league_id;
$$;

-- ── league_board v2 (0123 body + identity + dues) ────────────────────────────
create or replace function league_board()
  returns jsonb language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  if auth.uid() is null then return jsonb_build_object('error', 'not signed in'); end if;
  select coalesce(jsonb_agg(r), '[]'::jsonb) into result from (
    select jsonb_build_object(
      'league_id', l.id, 'name', l.name, 'season', l.season, 'avatar_url', l.avatar_url,
      'blurb', li.blurb, 'dues', li.dues, 'posted_at', li.updated_at,
      'seats_total', (select count(*) from league_membership m where m.league_id = l.id),
      'seats_open',  (select count(*) from league_membership m
                       where m.league_id = l.id and m.app_user_id is null and not m.enrolled),
      'draft_status', coalesce((select d.status from draft d where d.league_id = l.id), 'pending'),
      'draft_mode',   coalesce((select d.mode from draft d where d.league_id = l.id), 'snake'),
      'identity', _league_identity(l.id),
      'mine',    exists (select 1 from league_membership m
                          where m.league_id = l.id and m.app_user_id = auth.uid() and m.enrolled),
      'commish', l.commissioner_id = auth.uid()
    ) as r
    from league_listing li
    join league l on l.id = li.league_id
    where li.open
      and exists (select 1 from league_membership m
                   where m.league_id = l.id and m.app_user_id is null and not m.enrolled)
    order by li.updated_at desc
  ) t;
  return result;
end $$;

-- ── league_preview v-next (0161 body + identity, dues, the contract book) ────
create or replace function league_preview(p_league_id uuid)
  returns jsonb language plpgsql stable security definer set search_path = public as $$
declare l league%rowtype; d draft%rowtype; listed boolean;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not signed in'); end if;
  select * into l from league where id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such league'); end if;
  listed := exists (select 1 from league_listing li where li.league_id = p_league_id and li.open);
  if not (listed or is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'not open for browsing');
  end if;
  select * into d from draft where league_id = p_league_id;

  return jsonb_build_object(
    'ok', true,
    'name', l.name, 'season', l.season, 'avatar_url', l.avatar_url,
    'game_mode', coalesce(l.settings_json ->> 'game_mode', 'drip'),
    'ppr', coalesce((l.settings_json ->> 'ppr')::numeric, 1),
    'bestball', coalesce(l.settings_json -> 'bestball', '[]'::jsonb),
    'roster', coalesce(l.settings_json -> 'roster_classic', '{}'::jsonb),
    'identity', _league_identity(p_league_id),
    'dues', (select li.dues from league_listing li where li.league_id = p_league_id),
    'blurb', (select li.blurb from league_listing li where li.league_id = p_league_id),
    'seats_total', (select count(*) from league_membership m where m.league_id = p_league_id),
    'seats_open',  (select count(*) from league_membership m
                     where m.league_id = p_league_id and m.app_user_id is null and not m.enrolled),
    'draft', case when d.league_id is null then null else jsonb_build_object(
      'status', d.status, 'mode', d.mode, 'rounds', d.rounds,
      'pick_seconds', d.pick_seconds,
      'budget', case when d.mode = 'auction' then d.budget end,
      'night', case when d.night_start_min is not null then jsonb_build_object(
        'start_min', d.night_start_min, 'end_min', d.night_end_min) end) end,
    'rules', jsonb_build_object(
      'waiver_mode', coalesce(l.settings_json ->> 'waiver_mode', 'rolling'),
      'faab_budget', l.settings_json -> 'faab_budget',
      'trade_review', coalesce(l.settings_json ->> 'trade_review', 'none'),
      'pos_caps', l.settings_json -> 'pos_caps',
      'live_buffs', not league_powerups_off(p_league_id)),
    -- the whole contract book, when the league plays with one (0217–0220)
    'contract_rules', case when contracts_on(p_league_id) then jsonb_build_object(
      'salary_cap', league_salary_cap(p_league_id),
      'years_max', contract_years_max(p_league_id),
      'dead_pct', contract_dead_pct(p_league_id),
      'retention', salary_retention_on(p_league_id),
      'cap_trading', cap_trading_on(p_league_id),
      'ir_relief', ir_cap_relief_on(p_league_id),
      'tag_raise_pct', tag_raise_pct(p_league_id),
      'ext_discount_pct', ext_discount_pct(p_league_id),
      'rfa', rfa_on(p_league_id)) end,
    'scoring', l.settings_json -> 'scoring',
    'teams', (select coalesce(jsonb_agg(jsonb_build_object(
        'roster_id', m.sleeper_roster_id, 'team_name', m.team_name,
        'taken', m.app_user_id is not null and m.enrolled)
        order by m.sleeper_roster_id), '[]'::jsonb)
      from league_membership m where m.league_id = p_league_id));
end $$;
grant execute on function league_preview(uuid) to authenticated;

-- ── league_listing_state v2 (0124 body + dues): the commissioner's edit form
-- must read back what it wrote ────────────────────────────────────────────────
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
    'dues', li.dues,
    'seats_open', (select count(*) from league_membership m
                    where m.league_id = p_league_id and m.app_user_id is null and not m.enrolled));
end $$;
grant execute on function league_listing_state(uuid) to authenticated;
