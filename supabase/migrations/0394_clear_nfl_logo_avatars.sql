-- 0394 · CLEAR SAVED NFL-LOGO AVATARS
--
-- Founder: "clear the saved NFL avatars." The avatar picker offered the 32 ESPN
-- NFL team logos (0066) — NFL marks we aren't licensed for. The picker now
-- hides them in mark-free mode (src/app/AvatarPicker.tsx); this clears the ones
-- already saved as a team avatar (league_membership) or league crest (league).
-- A cleared avatar renders as the UI's usual no-avatar fallback.
--
-- Only ESPN's NFL logo URLs match. Drip avatars, Sleeper avatars and college
-- logos are left alone.
--
-- Old values are kept in nfl_logo_avatar_backup so this can be undone:
--   update league l set avatar_url = b.avatar_url
--     from nfl_logo_avatar_backup b where b.tbl = 'league' and b.row_id = l.id;
--   update league_membership m set avatar_url = b.avatar_url
--     from nfl_logo_avatar_backup b where b.tbl = 'league_membership' and b.row_id = m.id;

create table if not exists nfl_logo_avatar_backup (
  tbl        text not null,
  row_id     uuid not null,
  avatar_url text not null,
  cleared_at timestamptz not null default now(),
  primary key (tbl, row_id)
);
alter table nfl_logo_avatar_backup enable row level security;  -- no policies: service role only

insert into nfl_logo_avatar_backup (tbl, row_id, avatar_url)
select 'league', id, avatar_url from league
where avatar_url like 'https://a.espncdn.com/i/teamlogos/nfl/%'
on conflict do nothing;

insert into nfl_logo_avatar_backup (tbl, row_id, avatar_url)
select 'league_membership', id, avatar_url from league_membership
where avatar_url like 'https://a.espncdn.com/i/teamlogos/nfl/%'
on conflict do nothing;

update league set avatar_url = null
where avatar_url like 'https://a.espncdn.com/i/teamlogos/nfl/%';

update league_membership set avatar_url = null
where avatar_url like 'https://a.espncdn.com/i/teamlogos/nfl/%';
