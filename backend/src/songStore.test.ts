import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Song } from "./types.js";

let LocalSongStore: typeof import("./songStore.js").LocalSongStore;
const tempDirs: string[] = [];

beforeAll(async () => {
  process.env.SUNO_API_KEY ||= "test-suno-key";
  process.env.ANTHROPIC_API_KEY ||= "test-anthropic-key";
  ({ LocalSongStore } = await import("./songStore.js"));
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("LocalSongStore", () => {
  it("archives audio and returns newest-first downloadable metadata", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "between-sets-songs-"));
    tempDirs.push(rootDir);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "audio/mpeg" },
      })),
    );

    const song: Song = {
      id: "song-test-1",
      title: "A Night / To Remember",
      name: "Jordan",
      genre: "Soca",
      bpm: 130,
      lyrics: "[Chorus]\nDance",
      streamUrl: "https://example.com/stream",
      finalUrl: "https://example.com/final",
    };
    const store = new LocalSongStore(rootDir);
    const saved = await store.save(song, song.finalUrl);

    expect(saved.fileName).toBe("song-test-1-A-Night-To-Remember.mp3");
    expect(saved.downloadUrl).toBe("/api/songs/song-test-1/download");
    expect(await fs.readFile(path.join(rootDir, saved.fileName))).toEqual(Buffer.from([1, 2, 3]));
    expect((await store.list())[0]).toMatchObject({ id: song.id, bpm: 130 });
    expect((await store.fileFor(song.id))?.filePath).toBe(path.join(rootDir, saved.fileName));
  });
});
