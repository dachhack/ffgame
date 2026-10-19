-- Founder, after 0517 cut Monday Showdown's budget to $30,000: "What are the
-- prices?" Tonight's board (week 6, WAS and SF): each player's salary and
-- projection, and the league's 8 spots. Read only.
\pset pager off
set search_path = public;
\echo '── the spots and the cap'
select ord as spot, s.spot ->> 'label' as label, s.spot -> 'pos' as pos
  from league l, jsonb_array_elements(_contest_slots(l)) with ordinality s(spot, ord)
 where l.id = 'ec3c4c2d-63a1-4f27-8844-a7d132e53a11';
select _contest_budget(l) as budget, _contest_min_spend(l) as min_spend from league l where l.id = 'ec3c4c2d-63a1-4f27-8844-a7d132e53a11';
\echo '── WAS and SF, by position then salary'
select upper(pos) as pos, name, team, salary, proj
  from pod_salary where season = '2026' and week = 6 and team in ('WAS', 'SF')
 order by upper(pos), salary desc, name;
