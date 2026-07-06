-- 0050: the hero board persists its full working applied-state (extra slots per
-- window, real-time swaps, backups, and the targeted powerups: double-or-nothing,
-- spy, bye-steal, EMP) server-side, so a reload / another device restores exactly
-- what you set. Scoring still reads applied_state (buffs) and sealed_pick (lineup);
-- this is the client's working blob only. Self-only, pre-lock.
create table if not exists hero_applied (
  matchup_id   uuid not null references matchup(id) on delete cascade,
  app_user_id  uuid not null references app_user(id) on delete cascade,
  payload_json jsonb not null default '{}'::jsonb,
  updated_at   timestamptz not null default now(),
  primary key (matchup_id, app_user_id)
);
alter table hero_applied enable row level security;
create policy hero_applied_rw on hero_applied for all
  using (app_user_id = auth.uid())
  with check (
    app_user_id = auth.uid()
    and exists (select 1 from matchup m where m.id = hero_applied.matchup_id and m.status = 'scheduled')
  );
grant select, insert, update on hero_applied to authenticated;

create or replace function hero_set_applied(p_matchup_id uuid, p_payload jsonb)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare m matchup%rowtype;
begin
  select * into m from matchup where id = p_matchup_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no matchup'); end if;
  if m.status <> 'scheduled' then return jsonb_build_object('ok', false, 'error', 'locked'); end if;
  if not is_matchup_participant(p_matchup_id) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  insert into hero_applied (matchup_id, app_user_id, payload_json)
    values (p_matchup_id, auth.uid(), coalesce(p_payload, '{}'::jsonb))
  on conflict (matchup_id, app_user_id) do update set payload_json = coalesce(p_payload, '{}'::jsonb), updated_at = now();
  return jsonb_build_object('ok', true);
end $$;
grant execute on function hero_set_applied(uuid, jsonb) to authenticated;

create or replace function my_hero_applied(p_matchup_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  select payload_json into result from hero_applied where matchup_id = p_matchup_id and app_user_id = auth.uid();
  return coalesce(result, '{}'::jsonb);
end $$;
grant execute on function my_hero_applied(uuid) to authenticated;
