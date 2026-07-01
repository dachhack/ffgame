# Drip Fantasy — auth email templates

Branded HTML for Supabase Auth emails. Paste each file's contents into
**Supabase → Authentication → Emails → [template]** and set the subject below.

| File | Supabase template | Subject |
|------|-------------------|---------|
| `magic-link.html` | Magic Link | Your Drip Fantasy sign-in link |
| `confirm-signup.html` | Confirm signup | Confirm your Drip Fantasy account |
| `reset-password.html` | Reset Password | Reset your Drip Fantasy password |
| `invite.html` | Invite user | You're invited to Drip Fantasy |

## Signature
`signature.html` is a personal email signature (not a Supabase template). Paste it into
**Gmail → Settings → General → Signature → "Create new"**, then fill in the `[Your Name]`,
`[Title]` (default: Founder) and `[Phone]` tokens — or delete the phone `<span>` to drop it.
It's inline-styled and Arial-safe because Gmail strips `<style>` blocks and web fonts, so the
Space Grotesk wordmark falls back to Arial while keeping the ◆ mark and brand colors.

## Brand
- Accent: `#34E5D9` (mint) · header: `#142A2E` (dark olive) · button text: `#161510`
- Wordmark font: Space Grotesk (falls back to Arial in clients that block web fonts)
- Brand mark: ◆ (`&#9670;`) in the accent color

## Icons
Each template uses an **emoji hero icon** (🔗 / 🎉 / 🔑 / 🏈) so it renders everywhere
with no image hosting. To use custom art instead, host a PNG (e.g.
`https://www.dripfantasy.com/icons/magic.png`) and replace the `<div style="font-size:44px…">…</div>`
line — see the `ICON:` comment at the top of each file. Keep critical content as
text/HTML (not images) so it survives image-blocking.

## Notes
- Links/footer point to `https://www.dripfantasy.com` (the canonical site).
- Magic Link includes both the button (`{{ .ConfirmationURL }}`) and the 6-digit
  code (`{{ .Token }}`) for the app's OTP fallback.
