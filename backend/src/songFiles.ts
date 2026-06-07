// Shared helpers + interface for the song archive (local-disk or Supabase-backed).
import path from "node:path";
import type { SavedSong, Song } from "./types.js";

export const SAFE_ID = /^[a-zA-Z0-9_-]+$/;

/** What the download endpoint needs: either a local file to stream or a URL to redirect to. */
export interface DownloadTarget {
  song: SavedSong;
  filePath?: string; // local file to stream (LocalSongStore)
  url?: string; // remote URL to redirect to (SupabaseSongStore)
}

/** The archive contract. Both implementations are interchangeable. */
export interface SongStore {
  save(song: Song, sourceUrl: string): Promise<SavedSong>;
  list(): Promise<SavedSong[]>;
  delete(id: string): Promise<boolean>;
  fileFor(id: string): Promise<DownloadTarget | null>;
}

/** Filesystem/URL-safe slug from a song title. */
export function safeFilePart(value: string): string {
  const cleaned = value
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned.slice(0, 80) || "between-sets-song";
}

/** Best-effort audio extension from the source URL / content-type (Suno → mp3/m4a). */
export function audioExtension(sourceUrl: string, contentType: string | null): string {
  const type = (contentType || "").toLowerCase();
  if (type.includes("mp4") || type.includes("m4a")) return ".m4a";
  if (type.includes("wav")) return ".wav";
  if (type.includes("mpeg") || type.includes("mp3")) return ".mp3";

  try {
    const ext = path.extname(new URL(sourceUrl).pathname).toLowerCase();
    if ([".mp3", ".m4a", ".wav", ".mp4"].includes(ext)) {
      return ext === ".mp4" ? ".m4a" : ext;
    }
  } catch {
    // Fall through to the common Suno audio format.
  }
  return ".mp3";
}

/** content-type to send to Storage for an extension. */
export function audioContentType(ext: string): string {
  if (ext === ".m4a") return "audio/mp4";
  if (ext === ".wav") return "audio/wav";
  return "audio/mpeg";
}
