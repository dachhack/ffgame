-- 0233: a lock is final, a rookie term is law
--
-- Founder, over a commissioner's cap sheet where every deal — locked seats
-- and rookies included — still wore live LENGTH chips: "once you lock
-- contracts, you shouldn't be able to change the terms. Rookies should get
-- four years and not be adjustable."
--
-- Two rules become ABSOLUTE in set_contract_years, ahead of every role:
-- a rookie deal's term is never assignable (0232 refused owners; the
-- commissioner bypass let the chips through anyway), and a LOCKED seat's
-- lengths are final — commissioner and admin included. The commissioner's
-- pen still works where it should: unlocked, non-rookie deals before the
-- deadline.
--
-- And the backfill the founder's own league needs: deals signed before
-- 0232 filed auction-won rookies as veterans. Every contract whose player
-- is in his rookie season (pool exp = 0) and was acquired at auction or
-- draft is re-filed as a rookie deal at the league's rookie term.

create or replace function set_contract_years(p_league_id uuid, p_slug text, p_years int)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare c contract%rowtype; d draft%rowtype; is_owner boolean;
begin
  select * into c from contract where league_id = p_league_id and slug = p_slug;
  if not found then return jsonb_build_object('ok', false, 'error', 'no contract for that player'); end if;
  if p_years is null or p_years < 1 or p_years > contract_years_max(p_league_id) then
    return jsonb_build_object('ok', false, 'error', 'length must be 1–' || contract_years_max(p_league_id) || ' years');
  end if;
  select * into d from draft where league_id = p_league_id;
  is_owner := exists (select 1 from league_membership m
    where m.league_id = p_league_id and m.sleeper_roster_id = c.roster_id
      and m.app_user_id = auth.uid() and m.enrolled);
  -- 0233: two ABSOLUTE rules, ahead of every role (founder: "once you lock
  -- contracts, you shouldn't be able to change the terms. Rookies should get
  -- four years and not be adjustable"). The commissioner's pen works only on
  -- UNLOCKED, non-rookie deals before the deadline — a lock is a lock.
  if c.acquired = 'rookie' then
    return jsonb_build_object('ok', false, 'error', 'rookie deals run the league''s rookie term — the length isn''t assignable');
  end if;
  if d.status = 'complete' and (
    coalesce((select contracts_locked from league_membership
              where league_id = p_league_id and sleeper_roster_id = c.roster_id), false)
    or now() >= _contract_lock_deadline(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'this team''s lengths are locked — a lock is final');
  end if;
  if is_admin() or is_league_commish(p_league_id) then
    null;  -- the commissioner may correct any UNLOCKED deal
  elsif not is_owner then
    return jsonb_build_object('ok', false, 'error', 'not your contract');
  elsif false and (
    -- 0229: the room closing no longer slams the window — the OWNER's own
    -- 🔒 lock does (or the league deadline). Until then, lengths are theirs.
    coalesce((select contracts_locked from league_membership
              where league_id = p_league_id and sleeper_roster_id = c.roster_id), false)
    or now() >= _contract_lock_deadline(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'lengths are locked — ask your commissioner');
  end if;
  update contract set years = p_years where league_id = p_league_id and slug = p_slug;
  return jsonb_build_object('ok', true, 'slug', p_slug, 'years', p_years);
end $$;

-- Re-file pre-0232 auction/draft-won rookies as rookie deals at the term.
update contract c
set acquired = 'rookie',
    years = least(rookie_contract_years(c.league_id), contract_years_max(c.league_id))
from league_pool lp
where lp.league_id = c.league_id and lp.slug = c.slug and lp.exp = 0
  and c.acquired in ('auction', 'draft');
