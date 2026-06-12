// Participant store. Tracks everyone who has joined, plus the INTENT answer each
// gave for the CURRENT collecting round. At the buzzer one of the people who
// answered this round is chosen at random. Returns null if NOBODY has answered,
// so the show can skip generation instead of inventing a fake song.

interface Participant {
  id: string;
  name: string;
  answer: string | null; // this round's intent; null = hasn't answered yet
  sim: boolean; // a simulated/test player — real players win selection over these
}

const byId = new Map<string, Participant>();
let seq = 0;
let lastSelectedId: string | null = null; // avoid picking the same person twice in a row

/** Register a participant; returns their stable id. `sim` marks test players. */
export function join(name: string, sim = false): string {
  seq += 1;
  const id = `p${seq}`;
  byId.set(id, { id, name: name.trim() || `Guest ${seq}`, answer: null, sim });
  return id;
}

/** Record (or overwrite) a participant's answer for the current round. */
export function setAnswer(participantId: string, text: string): void {
  const p = byId.get(participantId);
  if (!p) return;
  p.answer = text.trim();
}

/**
 * Round boundary. Intents PERSIST across rounds: returning players only re-vibe
 * and re-vote (they don't re-type their "I want to…"), so their most-recent
 * intent keeps them selectable every round. New intents simply overwrite.
 * Kept as a no-op so the round boundary can call it without wiping intents.
 */
export function clearRound(): void {
  /* intentionally empty — see selectRandomAnswerer's anti-repeat */
}

/** Drop a participant entirely (on disconnect). */
export function remove(participantId: string): void {
  byId.delete(participantId);
}

/** Blank slate: forget everyone (dashboard "Reset"). */
export function reset(): void {
  byId.clear();
  lastSelectedId = null;
}

/** Total joined participants (crowd size). */
export function count(): number {
  return byId.size;
}

/** All joined names, in join order (for the stage name cloud). */
export function names(): string[] {
  return [...byId.values()].map((p) => p.name);
}

/**
 * Pick a random participant among everyone who has submitted an intent (intents
 * persist across rounds). Prefers someone other than the previous pick so a
 * small group gets variety. Falls back to a sample seed only if NOBODY has ever
 * answered, so dry-runs still resolve.
 */
export function selectRandomAnswerer(): { name: string; answer: string } | null {
  const answered = [...byId.values()].filter(
    (p): p is Participant & { answer: string } => p.answer !== null && p.answer.length > 0,
  );
  if (answered.length === 0) return null; // nobody submitted — caller skips generation
  // Real (human) players win over simulated test players: if ANY real player
  // answered, pick from them — so a solo host surrounded by test players always
  // wins their own song. Sims are only selectable when no real player answered.
  const real = answered.filter((p) => !p.sim);
  const pool = real.length > 0 ? real : answered;
  // Avoid repeating the immediately-previous selection when there's a choice.
  const fresh = pool.length > 1 ? pool.filter((p) => p.id !== lastSelectedId) : pool;
  const choices = fresh.length > 0 ? fresh : pool;
  const pick = choices[Math.floor(Math.random() * choices.length)]!;
  lastSelectedId = pick.id;
  return { name: pick.name, answer: pick.answer };
}
