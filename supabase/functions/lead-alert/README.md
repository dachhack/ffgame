# lead-alert

Emails a digest of new `code_request` leads (the "get a league code" capture
form) so Reddit-ad leads stop sitting unnoticed in the admin table.

## How it fires

Migration `0091_lead_alert.sql` adds `code_request.notified_at` and an
AFTER INSERT trigger that pokes this function via `pg_net` (async, post-commit).
The poke carries no data: on any call the function atomically claims rows
`WHERE notified_at IS NULL` with the service role and emails one digest. A
failed send un-claims the rows, so the next poke retries — missed pokes
self-heal, and a manual retry is just:

```sh
curl -X POST https://auth.dripfantasy.com/functions/v1/lead-alert \
  -H 'apikey: <anon key>' -H 'Content-Type: application/json' -d '{}'
```

## Secrets

Reuses the Gmail service-account secrets already set for `send-invite`
(`GOOGLE_SA_EMAIL`, `GOOGLE_SA_PRIVATE_KEY`, `GMAIL_SENDER`, optional
`GMAIL_FROM` / `GMAIL_FROM_NAME` — see that function's README for the one-time
Google setup). One optional addition:

- `LEAD_ALERT_TO` — recipient for the alerts. Defaults to `GMAIL_SENDER`.

## Deploy

Actions → "Deploy Edge Functions" → `lead-alert` (deployed `--no-verify-jwt`;
the trigger authenticates with the public anon key, which is not a JWT — and an
anonymous call can only trigger a no-op query when there are no unnotified
rows).
