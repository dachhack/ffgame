# `send-invite` edge function

Lets an **admin** email a Drip Fantasy invite (share link + code) to a pending
code-request, from the admin panel's **CODE REQUESTS** card (`✉ send code`). It
verifies the caller is an admin (`is_admin()` against their JWT), then sends the
mail **through Google Workspace via the Gmail API**, so it comes from a real
`dripfantasy.com` address with the domain's own deliverability — no third-party
mailer, no per-email cost (within Workspace's ~2,000 msgs/day limit).

## Why the Gmail API (and not SMTP)

Supabase edge functions run on a Deno runtime that talks HTTPS reliably but not
raw SMTP over TCP, and Google is phasing out app passwords. A **service account
with domain-wide delegation** sends over HTTPS and impersonates a Workspace user
(e.g. `hi@dripfantasy.com`), which is the durable, Google-recommended path.

## One-time setup

### 1. Create a service account + key (Google Cloud Console)

1. **console.cloud.google.com** → pick/create a project.
2. **APIs & Services → Library** → enable the **Gmail API**.
3. **APIs & Services → Credentials → Create credentials → Service account.**
   Name it e.g. `drip-mailer`. No project roles needed.
4. Open the service account → **Keys → Add key → Create new key → JSON**. This
   downloads a JSON file — you need its `client_email` and `private_key`.
5. On the service account's **Details** page, note its **Unique ID** (a long
   number = the "Client ID") for the next step.

### 2. Grant domain-wide delegation (Google Workspace Admin)

`admin.google.com` → **Security → Access and data control → API controls →
Domain-wide delegation → Add new**:

- **Client ID:** the service account's Unique ID from step 1.5
- **OAuth scopes:** `https://www.googleapis.com/auth/gmail.send`

This authorizes the service account to send *as* users in your domain. Nothing
else is granted.

### 3. Deploy + set secrets (Supabase CLI, from repo root)

```bash
# linked to the project: supabase link --project-ref <ref>
supabase functions deploy send-invite

supabase secrets set \
  GOOGLE_SA_EMAIL="drip-mailer@<project>.iam.gserviceaccount.com" \
  GMAIL_SENDER="you@dripfantasy.com" \
  GMAIL_FROM="hi@dripfantasy.com" \
  GMAIL_FROM_NAME="Drip Fantasy"

# the private key — paste the value of "private_key" from the JSON, keeping the
# literal \n sequences (the function un-escapes them). Easiest via a file:
supabase secrets set GOOGLE_SA_PRIVATE_KEY="$(jq -r .private_key /path/to/key.json)"
```

`GMAIL_SENDER` must be a **real Gmail-enabled mailbox** in the Workspace domain —
the service account can't impersonate an alias or a Squarespace forward.
`SUPABASE_URL` / `SUPABASE_ANON_KEY` are injected automatically.

### Sending "from" a different address (e.g. hi@dripfantasy.com)

To have mail *appear* from an address other than the impersonated mailbox, set
`GMAIL_FROM` to that address — but it must be a **verified "Send mail as" alias**
on `GMAIL_SENDER`, or Gmail silently rewrites the From back to the real mailbox.

1. Sign in to `GMAIL_SENDER`'s Gmail → **Settings → Accounts and Import → "Send
   mail as" → Add another email address.** Enter `hi@dripfantasy.com`, leave
   "Treat as an alias" checked.
2. Google emails a confirmation to `hi@dripfantasy.com`. Since it forwards to your
   Gmail (Squarespace), click the link (or enter the code) to verify.
3. Set `GMAIL_FROM="hi@dripfantasy.com"`. Leave it unset to send from `GMAIL_SENDER`.

## Request / response

```jsonc
// POST body (sent by src/data/liveApi.ts → sendInvite)
{ "to": "player@example.com", "code": "AB12CD", "link": "https://www.dripfantasy.com/?live=1&code=AB12CD", "leagueName": "Sunday Scaries" }
// → { "ok": true, "id": "<gmail message id>" }   |   { "ok": false, "error": "…" }
```

The function rejects anything but an admin JWT, and requires a valid `to`, a
non-empty `code`, and an `http(s)` `link`.

## Test from the CLI

```bash
curl -s -X POST "$SUPABASE_URL/functions/v1/send-invite" \
  -H "Authorization: Bearer <an admin user access token>" \
  -H 'Content-Type: application/json' \
  -d '{"to":"you@example.com","code":"TEST12","link":"https://www.dripfantasy.com/?live=1&code=TEST12"}'
```

## Troubleshooting

- **`unauthorized_client` / `invalid_grant` from the token endpoint** — the
  domain-wide delegation (step 2) isn't in place, the scope doesn't match, or
  `GMAIL_SENDER` isn't a user in the delegated domain.
- **`Server not configured`** — a secret is missing; re-run `secrets set`.
- **Delegation can take a few minutes to propagate** after you add it.
