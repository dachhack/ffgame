-- 0187 — THE COMMISSIONER CAN RENAME THE LEAGUE
--
-- Founder: "We do need a way for commish to change the name and avatar for the
-- league." The crest already had a setter (set_league_avatar, 0134-era); the
-- NAME had none at all — it was whatever create_native_league was handed, and
-- a typo at creation was permanent for everybody.
--
-- Same auth and shape as set_league_avatar, which is the function this stands
-- beside: commissioner or admin, one column, the stored value returned so the
-- caller renders what the server kept rather than what it hoped for.
create or replace function set_league_name(p_league_id uuid, p_name text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare n text;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  -- Collapse inner runs of whitespace too: a name is a label on a chip and a
  -- header, and "Turf    Warriors" wrecks both without ever looking deliberate.
  n := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  if length(n) < 2 then
    return jsonb_build_object('ok', false, 'error', 'the league needs a name — at least 2 characters');
  end if;
  if length(n) > 60 then
    return jsonb_build_object('ok', false, 'error', 'that name is too long — 60 characters at most');
  end if;
  update league set name = n where id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'league not found'); end if;
  return jsonb_build_object('ok', true, 'name', n);
end $$;

grant execute on function set_league_name(uuid, text) to authenticated;
