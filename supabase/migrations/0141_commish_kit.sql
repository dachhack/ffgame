-- 0141: COMMISH KIT — a league note and player flags, for ANY league kind.
--
-- Unlike the native-only transaction machinery, these are commissioner
-- communication tools and work everywhere a league has a commissioner —
-- Sleeper-synced pilot leagues included, because that is where the need
-- showed up first (a commish mid-slate wanting to tell the league "practice
-- week is reopened" or pin "ruled ineligible" on a player).
--
--   • LEAGUE NOTE: one standing announcement per league, stored in
--     settings_json.commish_note as {text, at}. One, deliberately — a note
--     you must overwrite stays current; a note feed rots. Members read it on
--     the board; the commissioner edits it in place there.
--   • PLAYER FLAGS: a short label pinned on a player, league-visible wherever
--     that player is picked (pool rows, pickers, the player card). Free text,
--     40 chars — "keeper", "out for season", "ineligible wk 102" — because
--     the commissioner's reasons are not enumerable.
--
-- Slugs are NOT validated against a pool table: Sleeper leagues have no
-- league_pool rows, and a flag on an unknown slug renders nowhere — harmless
-- by construction, and only a commissioner can write one.

create table if not exists player_flag (
  league_id  uuid not null references league(id) on delete cascade,
  slug       text not null,
  label      text not null,
  created_at timestamptz not null default now(),
  primary key (league_id, slug)
);
alter table player_flag enable row level security;
drop policy if exists player_flag_read on player_flag;
create policy player_flag_read on player_flag for select using (is_league_member(league_id));

-- The note. Empty/null text clears it — "make it so" semantics.
create or replace function set_league_note(p_league_id uuid, p_text text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare txt text := nullif(btrim(coalesce(p_text, '')), '');
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if txt is not null and length(txt) > 500 then
    return jsonb_build_object('ok', false, 'error', 'keep the note under 500 characters');
  end if;
  update league set settings_json = coalesce(settings_json, '{}'::jsonb)
      || case when txt is null then jsonb_build_object('commish_note', null)
              else jsonb_build_object('commish_note', jsonb_build_object('text', txt, 'at', now())) end
    where id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such league'); end if;
  return jsonb_build_object('ok', true, 'text', txt);
end $$;

-- The note + whether the caller may edit it, one round trip for the banner.
create or replace function league_note(p_league_id uuid)
  returns jsonb language plpgsql stable security definer set search_path = public as $$
declare n jsonb;
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select settings_json -> 'commish_note' into n from league where id = p_league_id;
  return jsonb_build_object('ok', true,
    'text', case when jsonb_typeof(n) = 'object' then n ->> 'text' end,
    'at',   case when jsonb_typeof(n) = 'object' then n ->> 'at' end,
    'can_edit', is_admin() or is_league_commish(p_league_id));
end $$;

-- Pin / re-label / clear a flag. Empty label deletes.
create or replace function set_player_flag(p_league_id uuid, p_slug text, p_label text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lbl text := nullif(btrim(coalesce(p_label, '')), '');
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if p_slug is null or btrim(p_slug) = '' then
    return jsonb_build_object('ok', false, 'error', 'which player?');
  end if;
  if lbl is null then
    delete from player_flag where league_id = p_league_id and slug = p_slug;
    return jsonb_build_object('ok', true, 'on', false);
  end if;
  if length(lbl) > 40 then
    return jsonb_build_object('ok', false, 'error', 'keep the flag under 40 characters');
  end if;
  insert into player_flag (league_id, slug, label) values (p_league_id, p_slug, lbl)
    on conflict (league_id, slug) do update set label = excluded.label, created_at = now();
  return jsonb_build_object('ok', true, 'on', true, 'label', lbl);
end $$;

-- Every flag in the league (any member).
create or replace function player_flags(p_league_id uuid)
  returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'slug', f.slug, 'label', f.label, 'created_at', f.created_at) order by f.created_at desc)
    from player_flag f where f.league_id = p_league_id), '[]'::jsonb);
end $$;

grant execute on function set_league_note(uuid, text) to authenticated;
grant execute on function league_note(uuid) to authenticated;
grant execute on function set_player_flag(uuid, text, text) to authenticated;
grant execute on function player_flags(uuid) to authenticated;
