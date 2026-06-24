# Supabase polish — founder checklist

Three small dashboard tasks that smooth the closed-pilot signup flow. None can
be scripted from this repo — they're all "click in the dashboard once" tasks.
Project: **dripff** (ref `kaoitimdsftclykhqaqx`, region us-east-1).

## 1. Magic-link template → include the 6-digit OTP code

The mobile fallback (`verifyEmailOtp` in `src/data/liveApi.ts`) needs the user
to type the code from the email. Today the template only renders the link.

- Dashboard → **Authentication → Email Templates → Magic Link**
- Replace the body with (or just add the `{{ .Token }}` line):
  ```
  <h2>Sign in to Drip League FF</h2>
  <p>Click the link to sign in:</p>
  <p><a href="{{ .ConfirmationURL }}">Sign in</a></p>
  <p>Or enter this 6-digit code:</p>
  <p style="font-size: 24px; font-family: monospace; letter-spacing: 3px;"><strong>{{ .Token }}</strong></p>
  <p style="color: #888; font-size: 12px;">Link/code expires in 1 hour.</p>
  ```
- **Save**.

Test: request a magic link, confirm the email shows a 6-digit code, paste it
into the "have a code?" field on the live splash.

## 2. Email provider → "Confirm email" OFF

Today new password signups have to click a confirmation email before they can
sign in — extra friction we don't need for a closed invite-only pilot.

- Dashboard → **Authentication → Providers → Email**
- Toggle **"Confirm email"** → **off**
- **Save**.

Effect: `signUpPassword` returns a session immediately (`needsConfirm: false`),
so onboarding goes straight to redeem-invite without an inbox detour.

## 3. Google OAuth consent screen → App name + Publish

Today the Google sign-in prompt reads "Sign in to `…supabase.co`" — looks like
a generic third-party tool. Fix it free:

- **Google Cloud Console** → project the OAuth client lives in
  → **APIs & Services → OAuth consent screen**
- **App name**: `Drip League FF`
- **User support email**: your email
- **Application home page**: `https://dachhack.github.io/ffgame/`
- **Authorized domains**: `supabase.co` (until #4 below)
- **Developer contact**: your email
- **Save**, then **Publish app** (moves out of "testing" to "in production").

Effect: the Google prompt now reads "Sign in to Drip League FF". The
supabase.co text underneath stays until #4 — a paid add-on.

## 4. Custom auth domain (optional, paid) — moves OFF supabase.co

This is the only knob that removes `…supabase.co` from the OAuth prompt
entirely (Google shows the actual auth host). Needs:

- A domain you own (~$10/yr; Cloudflare Registrar / Porkbun / Namecheap).
- **Supabase Pro plan** — $25/mo. Custom Domains is a paid add-on, no free tier.

Setup (after both):
1. Pick a subdomain — convention is `auth.<your-domain>`.
2. Dashboard → **Custom Domains** → enter `auth.dripleague.com` (or whatever).
3. Supabase gives you a CNAME target like `xxxxx.supabase.co`.
4. At your registrar → DNS → add a **CNAME** record `auth` → that target,
   proxied **off** if on Cloudflare (Supabase needs the raw CNAME).
5. Back in the dashboard, click **Verify**. ~5–10 min for DNS to propagate.
6. Once verified, update the Google OAuth client's
   **Authorized redirect URI** to use `auth.dripleague.com` instead of the
   `…supabase.co` host. Same in any provider configs.

After that, Google's prompt reads "Sign in to dripleague.com" with no
supabase.co anywhere.

## What stays "free tier" for the pilot
Everything except #4. The first three are free, take <5 minutes total, and
deliver the biggest perceived-polish win for the closed-pilot signup flow.
