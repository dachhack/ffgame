-- 0294: RE-SAVING THE COMBO DRIP YOU ALREADY FIELDED IS NOT FIELDING A SECOND
-- (v0.418.0).
--
-- Founder, a week after v0.394.2–4 named the slot and swept the orphans, over
-- a board with exactly one Combo Drip on it: "Still this error." The banner:
-- "NOT SAVED — SUN 1PM · 1: Combo Drip is one per unlock — you own 1, buy
-- another to field more."
--
-- The database held ONE combodrip row, at SUN 1PM · 1. The row being refused
-- was that same row, sent again. The live boards autosave the WHOLE lineup
-- after every edit as one upsert (INSERT … ON CONFLICT DO UPDATE on the slot
-- key), and Postgres fires a row's BEFORE INSERT trigger on the PROPOSED row
-- BEFORE it discovers the conflict — with a freshly minted id, since the
-- default has already run. enforce_single_combodrip excluded "the row I am"
-- by `sp.id is distinct from new.id`, which on that path excludes nothing:
-- the saved row at the same slot has a different id, so it was counted as a
-- second Combo Drip and the manager was told to buy another to keep the one
-- he had. Every autosave after the first refused it, forever, and the
-- row-by-row retry (v0.394.2) refused it again for the same reason.
--
-- v0.394.3 read the same banner and found a real orphan behind it, fixed
-- that, and stopped — the orphan was true and was not the whole story. This
-- is the shape underneath: the row a write REPLACES is the one at the same
-- (matchup, user, window, slot), which is the upsert's conflict key, not the
-- one with the same id. The metric-swap path in apply_targeted has always
-- excluded by slot for exactly this reason; the trigger now does too. `id`
-- stays in the exclusion for the plain UPDATE path, where it is right.
--
-- Same wiring as 0061/0062 (before insert or update, per row); body v3.

create or replace function enforce_single_combodrip() returns trigger
  language plpgsql security definer set search_path = public as $$
declare have int; q int;
begin
  if new.metric_id is distinct from 'combodrip' then return new; end if;
  if tg_op = 'UPDATE' and new.metric_id is not distinct from old.metric_id then return new; end if;
  select count(*) into have from sealed_pick sp
    where sp.matchup_id = new.matchup_id and sp.app_user_id = new.app_user_id
      and sp.metric_id = 'combodrip'
      and sp.id is distinct from new.id
      -- The row this write lands on. On an upsert the BEFORE INSERT trigger
      -- runs before the conflict is found, so `new.id` is a fresh default and
      -- the saved row at this slot would otherwise count against itself.
      and not (sp.game_window = new.game_window and sp.roster_slot = new.roster_slot);
  q := coalesce(combo_qty(new.matchup_id, new.app_user_id), 0);
  if have >= q then
    raise exception 'Combo Drip is one per unlock — you own %, buy another to field more', q
      using errcode = 'check_violation';
  end if;
  return new;
end $$;
