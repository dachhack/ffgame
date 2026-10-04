-- ═══════════════════════════════════════════════════════════════════════════
-- 0406 · THE DEVY PLAYER CARD.
--
-- Founder: "Let's make player cards for the devy players with previous season
-- stats and game logs for current season and any other eval info or news."
--
-- The card reads ESPN directly for what changes by the game (bio, every
-- college season, the season's game log, news — all CORS-open, fetched when
-- the card opens). What it needs from us is the evaluation and the market:
--   · stathead_devy.card — StatHead's devy profile for the player, as its
--     board publishes it (composite and its model's ranks, NFL career
--     projection, breakout age, dominator, recruiting stars, the rookie-draft
--     slot he prices as). StatHead numbers only: the third-party fields on
--     its board (marketListed, pListed) are not stored.
--   · college_player_card(espn_id) — identity, the devy market price and
--     price rank, StatHead's card, and our own season lines as a fallback
--     when ESPN can't be reached.
-- ═══════════════════════════════════════════════════════════════════════════

alter table stathead_devy add column if not exists card jsonb;

create or replace function upsert_stathead_devy(p_rows jsonb, p_as_of timestamptz) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if auth.uid() is not null and not is_admin() then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  insert into stathead_devy (espn_id, name, pos, rank_1qb, rank_sf, value_1qb, value_sf, draft_year, card, as_of)
  select e ->> 'espn_id', e ->> 'name', upper(e ->> 'pos'), (e ->> 'rank_1qb')::int,
         nullif(e ->> 'rank_sf', '')::int, nullif(e ->> 'value_1qb', '')::numeric, nullif(e ->> 'value_sf', '')::numeric,
         nullif(e ->> 'draft_year', '')::int,
         case when jsonb_typeof(e -> 'card') = 'object' then e -> 'card' end,
         p_as_of
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) e
   where (e ->> 'espn_id') ~ '^[0-9]+$' and (e ->> 'rank_1qb') ~ '^[0-9]+$'
  on conflict (espn_id) do update set name = excluded.name, pos = excluded.pos, rank_1qb = excluded.rank_1qb,
      rank_sf = excluded.rank_sf, value_1qb = excluded.value_1qb, value_sf = excluded.value_sf,
      draft_year = excluded.draft_year, card = coalesce(excluded.card, stathead_devy.card), as_of = excluded.as_of;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'rows', n);
end $$;

create or replace function college_player_card(p_espn_id text) returns jsonb
  language sql stable security definer set search_path = public as $$
  select case
    when auth.uid() is null then jsonb_build_object('ok', false, 'error', 'sign in')
    when not exists (select 1 from college_player where espn_id = p_espn_id)
      then jsonb_build_object('ok', false, 'error', 'no such college player')
    else (select jsonb_build_object('ok', true,
      'espn_id', cp.espn_id, 'slug', 'c-' || cp.espn_id, 'name', cp.full_name, 'pos', cp.pos,
      'school', cp.school, 'school_abbr', cp.school_abbr, 'class_year', cp.class_year, 'class_label', cp.class_label,
      'jersey', cp.jersey, 'active', cp.active, 'division', cp.division,
      'conference', cs.conference, 'tier', cs.tier,
      'graduated_to', (select a.new_slug from player_alias a where a.old_slug = 'c-' || cp.espn_id),
      'market', case when p.espn_id is null then jsonb_build_object('price', _devy_price(null, 'c-' || cp.espn_id), 'rank', null)
                     else jsonb_build_object('price', _devy_price(null, 'c-' || cp.espn_id), 'rank', p.rank,
                       'youth', p.youth = 1, 'as_of', p.as_of) end
                 || jsonb_build_object('frozen', _college_prices_frozen()),
      'stathead', case when s.espn_id is null then null
                       else jsonb_build_object('rank_1qb', s.rank_1qb, 'rank_sf', s.rank_sf,
                         'value_1qb', s.value_1qb, 'value_sf', s.value_sf, 'draft_year', s.draft_year,
                         'as_of', s.as_of, 'card', s.card) end,
      'seasons', coalesce((select jsonb_agg(to_jsonb(st) - 'espn_id' - 'updated_at' order by st.season desc)
                             from college_player_stats st where st.espn_id = cp.espn_id), '[]'::jsonb))
      from college_player cp
      left join college_school cs on cs.school_id = cp.school_id
      left join college_price p on p.espn_id = cp.espn_id
      left join stathead_devy s on s.espn_id = cp.espn_id
     where cp.espn_id = p_espn_id)
  end
$$;
grant execute on function college_player_card(text) to authenticated;
