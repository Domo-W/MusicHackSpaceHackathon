import type { Seed } from "./types.js";

// Sample seeds for the spine test (stands in for real audience input until the
// voting layer is wired). The real show replaces nextSeed() with the selected
// participant + winning genre from the tug round.
const SAMPLE_SEEDS: Seed[] = [
  { name: "Maya", answer: "I drove four hours just to be here tonight", genre: "disco house" },
  { name: "Devon", answer: "my dog learned to skateboard today", genre: "drum and bass" },
  { name: "Priya", answer: "I just quit my job to make music full time", genre: "synthwave" },
  { name: "Marcus", answer: "tonight is my first night out since the baby", genre: "afrobeats" },
  { name: "Sofia", answer: "I proposed at the top of a mountain last week", genre: "melodic techno" },
];

let i = 0;
export function nextSeed(): Seed {
  const s = SAMPLE_SEEDS[i % SAMPLE_SEEDS.length]!;
  i++;
  return s;
}
