// OFFBOARDING (v0.612.0, 0422). Founder: "do a daily sweep for inactive users
// and make an off boarding process."
//
// The process, once a day:
//   1. CANCEL. Any notice whose account has shown life since (a sign-in, a
//      league opened, an app check-in, a chat line) is withdrawn. Nothing is
//      sent; they came back.
//   2. NOTIFY. Every account the database says may go (0422's
//      offboard_candidates: not an admin, not a seat agent, not a
//      commissioner, no seat in the season being played, nothing from them
//      in INACTIVE_DAYS) and that holds no notice gets one email: "your
//      account will be removed in GRACE_DAYS days — sign in to keep it". The
//      notice is written to offboard_notice ONLY after Gmail accepts the
//      mail, so nobody is ever on the clock without having been told.
//   3. REMOVE. A notice past its grace period, whose account is still
//      eligible and still silent, is acted on: offboard_delete re-checks every
//      condition at that moment, clears the two foreign keys that would block
//      the delete, logs it, and deletes the auth user (which cascades). A
//      goodbye mail follows, best effort.
//
// FAIL CLOSED. With no Gmail credentials the sweep sends no notices, and with
// no notice nothing is ever removed — so a worker without mail configured
// cannot delete anyone, only log what it would have told. OFFBOARD_DRY_RUN=1
// does the same with mail configured: it reports the plan and touches nothing.
//
// The plan itself (who gets told, who goes, who waits) is a pure function
// over the candidate rows, so the test pins it without a database.
import { config } from './config.js';
import { db } from './supabase.js';
import { mailConfigured, sendMail, brandedHtml, escapeHtml } from './mail.js';

export const INACTIVE_DAYS = Number(process.env.OFFBOARD_INACTIVE_DAYS || 60);
export const GRACE_DAYS = Number(process.env.OFFBOARD_GRACE_DAYS || 14);
const EVERY_MS = Number(process.env.OFFBOARD_SWEEP_MS || 86400000);
const MAX_NOTICES_PER_RUN = Number(process.env.OFFBOARD_MAX_NOTICES || 200); // Workspace allows ~2,000 mails a day
const DRY_RUN = /^(1|true|yes)$/i.test(process.env.OFFBOARD_DRY_RUN || '');

/** Sort the worklist: who is told today, who is removed today, who waits. */
export function planOffboard(candidates, now = Date.now(), maxNotices = MAX_NOTICES_PER_RUN) {
  const notify = [], remove = [], waiting = [];
  for (const c of candidates) {
    if (!c.noticed_at) notify.push(c);
    else if (Date.parse(c.delete_after) <= now) remove.push(c);
    else waiting.push(c);
  }
  return { notify: notify.slice(0, maxNotices), deferred: Math.max(0, notify.length - maxNotices), remove, waiting };
}

const fmtDate = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' });

export function noticeMail(email, deleteAfterIso, graceDays = GRACE_DAYS) {
  return {
    to: email,
    subject: `Your Drip Fantasy account will be removed on ${fmtDate(deleteAfterIso)}`,
    html: brandedHtml({
      icon: '&#128075;', title: 'Still playing?',
      paras: [
        `We haven&rsquo;t seen <b>${escapeHtml(email)}</b> on Drip Fantasy in a while, and the pilot has a fixed number of spots. If we don&rsquo;t hear from you, this account will be removed on <b>${escapeHtml(fmtDate(deleteAfterIso))}</b> &mdash; ${graceDays} days from now.`,
        'To keep it, just sign in. That&rsquo;s all it takes; nothing else changes.',
        'If you&rsquo;re done with Drip, you don&rsquo;t need to do anything. Leagues you played in keep their results, with your seat shown by team name.',
      ],
      cta: { href: 'https://www.dripfantasy.com/?live=1', label: 'Sign in to keep my account' },
      fine: 'You&rsquo;re getting this because you have a Drip Fantasy account. Reply to this mail if something looks wrong.',
    }),
  };
}

