-- 0129: let an admin correct the email on a code request.
--
-- The address on a lead is whatever the visitor typed into the pre-auth request
-- form (0016) — anonymous, unverified, one shot. A typo there is a dead end from
-- the admin side: send-invite (the CODE REQUESTS card's "send invite") mails
-- code_request.email and nothing else, so a mistyped address means the invite
-- silently never lands, and the requester is left with no link and no way to
-- tell us. Same dead end for a request that arrived with only a platform
-- username and no email at all. Both are fixable by hand — the admin usually
-- knows the real address (they can reach the person on the league platform) —
-- there was just nowhere to put it.
--
-- Validation mirrors send-invite's EMAIL_RE so the panel can't store an address
-- the mailer would then refuse. The old value is written to audit_log by hand
-- (code_request carries no audit trigger — 0001 only wires picks/matchups/state)
-- because rewriting WHERE an invite goes deserves a paper trail: it's an admin
-- redirecting a league claim to an address of their choosing.

create or replace function admin_set_code_request_email(p_id uuid, p_email text)
  returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  e      text := nullif(btrim(coalesce(p_email, '')), '');
  before text;
begin
  if not is_admin() then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if e is null then return jsonb_build_object('ok', false, 'error', 'An email is required.'); end if;
  e := left(e, 320);  -- RFC max is 254; the cap is just a guard on a text column
  if e !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    return jsonb_build_object('ok', false, 'error', 'That does not look like an email address.');
  end if;

  select email into before from code_request where id = p_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'No such request.'); end if;

  update code_request set email = e where id = p_id;
  insert into audit_log (table_name, op, row_id, actor, old_row, new_row)
    values ('code_request', 'UPDATE', p_id::text, auth.uid(),
            jsonb_build_object('email', before), jsonb_build_object('email', e));

  return jsonb_build_object('ok', true, 'email', e);
end $$;

grant execute on function admin_set_code_request_email(uuid, text) to authenticated;
