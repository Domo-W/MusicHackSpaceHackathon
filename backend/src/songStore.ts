import fs from "node:fs/promises";
import path from "node:path";
import { CONFIG } from "./config.js";
import type { SavedSong, Song } from "./types.js";

const SAFE_ID = /^[a-zA-Z0-9_-]+$/;

function safeFilePart(value: string): string {
  const cleaned = value
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned.slice(0, 80) || "between-sets-song";
}

function audioExtension(sourceUrl: string, contentType: string | null): string {
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

export class LocalSongStore {
  constructor(private readonly rootDir = CONFIG.songsDir) {}

  async save(song: Song, sourceUrl: string): Promise<SavedSong> {
    const response = await fetch(sourceUrl, { headers: { "User-Agent": CONFIG.userAgent } });
    if (!response.ok) {
      throw new Error(`audio download ${response.status}: ${(await response.text()).slice(0, 200)}`);
    }

    await fs.mkdir(this.rootDir, { recursive: true });
    const extension = audioExtension(sourceUrl, response.headers.get("content-type"));
    const fileName = `${song.id}-${safeFilePart(song.title)}${extension}`;
    const filePath = path.join(this.rootDir, fileName);
    const tempPath = `${filePath}.partial`;
    await fs.writeFile(tempPath, Buffer.from(await response.arrayBuffer()));
    await fs.rename(tempPath, filePath);

    const saved: SavedSong = {
      id: song.id,
      title: song.title,
      name: song.name,
      genre: song.genre,
      bpm: song.bpm,
      lyrics: song.lyrics,
      createdAt: new Date().toISOString(),
      fileName,
      downloadUrl: `/api/songs/${encodeURIComponent(song.id)}/download`,
    };
    await fs.writeFile(
      path.join(this.rootDir, `${song.id}.json`),
      `${JSON.stringify(saved, null, 2)}\n`,
      "utf8",
    );
    return saved;
  }

  async list(): Promise<SavedSong[]> {
    let entries: string[];
    try {
      entries = await fs.readdir(this.rootDir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }

    const songs = await Promise.all(
      entries
        .filter((entry) => entry.endsWith(".json"))
        .map(async (entry) => {
          try {
            return JSON.parse(await fs.readFile(path.join(this.rootDir, entry), "utf8")) as SavedSong;
          } catch (err) {
            console.warn(`[songs] ignoring unreadable metadata ${entry}:`, (err as Error).message);
            return null;
          }
        }),
    );
    return songs
      .filter((song): song is SavedSong => song !== null)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async fileFor(id: string): Promise<{ song: SavedSong; filePath: string } | null> {
    if (!SAFE_ID.test(id)) return null;
    try {
      const song = JSON.parse(
        await fs.readFile(path.join(this.rootDir, `${id}.json`), "utf8"),
      ) as SavedSong;
      const filePath = path.join(this.rootDir, path.basename(song.fileName));
      await fs.access(filePath);
      return { song, filePath };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }
}

export const songStore = new LocalSongStore();
