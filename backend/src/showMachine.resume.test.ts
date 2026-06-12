import { describe, it, expect, beforeEach, vi } from "vitest";

// Keep generation inert so the auto-advance path doesn't hit the real APIs.
const { craftSongPrompt } = vi.hoisted(() => ({
  craftSongPrompt: vi.fn(async (..._a: unknown[]) => ({ title: "T", lyrics: "la la", style: "pop 120bpm" })),
}));
vi.mock("./agent.js", () => ({
  craftSongPrompt,
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

// showMachine starts intervals at module load — import under fake timers.
vi.useFakeTimers();
const show = await import("./showMachine.js");

describe("live-track re-seed (stage reload recovery)", () => {
  beforeEach(() => {
    show.reset();
    vi.clearAllTimers();
  });

  it("exposes no live track in the idle lobby", () => {
    expect(show.currentPlayingSong()).toBe(null);
  });

  it("exposes the opener as the live track once the show starts (so a reloaded stage can resume audio)", () => {
    show.startShow();
    const live = show.currentPlayingSong();
    expect(live).not.toBe(null);
    expect(live!.streamUrl).toContain("opener");
  });

  it("clears the live track on reset", () => {
    show.startShow();
    expect(show.currentPlayingSong()).not.toBe(null);
    show.reset();
    expect(show.currentPlayingSong()).toBe(null);
  });

  it("clears the live track when the show ends (recap takes over)", async () => {
    show.startShow();
    expect(show.currentPlayingSong()).not.toBe(null);
    await show.endShow();
    expect(show.currentPlayingSong()).toBe(null);
  });
});

describe("empty-round auto-advance (Jackbox-style: never hard-stop)", () => {
  beforeEach(() => {
    show.reset();
    vi.clearAllTimers();
    craftSongPrompt.mockClear();
  });

  it("auto-advances with a house seed after the grace window when nobody submits", async () => {
    show.startShow();
    show.onPlaying("song-test-1"); // opens round 1 gathering (no participants joined)
    // Drive gather → vote → buzzer (grace re-open) → vote → buzzer (auto-advance).
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    // The house seed reached the generation pipeline instead of looping the battle.
    expect(craftSongPrompt).toHaveBeenCalled();
  });
});
