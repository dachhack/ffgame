-- 0208: "LEAGUE FULL" — a commissioner can close the waiting room.
--
-- Founder: "Can we have a commish option to close the waiting room. Just
-- 'League Full'."
--
-- WHERE THIS SITS. 0125 made a full native league WAITLIST a joiner rather than
-- turn them away: `native_join` writes `league_join` and returns
-- `{ok: true, status: 'waitlisted'}`, and the commissioner deals them in from
-- the commish screen. That is the right default — a league that fills up mid
-- recruit shouldn't slam the door — but it is not always what the commissioner
-- wants. A league that is DONE recruiting has no use for a queue it will never
-- work through, and every person in it is someone who thinks they might still
-- get in.
--
-- So: one flag, and the door is either open or it says so.
--   waitlist_open = true  (default, today's behaviour) → full ⇒ waitlisted
--   waitlist_open = false                              → full ⇒ "league is full"
--
-- IT ONLY BITES WHEN THE LEAGUE IS FULL. With a seat free, an invite link
-- seats you immediately either way — closing the waiting room is not closing
-- the league.
--
-- CLOSING DOES NOT EVICT. Anyone already waiting stays in `league_join` and the
-- commissioner can still deal them in (or remove them) — the flag governs NEW
-- arrivals only. Throwing out the queue is a different, destructive act and is
-- not what "close the waiting room" asks for.

alter table league add column if not exists waitlist_open boolean not null default true;

-- ── THE SETTER ─────────────────────────────────────────────────────────────
-- Commissioner or admin, the same guard every other league setting takes.
create or replace function set_league_waitlist(p_league_id uuid, p_open boolean)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare waiting int;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  if p_open is null then return jsonb_build_object('ok', false, 'error', 'open must be true or false'); end if;
  update league set waitlist_open = p_open where id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such league'); end if;
  -- Report who is ALREADY waiting, so the UI can say "3 people are still in the
  -- queue" rather than implying the list was cleared.
  select count(*) into waiting from league_join j
    where j.league_id = p_league_id
      and not exists (select 1 from league_membership m
                       where m.league_id = j.league_id and m.app_user_id = j.app_user_id and m.enrolled);
  return jsonb_build_object('ok', true, 'waitlist_open', p_open, 'waiting', waiting);
end $$;
grant execute on function set_league_waitlist(uuid, boolean) to authenticated;

-- ── native_join v4 (0064 → 0070 → 0125 → here) ─────────────────────────────
-- Body copied VERBATIM from 0125's live definition; the only change is the
-- `lg.waitlist_open` branch inside the full-house case.
create or replace function native_join(p_code text, p_team_name text default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lg league%rowtype; seat int; e text; nm text;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not signed in'); end if;
  select * into lg from league where invite_code = upper(trim(p_code));
  if not found then return jsonb_build_object('ok', false, 'error', 'invalid invite code'); end if;
  if lg.provider <> 'native' then return jsonb_build_object('ok', false, 'error', 'not a native league — use the join flow'); end if;
  if lg.is_mock then return jsonb_build_object('ok', false, 'error', 'mock drafts are solo practice rooms — no joining'); end if;

  e := nullif(lower(btrim(coalesce(auth.jwt() ->> 'email', ''))), '');
  insert into app_user (id, email) values (auth.uid(), e)
    on conflict (id) do update set email = coalesce(excluded.email, app_user.email);

  -- Already seated? Idempotent. CHECKED BEFORE THE FLAG, deliberately: someone
  -- who already has a team in this league is not "trying to get in", and a
  -- closed waiting room must never lock an existing manager out of their own
  -- league.
  select sleeper_roster_id into seat from league_membership
    where league_id = lg.id and app_user_id = auth.uid() and enrolled limit 1;
  if seat is not null then
    return jsonb_build_object('ok', true, 'league_id', lg.id, 'roster_id', seat, 'status', 'enrolled');
  end if;

  perform pg_advisory_xact_lock(hashtext(lg.id::text));
  select sleeper_roster_id into seat from league_membership
    where league_id = lg.id and app_user_id is null and not enrolled
    order by sleeper_roster_id limit 1;
  if seat is null then
    -- THE DOOR (0208). Closed ⇒ say so; open ⇒ the waiting room, as before.
    if not lg.waitlist_open then
      return jsonb_build_object('ok', false, 'error', 'league is full', 'status', 'full', 'league', lg.name);
    end if;
    -- Full house → the waiting room, idempotently. 'waitlisted' is a success:
    -- the join HAPPENED, it just doesn't come with a seat yet.
    insert into league_join (league_id, app_user_id, email) values (lg.id, auth.uid(), e)
      on conflict (league_id, app_user_id) do update set email = excluded.email;
    return jsonb_build_object('ok', true, 'league_id', lg.id, 'status', 'waitlisted', 'league', lg.name);
  end if;

  nm := nullif(btrim(coalesce(p_team_name, '')), '');
  update league_membership
    set app_user_id = auth.uid(), enrolled = true, claim_email = e,
        team_name = coalesce(nm, team_name)
    where league_id = lg.id and sleeper_roster_id = seat;
  delete from league_join where league_id = lg.id and app_user_id = auth.uid();

  return jsonb_build_object('ok', true, 'league_id', lg.id, 'roster_id', seat, 'status', 'enrolled', 'league', lg.name);
end $$;

-- ── THE BACK DOOR ──────────────────────────────────────────────────────────
-- `join_league` (0043) writes the SAME `league_join` table without consulting
-- seats at all — it is the pool-join for platform leagues, where the
-- commissioner maps joiners onto provider rosters. The native UI never routes
-- there, but a closed waiting room that can be walked around by calling a
-- different RPC is not closed.
--
-- Guarded NARROWLY: native leagues, with the flag off, and only when there is
-- genuinely no free seat. Platform leagues are untouched, because "no open
-- seat" means something different for them and refusing there would break the
-- normal ESPN/Yahoo join.
-- Body copied VERBATIM from 0043; the only change is the block marked 0208.
create or replace function join_league(p_code text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lg league%rowtype; e text;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not signed in'); end if;
  e := nullif(lower(btrim(coalesce(auth.jwt() ->> 'email', ''))), '');
  insert into app_user (id, email) values (auth.uid(), e)
    on conflict (id) do update set email = coalesce(excluded.email, app_user.email);
  select * into lg from league where league.invite_code = upper(trim(p_code));
  if not found then return jsonb_build_object('ok', false, 'error', 'invalid invite code'); end if;
  -- Already rostered in this league? Nothing to do.
  if exists (select 1 from league_membership m where m.league_id = lg.id and m.app_user_id = auth.uid() and m.enrolled) then
    return jsonb_build_object('ok', true, 'league', lg.name, 'status', 'enrolled');
  end if;
  -- 0208: the same closed door as native_join, for the same league.
  if lg.provider = 'native' and not lg.waitlist_open
     and not exists (select 1 from league_membership m
                      where m.league_id = lg.id and m.app_user_id is null and not m.enrolled) then
    return jsonb_build_object('ok', false, 'error', 'league is full', 'status', 'full', 'league', lg.name);
  end if;
  insert into league_join (league_id, app_user_id, email) values (lg.id, auth.uid(), e)
    on conflict (league_id, app_user_id) do update set email = excluded.email;
  return jsonb_build_object('ok', true, 'league', lg.name, 'status', 'joined');
end $$;

-- ── SAY IT BEFORE THE SIGN-UP ──────────────────────────────────────────────
-- 0206 made this callable signed-out and 0207 added game_mode. Seats and the
-- door join them, so the join card can say "FULL" to someone holding an invite
-- link BEFORE they make an account — which is the whole point of a closed
-- waiting room. Finding out after signing up is the thing being fixed.
-- Return type changes ⇒ drop first.
drop function if exists league_by_invite(text);
create function league_by_invite(code text)
  returns table (league_id uuid, name text, season text, provider text, avatar_url text,
                 game_mode text, seats_open int, waitlist_open boolean)
  language sql stable security definer set search_path = public as $$
  select l.id, l.name, l.season, l.provider, l.avatar_url,
         coalesce(l.settings_json ->> 'game_mode', 'drip'),
         (select count(*)::int from league_membership m
           where m.league_id = l.id and m.app_user_id is null and not m.enrolled),
         l.waitlist_open
  from league l where l.invite_code = upper(trim(code));
$$;
grant execute on function league_by_invite(text) to authenticated, anon;
