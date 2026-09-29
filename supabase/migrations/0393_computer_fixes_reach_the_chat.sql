-- 0393 · @COMPUTER FIXES REACH THE CHAT (v0.562.0)
--
-- Founder: "yes, post fixes to the league chat too." An ask filed from chat
-- (0363) is answered on its GitHub issue; the league never heard. The worker
-- now relays the issue's closing note into the chat it was asked in
-- (server/src/computer.js relayFixes) — once, which this column remembers.
alter table computer_ask add column if not exists relayed_at timestamptz;
