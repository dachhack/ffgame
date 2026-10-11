create schema if not exists storage;
create table if not exists storage.objects (bucket_id text, name text);
alter table storage.objects enable row level security;
create or replace function _chat_reaction_ok(p_emoji text) returns boolean language sql immutable as $$ select p_emoji = any (array['👍','👎','🔥','😂','😮','💯']) $$;
create or replace function _chat_is_media_body(p text) returns boolean language sql immutable as $$ select p ~ '^https://\S+$' $$;
alter table app_user add column if not exists created_at timestamptz not null default now();
create table if not exists computer_ask (source text not null check (source in ('league','dm')), message_id bigint not null, issue int, primary key (source, message_id));
