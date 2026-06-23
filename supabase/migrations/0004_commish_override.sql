-- 0004: commissioner override allowlist.
--
-- Treat specific Sleeper accounts as commissioners regardless of Sleeper's
-- is_owner flag (e.g. the pilot admin, who may be a regular member in their own
-- leagues). The team-name proof in confirm_commish_verify still applies — this
-- only waives the is_owner requirement, not the proof-of-control.

create table if not exists commish_override (
  sleeper_user_id text primary key,
  note            text,
  created_at      timestamptz not null default now()
);

-- Admin exception: dachhack (765446581272072192) for their current leagues.
insert into commish_override (sleeper_user_id, note)
  values ('765446581272072192', 'pilot admin (dachhack)')
  on conflict (sleeper_user_id) do nothing;

-- Commissioner if Sleeper says is_owner OR the account is on the override list.
create or replace function _is_commish(urec jsonb, p_sleeper_user_id text)
  returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((urec->>'is_owner')::boolean, false)
      or exists (select 1 from commish_override o where o.sleeper_user_id = p_sleeper_user_id);
$$;

-- Re-create the two RPCs to use _is_commish instead of the inline is_owner check.
create or replace function start_commish_verify(p_code text, p_sleeper_user_id text, p_sleeper_username text)
  returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare lg league%rowtype; users jsonb; urec jsonb; tag text;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not signed in'); end if;
  insert into app_user (id) values (auth.uid()) on conflict (id) do nothing;
  select * into lg from league where league.commish_code = upper(trim(p_code));
  if not found then return jsonb_build_object('ok', false, 'error', 'invalid commissioner code'); end if;
  users := _sleeper_users(lg.sleeper_league_id);
  if users is null then return jsonb_build_object('ok', false, 'error', 'could not reach Sleeper — try again'); end if;
  select e into urec from jsonb_array_elements(users) e where e->>'user_id' = p_sleeper_user_id;
  if urec is null then return jsonb_build_object('ok', false, 'error', 'that Sleeper account is not in this league'); end if;
  if not _is_commish(urec, p_sleeper_user_id) then
    return jsonb_build_object('ok', false, 'error', 'that Sleeper account is not a commissioner of this league');
  end if;
  tag := 'DRIP-' || upper(substring(replace(gen_random_uuid()::text, '-', '') for 4));
  insert into commish_verify (app_user_id, league_id, sleeper_user_id, sleeper_username, tag, verified, created_at, expires_at)
    values (auth.uid(), lg.id, p_sleeper_user_id, p_sleeper_username, tag, false, now(), now() + interval '30 minutes')
  on conflict (app_user_id, league_id) do update
    set sleeper_user_id = excluded.sleeper_user_id, sleeper_username = excluded.sleeper_username,
        tag = excluded.tag, verified = false, created_at = now(), expires_at = excluded.expires_at;
  return jsonb_build_object('ok', true, 'tag', tag, 'league', lg.name);
end $$;

create or replace function confirm_commish_verify(p_code text)
  returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare lg league%rowtype; cv commish_verify%rowtype; users jsonb; urec jsonb; tname text;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not signed in'); end if;
  select * into lg from league where league.commish_code = upper(trim(p_code));
  if not found then return jsonb_build_object('ok', false, 'error', 'invalid commissioner code'); end if;
  select * into cv from commish_verify where app_user_id = auth.uid() and league_id = lg.id;
  if not found then return jsonb_build_object('ok', false, 'error', 'start verification first'); end if;
  if cv.expires_at < now() then return jsonb_build_object('ok', false, 'error', 'tag expired — start again'); end if;
  users := _sleeper_users(lg.sleeper_league_id);
  if users is null then return jsonb_build_object('ok', false, 'error', 'could not reach Sleeper — try again'); end if;
  select e into urec from jsonb_array_elements(users) e where e->>'user_id' = cv.sleeper_user_id;
  if urec is null then return jsonb_build_object('ok', false, 'error', 'account not found in league'); end if;
  tname := coalesce(urec->'metadata'->>'team_name', '');
  if position(cv.tag in tname) = 0 then
    return jsonb_build_object('ok', false, 'error', 'code not in your team name yet — add "' || cv.tag || '" and try again');
  end if;
  if not _is_commish(urec, cv.sleeper_user_id) then
    return jsonb_build_object('ok', false, 'error', 'that account is no longer a commissioner');
  end if;
  insert into app_user (id) values (auth.uid()) on conflict (id) do nothing;
  update commish_verify set verified = true where app_user_id = auth.uid() and league_id = lg.id;
  update league set commissioner_id = auth.uid() where id = lg.id;
  begin update app_user set sleeper_user_id = cv.sleeper_user_id, sleeper_username = cv.sleeper_username where id = auth.uid();
  exception when unique_violation then null; end;
  update league_membership set app_user_id = auth.uid(), enrolled = true
    where league_id = lg.id and sleeper_owner_id = cv.sleeper_user_id;
  return jsonb_build_object('ok', true, 'invite_code', lg.invite_code, 'league', lg.name);
end $$;
