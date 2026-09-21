-- LEAGUE COMPATIBILITY REPORT for v0.437.0–v0.456.0 (PR #915). READ-ONLY.
--
-- Run BEFORE or AFTER the branch's migrations (it uses base tables only and
-- asks psql whether the new tables exist). For every real league it prints
-- what the round changes about how that league is read, priced, opened and
-- swept — so the answer to "does any of this conflict with my leagues" is a
-- table, not a guess. Via .github/workflows/dbquery.yml:
--   file = scripts/db/league-compat-report.sql   (leave allow_writes off)
\set QUIET on
\pset pager off
\pset format aligned
\pset null '·'
\set ON_ERROR_STOP on
select (to_regclass('public.league_award') is not null)::text as has_awards,
       (to_regclass('public.trade_leg') is not null)::text as has_legs,
       (to_regclass('public.player_xref') is not null)::text as has_xref,
       (to_regclass('public.adp_board') is not null)::text as has_adp_board,
       exists (select 1 from information_schema.columns where table_name = 'waiver_claim' and column_name = 'group_id')::text as has_groups,
       exists (select 1 from information_schema.columns where table_name = 'trade_proposal' and column_name = 'review_until')::text as has_review
\gset

\echo
\echo '════ 0. what this database already has of the branch ════'
select :has_awards as awards_0325, :has_legs as legs_0322, :has_groups as groups_0323,
       :has_review as review_0321, :has_xref as xref_0331, :has_adp_board as adp_board_0334;

\echo
\echo '════ 1. every real league: how the round READS it ════'
\echo '   sf_old = 0237 rule (SF for a spec-less classic league); sf_new = 0336 rule (1QB) — a change flips'
\echo '   the ADP column, the dynasty board, the trade grade''s pick prices and (contract leagues) extension prices.'
\echo '   adp_fmt = the Sleeper board the ADP column will read; api = public read API after 0327 (open by default for native).'
with l as (
  select id, name, season, provider, coalesce(kind, 'league') as kind, coalesce(is_mock, false) as mock,
         settings_json as sj, coalesce(settings_json ->> 'game_mode', 'drip') as mode,
         (select count(*) from league_membership m where m.league_id = league.id and m.enrolled) as seats
  from league
), rules as (
  select l.*,
    case
      when mode <> 'classic' then true
      when sj -> 'roster_slots' is not null then coalesce((
        select count(*) filter (where s -> 'pos' ? 'QB') >= 2
               or bool_or((s -> 'pos' ? 'QB') and jsonb_array_length(s -> 'pos') > 1)
        from jsonb_array_elements(sj -> 'roster_slots') s), false)
      when sj -> 'roster_classic' is not null then
           coalesce((sj -> 'roster_classic' ->> 'SFLX')::int, 0) >= 1 or coalesce((sj -> 'roster_classic' ->> 'QB')::int, 0) >= 2
      else null   -- spec-less classic: OLD rule says SF, NEW rule says 1QB
    end as sf_spec,
    case when sj -> 'roster_slots' is null and sj -> 'roster_classic' is null and mode = 'classic' then 'spec-less' 
         when sj -> 'roster_slots' is not null then 'slots' when sj -> 'roster_classic' is not null then 'counts' else 'drip' end as spec,
    coalesce((sj ->> 'ppr')::numeric, 1) as ppr,
    sj -> 'scoring' ->> 'rec' as rec_override,
    (sj ->> 'public_api')::boolean as api_explicit,
    coalesce(sj ->> 'trade_review', 'none') as review,
    nullif(sj ->> 'trade_veto_votes', '')::int as veto_set,
    coalesce(nullif(sj ->> 'trade_review_hours', '')::int, 24) as review_h,
    coalesce(nullif(sj ->> 'trade_offer_days', '')::int, 0) as offer_days,
    coalesce((sj ->> 'faab_trading')::boolean, true) as faab_trading,
    coalesce(sj ->> 'waiver_mode', 'rolling') as waivers,
    sj ->> 'salary_cap' is not null as contracts
  from l
)
select left(name, 22) as league, season, provider, kind, mock, spec,
       coalesce(sf_spec, true)  as sf_old,
       coalesce(sf_spec, false) as sf_new,
       case when sf_spec is null then '⚠ FLIPS SF→1QB' else '' end as superflex_change,
       case when coalesce(sf_spec, false) then '2qb' when ppr >= 0.75 then 'ppr' when ppr >= 0.25 then 'half' else 'std' end as adp_fmt,
       case when rec_override is not null then '⚠ scoring.rec=' || rec_override || ' ≠ ppr key' else '' end as adp_note,
       coalesce(api_explicit::text, case when provider = 'native' then 'OPEN (default)' else 'private (default)' end) as api,
       review, coalesce(veto_set, greatest(1, ((seats - 2) / 2) + 1)) as veto_bar, seats, review_h, offer_days,
       waivers, faab_trading as faab_trades, contracts
  from rules
 where not mock and kind = 'league'
 order by provider, season desc, name;

