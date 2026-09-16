-- 0277: ASK FOR A WEEKLY REPORT (v0.393.2) — an admin can force one, and see
-- why the worker hasn't posted it.
--
-- Founder, the morning after week 2 closed: "Let's make the weekly reports."
-- The worker (0275 / server/src/report.js) posts a league's report on its own
-- once every matchup of the week carries a stamped final and the league's
-- season matches — and when one of those isn't true it says nothing. Two
-- RPCs, both admin-only:
--   • admin_week_report_state(league, week) — the facts the worker gates on:
--     how many matchups, how many final, how many stamped, whether a report
--     row and its chat line exist, and the latest request. Week null means
--     the latest week that has any matchup for the league.
--   • admin_request_week_report(league, week) — queue a FORCED build. The
--     worker sweeps report_request every tick, builds from whatever finals
--     exist (ignoring status and season), replaces the stored payload,
--     replaces the chat line, and stamps done_at (or error).

create table if not exists report_request (
  id            bigint generated always as identity primary key,
  league_id     uuid not null references league(id) on delete cascade,
  week          int  not null,
  requested_by  uuid references app_user(id) on delete set null,
  requested_at  timestamptz not null default now(),
  done_at       timestamptz,
  error         text
);
create index if not exists report_request_open on report_request(id) where done_at is null;
alter table report_request enable row level security;   -- no policies: RPC + worker only

create or replace function admin_week_report_state(p_league_id uuid, p_week int default null)
  returns jsonb language plpgsql stable security definer set search_path = public as $$
declare wk int; req jsonb;
begin
  if not is_admin() then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  wk := p_week;
  if wk is null then
    select max(week) into wk from matchup where league_id = p_league_id;
  end if;
  if wk is null then return jsonb_build_object('ok', true, 'week', null, 'matchups', 0); end if;
  select jsonb_build_object('requested_at', r.requested_at, 'done_at', r.done_at, 'error', r.error)
    into req from report_request r where r.league_id = p_league_id and r.week = wk
    order by r.id desc limit 1;
  return jsonb_build_object(
    'ok', true, 'week', wk,
    'season', (select season from league where id = p_league_id),
    'matchups', (select count(*) from matchup where league_id = p_league_id and week = wk),
    'final',    (select count(*) from matchup where league_id = p_league_id and week = wk and status = 'final'),
    'stamped',  (select count(*) from matchup where league_id = p_league_id and week = wk
                   and home_final is not null and away_final is not null),
    'statuses', (select coalesce(jsonb_object_agg(s, n), '{}'::jsonb) from
                   (select status::text as s, count(*) as n from matchup
                      where league_id = p_league_id and week = wk group by status) t),
    'report',   exists (select 1 from league_report where league_id = p_league_id and week = wk),
    'message',  exists (select 1 from league_message where league_id = p_league_id and kind = 'report' and report_week = wk),
    'request',  req);
end $$;

create or replace function admin_request_week_report(p_league_id uuid, p_week int)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare nid bigint;
begin
  if not is_admin() then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if p_week is null or p_week < 1 then return jsonb_build_object('ok', false, 'error', 'which week?'); end if;
  if not exists (select 1 from league where id = p_league_id) then
    return jsonb_build_object('ok', false, 'error', 'no such league');
  end if;
  if not exists (select 1 from matchup where league_id = p_league_id and week = p_week) then
    return jsonb_build_object('ok', false, 'error', 'that league has no matchups for week ' || p_week);
  end if;
  if exists (select 1 from report_request where league_id = p_league_id and week = p_week and done_at is null) then
    return jsonb_build_object('ok', true, 'queued', true, 'note', 'already queued — the worker picks it up within a minute');
  end if;
  insert into report_request (league_id, week, requested_by) values (p_league_id, p_week, auth.uid())
    returning id into nid;
  return jsonb_build_object('ok', true, 'queued', true, 'id', nid);
end $$;

grant execute on function admin_week_report_state(uuid, int) to authenticated;
grant execute on function admin_request_week_report(uuid, int) to authenticated;
