-- ═══════════════════════════════════════════════════════════════════════════
-- 0422 · THE DOOR IS OPEN, AND THE ROOM HAS A SIZE (v0.612.0).
--
-- Founder: "Let's drop the requirement for me to approve user accounts. Just
-- set a cap of 1000 users and do a daily sweep for inactive users and make an
-- off boarding process. Any account can add a native league or add drip to an
-- existing league."
--
-- Four things, in order:
--
--   A. EVERY ACCOUNT MAY CREATE. has_native() answers yes for any signed-in
--      user. create_native_league, convert_league_to_native and
--      create_mock_draft all read it, so the pilot gate closes in one place.
--      The 'native' feature flag still exists (admin_set_feature accepts it)
--      but nothing reads it any more.
--
--   B. THE CAP. site_pref.user_cap (default 1000). A trigger on auth.users
--      refuses the insert that would pass it, so the cap holds whichever way
--      an account arrives (password, magic link, Google, Apple). Seat agents
--      (the worker's stand-ins for empty seats, 0180) don't count toward it
--      and aren't refused by it. signup_open() tells the sign-up form before
--      it tries, so a full house gets the waitlist instead of a failed form.
--
--   C. OFFBOARDING. One predicate for "may this account be removed" — not an
--      admin, not an agent, not a commissioner, no seat in the season being
--      played — and one clock, _user_last_active(): the latest of sign-in,
--      opening a league, an app check-in, a chat line. The daily sweep (worker
--      offboard.js) emails an inactive account that it will be removed in 14
--      days, then removes it if it is still inactive. Any sign-in in between
--      cancels the notice. A member can also leave on their own:
--      delete_my_account(), which the privacy page promised and Apple
--      requires. Both paths run _offboard_prep first, which clears the two
--      foreign keys that would block the delete (solo_pass.claimed_by and
--      league_listing.created_by) and writes offboard_log. Everything else
--      cascades or nulls as 0001–0352 declared.
--
--   D. DRIP ON AN EXISTING LEAGUE, SELF-SERVE. import_my_league(): a signed-in
--      member of a Sleeper league brings it in and becomes its Drip
--      commissioner. Membership is checked against Sleeper's own league/users
--      endpoint (0003's _sleeper_users, from inside Postgres), falling back to
--      the member list the client fetched only when Sleeper can't be reached.
--      A league an admin imported but nobody claimed can be claimed the same
--      way; a league someone else already commissions is refused by name.
--      sleeper_leagues_for_sync() lets the worker mirror every current-season
--      Sleeper league's schedule and rosters, where it used to mirror only the
--      ids in PILOT_LEAGUE_IDS.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── A. every account may create ─────────────────────────────────────────────
create or replace function has_native() returns boolean
  language sql stable security definer set search_path = public as $$
  select auth.uid() is not null;
$$;

-- ── B. the cap ──────────────────────────────────────────────────────────────
alter table site_pref add column if not exists user_cap int not null default 1000;

/** Accounts that count: every auth user that is not a seat agent. */
create or replace function account_count() returns int
  language sql stable security definer set search_path = public as $$
  select count(*)::int from auth.users u
  where not exists (select 1 from seat_agent sa where sa.agent_user_id = u.id)
    and coalesce(u.raw_user_meta_data ->> 'seat_agent', '') <> 'true';
$$;

/** {open, count, cap} for the sign-up form. Anon, because the form is. */
create or replace function signup_open() returns jsonb
  language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'open', account_count() < coalesce((select user_cap from site_pref where id), 1000),
    'count', account_count(),
    'cap', coalesce((select user_cap from site_pref where id), 1000));
$$;
grant execute on function signup_open() to anon, authenticated;

create or replace function _cap_new_account() returns trigger
  language plpgsql security definer set search_path = public as $$
declare cap int;
begin
  -- The worker's seat agents are accounts in name only; they never count.
  if coalesce(new.raw_user_meta_data ->> 'seat_agent', '') = 'true' then return new; end if;
  select user_cap into cap from site_pref where id;
  if account_count() >= coalesce(cap, 1000) then
    raise exception 'Drip is full right now — all % spots are taken. Join the waitlist at dripfantasy.com and we''ll email you when one opens.', coalesce(cap, 1000)
      using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists cap_new_account on auth.users;
create trigger cap_new_account before insert on auth.users
  for each row execute function _cap_new_account();

create or replace function admin_set_user_cap(p_cap int) returns jsonb
  language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if p_cap is null or p_cap < 0 or p_cap > 1000000 then return jsonb_build_object('ok', false, 'error', 'cap must be 0–1,000,000'); end if;
  update site_pref set user_cap = p_cap, updated_at = now() where id;
  return jsonb_build_object('ok', true, 'cap', p_cap, 'count', account_count());
end $$;
grant execute on function admin_set_user_cap(int) to authenticated;

-- ── C. offboarding ──────────────────────────────────────────────────────────
create table if not exists offboard_notice (
  app_user_id    uuid primary key references app_user(id) on delete cascade,
  email          text not null,
  noticed_at     timestamptz not null default now(),
  delete_after   timestamptz not null,
  last_active_at timestamptz
);
alter table offboard_notice enable row level security;   -- RPC-only

create table if not exists offboard_log (
  id           bigint generated always as identity primary key,
  app_user_id  uuid not null,
  email        text,
  reason       text not null,          -- 'inactive' | 'self'
  noticed_at   timestamptz,
  deleted_at   timestamptz not null default now()
);
alter table offboard_log enable row level security;      -- RPC-only

/** The one clock: the latest sign of life. GREATEST skips NULLs. */
create or replace function _user_last_active(p_uid uuid) returns timestamptz
  language sql stable security definer set search_path = public as $$
  select greatest(
    (select greatest(u.last_sign_in_at, u.created_at) from auth.users u where u.id = p_uid),
    (select created_at from app_user where id = p_uid),
    (select max(last_at) from league_seen where app_user_id = p_uid),
    (select max(last_seen_at) from push_token where app_user_id = p_uid),
    (select max(created_at) from league_message where author_id = p_uid),
    (select max(created_at) from dm_message where author_id = p_uid));
$$;

/** Why the sweep must leave this account alone; empty = it may go. */
create or replace function _offboard_blockers(p_uid uuid, p_season text) returns text[]
  language sql stable security definer set search_path = public as $$
  select array_remove(array[
    case when exists (select 1 from app_admin a join app_user u on lower(u.email) = lower(a.email) where u.id = p_uid) then 'admin' end,
    -- An agent by its seat row, or by the mark the worker creates it with
    -- (the row follows the account; between the two it is still an agent).
    case when exists (select 1 from seat_agent sa where sa.agent_user_id = p_uid)
           or exists (select 1 from auth.users u where u.id = p_uid and coalesce(u.raw_user_meta_data ->> 'seat_agent', '') = 'true') then 'agent' end,
    case when exists (select 1 from league l where l.commissioner_id = p_uid) then 'commissioner' end,
    case when exists (select 1 from league_commish lc where lc.app_user_id = p_uid) then 'commissioner' end,
    case when exists (select 1 from league_membership m join league l on l.id = m.league_id
                       where m.app_user_id = p_uid and m.enrolled and l.season = p_season) then 'seated' end,
    case when exists (select 1 from team_manager tm join league l on l.id = tm.league_id
                       where tm.app_user_id = p_uid and l.season = p_season) then 'seated' end
  ], null);
$$;

/** The sweep's worklist: every account it may remove, inactive this long,
 *  with its notice if one stands. Service role only. */
create or replace function offboard_candidates(p_season text, p_inactive_days int default 60)
  returns table (app_user_id uuid, email text, last_active_at timestamptz, noticed_at timestamptz, delete_after timestamptz)
  language sql stable security definer set search_path = public as $$
  select u.id, u.email, _user_last_active(u.id), n.noticed_at, n.delete_after
  from app_user u
  left join offboard_notice n on n.app_user_id = u.id
  where cardinality(_offboard_blockers(u.id, p_season)) = 0
    and _user_last_active(u.id) < now() - make_interval(days => p_inactive_days)
  order by _user_last_active(u.id);
$$;
revoke all on function offboard_candidates(text, int) from public;
grant execute on function offboard_candidates(text, int) to service_role;

/** Record that the notice went out. Service role only. */
create or replace function offboard_notice_set(p_uid uuid, p_email text, p_grace_days int default 14) returns jsonb
  language plpgsql security definer set search_path = public as $$
begin
  insert into offboard_notice (app_user_id, email, delete_after, last_active_at)
  values (p_uid, p_email, now() + make_interval(days => p_grace_days), _user_last_active(p_uid))
  on conflict (app_user_id) do nothing;
  return jsonb_build_object('ok', true, 'delete_after', (select delete_after from offboard_notice where app_user_id = p_uid));
end $$;
revoke all on function offboard_notice_set(uuid, text, int) from public;
grant execute on function offboard_notice_set(uuid, text, int) to service_role;

/** A notice is cancelled by any sign of life after it. Returns the emails
 *  whose notices were withdrawn. Service role only. */
create or replace function offboard_cancel_revived() returns jsonb
  language sql security definer set search_path = public as $$
  with gone as (
    delete from offboard_notice n
    where _user_last_active(n.app_user_id) > n.noticed_at
    returning n.email
  )
  select coalesce(jsonb_agg(email), '[]'::jsonb) from gone;
$$;
revoke all on function offboard_cancel_revived() from public;
grant execute on function offboard_cancel_revived() to service_role;

/** Clear what would block the delete, and write the log line. Internal. */
create or replace function _offboard_prep(p_uid uuid, p_reason text) returns void
  language plpgsql security definer set search_path = public as $$
declare e text; n timestamptz;
begin
  select email into e from app_user where id = p_uid;
  select noticed_at into n from offboard_notice where app_user_id = p_uid;
  -- A solo pass remembers who claimed it; the pass stays, the claim is cleared.
  update solo_pass set claimed_by = null where claimed_by = p_uid;
  -- A board listing is owned by whoever posted it (not null). Hand it to the
  -- league's commissioner if there is one, else take it down.
  update league_listing ll set created_by = l.commissioner_id
    from league l where l.id = ll.league_id and ll.created_by = p_uid and l.commissioner_id is not null and l.commissioner_id <> p_uid;
  delete from league_listing where created_by = p_uid;
  insert into offboard_log (app_user_id, email, reason, noticed_at) values (p_uid, e, p_reason, n);
end $$;

/** The sweep's removal: re-checks the predicate at the moment it acts.
 *  Service role only. */
create or replace function offboard_delete(p_uid uuid, p_season text) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare b text[]; n offboard_notice;
begin
  select * into n from offboard_notice where app_user_id = p_uid;
  if n.app_user_id is null then return jsonb_build_object('ok', false, 'error', 'no notice stands'); end if;
  if n.delete_after > now() then return jsonb_build_object('ok', false, 'error', 'grace period not over'); end if;
  b := _offboard_blockers(p_uid, p_season);
  if cardinality(b) > 0 then return jsonb_build_object('ok', false, 'error', 'blocked', 'blockers', to_jsonb(b)); end if;
  if _user_last_active(p_uid) > n.noticed_at then
    delete from offboard_notice where app_user_id = p_uid;
    return jsonb_build_object('ok', false, 'error', 'revived');
  end if;
  perform _offboard_prep(p_uid, 'inactive');
  delete from auth.users where id = p_uid;   -- cascades to app_user and on
  return jsonb_build_object('ok', true, 'email', n.email);
end $$;
revoke all on function offboard_delete(uuid, text) from public;
grant execute on function offboard_delete(uuid, text) to service_role;

/** Leave on your own. Type your email to confirm. A commissioner hands the
 *  league to someone else (or deletes it) first — leave_league says the same. */
create or replace function delete_my_account(p_confirm text) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare e text; nm text;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not signed in'); end if;
  e := lower(btrim(coalesce(auth.jwt() ->> 'email', '')));
  if e = '' or lower(btrim(coalesce(p_confirm, ''))) <> e then
    return jsonb_build_object('ok', false, 'error', 'type your email address to confirm');
  end if;
  select l.name into nm from league l where l.commissioner_id = auth.uid()
    and exists (select 1 from league_membership m where m.league_id = l.id and m.enrolled and m.app_user_id is not null and m.app_user_id <> auth.uid())
    limit 1;
  if nm is not null then
    return jsonb_build_object('ok', false, 'error', format('you commission %s — hand it to someone else or delete it first', nm));
  end if;
  -- A commissioner of an empty league (nobody else seated) takes it with them.
  delete from league l where l.commissioner_id = auth.uid()
    and not exists (select 1 from league_membership m where m.league_id = l.id and m.enrolled and m.app_user_id is not null and m.app_user_id <> auth.uid());
  perform _offboard_prep(auth.uid(), 'self');
  delete from auth.users where id = auth.uid();
  return jsonb_build_object('ok', true);
end $$;
grant execute on function delete_my_account(text) to authenticated;

-- ── D. Drip on an existing league, self-serve ───────────────────────────────
create or replace function import_my_league(
  p_sleeper_id text, p_season text, p_name text, p_settings jsonb, p_avatar text,
  p_members jsonb, p_sleeper_user_id text, p_sleeper_username text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare lg league; lid uuid; users jsonb; verified boolean; u text; e text; cnm text;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not signed in'); end if;
  if p_sleeper_id is null or p_sleeper_id !~ '^[0-9]{6,}$' then return jsonb_build_object('ok', false, 'error', 'that is not a Sleeper league id'); end if;
  if p_sleeper_user_id is null or p_sleeper_user_id = '' then return jsonb_build_object('ok', false, 'error', 'link your Sleeper account first'); end if;
  if p_season is distinct from to_char(now(), 'YYYY') then
    return jsonb_build_object('ok', false, 'error', format('only this season (%s) can be brought in', to_char(now(), 'YYYY')));
  end if;
  if p_members is null or jsonb_typeof(p_members) <> 'array' or jsonb_array_length(p_members) = 0 then
    return jsonb_build_object('ok', false, 'error', 'that league has no managers yet');
  end if;
  -- Are you in it? Ask Sleeper, from here; the client's list only when Sleeper
  -- can't be reached from the database.
  users := _sleeper_users(p_sleeper_id);
  if users is not null and jsonb_typeof(users) = 'array' then
    verified := exists (select 1 from jsonb_array_elements(users) x where x ->> 'user_id' = p_sleeper_user_id);
  else
    verified := exists (select 1 from jsonb_array_elements(p_members) x where x ->> 'owner_id' = p_sleeper_user_id);
  end if;
  if not verified then return jsonb_build_object('ok', false, 'error', 'your Sleeper account is not a manager in that league'); end if;

  -- Your account, and your Sleeper identity on it.
  e := nullif(lower(btrim(coalesce(auth.jwt() ->> 'email', ''))), '');
  insert into app_user (id, email) values (auth.uid(), e)
    on conflict (id) do update set email = coalesce(excluded.email, app_user.email);
  begin
    update app_user set sleeper_user_id = p_sleeper_user_id, sleeper_username = coalesce(p_sleeper_username, sleeper_username)
      where id = auth.uid();
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'that Sleeper account is already linked to another login');
  end;

  select * into lg from league where sleeper_league_id = p_sleeper_id and season = p_season;
  if lg.id is not null then
    if lg.commissioner_id = auth.uid() or is_league_commish(lg.id) then
      lid := lg.id;
    elsif lg.commissioner_id is null then
      update league set commissioner_id = auth.uid() where id = lg.id;   -- imported, never claimed
      lid := lg.id;
    else
      select coalesce(display_name, sleeper_username, 'its commissioner') into cnm from app_user where id = lg.commissioner_id;
      return jsonb_build_object('ok', false, 'error', format('%s is already on Drip — ask %s for the invite code', lg.name, cnm));
    end if;
  else
    insert into league (sleeper_league_id, season, name, settings_json, provider, synced_at, commissioner_id)
    values (p_sleeper_id, p_season, coalesce(nullif(btrim(p_name), ''), 'League'), coalesce(p_settings, '{}'::jsonb), 'sleeper', now(), auth.uid())
    returning id into lid;
    u := clean_avatar_url(p_avatar);
    if u = '!invalid' then u := null; end if;
    update league set avatar_url = coalesce(u, random_drip_avatar()) where id = lid and avatar_url is null;
  end if;

  -- The seats. Yours links on the spot (sleeper_user_id matches your owner id).
  perform _upsert_membership_rows(lid, p_members);
  update league_membership set app_user_id = auth.uid(), enrolled = true
    where league_id = lid and sleeper_owner_id = p_sleeper_user_id and (app_user_id is null or app_user_id = auth.uid());

  select * into lg from league where id = lid;
  return jsonb_build_object('ok', true, 'league_id', lid, 'name', lg.name, 'invite_code', lg.invite_code,
    'seats', jsonb_array_length(p_members),
    'roster_id', (select sleeper_roster_id from league_membership where league_id = lid and app_user_id = auth.uid() limit 1));
end $$;
grant execute on function import_my_league(text, text, text, jsonb, text, jsonb, text, text) to authenticated;

/** Every current-season Sleeper league the worker should mirror. Service role. */
create or replace function sleeper_leagues_for_sync(p_season text)
  returns table (league_id uuid, sleeper_league_id text) language sql stable security definer set search_path = public as $$
  select id, sleeper_league_id from league
  where coalesce(provider, 'sleeper') = 'sleeper' and season = p_season and not is_mock
  order by created_at;
$$;
revoke all on function sleeper_leagues_for_sync(text) from public;
grant execute on function sleeper_leagues_for_sync(text) to service_role;
