// Edge Function: lead-alert
// Emails the founder when new code_request leads arrive, so Reddit-ad leads
// stop sitting unnoticed in the admin table. A database trigger (migration
// 0091) POKES this function on every insert; the poke carries NO data and needs
// no secret — on any call we atomically claim rows where notified_at is null
// (service role) and email a digest. An attacker hitting the endpoint can only
// cause a no-op query: leads are inserted solely via the validated
// request_code() RPC, and the claim means each lead is emailed once.
//
// Sends through the same Gmail service-account machinery as send-invite (see
// its README for the one-time Google setup). Secrets (project-wide, already
// set for send-invite):
//   GOOGLE_SA_EMAIL / GOOGLE_SA_PRIVATE_KEY / GMAIL_SENDER (+ optional
//   GMAIL_FROM / GMAIL_FROM_NAME)
//   LEAD_ALERT_TO  optional recipient override — defaults to GMAIL_SENDER.
//
// Deploy note: allow anonymous invocation (verify_jwt = false) — the trigger
// authenticates with the public anon key, which is not a JWT.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

// ── base64url + Google service-account token (same as send-invite) ────────────
function b64url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const b64urlStr = (s: string) => b64url(new TextEncoder().encode(s));

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
    sub,
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

// ── Digest email ──────────────────────────────────────────────────────────────
const esc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]!));

interface Lead {
  id: string; created_at: string; email: string | null; sleeper_username: string | null;
  league_name: string | null; league_ref: string | null; note: string | null;
  attribution: Record<string, unknown> | null;
}

// The interesting attribution keys, in display order; anything else is dropped.
const ATTR_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'referrer', 'landing'];
function attrLine(a: Lead['attribution']): string {
  if (!a) return 'organic / unknown';
  const parts = ATTR_KEYS.filter((k) => a[k]).map((k) => `${k.replace('utm_', '')}=${String(a[k])}`);
  return parts.length ? parts.join(' · ') : 'organic / unknown';
}

function digestHtml(leads: Lead[]): string {
  const row = (l: Lead) => `<tr>
    <td style="padding:14px 0;border-top:1px solid #eee;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1c1a14;line-height:1.6;">
      <strong>${esc(l.email ?? '(no email)')}</strong>
      ${l.sleeper_username ? ` &middot; ${esc(l.sleeper_username)}` : ''}<br>
      ${l.league_name ? `League: ${esc(l.league_name)}<br>` : ''}
      ${l.league_ref ? `Ref: ${esc(l.league_ref)}<br>` : ''}
      ${l.note ? `<span style="color:#4a463c;">&ldquo;${esc(l.note)}&rdquo;</span><br>` : ''}
      <span style="font-size:12px;color:#9a968a;">${esc(attrLine(l.attribution))} &middot; ${esc(new Date(l.created_at).toISOString().replace('T', ' ').slice(0, 16))} UTC</span>
    </td>
  </tr>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0;padding:0;background:#f4f3ef;">
  <tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:#ffffff;border:1px solid #e7e4dc;border-radius:14px;overflow:hidden;">
      <tr><td style="background:#142A2E;padding:18px 28px;">
        <span style="color:#34E5D9;font-size:16px;vertical-align:middle;">&#9670;</span>
        <span style="font-family:Arial,Helvetica,sans-serif;color:#ffffff;font-weight:700;letter-spacing:2.5px;font-size:14px;vertical-align:middle;margin-left:8px;">DRIP FANTASY</span>
      </td></tr>
      <tr><td style="padding:28px 32px;font-family:Arial,Helvetica,sans-serif;color:#1c1a14;">
        <h1 style="margin:0 0 4px;font-size:20px;font-weight:700;color:#14111F;">${leads.length === 1 ? 'New league code request' : `${leads.length} new league code requests`}</h1>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${leads.map(row).join('')}</table>
        <p style="margin:20px 0 0;font-size:13px;"><a href="https://dripfantasy.com/?live=1" style="color:#0E8C7A;">Open the admin panel &rarr;</a></p>
      </td></tr>
    </table>
  </td></tr>
</table>`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405);

  try {
    const saEmail = Deno.env.get('GOOGLE_SA_EMAIL');
    const saKey = Deno.env.get('GOOGLE_SA_PRIVATE_KEY');
    const sender = Deno.env.get('GMAIL_SENDER');
    if (!saEmail || !saKey || !sender)
      return json({ ok: false, error: 'Server not configured: set GOOGLE_SA_EMAIL, GOOGLE_SA_PRIVATE_KEY and GMAIL_SENDER.' });

    // Service role: code_request is RLS-locked with no policies on purpose.
    const supa = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    // Atomically CLAIM unnotified leads — a concurrent poke matches zero rows,
    // so no lead is ever emailed twice. Un-claimed below if the send fails.
    const { data: leads, error } = await supa
      .from('code_request')
      .update({ notified_at: new Date().toISOString() })
      .is('notified_at', null)
      .select('id, created_at, email, sleeper_username, league_name, league_ref, note, attribution');
    if (error) return json({ ok: false, error: error.message }, 500);
    if (!leads || leads.length === 0) return json({ ok: true, sent: 0 });

    try {
      const to = Deno.env.get('LEAD_ALERT_TO')?.trim() || sender;
      const fromName = Deno.env.get('GMAIL_FROM_NAME') ?? 'Drip Fantasy';
      const fromAddr = Deno.env.get('GMAIL_FROM')?.trim() || sender;
      const token = await getAccessToken(saEmail, saKey, sender);
      const first = leads[0] as Lead;
      const subject = leads.length === 1
        ? `New lead: ${first.email ?? first.sleeper_username ?? 'league code request'}`
        : `${leads.length} new leads (league code requests)`;
      const mime = [
        `From: ${fromName} <${fromAddr}>`,
        `To: ${to}`,
        `Subject: ${subject}`,
        'MIME-Version: 1.0',
        'Content-Type: text/html; charset="UTF-8"',
        'Content-Transfer-Encoding: 7bit',
        '',
        digestHtml(leads as Lead[]),
      ].join('\r\n');
      const send = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw: b64urlStr(mime) }),
      });
      if (!send.ok) {
        const out = await send.json().catch(() => ({}));
        throw new Error(out?.error?.message || `Gmail API ${send.status}`);
      }
      return json({ ok: true, sent: leads.length });
    } catch (e) {
      // Send failed → un-claim so the next poke (or a manual curl) retries.
      await supa.from('code_request').update({ notified_at: null }).in('id', leads.map((l) => l.id));
      return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
    }
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
