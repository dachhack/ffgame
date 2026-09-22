-- ═══════════════════════════════════════════════════════════════════════════
-- 0346 · THE RUN SHEET HOLDS STILL — the waiver report stops shuffling itself
--
-- 0344 orders the detailed run sheet `order by wc.id`, with a comment saying
-- "`id` is the order `process_waivers` walks, so the report reads the way the
-- run ran." Both halves of that are wrong. `waiver_claim.id` is a
-- `gen_random_uuid()`, so ordering by it is ordering by dice: the same run,
-- opened twice, lists its winners and losers in two different orders. And
-- `process_waivers` walks by
--
--     (faab ? -bid : 0), (standings ? rank : 0), waiver_priority,
--     group_seq, created_at
--
-- which has nothing to do with the primary key at all.
--
-- It was the probes that caught it, by being flaky rather than by being red —
-- wr3 failed on one assertion on a clean database and a different one on a
-- dirty database, which is the signature of an ORDER that is not one.
--
-- WHAT THIS ORDERS BY, AND WHAT IT DOES NOT PRETEND. The run's own walk cannot
-- be replayed after the fact: two of its five keys are gone. `waiver_priority`
-- is rotated BY the run — the winners go to the back the moment they win — and
-- `standings` rank moves every week. Reconstructing them would be a guess
-- dressed as a record.
--
-- So the sheet sorts by what is still true and still the point: in a FAAB
-- league the bid, high to low, which IS the run's first key and the only one a
-- manager reads the sheet to compare; everywhere else the filing time, which
-- is the run's last key and the only visible order a rolling league has.
-- Then roster, then group sequence, and `id` last — not as an order but as a
-- tiebreak, so two identical claims can never swap places between two views.
--
-- The wire ('order') was already deterministic and is re-emitted untouched.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function league_waiver_run(p_league_id uuid, p_at timestamptz)
  returns jsonb language plpgsql stable security definer set search_path = public as $$
declare ran timestamptz; mode text;
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if p_at is null then return jsonb_build_object('ok', false, 'error', 'no instant'); end if;

  -- NOT EQUALITY (0344). The chat line's created_at and the claims'
  -- processed_at are the same now() inside one transaction, but that timestamp
  -- travels out as text and back as a parameter, and a rule that needs the
  -- round trip to be byte-exact fails silently into an empty sheet. Nearest
  -- run within five seconds.
  select wc.processed_at into ran from waiver_claim wc
   where wc.league_id = p_league_id and wc.processed_at is not null
     and wc.processed_at between p_at - interval '5 seconds' and p_at + interval '5 seconds'
   order by abs(extract(epoch from (wc.processed_at - p_at)))
   limit 1;
  if ran is null then
    return jsonb_build_object('ok', true, 'found', false, 'at', p_at,
      'won', '[]'::jsonb, 'lost', '[]'::jsonb, 'order', '[]'::jsonb);
  end if;
  mode := league_waiver_mode(p_league_id);

  return jsonb_build_object('ok', true, 'found', true, 'at', ran, 'mode', mode,
    -- WHAT THE RUN DID. Bids high-to-low where there are bids, filing time
    -- where there are not — see the header for why this is not, and does not
    -- claim to be, a replay of the run's own walk.
    'won', coalesce((select jsonb_agg(jsonb_build_object(
        'roster_id', wc.roster_id, 'team', _txn_team(p_league_id, wc.roster_id),
        'add_slug', wc.add_slug, 'add', _txn_player(p_league_id, wc.add_slug),
        'drop_slug', wc.drop_slug,
        'drop', case when wc.drop_slug is null then null else _txn_player(p_league_id, wc.drop_slug) end,
        -- The bid only means anything in a FAAB league; elsewhere every claim
        -- carries a 0 that would read as "bid nothing" rather than "no bids".
        'bid', case when mode = 'faab' then wc.bid else null end,
        'group_id', wc.group_id, 'group_seq', wc.group_seq, 'group_max', wc.group_max)
        order by case when mode = 'faab' then -wc.bid else 0 end,
                 wc.created_at, wc.roster_id, wc.group_seq nulls last, wc.id)
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
        order by case when mode = 'faab' then -wc.bid else 0 end,
                 wc.created_at, wc.roster_id, wc.group_seq nulls last, wc.id)
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
