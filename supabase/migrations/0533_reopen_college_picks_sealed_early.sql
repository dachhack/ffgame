-- ═══════════════════════════════════════════════════════════════════════════
-- 0533 · REOPEN COLLEGE PICKS SEALED BEFORE THEIR KICKOFF
--
-- Founder, Devy Test 1, Saturday of college week 12, twenty minutes before
-- Texas kicked off: "I can't swap out smothers" — an Out running back in the
-- FLEX. Ops 097: all eight of that seat's weekly picks are `locked`, each
-- sealed on Tuesday Nov 17 between 20:19 and 20:28 UTC, minutes after it was
-- written and hours before the week's first game — while the server's own
-- lock time for every one of them (classic_pick_lock) is that player's real
-- kickoff, Friday or Saturday. The board offers no change on a sealed spot.
--
-- A classic weekly pick seals at its own player's kickoff. A sealed college
-- pick whose player's game is still ahead was sealed early; this opens it
-- again, in every classic league that is still scheduled or live. The worker
-- seals each at its kickoff (seal_due_college_picks). 0414 did the same for
-- NFL players and left college slugs out.
--
-- Why they sealed on Tuesday is not known yet: today the rule that seals them
-- answers correctly. That is the follow-up, not this file.
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare r record; n int := 0;
begin
  for r in
    with fix as (
      select sp.id, m.league_id
        from sealed_pick sp
        join matchup m on m.id = sp.matchup_id
        join league l on l.id = m.league_id
       where sp.game_window = 'wk' and sp.locked and sp.player_slug ~ '^c-[0-9]+$'
         and m.status in ('scheduled', 'live')
         and coalesce(l.settings_json ->> 'game_mode', 'drip') = 'classic'
         and classic_kickoff_for(m.league_id, m.week, sp.player_slug) > now()
    ), done as (
      update sealed_pick s set locked = false, revealed_at = null from fix where s.id = fix.id
      returning fix.league_id
    )
    select left(league_id::text, 8) as lg, count(*) as c from done group by 1 order by 1
  loop
    n := n + r.c;
    raise notice '0533: league % — % college pick(s) reopened', r.lg, r.c;
  end loop;
  raise notice '0533: % college pick(s) sealed before their kickoff reopened', n;
end $$;
