// ============================================================
// vibes.ts — the live "Pick the Vibe" poll.
// The DJ authors up to 4 vibe cards (the options); each phone reports the
// option index it currently has selected. We keep ONE pick per socket
// (re-picking overwrites, disconnect removes) so the tally = distinct phones
// per option. Index 0..3 is the stable key, NOT the card text (robust to edits).
// ============================================================

let cards: string[] = []; // current poll options (labels), index 0..3
const pickBySocket = new Map<number, number>(); // socketId -> chosen option index

/** DJ pushed new vibe cards → set the options and reset the tally. */
export function setCards(next: string[]): void {
  cards = (next || []).slice(0, 4).map((c) => String(c ?? "").trim());
  pickBySocket.clear();
}

/** The current poll options (non-empty labels only). */
export function getCards(): string[] {
  return cards.filter((c) => c.length > 0);
}

/** A phone selected an option this round. Ignored if out of range / no poll. */
export function recordPick(socketId: number, index: number): void {
  const live = getCards();
  if (live.length === 0) return;
  if (!Number.isInteger(index) || index < 0 || index >= live.length) return;
  pickBySocket.set(socketId, index);
}

/** Drop a phone's pick (on disconnect). */
export function removeSocket(socketId: number): void {
  pickBySocket.delete(socketId);
}

/** Counts per option index + total — distinct phones per option. */
export function tally(): { counts: number[]; total: number } {
  const live = getCards();
  const counts = live.map(() => 0);
  let total = 0;
  for (const idx of pickBySocket.values()) {
    if (idx >= 0 && idx < counts.length) {
      counts[idx] = (counts[idx] ?? 0) + 1;
      total += 1;
    }
  }
  return { counts, total };
}

/** Blank slate (show reset). */
export function reset(): void {
  cards = [];
  pickBySocket.clear();
}
