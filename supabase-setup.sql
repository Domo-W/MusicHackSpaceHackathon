-- ============================================================
-- Supabase setup for Between Sets song persistence.
-- Run ONCE in the "Between Sets" project ▸ SQL Editor (Run).
-- Creates the metadata table + a PUBLIC Storage bucket for the audio.
-- The backend writes with the service_role key (bypasses RLS); the public
-- bucket makes the audio downloadable via a stable CDN URL.
-- ============================================================

-- 1) Song metadata (mirrors SavedSong in backend/src/types.ts)
create table if not exists public.songs (
  id           text primary key,
  title        text        not null,
  name         text        not null,
  genre        text        not null,
  bpm          integer     not null,
  lyrics       text        not null,
  created_at   timestamptz not null default now(),
  file_name    text        not null,
  download_url text        not null
);

-- RLS on; no public policies needed — the backend uses the service_role key,
-- which bypasses RLS. (Add a public-read policy later only if a client reads
-- the table directly.)
alter table public.songs enable row level security;

create index if not exists songs_created_at_idx on public.songs (created_at desc);

-- 2) Public Storage bucket for the audio files
insert into storage.buckets (id, name, public)
values ('songs', 'songs', true)
on conflict (id) do update set public = true;

-- Done. Then set these env vars (Render dashboard + local .env), NEVER in git:
--   SUPABASE_URL=https://swmvlfqvibpjszahdmpq.supabase.co
--   SUPABASE_SERVICE_ROLE_KEY=<Project Settings ▸ API ▸ service_role secret>
--   SUPABASE_BUCKET=songs   (optional; this is the default)
-- The backend logs:  [songs] archive: Supabase (bucket "songs")
