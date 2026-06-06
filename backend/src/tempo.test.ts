import { beforeAll, describe, expect, it } from "vitest";

let genreBpm: (genre: string) => number;

beforeAll(async () => {
  process.env.SUNO_API_KEY ||= "test-suno-key";
  process.env.ANTHROPIC_API_KEY ||= "test-anthropic-key";
  ({ genreBpm } = await import("./tempo.js"));
});

describe("genreBpm", () => {
  it("uses genre conventions instead of fixing every song at 120", () => {
    expect(genreBpm("Soca")).toBe(130);
    expect(genreBpm("Dancehall")).toBe(100);
    expect(genreBpm("Reggae")).toBe(82);
    expect(genreBpm("Tropical House")).toBe(115);
  });

  it("uses the configured default for unknown genres", () => {
    expect(genreBpm("Future Mystery")).toBe(120);
  });
});
