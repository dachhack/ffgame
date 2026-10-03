-- ═══════════════════════════════════════════════════════════════════════════
-- 0416 · A COMPUTER LINE MAY CARRY A PAYLOAD (the closed-issue card's report).
--
-- 0290 tied txn to kind 'txn' both ways: check ((kind = 'txn') = (txn is not
-- null)). The closed-issue card (0415, v0.598.0) keeps its report in txn.fix
-- on a 'computer' line, so every card insert was refused. The first one
-- seen: ops 027 rewriting #1095's line in Kickoff League. A txn line still
-- needs its payload; text, poll and report lines still can't have one.
-- ═══════════════════════════════════════════════════════════════════════════
alter table league_message drop constraint if exists league_message_txn_check;
alter table league_message add constraint league_message_txn_check
  check ((kind <> 'txn' or txn is not null) and (txn is null or kind in ('txn', 'computer')));
