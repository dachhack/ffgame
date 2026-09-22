-- ═══════════════════════════════════════════════════════════════════════════
-- 0349 · THE LEAGUE POSTS A PICTURE — uploads in chat
--
-- Founder: "I want to allow users to post images in the chat."
--
-- Chat has rendered images since 0148 — but only ones that already live
-- somewhere else: a GIF from the picker, an imgur link somebody pasted. The
-- screenshot of the lineup that lost by 0.4, the photo of the trophy, the
-- whiteboard from draft night — the pictures a league actually wants to show
-- each other — had nowhere to go. This is the somewhere.
--
-- NO NEW MESSAGE KIND, NO NEW COLUMN. A message whose body is an image URL
-- already renders inline on web and native alike (0148), so an uploaded image
-- posts through chat_post / dm_send like any other line, is pinned, reacted to,
-- previewed and deleted like any other line, and shows up in an app build that
-- predates this migration. The only new thing is where the bytes live.
--
-- THE PATH IS THE PERMISSION: <league_id>/<author_id>/<random>.<ext>. The write
-- policy reads the league out of the first folder and the author out of the
-- second, so an upload can only land in a league you are actually in, under
-- your own id. Nothing the client says is trusted — not the filename, not the
-- content type it claims, not the size (the bucket caps both).
--
-- PUBLIC-READ, like the GIF CDNs beside it. A signed URL would be the tighter
-- answer, but a chat message stores ONE body string for ever and a signed URL
-- expires — the picture would rot out of the conversation in an hour. The
-- path carries two uuids and 16 random hex characters, so a URL is unguessable;
-- it is a link somebody in your league could forward, which is what a GIF link
-- and a screenshot pasted into a group text already are.
--
-- A DM'S PICTURE LIVES HERE TOO, under the league both people are in, and is
-- public-read like the rest of the bucket. That is the same bargain a DM's text
-- already makes with a screenshot — worth saying out loud rather than implying
-- a privacy the storage does not have.
--
-- DELETE IS THE AUTHOR'S OR THE COMMISSIONER'S — the same two people
-- chat_delete (0147) already trusts with the message. Moderation that takes
-- down the line and leaves the picture on the internet is not moderation, so
-- the clients remove the object as part of deleting the message.
--
-- APPLYING THIS: it writes storage.buckets and policies storage.objects, which
-- needs the same role the rest of the migrations run as (migrate.yml's
-- SUPABASE_DB_URL / the SQL editor). It is idempotent — re-running it resets
-- the bucket's limits and re-creates the three policies.
-- ═══════════════════════════════════════════════════════════════════════════

-- 6 MB and four types, enforced by Storage itself rather than by the client
-- asking nicely. The web composer downsizes anything big before it gets here,
-- so the cap is the backstop for a GIF or a client that does not.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-image', 'chat-image', true, 6291456,
        array['image/jpeg', 'image/png', 'image/gif', 'image/webp'])
on conflict (id) do update
  set public            = excluded.public,
      file_size_limit   = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ── reading the path ────────────────────────────────────────────────────────
-- Both halves of the path, as uuids or NULL — never an error. A policy that
-- raises on a malformed name fails the upload with a cast error instead of a
-- permission one, and the two read very differently at 11pm. NULL flows into
-- is_league_member / is_league_commish, both of which answer false for it.
create or replace function public.chat_image_league(p_name text) returns uuid
  language plpgsql immutable as $$
declare parts text[] := string_to_array(coalesce(p_name, ''), '/');
begin
  if coalesce(array_length(parts, 1), 0) <> 3 then return null; end if;
  return parts[1]::uuid;
exception when others then return null;
end $$;

create or replace function public.chat_image_author(p_name text) returns uuid
  language plpgsql immutable as $$
declare parts text[] := string_to_array(coalesce(p_name, ''), '/');
begin
  if coalesce(array_length(parts, 1), 0) <> 3 then return null; end if;
  return parts[2]::uuid;
exception when others then return null;
end $$;

grant execute on function public.chat_image_league(text) to authenticated, anon;
grant execute on function public.chat_image_author(text) to authenticated, anon;
grant execute on function public.is_league_member(uuid) to authenticated;
grant execute on function public.is_league_commish(uuid) to authenticated;

-- ── who may do what with the bytes ──────────────────────────────────────────
drop policy if exists "chat image read"   on storage.objects;
drop policy if exists "chat image write"  on storage.objects;
drop policy if exists "chat image delete" on storage.objects;

-- Read: the bucket is public, so this only mirrors what the public endpoint
-- already serves — it exists so the SDK's authenticated download path works too.
create policy "chat image read" on storage.objects for select
  using (bucket_id = 'chat-image');

-- Write: your own folder, inside a league you belong to.
create policy "chat image write" on storage.objects for insert to authenticated
  with check (bucket_id = 'chat-image'
    and public.chat_image_author(name) = auth.uid()
    and public.is_league_member(public.chat_image_league(name)));

-- Delete: yours, or the commissioner's call — chat_delete's two people.
create policy "chat image delete" on storage.objects for delete to authenticated
  using (bucket_id = 'chat-image'
    and (public.chat_image_author(name) = auth.uid()
         or public.is_league_commish(public.chat_image_league(name))
         or public.is_admin()));
