-- ═══════════════════════════════════════════════════════════════════════════
-- 0344 · THE WAIVER RUN OPENS UP
--
-- Founder: "can we have the daily waiver report be clickable in chat and open
-- a detailed report?"
--
-- 0290 posts one line when the run settles — "📋 Waivers ran — Team A won
-- Josh Allen ($14), dropping X; Team B won … · Missed: …" — and that line is
-- `left(btrim(body), 500)`. A quiet Tuesday fits. A busy Wednesday does not:
-- an eight-team FAAB run with drops and reasons runs past 500 characters and
-- the rest is simply gone, which is the worst possible place to truncate —
-- the end of the list is where the losers and their reasons are, and "why
-- didn't I get him" is the only question a waiver report exists to answer.
--
-- So the line stays a line and gains a door. This is what is behind it.
--
-- NO CHANGE TO `process_waivers`, deliberately. The run's instant is already
-- recoverable: every claim it settles is stamped `processed_at = now()`, the
-- chat line is inserted in the SAME transaction, and `now()` is fixed for a
-- transaction — so the message's `created_at` IS the run's `processed_at`.
-- Re-emitting a function that big to add a key it does not need would be
-- the riskier change, not the safer one.
--
-- MATCHED ON THE NEAREST INSTANT, not on equality. The two timestamps agree to
-- the microsecond in the database, but they travel out through PostgREST as
-- text and back as a parameter, and a rule that depends on a string surviving
-- that round trip byte for byte is a rule that will one day fail silently and
-- show an empty report. The window is ±5 seconds and the nearest run inside it
-- wins; two runs of one league cannot be five seconds apart, since each is a
-- transaction that settles every due claim.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function league_waiver_run(p_league_id uuid, p_at timestamptz) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare ran timestamptz; mode text;
begin
  -- A member's door. The run is league news — every claim in it has already
  -- been announced in chat — so this is the SAME audience, in more detail.
  -- Still gated: a league's wire is not public, and pending claims (which this
  -- never returns) are not even league-public.
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if p_at is null then return jsonb_build_object('ok', false, 'error', 'which run?'); end if;

  select wc.processed_at into ran
    from waiver_claim wc
   where wc.league_id = p_league_id
     and wc.processed_at between p_at - interval '5 seconds' and p_at + interval '5 seconds'
   order by abs(extract(epoch from wc.processed_at - p_at))
   limit 1;
  if ran is null then
    -- The run settled nothing this league still holds a claim row for, or the
    -- rows have been cleaned up. Say so rather than drawing an empty sheet
    -- that looks like a run in which nobody won anything.
    return jsonb_build_object('ok', true, 'at', null, 'found', false,
      'won', '[]'::jsonb, 'lost', '[]'::jsonb);
  end if;
  mode := league_waiver_mode(p_league_id);

  return jsonb_build_object('ok', true, 'found', true, 'at', ran, 'mode', mode,
    -- WHAT THE RUN DID, in the order it decided — `id` is the order
    -- `process_waivers` walks, so the report reads the way the run ran.
    'won', coalesce((select jsonb_agg(jsonb_build_object(
        'roster_id', wc.roster_id, 'team', _txn_team(p_league_id, wc.roster_id),
        'add_slug', wc.add_slug, 'add', _txn_player(p_league_id, wc.add_slug),
        'drop_slug', wc.drop_slug,
        'drop', case when wc.drop_slug is null then null else _txn_player(p_league_id, wc.drop_slug) end,
        -- The bid only means anything in a FAAB league; elsewhere every claim
        -- carries a 0 that would read as "bid nothing" rather than "no bids".
        'bid', case when mode = 'faab' then wc.bid else null end,
        'group_id', wc.group_id, 'group_seq', wc.group_seq, 'group_max', wc.group_max)
        order by wc.id)
      from waiver_claim wc
     where wc.league_id = p_league_id and wc.processed_at = ran and wc.status = 'won'), '[]'::jsonb),
    -- AND WHY THE REST DID NOT. This is the half the 500-character line loses
    -- first and the half a manager actually opens the report for. `note` is
    -- the reason `process_waivers` recorded — outbid, roster full, no budget,
    -- a linked group that could not complete, and the rest.
    'lost', coalesce((select jsonb_agg(jsonb_build_object(
        'roster_id', wc.roster_id, 'team', _txn_team(p_league_id, wc.roster_id),
        'add_slug', wc.add_slug, 'add', _txn_player(p_league_id, wc.add_slug),
        'drop_slug', wc.drop_slug,
        'drop', case when wc.drop_slug is null then null else _txn_player(p_league_id, wc.drop_slug) end,
        'bid', case when mode = 'faab' then wc.bid else null end,
        'why', coalesce(nullif(wc.note, ''), 'lost'),
        'group_id', wc.group_id, 'group_seq', wc.group_seq, 'group_max', wc.group_max)
        order by wc.id)
      from waiver_claim wc
     where wc.league_id = p_league_id and wc.processed_at = ran and wc.status = 'lost'), '[]'::jsonb),
    -- THE WIRE AFTER THE RUN: who is up next, and what everyone has left to
    -- spend. It is the other question a run produces — "where am I now?" — and
    -- it is one read of a table the claim rows cannot answer.
    'order', coalesce((select jsonb_agg(jsonb_build_object(
        'roster_id', lm.sleeper_roster_id, 'team', _txn_team(p_league_id, lm.sleeper_roster_id),
        'priority', lm.waiver_priority,
        'faab', case when mode = 'faab' then lm.faab_budget else null end)
        order by lm.waiver_priority nulls last, lm.sleeper_roster_id)
      from league_membership lm where lm.league_id = p_league_id), '[]'::jsonb));
end $$;
grant execute on function league_waiver_run(uuid, timestamptz) to authenticated;
