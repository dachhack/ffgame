-- 0276: PUSH DIAGNOSTICS (v0.392.0) — a test push and a delivery log, per
-- account.
--
-- Founder: "Can we check the browser and mobile alerts. They are not coming
-- through even though I have them on." Until now the only witness to a push
-- was the worker's log on Fly: a manager whose alerts were "on" had no way to
-- tell a device that never registered from a queue that never sent from a
-- push service that refused. Two RPCs give every account its own view:
--   • push_test() — enqueue one outbox row for the caller, to every device
--     they have registered. The worker's next sweep (60s) delivers it like
--     any other push; the log below shows what happened.
--   • my_push_log() — the caller's last dozen outbox rows: what was queued,
--     when, whether it went, and the error if it did not. The 'waiting-*'
--     errors are the worker's own marks (server/src/push.js) for a channel
--     whose credentials are absent on the server.
-- push_outbox stays deny-all; both functions are security definer and scoped
-- to auth.uid().

create or replace function push_test()
  returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); n int; nid bigint;
begin
  if me is null then return jsonb_build_object('ok', false, 'error', 'not signed in'); end if;
  select count(*) into n from push_token where app_user_id = me;
  if n = 0 then
    return jsonb_build_object('ok', false, 'error', 'no device registered — enable pushes on this phone or browser first');
  end if;
  if exists (select 1 from push_outbox where app_user_id = me and dedupe_key like 'test:' || me || ':%'
               and created_at > now() - interval '30 seconds') then
    return jsonb_build_object('ok', false, 'error', 'one test push every 30 seconds');
  end if;
  insert into push_outbox (app_user_id, kind, title, body, data, dedupe_key)
    values (me, 'chat', '🔔 Test push · Drip Fantasy',
            'If you can read this, pushes reach this device.',
            '{"open": "settings"}'::jsonb,
            'test:' || me || ':' || (extract(epoch from clock_timestamp()) * 1000)::bigint)
    returning id into nid;
  return jsonb_build_object('ok', true, 'id', nid, 'devices', n);
end $$;

create or replace function my_push_log()
  returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid(); rows jsonb;
begin
  if me is null then return jsonb_build_object('ok', false, 'error', 'not signed in'); end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', o.id, 'kind', o.kind, 'title', o.title, 'at', o.created_at,
      'sent_at', o.sent_at, 'error', o.error) order by o.id desc), '[]'::jsonb)
    into rows
    from (select * from push_outbox where app_user_id = me order by id desc limit 12) o;
  return jsonb_build_object('ok', true, 'rows', rows,
    'devices', (select coalesce(jsonb_agg(jsonb_build_object('platform', t.platform, 'seen', t.last_seen_at)), '[]'::jsonb)
                  from push_token t where t.app_user_id = me));
end $$;

grant execute on function push_test() to authenticated;
grant execute on function my_push_log() to authenticated;
