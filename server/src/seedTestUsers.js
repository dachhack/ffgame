// Seed made-up TEST player accounts for the sanitized Drip Test League and link
// each to one of its teams — so you can log in as several different "managers"
// without using real Sleeper handles. Uses the Supabase admin API (service role)
// to mint email+password auth users (email pre-confirmed), then enrolls them onto
// the fake league's rosters as human-controlled teams.
//
// Run from server/ (in the deployed worker):
//   npx tsx src/cli.js seed-test-users
import { db } from './supabase.js';

const PW = 'DripTest!23';
// roster → made-up identity (themed to the team's fake name / 2025 logo). The
// first is the league COMMISSIONER (owns a team AND gets the self-serve CommishDash).
const USERS = [
  { roster: 3, email: 'commish@driptest.app',   name: 'Commish Cassidy', commish: true },
  { roster: 4, email: 'grillmaster@driptest.app', name: 'Grill Master' },
  { roster: 5, email: 'wavydave@driptest.app',  name: 'Wavy Dave' },
  { roster: 6, email: 'chlorinecarl@driptest.app', name: 'Chlorine Carl' },
  { roster: 7, email: 'peanutpete@driptest.app', name: 'Peanut Pete' },
  { roster: 8, email: 'mileagemike@driptest.app', name: 'Mileage Mike' },
];

async function uidByEmail(email) {
  const { data } = await db().from('app_user').select('id').eq('email', email).maybeSingle();
  return data?.id ?? null;
}

export async function seedTestUsers(sleeperLeagueId = 'DRIPTEST-2026', season = '2026') {
  const { data: lg } = await db().from('league').select('id').eq('sleeper_league_id', sleeperLeagueId).eq('season', season).maybeSingle();
  if (!lg) throw new Error(`no league for sleeper_league_id=${sleeperLeagueId} season=${season}`);
  const lid = lg.id;
  const out = [];
  let commishUid = null;
  for (const u of USERS) {
    // Create the auth user (idempotent: reuse the existing one on a re-run).
    let uid = null;
    const { data: created, error } = await db().auth.admin.createUser({
      email: u.email, password: PW, email_confirm: true, user_metadata: { display_name: u.name },
    });
    if (created?.user?.id) uid = created.user.id;
    else uid = await uidByEmail(u.email);
    if (!uid) { console.error(`  ! ${u.email}: ${error?.message ?? 'could not create or find'}`); continue; }

    await db().from('app_user').upsert({ id: uid, email: u.email, display_name: u.name }, { onConflict: 'id' });
    const { error: lmErr } = await db().from('league_membership')
      .update({ app_user_id: uid, enrolled: true, controller: 'human' })
      .eq('league_id', lid).eq('sleeper_roster_id', u.roster);
    if (lmErr) { console.error(`  ! link ${u.email} → roster ${u.roster}: ${lmErr.message}`); continue; }
    if (u.commish) commishUid = uid;
    out.push({ email: u.email, password: PW, name: u.name, roster: u.roster, commish: !!u.commish });
  }
  // Make the made-up commish the league commissioner (unlocks the CommishDash).
  if (commishUid) {
    const { error } = await db().from('league').update({ commissioner_id: commishUid }).eq('id', lid);
    if (error) console.error(`  ! set commissioner_id: ${error.message}`);
  }
  return out;
}
