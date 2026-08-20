-- 0210 probes: quick reactions.
--
-- The cases that matter are the ones a hand-test would not think to try: that
-- a reaction is scoped to its LEAGUE (league_message.id is a global sequence,
-- so an unscoped toggle lets a stranger react into a room they are not in),
-- that toggling twice removes rather than doubles, and that one person can
-- hold several different reactions but not the same one twice.
\set QUIET on
\pset pager off
set client_min_messages = notice;

do $$
declare
  lg_a uuid; lg_b uuid;
  ua uuid := '00000000-0000-0000-0000-00000000ce01';
  ub uuid := '00000000-0000-0000-0000-00000000ce02';
  uc uuid := '00000000-0000-0000-0000-00000000ce03';
  mid bigint; r jsonb; js jsonb; n int;
begin
  insert into auth.users (id, email) values (ua,'ce1@test.dev'), (ub,'ce2@test.dev'), (uc,'ce3@test.dev')
    on conflict (id) do nothing;
  insert into app_user (id, email) values (ua,'ce1@test.dev'), (ub,'ce2@test.dev'), (uc,'ce3@test.dev')
    on conflict (id) do nothing;

  insert into league (id, sleeper_league_id, name, season, provider, invite_code, commissioner_id)
  values (gen_random_uuid(), 'REACT-PROBE-A', 'React A', '2026', 'native', 'REAC0001', ua) returning id into lg_a;
  insert into league (id, sleeper_league_id, name, season, provider, invite_code, commissioner_id)
  values (gen_random_uuid(), 'REACT-PROBE-B', 'React B', '2026', 'native', 'REAC0002', uc) returning id into lg_b;
  insert into league_membership (league_id, sleeper_roster_id, app_user_id, enrolled) values
    (lg_a, 1, ua, true), (lg_a, 2, ub, true), (lg_b, 1, uc, true);

  perform set_config('app.uid', ua::text, false);
  perform set_config('app.email', 'ce1@test.dev', false);
  r := chat_post(lg_a, 'who is starting Beck this week');
  mid := (r ->> 'id')::bigint;
  if mid is null then
    select max(id) into mid from league_message where league_id = lg_a;
  end if;
  if mid is null then raise exception 'PROBE FAIL: could not post a message to react to (%)', r; end if;

  -- 1. A reaction lands, and reports itself back.
  r := chat_react(lg_a, mid, '🔥');
  if not (r ->> 'ok')::boolean then raise exception 'PROBE FAIL: react rejected: %', r; end if;
  if not (r ->> 'on')::boolean then raise exception 'PROBE FAIL: first tap should turn it ON, got %', r; end if;
  if (select count(*) from chat_reaction where message_id = mid) <> 1 then
    raise exception 'PROBE FAIL: the reaction row was not written';
  end if;

  -- 2. TAPPING AGAIN REMOVES IT. A quick reaction is a toggle, not a tally —
  --    without this there is no way to undo a mis-tap.
  r := chat_react(lg_a, mid, '🔥');
  if (r ->> 'on')::boolean then raise exception 'PROBE FAIL: second tap should turn it OFF, got %', r; end if;
  if (select count(*) from chat_reaction where message_id = mid) <> 0 then
    raise exception 'PROBE FAIL: the second tap did not remove the row';
  end if;

  -- 3. ONE PERSON, SEVERAL DIFFERENT REACTIONS. Unlike a poll vote, 👍 and 😂
  --    are not in competition, so the key is (message, user, emoji).
  perform chat_react(lg_a, mid, '👍');
  perform chat_react(lg_a, mid, '😂');
  if (select count(*) from chat_reaction where message_id = mid and app_user_id = ua) <> 2 then
    raise exception 'PROBE FAIL: a second DIFFERENT reaction replaced the first';
  end if;

  -- 4. TWO PEOPLE, SAME REACTION → a count of 2, and `mine` true for both.
  perform set_config('app.uid', ub::text, false);
  perform set_config('app.email', 'ce2@test.dev', false);
  perform chat_react(lg_a, mid, '👍');
  js := _chat_reactions_json(mid, ub);
  select (e ->> 'n')::int into n from jsonb_array_elements(js) e where e ->> 'emoji' = '👍';
  if n <> 2 then raise exception 'PROBE FAIL: 👍 counted % , expected 2 — %', n, js; end if;
  if not (select (e ->> 'mine')::boolean from jsonb_array_elements(js) e where e ->> 'emoji' = '👍') then
    raise exception 'PROBE FAIL: mine should be true for a reactor';
  end if;
  js := _chat_reactions_json(mid, uc);
  if (select (e ->> 'mine')::boolean from jsonb_array_elements(js) e where e ->> 'emoji' = '👍') then
    raise exception 'PROBE FAIL: mine should be FALSE for somebody who did not react';
  end if;

  -- 5. OFF THE WHITELIST IS REFUSED. The client offers six; anything else is
  --    somebody calling the RPC directly.
  r := chat_react(lg_a, mid, '🦆');
  if (r ->> 'ok')::boolean then raise exception 'PROBE FAIL: an unlisted emoji was accepted'; end if;
  r := chat_react(lg_a, mid, '👍👍');
  if (r ->> 'ok')::boolean then raise exception 'PROBE FAIL: a doubled emoji was accepted'; end if;

  -- 6. THE ONE THAT NEEDS THE league_id PREDICATE. league_message.id is a
  --    GLOBAL sequence, so a member of league B can name league A's message by
  --    number. Without the scope this succeeds and the reaction appears in a
  --    room that member has never been in.
  perform set_config('app.uid', uc::text, false);
  perform set_config('app.email', 'ce3@test.dev', false);
  r := chat_react(lg_b, mid, '🔥');
  if (r ->> 'ok')::boolean then
    raise exception 'PROBE FAIL: reacted to ANOTHER LEAGUE''s message: %', r;
  end if;
  -- …and a non-member cannot reach it through the owning league either.
  r := chat_react(lg_a, mid, '🔥');
  if (r ->> 'ok')::boolean then raise exception 'PROBE FAIL: a non-member reacted'; end if;

  -- 7. THE MESSAGE JSON CARRIES THEM, which is how the client ever sees one.
  perform set_config('app.uid', ua::text, false);
  perform set_config('app.email', 'ce1@test.dev', false);
  r := chat_messages(lg_a);
  js := (select e -> 'reactions' from jsonb_array_elements(r -> 'messages') e where (e ->> 'id')::bigint = mid);
  if js is null or jsonb_array_length(js) = 0 then
    raise exception 'PROBE FAIL: chat_messages did not carry reactions — %', r -> 'messages';
  end if;

  -- 8. DELETING THE MESSAGE TAKES ITS REACTIONS WITH IT.
  delete from league_message where id = mid;
  if (select count(*) from chat_reaction where message_id = mid) <> 0 then
    raise exception 'PROBE FAIL: reactions outlived their message';
  end if;

  delete from league_membership where league_id in (lg_a, lg_b);
  delete from league_message where league_id in (lg_a, lg_b);
  delete from league where id in (lg_a, lg_b);
  delete from app_user where id in (ua, ub, uc);
  raise notice 'chat-reaction probes done';
end $$;
select 'ALL CHAT-REACTION PROBES PASSED' as result;
