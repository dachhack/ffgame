-- ═══════════════════════════════════════════════════════════════════════════
-- 0353 · THE COMMISSIONER RE-SCORES A WEEK
--
-- Founder, on the commissioner's tools: "Change scoring for previous weeks?
-- Change lineups for previous weeks and restamp? Change scoring for a player
-- and restamp?" — then: "Build the re-score button first."
--
-- All three end in the same step: re-resolve a finished week and write the
-- finals that come out. That step has existed since v0.470.0 as `restamp.yml`
-- — an operator's workflow, service-role credentials, a GitHub form, a
-- confirmation typed in capitals. 0345 taught the console to SEE a week that
-- needs it ("⚠ scored before the last play") and then had to say "only a
-- re-stamp (admin) recomputes them". This is the commissioner's door onto the
-- same errand, for their own league.
--
-- ── TWO STEPS, BECAUSE IT REWRITES RESULTS PEOPLE HAVE READ ────────────────
-- PREVIEW resolves the week and writes nothing: every matchup, before and
-- after, which results would change hands, and which seats have no saved
-- lineup (see below). APPLY is refused unless a preview of the same week
-- finished in the last 30 minutes and found something to change — the
-- preview is the thing being confirmed, so there must be one, and it must be
-- recent enough to still describe the week. Apply re-resolves rather than
-- replaying the preview's numbers, and its result says what it actually did.
--
-- ── CLASSIC ONLY ───────────────────────────────────────────────────────────
-- A drip week was scored live against power-ups bought and spent at the
-- time, buffs armed in-slot, per-window state and premium gating, none of
-- which a later pass can rebuild. Re-running one invents a different week:
-- the week-1 run of 2026-09-22 moved two drip leagues by −69.1 and +105.4 on a
-- fix that had nothing to do with them. The workflow refuses drip by default;
-- this refuses it outright.
--
-- ── WHAT A RE-SCORE CANNOT KNOW ────────────────────────────────────────────
-- A seat with no saved lineup is fielded from its roster and the injury
-- report AS THEY STAND NOW (stampFinals' own caveat). The preview names those
-- seats so the commissioner decides with that in front of them.
--
-- ── WHO HEARS ABOUT IT ─────────────────────────────────────────────────────
-- An apply that moved anything posts one house line to league chat — which
-- results moved, from what to what — and the worker rebuilds the week's
-- report from the corrected finals, replacing its chat line. A league whose
-- standings just changed is told by the league, not by noticing.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists rescore_request (
  id           bigint generated always as identity primary key,
  league_id    uuid not null references league(id) on delete cascade,
  week         int  not null,
  apply        boolean not null default false,
  -- For an apply: the preview it confirms.
  preview_id   bigint references rescore_request(id) on delete set null,
  requested_by uuid references app_user(id) on delete set null,
  requested_at timestamptz not null default now(),
  started_at   timestamptz,
  done_at      timestamptz,
  error        text,
  result       jsonb
);
create index if not exists rescore_request_open on rescore_request(id) where done_at is null;
create index if not exists rescore_request_week on rescore_request(league_id, week, id desc);
alter table rescore_request enable row level security;   -- no policies: RPC + worker only

/** The newest preview of a league-week that an apply may confirm: finished
 *  cleanly within 30 minutes, found something to change, and no apply has
 *  been filed since it. Null when there is none. */
create or replace function _rescore_confirmable(p_league_id uuid, p_week int) returns bigint
  language sql stable security definer set search_path = public as $$
  select p.id from rescore_request p
   where p.league_id = p_league_id and p.week = p_week and not p.apply
     and p.done_at is not null and p.error is null
     and p.done_at > now() - interval '30 minutes'
     and coalesce((p.result ->> 'changed')::int, 0) > 0
     and not exists (select 1 from rescore_request a
                      where a.league_id = p_league_id and a.week = p_week and a.apply and a.id > p.id)
   order by p.id desc limit 1;
$$;
revoke all on function _rescore_confirmable(uuid, int) from public, anon, authenticated;

create or replace function commish_request_rescore(p_league_id uuid, p_week int, p_apply boolean default false)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lg league%rowtype; stamped int; ws jsonb; pid bigint; rid bigint;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  select * into lg from league where id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such league'); end if;
  if coalesce(lg.settings_json ->> 'game_mode', 'drip') <> 'classic' then
    return jsonb_build_object('ok', false, 'error',
      'a drip week can''t be re-scored — it was played live against power-ups and window state that can''t be rebuilt afterwards');
  end if;
  select count(*) into stamped from matchup
   where league_id = p_league_id and week = p_week and status = 'final'
     and home_final is not null and away_final is not null;
  if stamped = 0 then
    return jsonb_build_object('ok', false, 'error', 'week ' || p_week || ' has no final scores yet — nothing to re-score');
  end if;
  ws := nfl_week_complete(p_week, lg.season);
  if not coalesce((ws ->> 'complete')::boolean, false) then
    return jsonb_build_object('ok', false, 'error', 'week ' || p_week || ' is still being played — re-score it once every game is final');
  end if;
  perform pg_advisory_xact_lock(hashtext('rescore:' || p_league_id::text));
  if exists (select 1 from rescore_request where league_id = p_league_id and week = p_week and done_at is null) then
    return jsonb_build_object('ok', false, 'error', 'week ' || p_week || ' is already being re-scored — give it a minute');
  end if;
  if p_apply then
    pid := _rescore_confirmable(p_league_id, p_week);
    if pid is null then
      return jsonb_build_object('ok', false, 'error',
        'preview week ' || p_week || ' first — apply confirms a preview from the last 30 minutes that found something to change');
    end if;
  end if;
  insert into rescore_request (league_id, week, apply, preview_id, requested_by)
  values (p_league_id, p_week, coalesce(p_apply, false), pid, auth.uid())
  returning id into rid;
  return jsonb_build_object('ok', true, 'id', rid, 'apply', coalesce(p_apply, false),
    'note', case when p_apply then 'applying — the scores change within a minute'
                 else 'previewing — nothing changes until you apply' end);
end $$;
grant execute on function commish_request_rescore(uuid, int, boolean) to authenticated;

-- The newest request for a league-week, and whether an apply may go now.
create or replace function league_rescore_state(p_league_id uuid, p_week int) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare q rescore_request%rowtype;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  select * into q from rescore_request where league_id = p_league_id and week = p_week order by id desc limit 1;
  return jsonb_build_object('ok', true, 'week', p_week,
    'can_apply', _rescore_confirmable(p_league_id, p_week) is not null,
    'request', case when q.id is null then null else jsonb_build_object(
      'id', q.id, 'apply', q.apply, 'requested_at', q.requested_at, 'started_at', q.started_at,
      'done_at', q.done_at, 'error', q.error, 'result', q.result) end);
end $$;
grant execute on function league_rescore_state(uuid, int) to authenticated;

-- THE WORKER CLOSES A REQUEST (service role only). An apply that moved
-- anything tells the league, in one house line, which results changed.
create or replace function rescore_finish(p_id bigint, p_result jsonb, p_error text default null)
  returns void language plpgsql security definer set search_path = public as $$
declare q rescore_request%rowtype; lines text[]; m jsonb;
begin
  update rescore_request set done_at = now(), result = p_result, error = nullif(btrim(coalesce(p_error, '')), '')
   where id = p_id and done_at is null
  returning * into q;
  if not found or q.error is not null or not q.apply then return; end if;
  if coalesce((p_result ->> 'changed')::int, 0) = 0 then return; end if;
  for m in select * from jsonb_array_elements(coalesce(p_result -> 'matchups', '[]'::jsonb)) loop
    if coalesce((m ->> 'moved')::boolean, false) then
      lines := lines || (_txn_team(q.league_id, (m ->> 'home_roster_id')::int) || ' '
        || coalesce(m #>> '{was,home}', '—') || '→' || (m #>> '{now,home}') || ' vs '
        || _txn_team(q.league_id, (m ->> 'away_roster_id')::int) || ' '
        || coalesce(m #>> '{was,away}', '—') || '→' || (m #>> '{now,away}')
        || case when coalesce((m ->> 'flipped')::boolean, false) then ' (result changed)' else '' end);
    end if;
  end loop;
  perform _chat_house(q.league_id,
    '📝 The commissioner re-scored week ' || q.week || ': ' || coalesce(array_to_string(lines, '; '), 'no change'),
    jsonb_build_object('kind', 'rescore', 'week', q.week, 'changed', (p_result ->> 'changed')::int,
                       'flipped', coalesce((p_result ->> 'flipped')::int, 0)));
end $$;
revoke all on function rescore_finish(bigint, jsonb, text) from public, anon, authenticated;
grant execute on function rescore_finish(bigint, jsonb, text) to service_role;