\echo
\echo '════ 2. trades in flight (offers, reviews, votes) — what 0336 changes for them ════'
\if :has_review
with t as (
  select t.id, t.league_id, t.status, t.created_at, t.expires_at, t.review_until, t.faab_dollars,
         (select count(*) from league_membership m where m.league_id = t.league_id and m.enrolled
             and m.sleeper_roster_id not in (t.from_roster, t.to_roster)) as electorate
    from trade_proposal t where t.status in ('pending', 'accepted', 'review')
)
select left(l.name, 22) as league, t.status, t.created_at::date as filed, t.expires_at, t.review_until, t.faab_dollars,
       coalesce(nullif(l.settings_json ->> 'trade_veto_votes', '')::int, greatest(1, ((
          (select count(*) from league_membership m where m.league_id = l.id and m.enrolled) - 2) / 2) + 1)) as veto_bar,
       t.electorate,
       case when t.status = 'review' and coalesce(nullif(l.settings_json ->> 'trade_veto_votes', '')::int, 1) > t.electorate
            then '⚠ bar above the room — 0336 caps it' else '' end as note
  from t join league l on l.id = t.league_id
 order by l.name, t.created_at;
\else
select 'no trade clocks yet (0321 not applied) — pending offers have no expiry and are untouched by the sweep' as note;
\endif

\echo
\echo '════ 3. pending waiver claims — groups, and clocks that differ inside a group ════'
\if :has_groups
select left(l.name, 22) as league, count(*) as pending_claims,
       count(distinct w.group_id) filter (where w.group_id is not null) as linked_groups,
       count(*) filter (where w.group_id is not null and exists (
         select 1 from waiver_claim w2 where w2.group_id = w.group_id and w2.status = 'pending'
            and coalesce(w2.clears_at, now()) <> coalesce(w.clears_at, now()))) as claims_in_mixed_clock_groups
  from waiver_claim w join league l on l.id = w.league_id
 where w.status = 'pending'
 group by l.name order by l.name;
\else
select left(l.name, 22) as league, count(*) as pending_claims, 0 as linked_groups
  from waiver_claim w join league l on l.id = w.league_id where w.status = 'pending' group by l.name order by l.name;
\endif

\echo
\echo '════ 4. awards: what the FIRST award_sweep after deploy will hand out (and post to chat) ════'
\echo '   one house message per league-week listed; coin is 0 unless a custom award set one'
with lw as (
  select m.league_id, m.week
    from matchup m join league l on l.id = m.league_id
   where m.week < 100 and l.provider = 'native' and coalesce(l.kind, 'league') = 'league' and not coalesce(l.is_mock, false)
     and coalesce(nullif(regexp_replace(l.season, '\D', '', 'g'), '')::int, 0)
         >= extract(year from now())::int - case when extract(month from now()) < 3 then 1 else 0 end
   group by m.league_id, m.week
  having count(*) filter (where m.status <> 'final' or m.home_final is null or m.away_final is null) = 0
)
select left(l.name, 22) as league, l.season, count(*) as final_weeks_to_award, string_agg(lw.week::text, ',' order by lw.week) as weeks
  from lw join league l on l.id = lw.league_id
 group by l.name, l.season order by l.name;
