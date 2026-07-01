# Domain + custom auth — runbook

For moving off `…supabase.co` / `…github.io` and onto **dripfantasy.com**.
Self-contained — pick it up later without rereading earlier context.

Domain registered via **Squarespace Domains** (Google Domains successor). DNS
panel sits under: Squarespace dashboard → Domains → dripfantasy.com → DNS.

## TL;DR
1. ~~Buy a domain~~ ✓ done — `dripfantasy.com` at Squarespace.
2. Add DNS records for **the site** (GitHub Pages) — free, immediate win.
3. **Upgrade Supabase to Pro** ($25/mo) if you want custom auth.
4. Add the **auth subdomain** + a CNAME at Squarespace.
5. **Flip three configs** (auth URL, Google OAuth redirect, Pages CNAME).

## 2. Upgrade Supabase to Pro

Dashboard → **Project Settings → Billing → Change Plan → Pro ($25/mo)**.
Same project, no data move. Pro is required for Custom Domains; everything
else stays free quota.

## 3. DNS at Squarespace

Squarespace dashboard → **Domains → dripfantasy.com → DNS → Custom Records**.

| Host | Type | Value | Why |
|------|------|-------|-----|
| `www` | CNAME | `dachhack.github.io` | Site (GitHub Pages) |
| `@` (apex) | A | 4× GitHub Pages IPs (below) | Site (apex redirect) |
| `auth` | CNAME | (from Supabase, see §4) | Custom auth host |

### Site (move off `…github.io`) — do this first, it's free
1. At Squarespace DNS → Add Custom Record:
   - **CNAME**: host `www` → `dachhack.github.io.` (trailing dot)
   - **A records** for the apex (host `@`), one per IP, GitHub Pages:
     ```
     185.199.108.153
     185.199.109.153
     185.199.110.153
     185.199.111.153
     ```
2. GitHub repo → **Settings → Pages → Custom domain**: `www.dripfantasy.com`
   → Save. Tick **"Enforce HTTPS"** once the cert provisions (~5–15 min).
3. Update Supabase Auth → URL Configuration:
   - Site URL: `https://www.dripfantasy.com/`
   - Add to Redirect URLs: `https://www.dripfantasy.com/?live=1`
   - Keep the old `https://dachhack.github.io/...` entry until you're confident.

That alone makes the live site live at https://www.dripfantasy.com — no
Supabase Pro needed.

### auth subdomain (only after Supabase Pro)
- Supabase Dashboard → **Custom Domains → Add Custom Domain**:
  `auth.dripfantasy.com`
- It returns a CNAME target like `abc123.frontend-prod.cluster.supabase.co`.
- Squarespace DNS → Add Custom Record → **CNAME**: host `auth` → that target.
- Wait 5–10 min → click **Verify** in the Supabase dashboard.

### Email — `hi@dripfantasy.com` (Google Workspace)

The FAQ + OAuth "App support email" point at **`hi@dripfantasy.com`**, so that
mailbox has to be real. We run it on **Google Workspace** (a full mailbox you
can send *from*, not just forward). Squarespace groups the Workspace records
under a separate **"Google records"** block (with its own ADD RECORD button),
distinct from Custom Records.

**Records (all live + verified):**

| Type | Host | Priority | Value | Purpose |
|------|------|---------|-------|---------|
| MX | `@` | 1 | `smtp.google.com` | Inbound mail → Google |
| TXT | `@` | — | `v=spf1 include:_spf.google.com ~all` | SPF for outbound `hi@` |
| TXT | `google._domainkey` | — | `v=DKIM1;k=rsa;p=…` (from Workspace) | Google DKIM |
| TXT | `_dmarc` | — | `v=DMARC1; p=none; rua=mailto:hi@dripfantasy.com` | *(optional)* DMARC monitoring |

**Setup steps:**
1. Google Workspace Admin → verify the domain, then create `hi@` as a **user**
   or an **alias** on your account (alias = free shared inbox).
2. Add the MX + DKIM from the Workspace wizard. Add the **root SPF manually** —
   the wizard only covers MX + DKIM, and the app's existing SPF lives on the
   `send` host, so `@` has none until you add it.
3. Admin → **Apps → Google Workspace → Gmail → Authenticate email** →
   **Start authentication** once the DKIM TXT is live.
4. Finish **Activate Gmail** in the wizard; test both directions
   (send *to* `hi@`, and *from* `hi@` — check `dkim=pass` / `spf=pass`).

**Gotchas (both bit us):**
- **Delete the old Squarespace email forwarding** for `hi@` first. Its MX runs
  separately (often hidden from the Custom Records editor) and conflicts with
  Google's MX → "Unable to verify."
- Google verification fails if you Retry **before MX propagates**. Check with
  `whatsmydns.net` (type MX → `dripfantasy.com`); once `smtp.google.com` shows
  globally, Retry passes. Squarespace TTL is 4h, so allow up to ~an hour.

**Leave the app's own mail records alone** — these are Resend/Amazon SES for
transactional email (magic links / invites), unrelated to Workspace:
`resend._domainkey` (DKIM) and the `send` host SPF (`v=spf1 include:amazonses.com ~all`).

## 4. Flip three configs (auth-domain only — site cutover is in §3 above)

1. **Google OAuth** — Cloud Console → OAuth client → **Authorized redirect URIs**
   - Replace `https://kaoitimdsftclykhqaqx.supabase.co/auth/v1/callback`
     with `https://auth.dripfantasy.com/auth/v1/callback`
   - Update **Authorized JavaScript origins** to `https://www.dripfantasy.com`.
   - **Authorized domains** on the consent screen: add `dripfantasy.com`,
     can drop `supabase.co`.

2. **App code** — `src/data/supabaseClient.ts`
   - Update `DEFAULT_URL` to `https://auth.dripfantasy.com` (or leave the
     supabase.co default and set `VITE_SUPABASE_URL=https://auth.dripfantasy.com`
     as a build-time env on the Pages workflow).
   - Bump version, push, confirm the version chip on the deployed site.

3. **Supabase Auth → URL Configuration** (already partly done in §3)
   - Site URL: `https://www.dripfantasy.com/`
   - Redirect URLs: `https://www.dripfantasy.com/?live=1`

## Verify
- Visit https://www.dripfantasy.com → live H2H pilot → Google sign-in:
  prompt should read **"Sign in to dripfantasy.com"** with no supabase.co.
- Magic-link email's redirect URL points at `www.dripfantasy.com`.
- `https://www.dripfantasy.com` serves the live site with a green padlock.

## Stage gates
- **Today / free**: §3 site cutover only. Live site moves to
  `www.dripfantasy.com`; auth still reads supabase.co in the consent screen.
- **+$25/mo, ~30 min**: §3 auth subdomain + §4 config flips. Removes
  supabase.co from the user-facing flow entirely.

## Cost summary (with dripfantasy.com)
| Item | Cost |
|------|------|
| Domain (Squarespace `.com`) | ~$20/yr |
| Supabase Pro (base plan) | $25/mo |
| Supabase Custom Domains add-on | $10/mo |
| Squarespace DNS | $0 |
| Google Workspace (`hi@` mailbox) | ~$6/user/mo |
| GitHub Pages | $0 |
| **Site only (no auth domain)** | **~$20/yr** |
| **Full custom auth** | **~$440/yr** ($20 + $35×12) |
