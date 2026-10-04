// MAIL FROM THE WORKER (v0.612.0) — the Gmail API through a Google Workspace
// service account, the same mechanism the send-invite and lead-alert edge
// functions use (supabase/functions/send-invite/README.md has the setup).
// The worker never had a way to email anyone; the offboarding sweep needs one,
// because an account must be WARNED before it is removed, and "warned" here
// means the mail was accepted by Gmail, not that we meant to send it.
//
// Secrets (Fly, staged by deploy-worker.yml when the repo secrets exist):
//   GOOGLE_SA_EMAIL        service-account address
//   GOOGLE_SA_PRIVATE_KEY  its PEM private key (\n-escaped is fine)
//   GMAIL_SENDER           the Workspace mailbox to impersonate
//   GMAIL_FROM             optional verified "send mail as" alias
//   GMAIL_FROM_NAME        default "Drip Fantasy"
// Without the first three, `mailConfigured()` is false and every caller must
// treat that as "send nothing" — the sweep does.
import { createSign } from 'node:crypto';

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const encodeHeader = (s) => (/^[\x00-\x7F]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`);

export function mailConfigured(env = process.env) {
  return !!(env.GOOGLE_SA_EMAIL && env.GOOGLE_SA_PRIVATE_KEY && env.GMAIL_SENDER);
}

/** A signed JWT for the token endpoint: the service account acting as `sub`. */
export function serviceJwt(saEmail, privateKeyPem, sub, now = Math.floor(Date.now() / 1000)) {
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({
    iss: saEmail, sub, scope: 'https://www.googleapis.com/auth/gmail.send',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  }));
  const unsigned = `${header}.${claim}`;
  const signer = createSign('RSA-SHA256');
  signer.update(unsigned);
  const sig = signer.sign(privateKeyPem.replace(/\\n/g, '\n'));
  return `${unsigned}.${b64url(sig)}`;
}

async function accessToken(env) {
  const jwt = serviceJwt(env.GOOGLE_SA_EMAIL, env.GOOGLE_SA_PRIVATE_KEY, env.GMAIL_SENDER);
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error_description || data.error || `token endpoint ${res.status}`);
  return data.access_token;
}

/** The raw RFC 822 message Gmail wants, base64url'd by the caller. Exported
 *  so the test can read the headers back. */
export function mimeMessage({ from, fromName, to, subject, html }) {
  return [
    `From: ${encodeHeader(fromName)} <${from}>`, `To: ${to}`, `Subject: ${encodeHeader(subject)}`,
    'MIME-Version: 1.0', 'Content-Type: text/html; charset="UTF-8"', 'Content-Transfer-Encoding: base64', '',
    Buffer.from(html, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n'),
  ].join('\r\n');
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Send one HTML mail. Resolves to Gmail's message id; throws on any failure
 *  (a thrown send is the signal the sweep keys its own bookkeeping on). */
export async function sendMail({ to, subject, html }, env = process.env) {
  if (!mailConfigured(env)) throw new Error('mail not configured');
  if (!EMAIL_RE.test(to)) throw new Error('bad recipient');
  const token = await accessToken(env);
  const raw = mimeMessage({
    from: (env.GMAIL_FROM || '').trim() || env.GMAIL_SENDER,
    fromName: env.GMAIL_FROM_NAME || 'Drip Fantasy', to, subject, html,
  });
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: b64url(raw) }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out?.error?.message || `Gmail API ${res.status}`);
  return out.id;
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** The brand skeleton the auth templates and edge functions share
 *  (docs/email-templates/README.md): mint accent, dark header, white card. */
export function brandedHtml({ icon, title, paras, cta, fine }) {
  const p = paras.map((t) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#4a463c">${t}</p>`).join('');
  const button = cta ? `
      <table role="presentation" cellspacing="0" cellpadding="0" style="margin:6px 0 18px"><tr>
        <td style="background:#34E5D9;border-radius:9px">
          <a href="${esc(cta.href)}" style="display:inline-block;padding:12px 22px;font-family:Arial,sans-serif;font-size:14px;font-weight:700;color:#161510;text-decoration:none">${esc(cta.label)}</a>
        </td></tr></table>` : '';
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f4f3ef">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f3ef;padding:28px 12px"><tr><td align="center">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid #e7e4dc;border-radius:14px;overflow:hidden;font-family:Arial,sans-serif">
  <tr><td style="background:#142A2E;padding:18px 28px">
    <span style="color:#34E5D9;font-size:16px">&#9670;</span>
    <span style="color:#ffffff;font-size:14px;font-weight:700;letter-spacing:2.5px;margin-left:8px">DRIP FANTASY</span>
  </td></tr>
  <tr><td style="padding:28px 28px 10px">
    <div style="font-size:44px;line-height:1;margin-bottom:14px">${icon}</div>
    <h1 style="margin:0 0 14px;font-size:22px;line-height:1.3;color:#14111F">${esc(title)}</h1>
    ${p}
    ${button}
    ${fine ? `<p style="margin:0;font-size:12px;line-height:1.5;color:#9a968a">${fine}</p>` : ''}
  </td></tr>
  <tr><td style="background:#faf9f6;padding:14px 28px;font-size:11px;color:#9a968a">
    Drip Fantasy &middot; <a href="https://www.dripfantasy.com" style="color:#0E8C7A;text-decoration:none">dripfantasy.com</a>
  </td></tr>
</table></td></tr></table></body></html>`;
}

export { esc as escapeHtml };
