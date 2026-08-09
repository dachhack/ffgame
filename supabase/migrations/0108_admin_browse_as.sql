-- 0108: let a super-admin READ through the player surfaces, so "view as" can
-- actually browse the site as a user (leagues page, open a league) instead of
-- rendering a separate summary panel.
--
-- The player screens read the tables directly under RLS, and every relevant
-- policy is is_league_member(), so an admin outside a league gets empty results
-- from myEnrollments / myMatchup / matchupTeams and the browse path renders
-- nothing. This widens exactly those SELECT policies with `or is_admin()`.
--
-- What is deliberately NOT touched:
--
--   • sealed_pick. supabase/README.md calls its policy "the one property that
--     must hold" — an opponent must not read an unlocked pick. Admins already
--     reach the same rows through admin_matchup_picks / admin_user_state, which
--     are purpose-built and auditable, so widening the policy would add no
--     capability while turning any future is_admin() bug into a cheating vector.
--     Consequence: a browse-as session shows the board without the user's own
--     sealed picks; read those from the 👁 view-as panel.
--
--   • Every write policy. sealed_pick, applied_state et al. gate on
--     `app_user_id = auth.uid()`, so an admin browsing as someone can never
--     write in that user's name — the read widening cannot become a write.
--     Read-only is enforced here, not just by hiding buttons in the UI.
--
-- is_admin() is the super-admin flag, not a league commissioner, so this grants
-- a commissioner nothing new about leagues they don't belong to.
drop policy if exists league_read on league;
create policy league_read on league
  for select using (is_league_member(id) or is_admin());

drop policy if exists membership_read on league_membership;
create policy membership_read on league_membership
  for select using (is_league_member(league_id) or is_admin());

drop policy if exists lineup_read on sleeper_lineup;
create policy lineup_read on sleeper_lineup
  for select using (is_league_member(league_id) or is_admin());

drop policy if exists matchup_read on matchup;
create policy matchup_read on matchup
  for select using (is_league_member(league_id) or is_admin());

drop policy if exists matchup_state_read on matchup_state;
create policy matchup_state_read on matchup_state
  for select using (is_matchup_participant(matchup_id) or is_admin());
