#!/usr/bin/env node
/* ============================================================
   democrowd.mjs — a BELIEVABLE crowd for the demo video (not a stress test).
   Differences from loadtest.mjs:
     • No control socket — the REAL stage + DJ dashboard drive the show.
       Start the show from the dashboard as usual; this script only plays audience.
     • Realistic names; a STAR name gets shouted by ~35% of the crowd so it
       visibly trends and the generated song is about them.
     • Varied, funny intents (matching the VO script) instead of one canned line.
     • Staggered joins (wall fills up on camera) instead of a 2s burst.
     • Vote pulls follow a drama curve per round: one side leads early, the
       other side mounts a comeback in the last stretch.

   Usage: node scripts/democrowd.mjs [url] [N] [starName]
     node scripts/democrowd.mjs ws://localhost:8787 60 Dupes
   Ctrl-C to stop. Run it before (or right after) showing the join QR.
   ============================================================ */
import WebSocket from "ws";

const URL = process.argv[2] || "ws://localhost:8787";
const N = Number(process.argv[3] || 60);
const STAR = process.argv[4] || "Dupes";
const CODE = process.argv[5] || process.env.ROOM_CODE || null; // optional room code for hosted lobbies

const NAMES = [
  "Maya","Theo","Priya","Marcus","Lena","Andre","Sofia","Jules","Nico","Tash",
  "Omar","Bex","Caleb","Imani","Rafa","Zoe","Dante","Mila","Khalil","June",
  "Esme","Tobi","Carmen","Felix","Nadia","Leo","Aisha","Mateo","Ruby","Sage",
];
const INTENTS = [
  "I want to lose my mind",
  "I want to text my ex",
  "I want to fall in love twice",
  "I want my song played at my funeral",
  "I want everyone to know my name",
  "I want to dance until my shoes break",
  "I want to forget about Monday",
  "I want the bass to fix my life",
  "I want my friends to scream this chorus",
  "I want one perfect night",
  "I want to feel like the main character",
  "I want to start a mosh pit",
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = (a) => a[Math.floor(Math.random() * a.length)];
const jitter = (lo, hi) => lo + Math.random() * (hi - lo);

let connected = 0, joins = 0, intentsSent = 0, pullsSent = 0;
const clients = [];
let roundStartedAt = 0; // when we first saw the current round's tug
let currentRound = 0;

// Drama curve: fraction of the crowd pulling side A, as a function of seconds
// into the round. A leads early, B comes back hard late. Alternates per round
// so consecutive rounds don't look identical.
function sideABias(tSec, round) {
  const flip = round % 2 === 0;
  let bias;
  if (tSec < 8) bias = 0.66;        // A jumps out front
  else if (tSec < 16) bias = 0.55;  // B wakes up
  else bias = 0.40;                  // comeback — B takes it late
  return flip ? 1 - bias : bias;
}

function pickShoutName(i) {
  // ~35% of the crowd shouts the star; everyone else shouts a regular name.
  if (Math.random() < 0.35) return STAR;
  return NAMES[i % NAMES.length];
}

function makeClient(i) {
  const c = { id: i, ws: null, pid: null, myRound: 0, alive: true, tapHz: jitter(1.5, 4.5) };
  const ws = new WebSocket(URL, { perMessageDeflate: false, headers: { "User-Agent": "between-sets-democrowd" } });
  c.ws = ws;
  ws.on("open", () => { connected++; });
  ws.on("message", (raw) => {
    let m; try { m = JSON.parse(raw.toString()); } catch { return; }
    if (m.type === "joined") {
      c.pid = m.participantId;
      // Intent lands a beat after the name — like a real person reading the next screen.
      setTimeout(() => {
        if (c.alive && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "answer", participantId: c.pid, text: rnd(INTENTS) }));
          intentsSent++;
        }
      }, jitter(1500, 7000));
    } else if (m.type === "tug") {
      if (typeof m.round === "number" && m.round >= 1 && m.round > c.myRound) {
        c.myRound = m.round;
        if (m.round > currentRound) { currentRound = m.round; roundStartedAt = Date.now(); }
        // Staggered re-join: the wall fills over ~10s instead of all at once.
        setTimeout(() => {
          if (c.alive && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "join", name: pickShoutName(i), code: CODE || undefined }));
            joins++;
          }
        }, jitter(300, 10000));
      }
    }
  });
  ws.on("error", () => { c.alive = false; });
  ws.on("close", () => { c.alive = false; });
  return c;
}

async function main() {
  console.log(`[democrowd] target=${URL}  crowd=${N}  star="${STAR}"  code=${CODE || "(none)"}`);
  console.log(`[democrowd] no control socket — drive the show from the DJ dashboard as normal.`);
  // Trickle in over ~12s, like people scanning the QR one after another.
  for (let i = 0; i < N; i++) { clients.push(makeClient(i)); await sleep(jitter(50, 350)); }
  console.log(`[democrowd] ${connected}/${N} connected. Crowd is live — start the show whenever.`);

  // Vote taps: each client taps at its own human-ish rate; side follows the drama curve.
  setInterval(() => {
    const tSec = roundStartedAt ? (Date.now() - roundStartedAt) / 1000 : 0;
    const biasA = sideABias(tSec, currentRound);
    for (const c of clients) {
      if (!c.alive || c.ws.readyState !== WebSocket.OPEN || !c.pid) continue;
      if (Math.random() > c.tapHz / 10) continue; // tick is 100ms → tapHz taps/sec
      const side = Math.random() < biasA ? "A" : "B";
      c.ws.send(JSON.stringify({ type: "pull", participantId: c.pid, side, impulse: 0.6 }));
      pullsSent++;
    }
  }, 100);

  // Status line so you can see it breathing while you record.
  setInterval(() => {
    const alive = clients.filter((c) => c.alive && c.ws.readyState === WebSocket.OPEN).length;
    console.log(`[democrowd] round=${currentRound}  alive=${alive}  joins=${joins}  intents=${intentsSent}  pulls=${pullsSent}`);
  }, 5000);
}

process.on("SIGINT", () => {
  clients.forEach((c) => { try { c.ws.close(); } catch {} });
  console.log(`\n[democrowd] done. joins=${joins} intents=${intentsSent} pulls=${pullsSent}`);
  process.exit(0);
});
main();
