-- 0039: admin-assigned commissioner (platform-agnostic).
--
-- The self-serve flow (0003/0004) proves ownership by matching a Sleeper user_id
-- and tagging a Sleeper team name — Sleeper-only, so it dead-ends commissioners on
-- ESPN / Yahoo / Fleaflicker / MFL. Instead, the admin hands the commish code to a
-- specific league runner out-of-band (a targeted invite email), so redeeming that
-- code IS the authorization: whoever redeems it becomes the league's commissioner.
-- Works for every platform. The commish code is now a bearer credential — keep it
-- private, and rotate it via admin_regen_code(..., 'commish') if it leaks.

create or replace function redeem_commish(p_code text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lg league%rowtype;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not signed in'); end if;
  insert into app_user (id) values (auth.uid()) on conflict (id) do nothing;
  select * into lg from league where league.commish_code = upper(trim(p_code));
  if not found then return jsonb_build_object('ok', false, 'error', 'invalid commissioner code'); end if;
  update league set commissioner_id = auth.uid() where id = lg.id;
  return jsonb_build_object('ok', true, 'league', lg.name, 'invite_code', lg.invite_code, 'league_id', lg.id);
end $$;
grant execute on function redeem_commish(text) to authenticated;
