-- ═══════════════════════════════════════════════════════════════════════════
-- 0414 · THE RAMS ARE "LA" ON THE SLATE AND "LAR" IN THE POOL.
--
-- Kickoff League chat, Oct 2: "Rams players are glitched again, can I get
-- Stafford out and Shough in? … it's been Stafford and Puka both weeks."
-- (#1095, "I thought we fixed this.")
--
-- The worker writes nfl_slate with our normalized codes (scoreboard.js
-- fixTeam: LAR→LA, WSH→WAS, JAC→JAX), and league_pool.team keeps Sleeper's
-- (LAR). classic_kickoff_for joined them on upper() alone, so a Rams player
-- had NO kickoff:
--   • here, classic_slug_started read false, so a Rams player could be moved
--     after his game started;
--   • in the worker (lock.js, fixed alongside), "can't place him" sealed his
--     lineup spot at the week's FIRST kickoff, Thursday night, for a Sunday
--     game. That is the glitch the chat reported.
-- resolve.js already compared through normTeam (v0.388-era); these two did not.
-- _nfl_team mirrors core slugMeta.normTeam.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function _nfl_team(t text) returns text
  language sql immutable as $$
  select case upper(coalesce(t, ''))
           when 'LAR' then 'LA' when 'STL' then 'LA' when 'WSH' then 'WAS' when 'JAC' then 'JAX'
           when 'OAK' then 'LV' when 'SD' then 'LAC' when 'AZ' then 'ARI'
           else upper(coalesce(t, '')) end
$$;

-- 0375's body; the NFL branch now compares normalized team codes.
create or replace function classic_kickoff_for(p_league_id uuid, p_week int, p_slug text)
  returns timestamptz language sql stable security definer set search_path = public as $$
  select case
    when p_slug ~ '^c-[0-9]+$' then (
      select min(s.kickoff)
        from college_player cp
        join nfl_slate s
          on upper(s.home) = upper(cp.school_abbr) or upper(s.away) = upper(cp.school_abbr)
       where cp.espn_id = substr(p_slug, 3) and cp.school_abbr is not null
         and case when p_week > 200
                  then s.week = p_week and s.season = (select max(season) from nfl_slate where week = p_week)
                  else s.week between 201 and 223
                   and s.kickoff between (select lo from nfl_week_window(p_week)) and (select hi from nfl_week_window(p_week))
             end)
    else (
      select min(s.kickoff)
        from league_pool p
        join nfl_slate s
          on s.week = p_week
         and s.season = (select max(season) from nfl_slate where week = p_week)
         and (_nfl_team(s.home) = _nfl_team(p.team) or _nfl_team(s.away) = _nfl_team(p.team))
       where p.league_id = p_league_id and p.slug = p_slug and p.team <> '')
  end;
$$;
grant execute on function classic_kickoff_for(uuid, int, text) to authenticated;

-- ── Picks the worker sealed early ──────────────────────────────────────────
-- Weeks 3 and 4: every Rams player in a classic lineup sealed at Thursday's
-- kickoff. A classic weekly pick seals at its own player's kickoff, so a
-- sealed pick whose player's game is still ahead was sealed by the bug; open
-- it again. The worker seals it at the right time. Byes and players we can't
-- place have no kickoff and are left alone. Called here and once by the worker
-- at boot (v0.597.0), so an old worker re-sealing between this migration and
-- the deploy can't make it stick.
create or replace function unseal_early_classic_picks() returns int
  language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if auth.uid() is not null and not is_admin() then return 0; end if;
  with fix as (
    select sp.id
      from sealed_pick sp
      join matchup m on m.id = sp.matchup_id
      join league l on l.id = m.league_id
     where sp.game_window = 'wk' and sp.locked and sp.player_slug is not null and sp.player_slug !~ '^c-[0-9]+$'
       and m.status in ('scheduled', 'live')
       and coalesce(l.settings_json ->> 'game_mode', 'drip') = 'classic'
       and classic_kickoff_for(m.league_id, m.week, sp.player_slug) > now()
  )
  update sealed_pick s set locked = false, revealed_at = null from fix where s.id = fix.id;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function unseal_early_classic_picks() from public;

select unseal_early_classic_picks();
