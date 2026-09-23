-- Minimal Supabase shim for scratch-DB migration probes.
create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text
);
-- GUC-driven identity: set app.uid / app.email / app.role per probe.
--
-- The REQUEST CLAIMS come first, as they do in Supabase's own auth.uid(): the
-- write API (0352) acts as a key's owner by setting request.jwt.claims for its
-- transaction, and a shim that ignored them would test a different function
-- from the one production runs. Probes never set the claims themselves, so for
-- every other suite this still reads app.uid exactly as before.
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub',
                  nullif(current_setting('app.uid', true), ''))::uuid;
$$;
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb,
                  jsonb_build_object('email', nullif(current_setting('app.email', true), '')));
$$;
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('app.role', true), ''), 'authenticated');
$$;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
-- Supabase realtime publication stub (0005 alters it).
do $$ begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;
create extension if not exists pgcrypto;
-- Supabase Storage stub (0349 creates the chat-image bucket and its policies).
-- Probes never upload; the tables only have to exist for the migration to apply.
create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key, name text, public boolean default false, owner uuid,
  file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now()
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id),
  name text, owner uuid, metadata jsonb, created_at timestamptz default now()
);
alter table storage.objects enable row level security;
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1];
$$;
grant usage on schema storage to anon, authenticated, service_role;
