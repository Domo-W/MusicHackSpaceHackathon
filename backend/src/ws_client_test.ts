import { WebSocket } from "ws";

const ws = new WebSocket("ws://localhost:8787");
const t0 = Date.now();
const el = () => ((Date.now() - t0) / 1000).toFixed(1).padStart(5);
const played = new Set<string>();
let rounds = 0;

function playNow(id: string) {
  if (played.has(id)) return;
  played.add(id);
  ws.send(JSON.stringify({ type: "playing", id }));
  console.log(`[${el()}s] → sent playing ${id}`);
  if (++rounds >= 3) {
    setTimeout(() => { console.log("\n✓ 3 rounds generated-ahead — spine works"); ws.close(); process.exit(0); }, 1500);
  }
}

ws.on("open", () => { console.log(`[${el()}s] connected → start`); ws.send(JSON.stringify({ type: "start" })); });
ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.type === "generating") console.log(`[${el()}s] generating round ${m.roundIndex}: ${m.seed.name}/${m.seed.genre}`);
  else if (m.type === "song_ready") {
    console.log(`[${el()}s] song_ready ${m.song.id} (${m.song.name}) stream=${m.song.streamUrl.slice(0, 45)}…`);
    // cold start: play first immediately; later: simulate a 5s crossfade-in
    if (played.size === 0) playNow(m.song.id);
    else setTimeout(() => playNow(m.song.id), 5000);
  } else if (m.type === "song_final") console.log(`[${el()}s] song_final ${m.id} → m4a ready`);
});
ws.on("error", (e) => { console.error("ws error", e.message); process.exit(1); });
setTimeout(() => { console.log("timeout"); process.exit(1); }, 210000);
