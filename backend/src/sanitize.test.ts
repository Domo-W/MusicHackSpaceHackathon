import { describe, it, expect, beforeEach } from "vitest";
import {
  parseBlockedWord,
  noteBlockedWord,
  resetRuntimeBlocked,
  stripWord,
  sanitizeIntent,
  sanitizeStyle,
  sanitizeLyrics,
} from "./sanitize.js";

describe("parseBlockedWord", () => {
  it("extracts the artist-name offender (the real 'skank' rejection)", () => {
    expect(
      parseBlockedWord(
        "Your tags contain artist name skank - we don't reference specific artists on Suno, please change your tags and try again.",
      ),
    ).toBe("skank");
  });

  it("extracts a producer-tag offender", () => {
    expect(parseBlockedWord("Your lyrics contain producer tag lowlight — we don't reference specific artists")).toBe("lowlight");
  });

  it("returns null for a generic 'inappropriate material' rejection (no word named)", () => {
    expect(parseBlockedWord("Prompt contained inappropriate material")).toBe(null);
    expect(parseBlockedWord(null)).toBe(null);
  });
});

describe("static sanitize", () => {
  beforeEach(() => resetRuntimeBlocked());

  it("rewrites the reggae 'skank' descriptor so the style passes", () => {
    const out = sanitizeStyle("Reggae, 82 BPM, 4/4, skank guitar, warm bass");
    expect(out.toLowerCase()).not.toContain("skank");
    expect(out).toContain("offbeat");
  });

  it("scrubs profanity from a typed intent but keeps it singable", () => {
    expect(sanitizeIntent("I want to dance my ass off")).toBe("I want to dance my attitude off");
    expect(sanitizeIntent("this shit is fire").toLowerCase()).not.toContain("shit");
  });

  it("removes slurs entirely and tidies whitespace", () => {
    const out = sanitizeLyrics("hey nigga what up");
    expect(out.toLowerCase()).not.toContain("nigga");
    expect(out).not.toMatch(/\s{2,}/);
  });

  it("does not mangle innocent words that merely contain a bad substring", () => {
    // \b word boundaries: "class" contains "ass", "bass" contains "ass" — must survive.
    expect(sanitizeIntent("play classic bass music")).toBe("play classic bass music");
  });
});

describe("runtime-learned blocking", () => {
  beforeEach(() => resetRuntimeBlocked());

  it("strips a word Suno named at runtime from later submissions", () => {
    expect(sanitizeStyle("dreamy zylofon groove")).toContain("zylofon"); // unknown → untouched
    noteBlockedWord("zylofon");
    expect(sanitizeStyle("dreamy zylofon groove").toLowerCase()).not.toContain("zylofon");
  });
});

describe("stripWord", () => {
  it("replaces a whole word case-insensitively and collapses leftover spaces", () => {
    expect(stripWord("a SKANK b", "skank", "")).toBe("a b");
    expect(stripWord("a skank b", "skank", "offbeat")).toBe("a offbeat b");
  });
});
