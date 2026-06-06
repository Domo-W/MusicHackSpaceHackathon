// Spine smoke test: Claude agent -> Suno generate/stream. Run: npx tsx backend/src/smoke.ts
import { craftSongPrompt } from "./agent.js";
import { generateSong } from "./suno.js";

const seed = {
  name: "Maya",
  answer: "I drove four hours just to be here tonight",
  genre: "disco house",
};

const t0 = Date.now();
console.log("→ crafting prompt via Claude…");
const prompt = await craftSongPrompt(seed);
console.log(`✓ agent in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log("  title:", prompt.title);
console.log("  style:", prompt.style);
console.log("  lyrics:\n" + prompt.lyrics.split("\n").map((l) => "    " + l).join("\n"));

console.log("\n→ generating via Suno…");
const result = await generateSong(prompt, {
  onPlayable: (url, status) =>
    console.log(`  ▶ playable at +${((Date.now() - t0) / 1000).toFixed(1)}s (status=${status}) ${url.slice(0, 60)}`),
});
console.log(`✓ complete at +${(result.msToComplete / 1000).toFixed(1)}s`);
console.log("  msToPlayable:", (result.msToPlayable / 1000).toFixed(1) + "s");
console.log("  finalUrl:", result.finalUrl);
