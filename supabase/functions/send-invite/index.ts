// Edge Function: send-invite
// Lets an ADMIN email a Drip Fantasy invite (share link + code) to a pending
// code-request, straight from the admin panel's CODE REQUESTS card. Sends through
// Google Workspace via the Gmail API, so mail comes from a real dripfantasy.com
// address with the domain's own deliverability — no third-party mailer.
//
// Flow:
//   admin clicks "✉ send code" → supabase.functions.invoke('send-invite', {to, code, link})
//   → we verify is_admin() with the caller's JWT
//   → we mint a Google OAuth token for the service account (impersonating GMAIL_SENDER)
//   → we POST a MIME message to gmail.googleapis.com … /messages/send
//
// Secrets (set once with `supabase secrets set …`, see README.md):
//   GOOGLE_SA_EMAIL        service account client_email
//   GOOGLE_SA_PRIVATE_KEY  service account private key (PEM; \n-escaped is fine)
//   GMAIL_SENDER           Workspace user to send AS, e.g. hi@dripfantasy.com
//   GMAIL_FROM_NAME        optional display name (default: "Drip Fantasy")
// SUPABASE_URL / SUPABASE_ANON_KEY are injected automatically.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

// ── base64url helpers ────────────────────────────────────────────────────────
function b64url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const b64urlStr = (s: string) => b64url(new TextEncoder().encode(s));
// Standard base64 of a UTF-8 string (no url-safe swap) — for the raw MIME body.
function b64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
// RFC 2047 encoded-word so non-ASCII in a header (e.g. an em dash in the subject)
// survives instead of turning into mojibake.
const encodeHeader = (s: string) =>
  /^[\x00-\x7F]*$/.test(s) ? s : `=?UTF-8?B?${b64(new TextEncoder().encode(s))}?=`;

// ── Google service-account access token (JWT bearer grant, RS256) ─────────────
function pemToPkcs8(pem: string): ArrayBuffer {
  const body = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const bin = atob(body);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}
async function getAccessToken(saEmail: string, privateKeyPem: string, sub: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64urlStr(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64urlStr(JSON.stringify({
    iss: saEmail,
    sub, // the Workspace user we impersonate (domain-wide delegation)
    scope: 'https://www.googleapis.com/auth/gmail.send',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = `${header}.${claim}`;
  const key = await crypto.subtle.importKey(
    'pkcs8', pemToPkcs8(privateKeyPem.replace(/\\n/g, '\n')),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const jwt = `${unsigned}.${b64url(new Uint8Array(sig))}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error_description || data.error || `token endpoint ${res.status}`);
  return data.access_token as string;
}

// ── Branded invite email (ASCII/entities only, so the body is 7-bit clean) ────
const esc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]!));
function inviteHtml(link: string, code: string, leagueName?: string | null): string {
  const forLeague = leagueName ? ` for <strong>${esc(leagueName)}</strong>` : '';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0;padding:0;background:#f4f3ef;">
  <tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:#ffffff;border:1px solid #e7e4dc;border-radius:14px;overflow:hidden;">
      <tr><td style="background:#142A2E;padding:18px 28px;">
        <span style="color:#34E5D9;font-size:16px;vertical-align:middle;">&#9670;</span>
        <span style="font-family:Arial,Helvetica,sans-serif;color:#ffffff;font-weight:700;letter-spacing:2.5px;font-size:14px;vertical-align:middle;margin-left:8px;">DRIP FANTASY</span>
      </td></tr>
      <tr><td style="padding:36px 32px 28px;font-family:Arial,Helvetica,sans-serif;color:#1c1a14;">
        <div style="font-size:44px;line-height:1;">&#127944;</div>
        <h1 style="margin:14px 0 6px;font-size:22px;font-weight:700;color:#14111F;">You&rsquo;re in.</h1>
        <p style="margin:0 0 22px;font-size:15px;line-height:1.55;color:#4a463c;">Here&rsquo;s your invite to the Drip Fantasy live head-to-head pilot${forLeague}. Tap below to sign in and set your team.</p>
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td style="background:#34E5D9;border-radius:9px;">
            <a href="${esc(link)}" style="display:inline-block;padding:14px 30px;font-size:15px;font-weight:700;color:#14111F;text-decoration:none;">Accept invite &rarr;</a>
          </td>
        </tr></table>
        <p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#4a463c;">Or sign in at <a href="https://www.dripfantasy.com" style="color:#0E8C7A;text-decoration:none;">dripfantasy.com</a> and enter this code:</p>
        <div style="margin:8px 0 0;font-family:'Courier New',monospace;font-size:22px;font-weight:700;letter-spacing:4px;color:#142A2E;">${esc(code)}</div>
        <p style="margin:26px 0 0;font-size:12px;line-height:1.5;color:#9a968a;">Didn&rsquo;t request this? You can ignore it &mdash; nothing happens until you sign in.</p>
      </td></tr>
      <tr><td style="background:#faf9f6;border-top:1px solid #eee;padding:16px 28px;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#9a968a;">
        Drip Fantasy &middot; <a href="https://www.dripfantasy.com" style="color:#0E8C7A;text-decoration:none;">dripfantasy.com</a>
      </td></tr>
    </table>
  </td></tr>
</table>`;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405);

  try {
    const auth = req.headers.get('Authorization') ?? '';
    if (!auth) return json({ ok: false, error: 'Not signed in.' });

    // Verify the caller is an admin, using THEIR JWT (not the service role).
    const supa = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: auth } } },
    );
    const { data: isAdmin, error: adminErr } = await supa.rpc('is_admin');
    if (adminErr) return json({ ok: false, error: adminErr.message });
    if (!isAdmin) return json({ ok: false, error: 'Admins only.' });

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const to = String(body.to ?? '').trim();
    const code = String(body.code ?? '').trim();
    const link = String(body.link ?? '').trim();
    const leagueName = body.leagueName ? String(body.leagueName) : null;
    if (!EMAIL_RE.test(to)) return json({ ok: false, error: 'A valid recipient email is required.' });
    if (!code) return json({ ok: false, error: 'An invite code is required.' });
    if (!/^https?:\/\//.test(link)) return json({ ok: false, error: 'A valid invite link is required.' });

    const saEmail = Deno.env.get('GOOGLE_SA_EMAIL');
    const saKey = Deno.env.get('GOOGLE_SA_PRIVATE_KEY');
    const sender = Deno.env.get('GMAIL_SENDER');
    if (!saEmail || !saKey || !sender)
      return json({ ok: false, error: 'Server not configured: set GOOGLE_SA_EMAIL, GOOGLE_SA_PRIVATE_KEY and GMAIL_SENDER.' });
    const fromName = Deno.env.get('GMAIL_FROM_NAME') ?? 'Drip Fantasy';

    const token = await getAccessToken(saEmail, saKey, sender);

    const subject = "You're in — your Drip Fantasy invite";
    const mime = [
      `From: ${encodeHeader(fromName)} <${sender}>`,
      `To: ${to}`,
      `Subject: ${encodeHeader(subject)}`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset="UTF-8"',
      'Content-Transfer-Encoding: 7bit',
      '',
      inviteHtml(link, code, leagueName),
    ].join('\r\n');

    const send = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw: b64urlStr(mime) }),
    });
    const out = await send.json().catch(() => ({}));
    if (!send.ok) return json({ ok: false, error: out?.error?.message || `Gmail API ${send.status}` });
    return json({ ok: true, id: out.id });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
