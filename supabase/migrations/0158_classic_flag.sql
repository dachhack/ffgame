-- 0158: CLASSIC BEHIND A FLAG — the founder turns normie mode on per league.
--
-- 0157 shipped classic as a commissioner switch; the founder's follow-up:
-- "let's feature flag it. I'll turn on normie fantasy availability per
-- league." So availability is an ADMIN lever (settings_json.classic_ok),
-- and the commissioner's DRIP ⇄ CLASSIC choice only unlocks where it's set.
--
-- The gate sits in set_league_game_mode itself — the one write path — so no
-- client can talk its way into classic on an unflagged league. Everything
-- downstream (resolver branch, power-up refusals, board branch) keys off
-- game_mode, which now can't become 'classic' without the flag; leagues
-- already classic when a flag is later cleared stay classic (the founder
-- controls both levers, and yanking a live league's mode mid-season is
-- exactly what the draft-freeze exists to prevent).

-- ── The admin lever ─────────────────────────────────────────────────────────
create or replace function set_league_classic_access(p_league_id uuid, p_on boolean)
  returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then return jsonb_build_object('ok', false, 'error', 'admin only'); end if;
  if p_on is null then return jsonb_build_object('ok', false, 'error', 'on or off'); end if;
  update league set settings_json = coalesce(settings_json, '{}'::jsonb)
      || jsonb_build_object('classic_ok', p_on)
    where id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such league'); end if;
  return jsonb_build_object('ok', true, 'on', p_on);
end $$;

-- ── set_league_game_mode v2 (0157 body + the availability gate) ─────────────
create or replace function set_league_game_mode(p_league_id uuid, p_mode text, p_ppr numeric default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare dstat text;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  if p_mode not in ('drip', 'classic') then
    return jsonb_build_object('ok', false, 'error', 'mode must be drip or classic');
  end if;
  if p_ppr is not null and p_ppr not in (0, 0.5, 1) then
    return jsonb_build_object('ok', false, 'error', 'ppr must be 0, 0.5 or 1');
  end if;
  if p_mode = 'classic' and coalesce((select (settings_json ->> 'classic_ok')::boolean
      from league where id = p_league_id), false) is not true then
    return jsonb_build_object('ok', false, 'error', 'classic mode is not enabled for this league');
  end if;
  select status into dstat from draft where league_id = p_league_id;
  if dstat is not null and dstat <> 'pending' then
    return jsonb_build_object('ok', false, 'error', 'game mode locks once the draft starts');
  end if;
  update league set settings_json = coalesce(settings_json, '{}'::jsonb)
      || jsonb_build_object('game_mode', p_mode)
      || case when p_ppr is null then '{}'::jsonb else jsonb_build_object('ppr', p_ppr) end
    where id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such league'); end if;
  return jsonb_build_object('ok', true, 'mode', p_mode);
end $$;

-- ── league_game_mode v2: report availability so the UIs can hide the pill ───
create or replace function league_game_mode(p_league_id uuid)
  returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  return (select jsonb_build_object('ok', true,
      'mode', coalesce(settings_json ->> 'game_mode', 'drip'),
      'ppr',  coalesce((settings_json ->> 'ppr')::numeric, 1),
      'classic_ok', coalesce((settings_json ->> 'classic_ok')::boolean, false),
      'can_edit', is_admin() or is_league_commish(p_league_id))
    from league where id = p_league_id);
end $$;

grant execute on function set_league_classic_access(uuid, boolean) to authenticated;