export function goodbyeMail(email) {
  return {
    to: email,
    subject: 'Your Drip Fantasy account has been removed',
    html: brandedHtml({
      icon: '&#128588;', title: 'Thanks for playing',
      paras: [
        `The Drip Fantasy account for <b>${escapeHtml(email)}</b> has been removed after a period of inactivity, as we said it would be. Your personal details are gone; leagues you played in keep their results, with your seat shown by team name.`,
        'If you&rsquo;d like to play again, you can sign up any time &mdash; a spot is yours while there&rsquo;s one open.',
      ],
      cta: { href: 'https://www.dripfantasy.com', label: 'dripfantasy.com' },
    }),
  };
}

/** One pass. Returns a tally; never throws for one account's trouble. */
export async function sweepOffboard({ season = config.season, inactiveDays = INACTIVE_DAYS, graceDays = GRACE_DAYS, dryRun = DRY_RUN, log = () => {}, now = Date.now(), env = process.env } = {}) {
  const out = { season, inactiveDays, graceDays, dryRun, mail: mailConfigured(env), revived: 0, notified: 0, removed: 0, waiting: 0, deferred: 0, errors: [] };
  // 1. CANCEL — nothing to send, so this runs whether or not mail is up.
  if (!dryRun) {
    const { data, error } = await db().rpc('offboard_cancel_revived');
    if (error) out.errors.push(`cancel: ${error.message}`);
    else out.revived = Array.isArray(data) ? data.length : 0;
  }
  const { data: rows, error } = await db().rpc('offboard_candidates', { p_season: season, p_inactive_days: inactiveDays });
  if (error) { out.errors.push(`candidates: ${error.message}`); return out; }
  const plan = planOffboard(rows ?? [], now);
  out.waiting = plan.waiting.length; out.deferred = plan.deferred;
  if (dryRun) {
    out.wouldNotify = plan.notify.map((c) => c.email);
    out.wouldRemove = plan.remove.map((c) => c.email);
    return out;
  }
  if (!out.mail) {
    // FAIL CLOSED: no mail → no notice → no removal.
    log(`offboard: mail not configured — ${plan.notify.length} would be told, ${plan.remove.length} past grace; nothing sent, nothing removed`);
    return out;
  }
  // 2. NOTIFY — the notice is recorded only once the mail is accepted.
  for (const c of plan.notify) {
    try {
      const deleteAfter = new Date(now + graceDays * 86400e3).toISOString();
      await sendMail(noticeMail(c.email, deleteAfter, graceDays), env);
      const { error: e2 } = await db().rpc('offboard_notice_set', { p_uid: c.app_user_id, p_email: c.email, p_grace_days: graceDays });
      if (e2) throw new Error(e2.message);
      out.notified++;
    } catch (e) { out.errors.push(`notify ${c.app_user_id}: ${e.message}`); }
  }
  // 3. REMOVE — the database re-checks everything at the moment it acts.
  for (const c of plan.remove) {
    try {
      const { data: r, error: e3 } = await db().rpc('offboard_delete', { p_uid: c.app_user_id, p_season: season });
      if (e3) throw new Error(e3.message);
      if (!r?.ok) { if (r?.error !== 'revived') out.errors.push(`remove ${c.app_user_id}: ${r?.error}`); else out.revived++; continue; }
      out.removed++;
      await sendMail(goodbyeMail(c.email), env).catch((e) => log(`offboard: goodbye to ${c.email} failed — ${e.message}`));
    } catch (e) { out.errors.push(`remove ${c.app_user_id}: ${e.message}`); }
  }
  return out;
}

// Daily, detached, non-overlapping — the shape poll/declared.js uses. Called
// from the worker's tick; a slow Gmail round never stretches a play tick.
let last = 0;
let inflight = null;
export function sweepOffboardDaily(log = () => {}) {
  if (inflight || Date.now() - last < EVERY_MS) return false;
  last = Date.now();
  inflight = sweepOffboard({ log })
    .then((r) => log(`offboard: ${r.revived} revived, ${r.notified} told, ${r.removed} removed, ${r.waiting} on the clock` + (r.errors.length ? ` — ${r.errors.length} errors: ${r.errors.slice(0, 3).join('; ')}` : '') + (r.dryRun ? ' (dry run)' : '') + (!r.mail ? ' (no mail)' : '')))
    .catch((e) => log('offboard error', e.message))
    .finally(() => { inflight = null; });
  return true;
}
