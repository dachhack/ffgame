# Domain + custom auth — runbook

For when you're ready to move off `…supabase.co` / `…github.io` and onto your
own domain. Self-contained — pick it up later without rereading earlier
context.

## TL;DR
1. **Buy a domain** ($10–15/yr). My pick: **Cloudflare Registrar** — at-cost
   pricing, free DNS, no upsells. Alt: Porkbun.
2. **Upgrade Supabase to Pro** ($25/mo). Custom Domains is paid-only.
3. **Add the auth subdomain** + a CNAME at your registrar.
4. **Flip three configs** (auth URL, Google OAuth redirect, Pages CNAME).

## 1. Buy the domain

Cloudflare Registrar: <https://dash.cloudflare.com/?to=/:account/registrar>.
Login → Domain Registration → Register Domains → search.

Suggestions (verify availability):
- `dripleague.com` / `dripleague.app` — most direct
- `dripff.com` / `dripff.app` — keys to the Supabase project ref
- `dripfantasy.com` — descriptive

Cloudflare doesn't charge a markup over the registry fee. `.com` is ~$10/yr,
`.app` is ~$14/yr.

Once bought, Cloudflare auto-creates the zone. No DNS yet.

## 2. Upgrade Supabase to Pro

Dashboard → **Project Settings → Billing → Change Plan → Pro ($25/mo)**.
Same project, no data move. Pro is required for Custom Domains; everything
else stays free quota.

## 3. DNS — three records

At your registrar's DNS panel:

| Record | Type | Value | Why |
|--------|------|-------|-----|
| `auth` | CNAME | (from Supabase) | Custom auth host |
| `www` (or apex) | CNAME / A | `dachhack.github.io` | Site itself |
| `MX` | optional | (forwarding) | Email forwarding |

### auth subdomain
- Dashboard → **Custom Domains → Add Custom Domain**: `auth.<your-domain>`
- It returns a CNAME target like `abc123.frontend-prod.cluster.supabase.co`.
- Add a **CNAME** record at registrar: `auth` → that target.
  - **Cloudflare users**: set proxy status to **DNS only** (gray cloud).
    Supabase needs a raw CNAME for its own SSL cert.
- Wait 5–10 min → click **Verify** in the dashboard.

### Site host (move off `…github.io`)
- Dashboard for your registrar → CNAME `www` → `dachhack.github.io`
  (or for the apex: an A record set to GitHub Pages IPs — see
  <https://docs.github.com/pages/configuring-a-custom-domain-for-your-github-pages-site>).
- GitHub repo → Settings → Pages → **Custom domain**: `www.<your-domain>`.
  Tick **"Enforce HTTPS"** once the cert provisions (~10 min).

### Email forwarding (no inbox setup)
Cloudflare Email Routing (free) → forward `hi@<your-domain>` →
`mlporritt@gmail.com`. Useful for OAuth's "App support email" looking
professional.

## 4. Flip three configs

1. **Supabase Auth URL** — Dashboard → Authentication → URL Configuration
   - Site URL: `https://www.<your-domain>/`  (or wherever the site lives)
   - Redirect URLs: add `https://www.<your-domain>/?live=1`
     (keep the old `https://dachhack.github.io/...` entry until cutover is done)

2. **Google OAuth** — Cloud Console → OAuth client → **Authorized redirect URIs**
   - Replace `https://kaoitimdsftclykhqaqx.supabase.co/auth/v1/callback`
     with `https://auth.<your-domain>/auth/v1/callback`
   - Update **Authorized JavaScript origins** to your new site host.
   - **Authorized domains** on the consent screen: add your domain, can drop
     `supabase.co`.

3. **App code** — `src/data/supabaseClient.ts`
   - Update `DEFAULT_URL` to `https://auth.<your-domain>` (or leave the
     supabase.co default and set `VITE_SUPABASE_URL=https://auth.<your-domain>`
     as a build-time env on the Pages workflow).
   - Bump version, push, confirm the version chip on the deployed site.

## Verify
- Visit the new domain → Splash → join the live H2H pilot → Google sign-in:
  prompt should read **"Sign in to <your-domain>"** with no supabase.co.
- Magic-link email's redirect URL points at `www.<your-domain>`.
- `https://www.<your-domain>` serves the live site with a green padlock.

## Rough order-of-operations
Same day:
- Buy domain (5 min)
- Upgrade Supabase Pro (1 min)
- DNS records (5 min, then 10 min propagation wait)

Next ~30 min:
- Verify Supabase custom domain
- Flip auth/OAuth configs
- Push the code change

## Cost summary
| Item | First-year cost |
|------|-----------------|
| Domain (`.com` via Cloudflare) | $10 |
| Supabase Pro | $25/mo (~$300/yr) |
| Cloudflare DNS / Email Routing | $0 |
| GitHub Pages (with custom domain) | $0 |
| **Total** | **~$310/yr** |
