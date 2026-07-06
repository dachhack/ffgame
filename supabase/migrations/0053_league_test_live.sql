-- 0053: super-admin "live test" toggle. Anchors a league's live board to a
-- compressed real-time schedule (set when the toggle flips on) so the whole
-- Setup → Locked → Live → Final flow can be exercised in preseason without
-- waiting for the real slate. Stores the anchor timestamp; null = off. The board
-- reads test_live_at directly (any league member) and derives the compressed
-- window timeline client-side.

alter table league add column if not exists test_live_at timestamptz;

-- Super-admin only: flip live-test mode on (stamp now) or off (clear).
create or replace function admin_set_test_live(p_league_id uuid, p_on boolean)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare ts timestamptz;
begin
  if not is_admin() then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  update league set test_live_at = case when p_on then now() else null end where id = p_league_id
    returning test_live_at into ts;
  return jsonb_build_object('ok', true, 'test_live_at', ts);
end $$;
grant execute on function admin_set_test_live(uuid, boolean) to authenticated;

-- Surface test_live_at on the super-admin overview so the toggle reflects state.
create or replace function admin_overview() returns jsonb
  language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  if not is_admin() then return jsonb_build_object('error', 'forbidden'); end if;
  select coalesce(jsonb_agg(r), '[]'::jsonb) into result from (
    select jsonb_build_object(
      'league_id', l.id, 'sleeper_league_id', l.sleeper_league_id, 'name', l.name, 'season', l.season,
      'provider', l.provider,
      'commish_code', l.commish_code, 'invite_code', l.invite_code,
      'commissioner', l.commissioner_id is not null, 'lineup_policy', l.lineup_policy,
      'weekly_budget', l.weekly_budget,
      'test_live_at', l.test_live_at,
      'rosters', (select count(*) from league_membership m where m.league_id = l.id),
      'enrolled', (select count(*) from league_membership m where m.league_id = l.id and m.enrolled),
      'ai_teams', (select count(*) from league_membership m where m.league_id = l.id and m.controller = 'ai')
    ) as r from league l order by l.created_at desc
  ) t;
  return result;
end $$;
grant execute on function admin_overview() to authenticated;
