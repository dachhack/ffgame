-- 0003: commissioner verification + commissioner codes.
--
-- Trust chain: admin provisions a COMMISSIONER code per league → the commissioner
-- logs in, enters it, and proves control of their Sleeper commish account by
-- temporarily putting a one-time tag in their Sleeper TEAM NAME → on success they
-- become commissioner_id and are shown the PLAYER invite code to distribute.
--
-- The team-name check must be server-side (a browser could fake "I saw it"), so we
-- fetch Sleeper from inside the database via the `http` extension. Volume is tiny
-- (a few manual verifications), so the synchronous fetch is fine.

-- Outbound HTTP from Postgres (pgsql-http). Supabase keeps extensions in `extensions`.
create extension if not exists http with schema extensions;

-- The admin-provisioned commissioner code (distinct from league.invite_code).
alter table league add column if not exists commish_code text unique default gen_invite_code();
update league set commish_code = gen_invite_code() where commish_code is null;

-- Pending team-name verification, one per (user, league).
create table if not exists commish_verify (
  app_user_id      uuid not null references app_user(id) on delete cascade,
  league_id        uuid not null references league(id) on delete cascade,
  sleeper_user_id  text not null,
  sleeper_username text,
  tag              text not null,                 -- the team-name code, e.g. DRIP-7F3A
  verified         boolean not null default false,
  created_at       timestamptz not null default now(),
  expires_at       timestamptz not null default now() + interval '30 minutes',
  primary key (app_user_id, league_id)
);
alter table commish_verify enable row level security;
create policy commish_verify_self on commish_verify for select using (app_user_id = auth.uid());
-- writes happen only inside the SECURITY DEFINER RPCs below.

-- Fetch a league's Sleeper users as jsonb (or null on failure).
create or replace function _sleeper_users(p_sleeper_league_id text)
  returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare body text;
begin
  select content into body from extensions.http_get('https://api.sleeper.app/v1/league/' || p_sleeper_league_id || '/users');
  return body::jsonb;
exception when others then
  return null;
end $$;

-- Step 1: validate the commissioner code, confirm the claimed Sleeper account is an
-- owner of that league, and issue a team-name tag. Client passes the Sleeper id it
-- resolved via the Sleeper API.
create or replace function start_commish_verify(p_code text, p_sleeper_user_id text, p_sleeper_username text)
  returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare lg league%rowtype; users jsonb; urec jsonb; tag text;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not signed in'); end if;
  insert into app_user (id) values (auth.uid()) on conflict (id) do nothing;  -- FK target for commish_verify
  select * into lg from league where league.commish_code = upper(trim(p_code));
  if not found then return jsonb_build_object('ok', false, 'error', 'invalid commissioner code'); end if;

  users := _sleeper_users(lg.sleeper_league_id);
  if users is null then return jsonb_build_object('ok', false, 'error', 'could not reach Sleeper — try again'); end if;
  select e into urec from jsonb_array_elements(users) e where e->>'user_id' = p_sleeper_user_id;
  if urec is null then return jsonb_build_object('ok', false, 'error', 'that Sleeper account is not in this league'); end if;
  if coalesce((urec->>'is_owner')::boolean, false) is not true then
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

-- Step 2: re-fetch Sleeper and confirm the tag is now in the user's team name (and
-- they're still an owner). On success: set commissioner_id, link + enroll them, and
-- reveal the player invite code.
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
  if coalesce((urec->>'is_owner')::boolean, false) is not true then
    return jsonb_build_object('ok', false, 'error', 'that account is no longer a commissioner');
  end if;

  -- Success.
  insert into app_user (id) values (auth.uid()) on conflict (id) do nothing;
  update commish_verify set verified = true where app_user_id = auth.uid() and league_id = lg.id;
  update league set commissioner_id = auth.uid() where id = lg.id;
  begin
    update app_user set sleeper_user_id = cv.sleeper_user_id, sleeper_username = cv.sleeper_username where id = auth.uid();
  exception when unique_violation then null; end;
  update league_membership set app_user_id = auth.uid(), enrolled = true
    where league_id = lg.id and sleeper_owner_id = cv.sleeper_user_id;

  return jsonb_build_object('ok', true, 'invite_code', lg.invite_code, 'league', lg.name);
end $$;

grant execute on function start_commish_verify(text, text, text) to authenticated;
grant execute on function confirm_commish_verify(text) to authenticated;
