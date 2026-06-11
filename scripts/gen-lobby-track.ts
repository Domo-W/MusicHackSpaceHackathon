/* One-off: generate the calm LOBBY bed — a downtempo, instrumental variation of
   the hype opener. Plays under the sign-up lobby, then hands off to the opener
   when the show starts. Run: npx tsx scripts/gen-lobby-track.ts
   Saves to frontend/assets/lobby.m4a */
import { writeFile } from "node:fs/promises";
import { generateSong } from "../backend/src/suno.js";

const OUT = new URL("../frontend/assets/lobby.m4a", import.meta.url);

// Same world as the opener (warm, neon, club) but RELAXED: low tempo, no drop,
// instrumental so it never competes with names/voices while people sign up.
const style =
  "ambient downtempo house, 90 BPM, 4/4, warm analog pads, soft sub bass, " +
  "gentle plucked arpeggio, hazy late-night anticipation, spacious reverb, " +
  "no build, no drop, mellow and patient, instrumental";

async function main() {
  console.log("[lobby] submitting calm instrumental generation…");
  const res = await generateSong(
    { lyrics: "", style, title: "In Between — Lobby", instrumental: true },
    { onPlayable: (url, status) => console.log(`[lobby] playable (${status}): ${url.slice(0, 80)}…`) },
  );
  console.log(`[lobby] complete in ${(res.msToComplete / 1000).toFixed(0)}s → downloading final m4a`);
  const audio = await fetch(res.finalUrl);
  if (!audio.ok) throw new Error(`download failed: ${audio.status}`);
  const buf = Buffer.from(await audio.arrayBuffer());
  await writeFile(OUT, buf);
  console.log(`[lobby] saved ${(buf.length / 1024).toFixed(0)} KB → frontend/assets/lobby.m4a`);
}

main().catch((e) => { console.error("[lobby] failed:", e.message); process.exit(1); });
