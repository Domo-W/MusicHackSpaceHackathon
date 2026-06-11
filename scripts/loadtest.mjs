#!/usr/bin/env node
/* ============================================================
   loadtest.mjs — stress the backend with a hackathon-sized crowd, exercising the
   REAL worst case (not just steady state):
     • BURST connect — all N sockets in ~2s, like a QR appearing on the projector.
     • Per-round RE-JOIN storm — every round the backend clears everyone and each
       phone re-joins, so each round is ~N joins + an N×N `name` broadcast burst,
       inside the 15s gather window. (This path is what we actually ship now.)
     • Continuous vote taps (batched pulls) + an intent per round.
   A control socket drives the show and advances rounds (it stands in for the stage
   reporting `playing`, so we can cycle rounds fast without waiting on Suno).

   Usage: node scripts/loadtest.mjs [url] [N] [rounds] [secPerRound]
     node scripts/loadtest.mjs ws://localhost:8787 100 6 5
     node scripts/loadtest.mjs wss://between-sets.onrender.com 100 6 5
   ============================================================ */
import WebSocket from "ws";

const URL = process.argv[2] || "ws://localhost:8787";
const N = Number(process.argv[3] || 100);
const ROUNDS = Number(process.argv[4] || 6);
const SEC_PER_ROUND = Number(process.argv[5] || 5);
const CODE = process.argv[6] || null; // optional room code for hosted lobbies
const PULL_HZ = 4;
const EXPECTED_TUG_HZ = 15;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NAMES = ["Alex","Sam","Jordan","Riley","Casey","Taylor","Jamie","Morgan","Dre","Kai","Nova","Zane","Lux","Remy","Sky"];
const rnd = (a) => a[Math.floor(Math.random() * a.length)];

let connected = 0, connErrors = 0, totalTugRx = 0, totalPullTx = 0, totalJoins = 0, totalRejoins = 0;
const gaps = [];
const clients = [];
let testDeadline = 0;

function makeClient(i) {
  const c = { id: i, ws: null, pid: null, myRound: 0, tugRx: 0, lastTug: 0, alive: true };
  const ws = new WebSocket(URL, { perMessageDeflate: false, headers: { "User-Agent": "between-sets-loadtest" } });
  c.ws = ws;
  ws.on("open", () => { connected++; });
  ws.on("message", (raw) => {
    let m; try { m = JSON.parse(raw.toString()); } catch { return; }
    if (m.type === "joined") {
      c.pid = m.participantId;
      ws.send(JSON.stringify({ type: "answer", participantId: c.pid, text: "dance all night" }));
    } else if (m.type === "tug") {
      c.tugRx++; totalTugRx++;
      const now = Date.now();
      if (c.lastTug && c.tugRx % 5 === 0) gaps.push(now - c.lastTug);
      c.lastTug = now;
      // Re-join at the start of every round (the new per-round behavior).
      if (typeof m.round === "number" && m.round >= 1 && m.round > c.myRound) {
        c.myRound = m.round;
        ws.send(JSON.stringify({ type: "join", name: rnd(NAMES) + i, code: CODE || undefined }));
        if (m.round === 1) totalJoins++; else totalRejoins++;
      }
    }
  });
  ws.on("error", () => { connErrors++; c.alive = false; });
  ws.on("close", () => { c.alive = false; });
  return c;
}

