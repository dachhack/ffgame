-- ═══════════════════════════════════════════════════════════════════════════
-- 0418 · THE DEVY VALUES AS A CSV (v0.602.0).
--
-- Founder: "add a link to download the values as csv". The whole list (or one
-- position), in 0417's order, one line per player, with the refresh date in
-- every row so a saved file says how fresh it was. Same numbers as the gear's
-- list: StatHead ranks and Drip's curve on them.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function devy_base_values_csv(p_sort text default 'sf', p_pos text default null) returns text
  language sql stable security definer set search_path = public as $$
  with page as (select devy_base_values(p_sort, p_pos, null, 10000, 0) as j),
  r as (select x, n from page, jsonb_array_elements(page.j -> 'rows') with ordinality as t(x, n))
  select 'rank_sf,rank_1qb,name,pos,school,class,value_1qb,value_sf,underclass_discount,refreshed' || chr(10) ||
    coalesce(string_agg(concat_ws(',',
      coalesce(x ->> 'rank_sf', ''), x ->> 'rank_1qb',
      '"' || replace(coalesce(x ->> 'name', ''), '"', '""') || '"',
      x ->> 'pos', coalesce(x ->> 'school', ''),
      case when x ->> 'class_year' is null then '' when (x ->> 'class_year')::int <= 1 then 'FR' when (x ->> 'class_year')::int = 2 then 'SO' when (x ->> 'class_year')::int = 3 then 'JR' else 'SR+' end,
      to_char((x ->> 'value_1qb')::numeric, 'FM990.00'),
      coalesce(to_char((x ->> 'value_sf')::numeric, 'FM990.00'), ''),
      case when (x ->> 'underclass')::boolean then 'yes' else 'no' end,
      coalesce(to_char((select (j ->> 'as_of')::timestamptz from page) at time zone 'UTC', 'YYYY-MM-DD'), '')),
      chr(10) order by n), '') || chr(10)
  from r
$$;
revoke all on function devy_base_values_csv(text, text) from public;
grant execute on function devy_base_values_csv(text, text) to authenticated;
