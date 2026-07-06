-- 0040: capture a league ID / link on a code request, so a request is import-ready.
--
-- 0016's request_code() took (email, sleeper, league, note). Add a league_ref
-- column (the platform league ID or URL) and thread it through request_code() and
-- admin_code_requests(). Drop the old 4-arg function first so there's no ambiguous
-- overload for PostgREST to choose between.

alter table code_request add column if not exists league_ref text;

drop function if exists request_code(text, text, text, text);
create or replace function request_code(p_email text, p_sleeper text, p_league text, p_league_ref text, p_note text)
  returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  e text := nullif(btrim(coalesce(p_email, '')), '');
  s text := nullif(btrim(coalesce(p_sleeper, '')), '');
  l text := nullif(btrim(coalesce(p_league, '')), '');
  r text := nullif(btrim(coalesce(p_league_ref, '')), '');
  n text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if e is null and s is null then
    return jsonb_build_object('ok', false, 'error', 'Add an email so we can reach you.');
  end if;
  insert into code_request (email, sleeper_username, league_name, league_ref, note)
    values (e, s, l, left(r, 500), left(n, 1000));
  return jsonb_build_object('ok', true);
end $$;

grant execute on function request_code(text, text, text, text, text) to anon, authenticated;

-- Admin triage: include league_ref. Unhandled first, newest first.
create or replace function admin_code_requests()
  returns jsonb
  language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  if not is_admin() then return jsonb_build_object('error', 'forbidden'); end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'created_at', created_at, 'email', email,
    'sleeper_username', sleeper_username, 'league_name', league_name,
    'league_ref', league_ref, 'note', note, 'handled', handled
  ) order by handled asc, created_at desc), '[]'::jsonb) into result from code_request;
  return result;
end $$;

grant execute on function admin_code_requests() to authenticated;
