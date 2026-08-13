-- 0135: make 0134's lock hold visible to clients — the follow-up the live board
-- forced. 0134 reopened week 102 server-side, but the web board derives every
-- window's locked/live state from the WALL CLOCK against the slate's kickoffs
-- (Matchup.tsx liveWinState): at kickoff−1h it shows 🔒 LOCKED on its own
-- authority, so the founder was looking at a locked board over a wide-open
-- database. The client can't honor a hold it can't see; lock_hold is RLS-dark
-- by design. This is the one peephole: the set of held weeks, nothing else.
create or replace function lock_holds() returns int[]
  language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(week order by week), '{}') from lock_hold;
$$;
grant execute on function lock_holds() to authenticated;
