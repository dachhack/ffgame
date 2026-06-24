-- 0016: "request a code for your league" — a pre-auth lead-capture so a wowed
-- demo visitor with no commissioner invite can ask us to set their league up in
-- the pilot. Visitors are ANONYMOUS, so the insert runs through a SECURITY
-- DEFINER function granted to anon; the table itself stays RLS-locked with no
-- direct anon/authenticated access. Admins read + triage via is_admin() RPCs.

create table if not exists code_request (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  email text,
  sleeper_username text,
  league_name text,
  note text,
  handled boolean not null default false
);

alter table code_request enable row level security;
-- No policies on purpose → no direct table access for anon/authenticated. Every
-- read/write goes through the SECURITY DEFINER functions below.

-- Public (anonymous) submit. Requires at least one way to reach the person so a
-- request is actionable; trims everything and caps the free-text note.
create or replace function request_code(p_email text, p_sleeper text, p_league text, p_note text)
  returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  e text := nullif(btrim(coalesce(p_email, '')), '');
  s text := nullif(btrim(coalesce(p_sleeper, '')), '');
  l text := nullif(btrim(coalesce(p_league, '')), '');
  n text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if e is null and s is null then
    return jsonb_build_object('ok', false, 'error', 'Add an email or your Sleeper username so we can reach you.');
  end if;
  insert into code_request (email, sleeper_username, league_name, note)
    values (e, s, l, left(n, 1000));
  return jsonb_build_object('ok', true);
end $$;

grant execute on function request_code(text, text, text, text) to anon, authenticated;

-- Admin triage: unhandled first, newest first.
create or replace function admin_code_requests()
  returns jsonb
  language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  if not is_admin() then return jsonb_build_object('error', 'forbidden'); end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'created_at', created_at, 'email', email,
    'sleeper_username', sleeper_username, 'league_name', league_name,
    'note', note, 'handled', handled
  ) order by handled asc, created_at desc), '[]'::jsonb) into result from code_request;
  return result;
end $$;

create or replace function admin_set_code_request_handled(p_id uuid, p_handled boolean)
  returns jsonb
  language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  update code_request set handled = p_handled where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

grant execute on function admin_code_requests() to authenticated;
grant execute on function admin_set_code_request_handled(uuid, boolean) to authenticated;
