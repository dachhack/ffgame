-- ═══════════════════════════════════════════════════════════════════════════
-- 0402 · set_college_ktc: THE BOARD'S DELETE NEEDS A WHERE.
--
-- The first live run of the college sweep logged "ktc devy DELETE requires a
-- WHERE clause": production's PostgREST runs pg_safeupdate, which refuses an
-- unqualified DELETE even inside a function. The scratch battery has no
-- safeupdate, so 0400's probes passed. Same body, `where true`.
-- ═══════════════════════════════════════════════════════════════════════════

-- p_rows: [{name, pos, school, rank, value}] — replaces the board.
create or replace function set_college_ktc(p_rows jsonb) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare matched int; total int;
begin
  if auth.uid() is not null and not is_admin() then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) < 20 then
    -- a short or broken read must not wipe the board
    return jsonb_build_object('ok', false, 'error', 'too few rows');
  end if;
  total := jsonb_array_length(p_rows);
  delete from college_ktc where true;   -- 0402: production runs pg_safeupdate
  insert into college_ktc (espn_id, ktc_rank, value, name, as_of)
  select distinct on (m.espn_id) m.espn_id, m.rk, m.val, m.name, now()
    from (
      select r.rk, r.val, r.name, cp.espn_id,
             row_number() over (partition by r.rk
               order by (upper(cp.school_abbr) = upper(r.school)) desc, cp.active desc, cp.class_year desc nulls last) as pick,
             count(*) over (partition by r.rk) as n,
             bool_or(upper(cp.school_abbr) = upper(r.school)) over (partition by r.rk) as school_hit
        from (select (e ->> 'rank')::int as rk, (e ->> 'value')::int as val, e ->> 'name' as name,
                     upper(e ->> 'pos') as pos, e ->> 'school' as school
                from jsonb_array_elements(p_rows) e
               where (e ->> 'rank') ~ '^[0-9]+$' and (e ->> 'value') ~ '^[0-9]+$') r
        join college_player cp on _college_norm(cp.full_name) = _college_norm(r.name) and cp.pos = r.pos and cp.active
    ) m
   where m.pick = 1 and (m.n = 1 or m.school_hit)   -- a name twin needs the school to decide
   order by m.espn_id, m.rk;
  get diagnostics matched = row_count;
  return jsonb_build_object('ok', true, 'rows', total, 'matched', matched);
end $$;
revoke all on function set_college_ktc(jsonb) from public, anon;
grant execute on function set_college_ktc(jsonb) to authenticated;
