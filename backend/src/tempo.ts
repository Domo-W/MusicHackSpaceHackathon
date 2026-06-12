import { CONFIG } from "./config.js";

const GENRE_BPMS: Array<[RegExp, number]> = [
  [/\bdrum\s*(?:and|&|n)\s*bass\b|\bdnb\b/i, 174],
  [/\bdubstep\b/i, 140],
  [/\bsoca\b/i, 130],
  [/\btechno\b/i, 130],
  [/\bpop\s*rock\b/i, 128],
  [/\btropical\s*house\b/i, 115],
  [/\bhouse\b/i, 124],
  [/\bpop\b/i, 120],
  [/\bfunk\b/i, 115],
  [/\bafro\s*beats?\b|\bafrobeats?\b/i, 110],
  [/\bfolk\b/i, 108],
  [/\bcountry\b/i, 104],
  [/\bdancehall\b/i, 100],
  [/\bsoul\b/i, 96],
  [/\bhip[\s-]*hop\b|\brap\b/i, 92],
  [/\breggae\b/i, 82],
];

/** A deterministic, genre-typical target tempo for Suno and the live UI. */
export function genreBpm(genre: string): number {
  for (const [pattern, bpm] of GENRE_BPMS) {
    if (pattern.test(genre)) return bpm;
  }
  return CONFIG.defaultBpm;
}
