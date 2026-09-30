-- ═══════════════════════════════════════════════════════════════════════════
-- 0399 · WHEN THE DEVY MARKET OPENS IS THE COMMISSIONER'S CALL.
--
-- Founder: "Lets make market open a commish decision".
--
-- Until now a new devy-market league opened its market when its first draft
-- completed (the Jan 15 lock reads "no draft done since the last Jan 15" as
-- locked, and a new league has none). settings_json.devy_open:
--   'after_draft' (default) — as before: shares open once the first draft is done;
--   'now'                   — shares open as soon as the league exists, so
--                             teams can scout and buy before the startup draft.
-- The choice only matters before the league's first completed draft; from
-- then on the yearly rhythm is the same for everyone (open until Jan 15,
-- locked until the rookie draft is done). A live draft always locks — a stake
-- bought mid-draft would reserve a player out from under the pick clock.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function _devy_open_now(p_league_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((select settings_json ->> 'devy_open' from league where id = p_league_id), 'after_draft') = 'now'
$$;

-- Has this league's lineage ever finished a draft?
create or replace function _devy_lineage_drafted(p_league_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from league l join draft d on d.league_id = l.id
                  where l.sleeper_league_id = _lineage(p_league_id) and d.status = 'complete')
$$;

create or replace function _devy_shares_locked(p_league_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select now() >= devy_shares_lock_at()
     and not exists (
       select 1 from league l join draft d on d.league_id = l.id
        where l.sleeper_league_id = _lineage(p_league_id)
          and d.status = 'complete' and d.completed_at >= devy_shares_lock_at())
     -- 0399: opened at creation — open until the first draft starts
     and not (_devy_open_now(p_league_id)
              and not _devy_lineage_drafted(p_league_id)
              and not exists (select 1 from league l join draft d on d.league_id = l.id
                               where l.sleeper_league_id = _lineage(p_league_id) and d.status = 'live'))
$$;

create or replace function set_league_devy_open(p_league_id uuid, p_open text)
  returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  if p_open not in ('now', 'after_draft') then
    return jsonb_build_object('ok', false, 'error', 'the market opens now or after_draft');
  end if;
  if not exists (select 1 from league where id = p_league_id and provider = 'native') then
    return jsonb_build_object('ok', false, 'error', 'not a native league');
  end if;
  if _devy_lineage_drafted(p_league_id) then
    return jsonb_build_object('ok', false, 'error', 'this league has drafted — the market already runs on the yearly calendar');
  end if;
  if exists (select 1 from draft where league_id = p_league_id and status = 'live') then
    return jsonb_build_object('ok', false, 'error', 'not while the draft is running');
  end if;
  update league set settings_json = coalesce(settings_json, '{}'::jsonb) || jsonb_build_object('devy_open', p_open)
   where id = p_league_id;
  return jsonb_build_object('ok', true, 'open', p_open, 'locked', _devy_shares_locked(p_league_id));
end $$;
grant execute on function set_league_devy_open(uuid, text) to authenticated;

create or replace function devy_shares_state(p_league_id uuid)
  returns jsonb language sql stable security definer set search_path = public as $$
  with lin as (select _lineage(p_league_id) as l),
  rights as (select * from devy_share_rights((select l from lin))),
  held as (
    select s.slug, jsonb_agg(jsonb_build_object('roster_id', s.roster_id, 'shares', s.shares, 'maxed_at', s.maxed_at,
             'cost', s.cost, 'value', _devy_proceeds(_devy_price(s.lineage, s.slug), s.shares, s.shares, s.cost),
             'maxed', _devy_maxed(s.shares, s.cost), 'qualified', _devy_qualified(s.shares, s.cost),
             'team', coalesce(m.team_name, 'Team ' || s.roster_id)) order by s.shares desc, s.maxed_at nulls last, s.roster_id) as holders
      from devy_share s
      left join league_membership m on m.league_id = p_league_id and m.sleeper_roster_id = s.roster_id
     where s.lineage = (select l from lin)
     group by s.slug),
  teams as (
    select m.sleeper_roster_id as roster_id,
           _devy_cash((select l from lin), m.sleeper_roster_id) as cash,
           coalesce((select sum(s.shares) from devy_share s where s.lineage = (select l from lin) and s.roster_id = m.sleeper_roster_id), 0) as shares,
           coalesce((select sum(_devy_proceeds(_devy_price(s.lineage, s.slug), s.shares, s.shares, s.cost))
                       from devy_share s where s.lineage = (select l from lin) and s.roster_id = m.sleeper_roster_id), 0) as value
      from league_membership m where m.league_id = p_league_id)
  select case when not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin())
    then jsonb_build_object('ok', false, 'error', 'forbidden')
    else jsonb_build_object('ok', true,
      'on', _devy_shares_on(p_league_id),
      'current', _devy_is_current(p_league_id),
      'locked', _devy_shares_locked(p_league_id),
      'lock_at', devy_shares_lock_at(),
      -- 0399: the commissioner's opening choice, and whether it still matters
      'open_now', _devy_open_now(p_league_id),
      'drafted', _devy_lineage_drafted(p_league_id),
      'frozen', _college_prices_frozen(),
      'rules', _devy_share_rules(),
      -- 0397: every seat, for the share-trade screen
      'teams', coalesce((select jsonb_agg(jsonb_build_object('roster_id', m.sleeper_roster_id,
                 'team', coalesce(m.team_name, 'Team ' || m.sleeper_roster_id)) order by m.sleeper_roster_id)
                 from league_membership m where m.league_id = p_league_id), '[]'::jsonb),
      'start_cash', coalesce((select nullif(settings_json ->> 'devy_start_cash', '')::numeric from league where id = p_league_id), 100),
      'used', coalesce((select jsonb_object_agg(t.roster_id::text, t.shares) from teams t), '{}'::jsonb),
      'cash', coalesce((select jsonb_object_agg(t.roster_id::text, t.cash) from teams t), '{}'::jsonb),
      'value', coalesce((select jsonb_object_agg(t.roster_id::text, t.value) from teams t), '{}'::jsonb),
      'prices_as_of', (select max(as_of) from college_price),
      'players', coalesce((select jsonb_agg(jsonb_build_object(
          'slug', h.slug, 'name', cp.full_name, 'pos', cp.pos, 'school', cp.school_abbr, 'class_year', cp.class_year,
          'active', coalesce(cp.active, false),
          'graduated_to', (select a.new_slug from player_alias a where a.old_slug = h.slug),
          'price', _devy_price((select l from lin), h.slug),
          'rank', (select p.rank from college_price p where p.espn_id = substr(h.slug, 3)),
          'holders', h.holders,
          'right', (select jsonb_build_object('roster_id', r.roster_id, 'via', r.via) from rights r where r.slug = h.slug))
          order by cp.full_name)
        from held h left join college_player cp on cp.espn_id = substr(h.slug, 3)), '[]'::jsonb),
      'reserved', coalesce((select jsonb_agg(jsonb_build_object('slug', r.slug, 'roster_id', r.roster_id, 'college_slug', r.college_slug))
        from devy_reserved(p_league_id) r), '[]'::jsonb))
  end
$$;
