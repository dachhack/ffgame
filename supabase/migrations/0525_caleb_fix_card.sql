-- 0525 · THE FIX CARD FOR CALEB'S BUFFS (v0.734.0, #1417)
--
-- Founder: "Post the fix card in Gridiron Gang chat". The question was asked
-- in the league chat without @computer ("do the buffs i apply to caleb not
-- work if he gets subbed into another window?"), so there is no ask for the
-- relay or ops computer-recard to post from. This posts the same Computer
-- card line the relay would (league_message kind 'computer', the report in
-- txn.fix), from #1417's chat-summary / chat-report. Once only.
do $$
declare lid uuid := '798acff0-e0bb-4e11-9e1b-4a3bb29525bd';
        head text := 'Fixed (#1417). Double or Nothing and Grudge played on a backup did nothing when he subbed into another spot.';
begin
  if not exists (select 1 from league where id = lid and name = 'Gridiron Gang') then
    raise notice '0525: Gridiron Gang not found — nothing to do'; return;
  end if;
  if exists (select 1 from league_message where league_id = lid and kind = 'computer' and body = head) then
    raise notice '0525: card already posted'; return;
  end if;
  insert into league_message (league_id, author_id, kind, body, mentions, txn)
  values (lid, null, 'computer', head, '{}', jsonb_build_object('fix', jsonb_build_object(
    'issue', 1417, 'pr', 1417, 'url', 'https://github.com/dachhack/ffgame/pull/1417',
    'report', 'What was wrong: Caleb Williams'' Thursday spot had no opponent, so he played as a backup and his points moved to the Sunday night spot, but his Double or Nothing and Grudge stayed behind on the empty spot and did nothing. How it was fixed: buffs played on a backup now go with him to the spot he covers, so they settle there — including this week.')));
  raise notice '0525: card posted in Gridiron Gang chat';
end $$;
