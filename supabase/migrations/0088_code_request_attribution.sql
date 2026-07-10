-- 0088: first-touch attribution on code requests, so a lead is traceable to the
-- channel that produced it (the Reddit ads vs organic). The client captures
-- utm_* params + the first external referrer on the visitor's FIRST load
-- (src/app/analytics.ts attribution()) and hands the same object here that it
-- attaches to every analytics event — one attribution truth for both PostHog
-- and the lead row. Nullable/absent for organic and legacy clients.
--
-- Follows 0040's pattern: drop the old arity first so there's no ambiguous
-- overload for PostgREST to choose between; the new arg has a default so a
-- deployed pre-0088 bundle calling with five named args keeps working.

alter table code_request add column if not exists attribution jsonb;

drop function if exists request_code(text, text, text, text, text);
create or replace function request_code(p_email text, p_sleeper text, p_league text, p_league_ref text, p_note text, p_attribution jsonb default null)
  returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  e text := nullif(btrim(coalesce(p_email, '')), '');
  s text := nullif(btrim(coalesce(p_sleeper, '')), '');
  l text := nullif(btrim(coalesce(p_league, '')), '');
  r text := nullif(btrim(coalesce(p_league_ref, '')), '');
  n text := nullif(btrim(coalesce(p_note, '')), '');
  -- anon-supplied: cap the whole object like the text fields (drop, don't error)
  a jsonb := case when length(coalesce(p_attribution::text, '')) <= 2000 then p_attribution else null end;
begin
  if e is null and s is null then
    return jsonb_build_object('ok', false, 'error', 'Add an email so we can reach you.');
  end if;
  insert into code_request (email, sleeper_username, league_name, league_ref, note, attribution)
    values (e, s, l, left(r, 500), left(n, 1000), a);
  return jsonb_build_object('ok', true);
end $$;

grant execute on function request_code(text, text, text, text, text, jsonb) to anon, authenticated;

-- Admin triage: include attribution. Unhandled first, newest first.
create or replace function admin_code_requests()
  returns jsonb
  language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  if not is_admin() then return jsonb_build_object('error', 'forbidden'); end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'created_at', created_at, 'email', email,
    'sleeper_username', sleeper_username, 'league_name', league_name,
    'league_ref', league_ref, 'note', note, 'handled', handled,
    'attribution', attribution
  ) order by handled asc, created_at desc), '[]'::jsonb) into result from code_request;
  return result;
end $$;