\if :has_awards
\echo '   …minus the weeks every active award already covers (what the sweep will ACTUALLY touch):'
with lw as (
  select m.league_id, m.week
    from matchup m join league l on l.id = m.league_id
   where m.week < 100 and l.provider = 'native' and coalesce(l.kind, 'league') = 'league' and not coalesce(l.is_mock, false)
     and coalesce(nullif(regexp_replace(l.season, '\D', '', 'g'), '')::int, 0)
         >= extract(year from now())::int - case when extract(month from now()) < 3 then 1 else 0 end
   group by m.league_id, m.week
  having count(*) filter (where m.status <> 'final' or m.home_final is null or m.away_final is null) = 0
     and exists (select 1 from _league_award_defs(m.league_id) a
                  where not exists (select 1 from league_award_win w where w.league_id = m.league_id and w.week = m.week and w.key = a.key))
)
select left(l.name, 22) as league, l.season, count(*) as weeks_the_sweep_touches, string_agg(lw.week::text, ',' order by lw.week) as weeks
  from lw join league l on l.id = lw.league_id
 group by l.name, l.season order by l.name;
\echo '   custom awards already defined (coin prizes pay from the wallet):'
select left(l.name, 22) as league, a.key, a.name, a.coin, a.active from league_award a join league l on l.id = a.league_id order by l.name, a.sort;
\echo '   weeks already awarded (untouched by the sweep unless an active award is missing for them):'
select left(l.name, 22) as league, count(distinct w.week) as awarded_weeks, count(*) as wins
  from league_award_win w join league l on l.id = w.league_id group by l.name order by l.name;
\echo '   badge grants (league_history counted these into the record before 0336):'
select left(l.name, 22) as league, g.roster_id, count(*) as badges from league_badge_grant g join league l on l.id = g.league_id
 group by l.name, g.roster_id having count(*) > 1 order by l.name;
\endif

\echo
\echo '════ 5. lineages: a private season readable through a public one (0336 closes this) ════'
select left(a.name, 22) as private_league, a.season, left(b.name, 22) as public_sibling, b.season as sibling_season
  from league a join league b on b.sleeper_league_id = a.sleeper_league_id and b.id <> a.id
 where a.provider = 'native' and b.provider = 'native'
   and coalesce((a.settings_json ->> 'public_api')::boolean, true) = false
   and coalesce((b.settings_json ->> 'public_api')::boolean, true) = true
 order by a.name;

\echo
\echo '════ 6. pool ids — what the daily crosswalk backfill will fill or CORRECT ════'
\if :has_xref
select left(l.name, 22) as league, count(*) as pool,
       count(*) filter (where lp.espn_id is null and lp.sleeper_id is not null
          and exists (select 1 from player_xref x where x.sleeper_id = lp.sleeper_id and x.espn_id is not null)) as espn_to_fill,
       count(*) filter (where lp.sleeper_id is null and lp.espn_id is not null
          and exists (select 1 from player_xref x where x.espn_id = lp.espn_id and x.sleeper_id is not null)) as sleeper_to_fill,
       count(*) filter (where lp.sleeper_id is not null and lp.espn_id is not null and exists (
          select 1 from player_xref x, player_xref o
           where x.sleeper_id = lp.sleeper_id and x.espn_id is not null and lp.espn_id <> x.espn_id
             and o.espn_id = lp.espn_id and o.gsis_id <> x.gsis_id)) as espn_to_correct
  from league_pool lp join league l on l.id = lp.league_id
 where l.provider = 'native' and not coalesce(l.is_mock, false)
 group by l.name order by l.name;
\else
select left(l.name, 22) as league, count(*) as pool,
       count(*) filter (where lp.espn_id is null) as no_espn_id, count(*) filter (where lp.sleeper_id is null) as no_sleeper_id
  from league_pool lp join league l on l.id = lp.league_id
 where l.provider = 'native' and not coalesce(l.is_mock, false)
 group by l.name order by l.name;
\endif

\echo
\echo '════ 7. seats: who would be on old mobile builds (the retired review chips could still save over a league vote) ════'
select left(l.name, 22) as league, count(*) as seats, count(*) filter (where m.app_user_id is null) as unclaimed
  from league_membership m join league l on l.id = m.league_id
 where l.provider = 'native' and not coalesce(l.is_mock, false) and m.enrolled
 group by l.name order by l.name;
\echo
\echo 'done — read-only.'
