-- 0279: A DRAFT IS NOT AN ADD/DROP (v0.394.5).
--
-- Founder, the afternoon of a draft: "with the season already started that
-- might be a hiccup. Let's make sure drafting mid-nfl season still works."
--
-- 0179 put a kickoff lock on `native_roster`: in a CLASSIC-mode league you may
-- not add, drop or move a player whose game in the league's LIVE WEEK has
-- already started. That rule is right for a season in progress, and it was
-- written when every classic league drafted before week 1.
--
-- It does not survive a league that drafts AFTER the season starts, which is
-- now the normal case:
--   • `native_generate_schedule` always numbers weeks 1..N, and the creation
--     flow generates the schedule BEFORE the draft, so a brand-new league has
--     week-1 matchups sitting at 'scheduled';
--   • `league_live_week` is therefore 1, and every real week-1 kickoff is in
--     the past, so `classic_slug_started` is TRUE for every pooled player;
--   • a draft pick is an INSERT into `native_roster`, so the trigger fires and
--     refuses it.
-- Reproduced before writing this: a manager's `make_draft_pick` raises "that
-- player's game has kicked off", while the WORKER's autopick sails through
-- (auth.uid() is null exempts the server) and an is_admin() commissioner is
-- exempt too. The room appears to draft itself while refusing every human, and
-- undo/edit/reset — all DELETEs — refuse for a non-admin commissioner as well.
--
-- THE FIX IS THE SCOPE, not the rule: the lock is about protecting a lineup
-- mid-season, and a league whose draft has not finished has no lineup to
-- protect. While `draft.status <> 'complete'` the roster is being BUILT, and
-- building it is the whole point. The moment the draft completes the lock
-- applies again, unchanged, which is what keeps week-1 add/drops honest.
--
-- Body is 0179's, with the one exemption added.

create or replace function enforce_classic_roster_lock() returns trigger
  language plpgsql security definer set search_path = public as $$
declare rec native_roster; other text;
begin
  if auth.uid() is null then return coalesce(new, old); end if;   -- the server
  if is_admin() then return coalesce(new, old); end if;           -- game ops
  rec := coalesce(new, old);
  -- A DRAFT IN PROGRESS IS EXEMPT (0279). Not "before week 1" — a draft, at
  -- any point in the season. status is 'pending' until it opens and 'live'
  -- while it runs; only 'complete' re-arms the lock.
  if exists (select 1 from draft d
              where d.league_id = rec.league_id and d.status <> 'complete') then
    return coalesce(new, old);
  end if;
  if classic_slug_started(rec.league_id, rec.slug) then
    raise exception 'that player''s game has kicked off — he cannot be added, dropped or moved this week'
      using errcode = 'check_violation';
  end if;
  -- An UPDATE that swaps the slug is two moves in one row; check both ends,
  -- for the same reason 0178 checks the outgoing player on a lineup swap.
  if tg_op = 'UPDATE' and new.slug is distinct from old.slug then
    other := old.slug;
    if classic_slug_started(old.league_id, other) then
      raise exception 'that player''s game has kicked off — he cannot be added, dropped or moved this week'
        using errcode = 'check_violation';
    end if;
  end if;
  return coalesce(new, old);
end $$;

comment on function enforce_classic_roster_lock() is
  'CLASSIC roster moves lock at each player''s kickoff — EXCEPT while the league''s draft is unfinished (0279), when the roster is being built rather than changed.';
