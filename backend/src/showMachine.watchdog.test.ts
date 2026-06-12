import { describe, it, expect, beforeEach, vi } from "vitest";

// Keep generation inert: an empty round now auto-advances with a house seed, which
// would otherwise call the real Anthropic/Suno APIs when timers run far enough.
vi.mock("./agent.js", () => ({
  craftSongPrompt: vi.fn(async () => ({ title: "T", lyrics: "la la", style: "pop 120bpm" })),
  craftOpenerPrompt: vi.fn(async () => ({ title: "T", lyrics: "la la", style: "pop 120bpm" })),
}));
vi.mock("./suno.js", () => ({
  generateSong: vi.fn(async (_p: unknown, cb: { onPlayable?: (u: string, s: string) => void } = {}) => {
    cb.onPlayable?.("http://test/stream.m4a", "streaming");
    return { finalUrl: "http://test/final.m4a", msToComplete: 1 };
  }),
}));
vi.mock("./songStore.js", () => ({
  songStore: {
    save: vi.fn(async (song: Record<string, unknown>) => ({ ...song, fileName: "t.m4a", downloadUrl: "http://test/final.m4a" })),
    list: vi.fn(async () => []),
  },
}));

// showMachine starts intervals at module load — import under fake timers so the
// watchdog (and the snapshot loops) run on the controlled clock.
vi.useFakeTimers();
const show = await import("./showMachine.js");

describe("stale-show watchdog", () => {
  beforeEach(() => {
    show.reset();
    vi.clearAllTimers();
  });

  it("auto-resets a started show whose first track never reports playing", () => {
    show.startShow();
    expect(show.currentShowState().started).toBe(true);

    vi.advanceTimersByTime(3 * 60_000 + 1000);

    expect(show.currentShowState().started).toBe(false);
    expect(show.currentShowState().phase).toBe("idle");
  });

  it("does not reset once a track has reported playing", () => {
    show.startShow();
    show.onPlaying("song-test-1");

    vi.advanceTimersByTime(30 * 60_000);

    expect(show.currentShowState().started).toBe(true);
  });
});
