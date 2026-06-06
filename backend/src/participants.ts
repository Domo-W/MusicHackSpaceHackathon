import { nextSeed } from "./seeds.js";

// Participant store. Tracks everyone who has joined, plus the INTENT answer each
// gave for the CURRENT collecting round. At the buzzer one of the people who
// answered this round is chosen at random. Falls back to a sample seed (name +
// answer only) if nobody answered, so dry-runs still resolve a round.

interface Participant {
  id: string;
  name: string;
  answer: string | null; // this round's intent; null = hasn't answered yet
}

const byId = new Map<string, Participant>();
let seq = 0;
let lastSelectedId: string | null = null; // avoid picking the same person twice in a row

/** Register a participant; returns their stable id. */
export function join(name: string): string {
  seq += 1;
  const id = `p${seq}`;
  byId.set(id, { id, name: name.trim() || `Guest ${seq}`, answer: null });
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
export function selectRandomAnswerer(): { name: string; answer: string } {
  const answered = [...byId.values()].filter(
    (p): p is Participant & { answer: string } => p.answer !== null && p.answer.length > 0,
  );
  if (answered.length === 0) {
    const s = nextSeed(); // genre stripped by caller — only name + answer used here
    return { name: s.name, answer: s.answer };
  }
  // Avoid repeating the immediately-previous selection when there's a choice.
  const fresh = answered.length > 1 ? answered.filter((p) => p.id !== lastSelectedId) : answered;
  const choices = fresh.length > 0 ? fresh : answered;
  const pick = choices[Math.floor(Math.random() * choices.length)]!;
  lastSelectedId = pick.id;
  return { name: pick.name, answer: pick.answer };
}
