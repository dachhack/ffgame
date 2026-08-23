-- 0214 — THE SLATE LEARNS ITS GAME ID (join-audit finding 1, v0.345.1).
--
-- game_feed and live_play have always been keyed by ESPN's stable event id,
-- but nfl_slate never stored it — the worker HELD the id at the moment it
-- built each slate row (slateFromGames) and dropped it. So the one join in the
-- schema between the slate and the feed, pot settlement's "is this window's
-- slate all final", matched on (week, home team) — a team-code STRING compare
-- across two vocabularies. That is precisely the join the LAR/LA split broke
-- for every Rams game (fixed at the code layer in v0.344.0), and a string
-- compare that can break once can break again.
--
-- The worker writes game_id from this release on (both slate writers — the
-- preseason tick and the weekly sync — carry it), and pot_window_final joins
-- on it WHERE THE ROW HAS ONE. Rows written before this migration have NULL
-- game_id and keep the team-code join until the next sync overwrites them —
-- upserts key on (season, week, home), so every future sync backfills its
-- whole week. Team codes in SQL are display-and-legacy from here.

alter table nfl_slate add column if not exists game_id text;

comment on column nfl_slate.game_id is
  'ESPN event id — the same key game_feed.game_id and live_play.game_id carry. The slate↔feed join key; team codes are display/legacy.';

-- Same function as 0117, with the slate↔feed join id-first. The elapsed-time
-- fallback's shape is unchanged: it applies only to games with no live feed at
-- all, so an overtime thriller with a feed is never settled early.
create or replace function pot_window_final(p_matchup_id uuid, p_win text) returns boolean
  language plpgsql stable security definer set search_path = public as $$
declare m matchup%rowtype; sn text; games int;
begin
  select * into m from matchup where id = p_matchup_id;
  if not found then return false; end if;
  if m.status = 'final' then return true; end if;
  -- Same season resolution as window_kickoff/0058: the newest season carrying
  -- this week number, so a stale prior season can never settle a live pot.
  select max(season) into sn from nfl_slate where week = m.week;
  select count(*) into games from nfl_slate s where s.season = sn and s.week = m.week and s.win = p_win;
  if games = 0 then return false; end if;
  return not exists (
    select 1 from nfl_slate s
    where s.season = sn and s.week = m.week and s.win = p_win
      and not (
        exists (
          select 1 from game_feed gf where gf.week = m.week and gf.state = 'post'
            and ((s.game_id is not null and gf.game_id = s.game_id)
              or (s.game_id is null and gf.home = s.home))
        )
        or (
          not exists (
            select 1 from game_feed gf where gf.week = m.week and gf.state is not null
              and ((s.game_id is not null and gf.game_id = s.game_id)
                or (s.game_id is null and gf.home = s.home))
          )
          and s.kickoff is not null and s.kickoff + interval '4 hours' <= now()
        )
      )
  );
end $$;