async function main() {
  console.log(`[loadtest] target=${URL}  clients=${N}  rounds=${ROUNDS} @ ${SEC_PER_ROUND}s  (burst connect + per-round re-join)`);
  // BURST connect — all N within ~2s (no ramp), like everyone scanning at once.
  console.log(`[loadtest] burst-connecting ${N}…`);
  for (let i = 0; i < N; i++) { clients.push(makeClient(i)); if (i % 25 === 24) await sleep(300); }
  await sleep(2000);
  console.log(`[loadtest] connected=${connected}/${N}  errors=${connErrors}`);

  // control socket = stands in for the stage; drives the show + advances rounds.
  const ctl = new WebSocket(URL, { headers: { "User-Agent": "between-sets-loadtest-ctl" } });
  await new Promise((res) => ctl.on("open", res));
  const send = (o) => ctl.send(JSON.stringify(o));
  send({ type: "reset" }); await sleep(1000);
  send({ type: "start" }); await sleep(800);

  // vote taps for everyone, continuously
  const pullTimer = setInterval(() => {
    for (const c of clients) {
      if (c.alive && c.ws.readyState === WebSocket.OPEN && c.pid) {
        c.ws.send(JSON.stringify({ type: "pull", participantId: c.pid, side: Math.random() < 0.5 ? "A" : "B", impulse: 0.6 }));
        totalPullTx++;
      }
    }
  }, Math.round(1000 / PULL_HZ));

  testDeadline = Date.now() + ROUNDS * SEC_PER_ROUND * 1000;
  let lastRx = 0, lastT = Date.now();
  for (let r = 1; r <= ROUNDS; r++) {
    // advance a round (control plays the "next song" → backend opens the next round,
    // clearing everyone for r>1 → the re-join storm).
    send({ type: "playing", id: `loadtest-song-${r}` });
    await sleep(SEC_PER_ROUND * 1000);
    const now = Date.now(), drx = totalTugRx - lastRx, dt = (now - lastT) / 1000;
    const alive = clients.filter((c) => c.alive && c.ws.readyState === WebSocket.OPEN).length;
    console.log(`[loadtest] round ${r}: alive=${alive}  tugRx=${Math.round(drx / dt)}/s  rejoins=${totalRejoins}  pulls≈${totalPullTx}`);
    lastRx = totalTugRx; lastT = now;
  }
  clearInterval(pullTimer);
  send({ type: "reset" }); // leave the show clean
  await sleep(500);

  const alive = clients.filter((c) => c.alive && c.ws.readyState === WebSocket.OPEN).length;
  const per = clients.map((c) => c.tugRx);
  const avg = per.reduce((a, b) => a + b, 0) / Math.max(1, per.length);
  const dur = ROUNDS * SEC_PER_ROUND;
  const ideal = EXPECTED_TUG_HZ * dur;
  gaps.sort((a, b) => a - b);
  const p = (q) => (gaps.length ? gaps[Math.min(gaps.length - 1, Math.floor(q * gaps.length))] : 0);
  console.log("\n================ LOAD TEST REPORT ================");
  console.log(`target            : ${URL}`);
  console.log(`clients           : ${N}   connected: ${connected}   alive at end: ${alive}   conn errors: ${connErrors}`);
  console.log(`round joins        : ${totalJoins} (round 1)   re-joins: ${totalRejoins} (rounds 2+)`);
  console.log(`pulls sent         : ${totalPullTx}`);
  console.log(`tug per client     : avg ${avg.toFixed(0)}  min ${Math.min(...per)}  max ${Math.max(...per)}  (ideal ≈ ${ideal})`);
  console.log(`delivery ratio     : ${(avg / ideal * 100).toFixed(1)}%`);
  console.log(`tug gap (≈67ms)    : p50 ${p(0.5)}  p95 ${p(0.95)}  p99 ${p(0.99)}  max ${gaps[gaps.length-1]||0} ms`);
  const ok = alive >= N * 0.98 && avg / ideal > 0.85 && p(0.95) < 400 && totalRejoins > 0;
  console.log(ok ? "VERDICT: ✅ held through burst connect + per-round re-join storm"
                 : "VERDICT: ⚠️  degraded under burst/re-join — see drops / delivery / gaps");
  console.log("==================================================");
  clients.forEach((c) => { try { c.ws.close(); } catch {} }); try { ctl.close(); } catch {}
  setTimeout(() => process.exit(0), 500);
}
main();
