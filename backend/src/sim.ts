// Simulated players — a dev/test aid so a solo host can fill the room, hit the
// 2-player minimum, and run a believable show alone. Sims are real room members
// (so they count toward the crowd) AND real participants each round (name in the
// cloud + an "I want to…" intent in the selection pool), and they vote in the
// tug-of-war. Names + intents are drawn WITHOUT repeats until the pool is
// exhausted, so repeated solo tests don't feel stale.

import { broadcast } from "./bus.js";
import * as participants from "./participants.js";
import * as room from "./room.js";
import * as tug from "./tug.js";

const NAMES = [
  "Maya", "Theo", "Priya", "Marcus", "Lena", "Andre", "Sofia", "Jules", "Nico", "Tash",
  "Omar", "Bex", "Caleb", "Imani", "Rafa", "Zoe", "Dante", "Mila", "Khalil", "June",
  "Esme", "Tobi", "Carmen", "Felix", "Nadia", "Leo", "Aisha", "Mateo", "Ruby", "Sage",
  "Kofi", "Yara", "Devon", "Anika", "Bruno", "Cleo", "Idris", "Noor", "Remy", "Suki",
];

const INTENTS = [
  "I want to lose my mind", "I want to text my ex", "I want to fall in love twice",
  "I want to start a mosh pit", "I want one perfect night", "I want to forget about Monday",
  "I want the bass to fix my life", "I want my friends to scream this chorus",
  "I want to feel like the main character", "I want to dance until my shoes break",
  "I want to be somebody else tonight", "I want a song my mum can't hear",
  "I want to cry on the dance floor", "I want to fall for a stranger", "I want to glow in the dark",
  "I want to run away with everyone here", "I want to make this Tuesday legendary",
  "I want to be unforgettable", "I want to kiss someone reckless", "I want the night to never end",
  "I want to be loud for once", "I want to feel 17 again", "I want to dance like nobody's filming",
  "I want to set the room on fire",
];

interface Sim { key: string; name: string; pid: string | null; bias: number; intent: string }

let sims: Sim[] = [];
let seq = 0;
let nameBag: string[] = [];
let intentBag: string[] = [];

// Draw without repeats until the bag empties, then refill — so a solo tester
// running several sessions doesn't keep seeing the same names/prompts.
function draw(bag: string[], source: string[]): string {
  if (bag.length === 0) {
    // Fisher–Yates-ish shuffle without Math.random bias concerns (plain is fine here).
    const copy = source.slice();
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = copy[i]!; copy[i] = copy[j]!; copy[j] = t;
    }
    bag.push(...copy);
  }
  return bag.pop()!;
}
const freshName = () => draw(nameBag, NAMES);
const freshIntent = () => draw(intentBag, INTENTS);

/** How many sims are currently in the room. */
export function count(): number {
  return sims.length;
}

/** Add `n` simulated players: room members + participants (name + intent), and
 *  put their names on the stage cloud. Returns the new count. */
export function add(n: number): number {
  for (let i = 0; i < n; i++) {
    const name = freshName();
    const key = `sim-${++seq}`;
    const pid = participants.join(name, true);
    const intent = freshIntent();
    participants.setAnswer(pid, intent);
    room.addSimMember(key, name);
    sims.push({ key, name, pid, bias: 0.35 + Math.random() * 0.3, intent });
    broadcast({ type: "name", name });
  }
  broadcast({ type: "room_state", ...room.snapshot() });
  return sims.length;
}

/** Round boundary re-join: participants were wiped, so re-register each sim with
 *  a FRESH intent (kept varied round to round) and re-show their name. */
export function rejoinForRound(): void {
  for (const s of sims) {
    s.pid = participants.join(s.name, true);
    s.intent = freshIntent();
    participants.setAnswer(s.pid, s.intent);
    broadcast({ type: "name", name: s.name });
  }
}

/** Post the sims' intents onto the stage's gather feed, staggered like real
 *  people typing — called once gather is live so they don't get cleared by the
 *  new-round wipe. Mirrors what real phones do via handleAnswer. */
export function postIntentsToGather(): void {
  for (const s of sims) {
    const name = s.name;
    const text = s.intent;
    setTimeout(() => broadcast({ type: "intent", name, text }), 800 + Math.random() * 6000);
  }
}

/** One tug-of-war vote tick for the sims (called during the collecting phase). */
export function voteTick(): void {
  for (const s of sims) {
    if (s.pid) tug.applyPull(s.pid, Math.random() < s.bias ? "A" : "B", 0.6);
  }
}

/** Forget all sims (on show reset). */
export function reset(): void {
  sims = [];
  seq = 0;
  nameBag = [];
  intentBag = [];
}
