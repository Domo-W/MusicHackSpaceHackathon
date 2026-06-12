import { CONFIG } from "./config.js";

// [pattern, minBpm, maxBpm] — each genre's natural tempo WINDOW. A song picks a
// random tempo inside its genre's window (see pickGenreBpm), so two songs of the
// same genre aren't metronomically identical while staying rhythmically authentic.
// Order matters: more specific patterns (e.g. "tropical house") come before
// looser ones (e.g. "house").
const GENRE_TEMPOS: Array<[RegExp, number, number]> = [
  [/\bdrum\s*(?:and|&|n)\s*bass\b|\bdnb\b/i, 170, 176],
  [/\bdubstep\b/i, 138, 142],
  [/\bmiami\s*bass\b/i, 128, 140],
  [/\bsoca\b/i, 126, 134],
  [/\btechno\b/i, 126, 134],
  [/\bpop\s*rock\b/i, 124, 132],
  [/\btropical\s*house\b/i, 110, 120],
  [/\bhouse\b/i, 120, 128],
  [/\bpop\b/i, 116, 124],
  [/\bgospel\b/i, 100, 118],
  [/\bfunk\b/i, 110, 120],
  [/\bafro\s*beats?\b|\bafrobeats?\b/i, 106, 114],
  [/\bfolk\b/i, 102, 114],
  [/\bcountry\b/i, 98, 110],
  [/\bdancehall\b/i, 96, 104],
  [/\bsoul\b/i, 92, 100],
  [/\bhip[\s-]*hop\b|\brap\b/i, 86, 96],
  [/\breggae\b/i, 78, 86],
];

function windowFor(genre: string): [number, number] | null {
  for (const [pattern, min, max] of GENRE_TEMPOS) {
    if (pattern.test(genre)) return [min, max];
  }
  return null;
}

/** A deterministic, genre-typical tempo (the centre of the genre's window). Used
 *  where a stable value is wanted; song generation uses pickGenreBpm instead. */
export function genreBpm(genre: string): number {
  const w = windowFor(genre);
  return w ? Math.round((w[0] + w[1]) / 2) : CONFIG.defaultBpm;
}

/** A randomized, genre-appropriate tempo — call ONCE per song, then thread the
 *  result through (Suno style string + stored bpm) so it stays consistent. */
export function pickGenreBpm(genre: string): number {
  const w = windowFor(genre);
  if (!w) return CONFIG.defaultBpm;
  return w[0] + Math.floor(Math.random() * (w[1] - w[0] + 1));
}
