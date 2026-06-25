# Drip Fantasy — auth email templates

Branded HTML for Supabase Auth emails. Paste each file's contents into
**Supabase → Authentication → Emails → [template]** and set the subject below.

| File | Supabase template | Subject |
|------|-------------------|---------|
| `magic-link.html` | Magic Link | Your Drip Fantasy sign-in link |
| `confirm-signup.html` | Confirm signup | Confirm your Drip Fantasy account |
| `reset-password.html` | Reset Password | Reset your Drip Fantasy password |
| `invite.html` | Invite user | You're invited to Drip Fantasy |

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
