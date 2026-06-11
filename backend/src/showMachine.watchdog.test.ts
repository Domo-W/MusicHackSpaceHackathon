import { describe, it, expect, beforeEach, vi } from "vitest";

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
