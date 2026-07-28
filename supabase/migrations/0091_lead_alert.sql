-- 0091: lead alerting — email the founder when a new code_request lands, so
-- Reddit-ad leads stop sitting unnoticed in the admin table (STATUS.md task).
--
-- Shape: an AFTER INSERT trigger POKES the lead-alert Edge Function via pg_net
-- (async queue — the HTTP call happens post-commit, off the insert's critical
-- path, and a delivery failure can't break lead capture). The poke carries no
-- lead data and needs no secret: the function claims rows WHERE notified_at IS
-- NULL itself (service role) and emails a digest, so an attacker curling the
-- endpoint can only trigger a no-op query. notified_at doubles as the retry
-- ledger — the function un-claims on a failed send, and any later poke sweeps
-- up everything still unnotified (missed pokes self-heal).
--
-- Deploy: the lead-alert function must be deployed (--no-verify-jwt) via the
-- Deploy Edge Functions workflow; Gmail secrets are already set for send-invite.
-- Optional LEAD_ALERT_TO secret overrides the recipient (default GMAIL_SENDER).

alter table code_request add column if not exists notified_at timestamptz;

-- Backfill: existing leads are already visible in the admin table — marking
-- them notified keeps the first live poke from emailing the whole backlog.
update code_request set notified_at = now() where notified_at is null;

create extension if not exists pg_net;

create or replace function poke_lead_alert()
  returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  -- auth.dripfantasy.com is the project's Custom Domain (routes Edge Functions
  -- too). The apikey is the public anon/publishable key — same one shipped in
  -- every browser bundle (src/data/supabaseClient.ts); it only satisfies the
  -- functions gateway, it grants nothing.
  perform net.http_post(
    url := 'https://auth.dripfantasy.com/functions/v1/lead-alert',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'sb_publishable_bEjQC0i5aZ36WFlBisxhbQ_9MwLo8d2'
    ),
    body := '{}'::jsonb
  );
  return new;
exception when others then
  -- Alerting must never block lead capture (e.g. pg_net missing/unhealthy).
  return new;
end $$;

drop trigger if exists code_request_lead_alert on code_request;
create trigger code_request_lead_alert
  after insert on code_request
  for each row execute function poke_lead_alert();
