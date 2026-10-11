-- 0477: PRIZES AND DUES ON THE SETTINGS AND THE BOARD (v0.675.0). HANDOFF's
-- fifth not-done item: "Prizes and dues on the settings and the board (the
-- listing has a text field only)." Dues already had a home (0320:
-- settings.dues_amount / dues_note and the per-seat tracker, any
-- commissioner's); the board listing carried its own free-text line and
-- nothing knew about prizes. Now:
--
--   • set_league_prizes: a list of places and what each wins
--     ({label, prize}, up to eight, free text), kept in settings.prizes;
--     the league hears the list in chat.
--   • _bullseye_info carries the dues and the prizes, so a contest league's
--     own screens (SETTINGS, the hub) show the money.
--   • league_board carries the prizes, and falls back to the league's dues
--     setting when the listing's line is blank — the platform prints it,
--     never collects it (0223).

create or replace function _league_prizes(lg league) returns jsonb
  language sql immutable as $$
  select case when jsonb_typeof(lg.settings_json -> 'prizes') = 'array' then lg.settings_json -> 'prizes' else '[]'::jsonb end;
$$;
create or replace function _league_dues_word(lg league) returns text
  language sql immutable as $$
  select case when nullif(lg.settings_json ->> 'dues_amount', '') is null then null
              else '$' || (lg.settings_json ->> 'dues_amount') || coalesce(' — ' || nullif(lg.settings_json ->> 'dues_note', ''), '') end;
$$;
revoke all on function _league_prizes(league), _league_dues_word(league) from public, anon, authenticated;

create or replace function set_league_prizes(p_league_id uuid, p_prizes jsonb) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare rows jsonb; line text;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then return jsonb_build_object('ok', false, 'error', 'commissioner only'); end if;
  if p_prizes is null or jsonb_typeof(p_prizes) <> 'array' then
    return jsonb_build_object('ok', false, 'error', 'prizes are a list: a place and what it wins');
  end if;
  if jsonb_array_length(p_prizes) > 8 then return jsonb_build_object('ok', false, 'error', 'up to eight prizes'); end if;
  select coalesce(jsonb_agg(jsonb_build_object('label', left(btrim(e ->> 'label'), 40), 'prize', left(btrim(e ->> 'prize'), 60)) order by ord), '[]'::jsonb)
    into rows
    from jsonb_array_elements(p_prizes) with ordinality t(e, ord)
   where nullif(btrim(coalesce(e ->> 'label', '')), '') is not null and nullif(btrim(coalesce(e ->> 'prize', '')), '') is not null;
  update league set settings_json = coalesce(settings_json, '{}'::jsonb) || jsonb_build_object('prizes', rows) where id = p_league_id;
  if jsonb_array_length(rows) > 0 then
    select string_agg((e ->> 'label') || ' — ' || (e ->> 'prize'), ' · ' order by ord) into line
      from jsonb_array_elements(rows) with ordinality t(e, ord);
    perform _chat_house(p_league_id, '🏆 Prizes: ' || line, jsonb_build_object('kind', 'prizes'));
  end if;
  return jsonb_build_object('ok', true, 'prizes', rows);
end $$;
revoke all on function set_league_prizes(uuid, jsonb) from public, anon;
grant execute on function set_league_prizes(uuid, jsonb) to authenticated;

-- _bullseye_info — 0475's body, plus the money.
create or replace function _bullseye_info(lg league) returns jsonb
  language sql stable security definer set search_path = public as $$
  select case when _is_contest(lg) then jsonb_build_object(
    'contest', _contest_of(lg),
    'format', _contest_format_of(lg),
    'budget', _contest_budget(lg),
    'min_spend', _contest_min_spend(lg),
    'auto_sub', coalesce((lg.settings_json ->> 'auto_sub')::boolean, false),
    'late_entry', _contest_late_entry(lg),
    'entry_deadline', _contest_entry_deadline(lg),
    'dues_amount', nullif(lg.settings_json ->> 'dues_amount', '')::int,
    'dues_note', lg.settings_json ->> 'dues_note',
    'prizes', _league_prizes(lg),
    'variant', coalesce(lg.settings_json ->> 'bullseye', 'slots'),
    'radius', coalesce((lg.settings_json ->> 'bullseye_radius')::int, 10),
    'span', case when lg.contest_week is null then 'season' else 'week' end,
    'week', lg.contest_week,
    'max_seats', coalesce(_bullseye_max_seats(lg), (select count(*)::int from league_membership m where m.league_id = lg.id)),
    'seats_taken', _league_seats_taken(lg.id),
    'spots', jsonb_array_length(_contest_slots(lg)))
  else null end;
$$;

-- league_board — 0463's body, plus the prizes and the dues fallback.
create or replace function league_board()
  returns jsonb language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  if auth.uid() is null then return jsonb_build_object('error', 'not signed in'); end if;
  select coalesce(jsonb_agg(r), '[]'::jsonb) into result from (
    select jsonb_build_object(
      'league_id', l.id, 'name', l.name, 'season', l.season, 'avatar_url', l.avatar_url,
      'kind', l.kind, 'bullseye', _bullseye_info(l),
      'blurb', li.blurb, 'dues', coalesce(li.dues, _league_dues_word(l)), 'prizes', _league_prizes(l), 'posted_at', li.updated_at,
      'seats_total', case when l.kind = 'bullseye' then _bullseye_max_seats(l)
                          else (select count(*) from league_membership m where m.league_id = l.id) end,
      'seats_open',  _league_seats_open(l.id),
      'draft_status', coalesce((select d.status from draft d where d.league_id = l.id), 'pending'),
      'draft_mode',   coalesce((select d.mode from draft d where d.league_id = l.id), 'snake'),
      'identity', _league_identity(l.id),
      'mine',    exists (select 1 from league_membership m
                          where m.league_id = l.id and m.app_user_id = auth.uid() and m.enrolled),
      'commish', l.commissioner_id = auth.uid()
    ) as r
    from league_listing li
    join league l on l.id = li.league_id
    where li.open
      and _league_seats_open(l.id) > 0
      and not (l.kind = 'bullseye' and l.contest_week is not null
               and coalesce(_week_first_lock(l.season, l.contest_week) <= now(), false))
    order by li.updated_at desc
  ) t;
  return result;
end $$;
