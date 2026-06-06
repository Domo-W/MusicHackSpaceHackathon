import type { Side } from "./types.js";

// Per-round tug-of-war aggregation.
//
// - `p` is the ROPE POSITION (0 = all the way to A, 1 = all the way to B). It is
//   CUMULATIVE within a round: each pull nudges it toward that side and it STAYS
//   there. winner() reads `p` (who is ahead), not the decaying drives.
// - `driveA`/`driveB` are DECAYING per-side energy (slosh/particles for the viz).
//   They fade between pulls via the decay tick.
// - `energy` is the recent pull RATE across both sides, normalized 0..1.
// - `membersA`/`membersB` are the distinct pullers per side THIS round.

const DECAY_PER_SEC = 1.6; // exponential decay rate for drive
const PULL_GAIN = 0.06; // how far one unit of impulse moves the rope
const DRIVE_GAIN = 1.0; // impulse → drive contribution
const ENERGY_WINDOW_MS = 2000; // window for "recent pull rate"
const ENERGY_FULL_RATE = 8; // pulls/sec across the crowd that reads as energy 1.0

let p = 0.5; // rope position 0..1
let driveA = 0;
let driveB = 0;
const membersA = new Set<string>();
const membersB = new Set<string>();

// Sliding window of recent pull timestamps for the energy estimate.
let pullTimes: number[] = [];

let lastTick = Date.now();

/** Begin a fresh round. Genres are passed for symmetry with the show flow. */
export function reset(_genreA?: unknown, _genreB?: unknown): void {
  p = 0.5;
  driveA = 0;
  driveB = 0;
  membersA.clear();
  membersB.clear();
  pullTimes = [];
  lastTick = Date.now();
}

/** Apply one (batched) pull from a participant toward a side. */
export function applyPull(participantId: string, side: Side, impulse: number): void {
  const amt = Math.max(0, Number.isFinite(impulse) ? impulse : 0);
  if (amt === 0) return;
  if (side === "A") {
    driveA += amt * DRIVE_GAIN;
    p = clamp01(p - amt * PULL_GAIN);
    membersA.add(participantId);
  } else {
    driveB += amt * DRIVE_GAIN;
    p = clamp01(p + amt * PULL_GAIN);
    membersB.add(participantId);
  }
  pullTimes.push(Date.now());
}

/** Decay tick — call on an interval. Fades drives and trims the energy window. */
export function tick(): void {
  const now = Date.now();
  const dt = (now - lastTick) / 1000;
  lastTick = now;
  if (dt > 0) {
    const factor = Math.exp(-DECAY_PER_SEC * dt);
    driveA *= factor;
    driveB *= factor;
  }
  const cutoff = now - ENERGY_WINDOW_MS;
  pullTimes = pullTimes.filter((t) => t >= cutoff);
}

function energy(): number {
  const now = Date.now();
  const cutoff = now - ENERGY_WINDOW_MS;
  const recent = pullTimes.filter((t) => t >= cutoff).length;
  const rate = recent / (ENERGY_WINDOW_MS / 1000); // pulls per second
  return clamp01(rate / ENERGY_FULL_RATE);
}

export interface TugSnapshot {
  p: number;
  driveA: number;
  driveB: number;
  membersA: number;
  membersB: number;
  energy: number;
}

export function snapshot(): TugSnapshot {
  return {
    p,
    driveA,
    driveB,
    membersA: membersA.size,
    membersB: membersB.size,
    energy: energy(),
  };
}

/** Winning side = whichever the rope is closer to. Tie → A (deterministic). */
export function winner(): Side {
  return p <= 0.5 ? "A" : "B";
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
