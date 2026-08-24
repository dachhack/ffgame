-- 0232: an auction can win a rookie, not age him
--
-- Founder, over Jordyn Tyson at $1·1yr with LENGTH chips live: "Tyson is a
-- rookie, his contract should be set at 4 years and not changeable."
--
-- The rookie term (0231) only fired in rookie DRAFTS — a rookie won at the
-- startup auction signed like a veteran: manager-set length, taggable,
-- extendable. Now the originate trigger checks the pool's own exp column
-- (0 = rookie season, the tenure filters' data) on every auction-priced
-- pick: a rookie signs at his BID (the auction priced him) but on a ROOKIE
-- deal — the league's rookie term, length fixed by rule, exactly like a
-- rookie-draft pick. Unknown experience stays a veteran deal: the rule
-- needs evidence, not absence. set_contract_years' refusal now names the
-- rule instead of the scale.

create or replace function _contract_originate() returns trigger
  language plpgsql security definer set search_path = public as $$
declare sal int; yrs int := 1; how text; pk record; seas text; d draft%rowtype;
begin
  if not contracts_on(new.league_id) then return new; end if;
  -- Rollover carriage owns 'keeper' rows: the carried deal (real salary,
  -- real years) is inserted by rollover_league right after these rows land.
  -- A $1 street deal here would squat on that slot.
  if new.acquired = 'keeper' then return new; end if;
  select season into seas from league where id = new.league_id;
  if new.acquired = 'draft' then
    select * into d from draft where league_id = new.league_id;
    select price, round into pk from draft_pick
      where league_id = new.league_id and slug = new.slug
      order by overall desc limit 1;
    if pk.price is not null then
      sal := greatest(1, pk.price); how := 'auction';           -- the bid IS the salary
      -- 0232 (founder: "Tyson is a rookie, his contract should be set at 4
      -- years and not changeable"): a startup auction can WIN a rookie, but
      -- it cannot make him a veteran. exp = 0 in the pool marks his rookie
      -- season, and his deal signs like every rookie deal — at the league's
      -- rookie term, length fixed by rule, priced at the bid (the auction
      -- said what he costs; the rule says how long he's held). An unknown
      -- exp stays a veteran deal — the rule needs evidence, not absence.
      if coalesce((select lp.exp from league_pool lp
                   where lp.league_id = new.league_id and lp.slug = new.slug), 99) = 0 then
        how := 'rookie';
        yrs := least(rookie_contract_years(new.league_id), contract_years_max(new.league_id));
      end if;
    else
      sal := contract_rookie_scale(coalesce(pk.round, 99));     -- scale by round
      how := case when d.pick_owners is not null then 'rookie' else 'draft' end;
      -- 0231: rookie deals run the league's own term — default 4, the NFL's
      -- real rookie-contract length, commissioner-settable in 📜 SALARY.
      if how = 'rookie' then yrs := least(rookie_contract_years(new.league_id), contract_years_max(new.league_id)); end if;
    end if;
  elsif new.acquired = 'waiver' then
    select greatest(1, coalesce(bid, 0)) into sal from waiver_claim
      where league_id = new.league_id and roster_id = new.roster_id
        and add_slug = new.slug and status in ('pending', 'won')
      order by created_at desc limit 1;
    sal := coalesce(sal, 1); how := 'waiver';                   -- the FAAB bid, else the $1 min
  elsif new.acquired = 'fa' then
    sal := 1; how := 'fa';
  else
    sal := 1; how := 'commish';
  end if;
  insert into contract (league_id, slug, roster_id, salary, years, acquired, start_season)
  values (new.league_id, new.slug, new.roster_id, sal, yrs, how, coalesce(seas, ''))
  on conflict (league_id, slug) do update
    set roster_id = excluded.roster_id;
  return new;
end $$;

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
  if is_admin() or is_league_commish(p_league_id) then
    null;  -- the commissioner may always correct a deal
  elsif not is_owner then
    return jsonb_build_object('ok', false, 'error', 'not your contract');
  elsif c.acquired = 'rookie' then
    return jsonb_build_object('ok', false, 'error', 'rookie deals run the league''s rookie term — the length isn''t assignable');
  elsif found and d.status = 'complete' and (
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
