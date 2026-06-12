// Deterministic content sanitizer for everything that hits Suno (style, lyrics,
// title) and for the crowd's typed intents. Suno's moderation rejects profanity,
// slurs, and — annoyingly — false-positive "artist name"/"producer tag" matches on
// ordinary words (e.g. the reggae rhythm term "skank", "lowlight", "Niger"). A
// rejection costs a full generation round-trip, so we scrub KNOWN offenders BEFORE
// submitting and LEARN new ones from Suno's own error text at runtime.
//
// This is the deterministic first line of defense; the agent's LLM "strict re-craft"
// (agent.ts STRICT_SANITIZE) remains the fallback for generic "inappropriate
// material" rejections where Suno names no specific word.

// Map of lowercased offender → radio-clean replacement. Empty string = drop it.
// Two buckets: Suno false-positives (kept musical) and profanity (kept party-clean).
const REPLACEMENTS: Record<string, string> = {
  // ---- Suno false-positive flags (legit words it reads as artist/producer tags) ----
  skank: "offbeat", // reggae upstroke rhythm — Suno reads it as an artist name
  lowlight: "dim light",
  "low-light": "dim light",
  niger: "congo", // the river/region — Suno can't tell it from a slur
  broods: "moody", // band name false-positive
  // ---- profanity → upbeat, clean equivalents (keep the song singable) ----
  fuck: "funk",
  fucking: "funky",
  fucked: "funked",
  shit: "stuff",
  bullshit: "nonsense",
  bitch: "baby",
  bitches: "babies",
  bastard: "rascal",
  asshole: "jerk",
  ass: "attitude",
  damn: "dang",
  goddamn: "gosh",
  hell: "heck",
  piss: "tick",
  pissed: "ticked",
  dick: "dude",
  cock: "rooster",
  pussy: "kitty",
  slut: "star",
  whore: "star",
  // ---- slurs / hard blocks → removed entirely ----
  cunt: "",
  nigger: "",
  nigga: "",
  faggot: "",
  fag: "",
  retard: "",
  retarded: "",
};

// Words Suno named in a rejection THIS run — stripped from every later submission so
// the same generation succeeds on retry without re-crafting via the LLM.
const runtimeBlocked = new Set<string>();

/** Pull the specific offending word out of a Suno rejection message, if it names
 *  one ("artist name skank", "producer tag lowlight", "the word damn"). Returns the
 *  lowercased word, or null for generic "inappropriate material" rejections. */
export function parseBlockedWord(message: string | null | undefined): string | null {
  if (!message) return null;
  const m = /(?:artist name|producer tag|the word|tag)\s+["']?([A-Za-z][\w'-]*)/i.exec(message);
  return m ? m[1]!.toLowerCase() : null;
}

/** Record a word Suno rejected so subsequent submissions strip it deterministically. */
export function noteBlockedWord(word: string): void {
  const w = word.trim().toLowerCase();
  if (w) runtimeBlocked.add(w);
}

/** Test-only: forget runtime-learned words. */
export function resetRuntimeBlocked(): void {
  runtimeBlocked.clear();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Replace/remove a single whole word (case-insensitive), then tidy whitespace and
 *  stray punctuation left by a removal. */
export function stripWord(text: string, word: string, replacement = ""): string {
  if (!text || !word) return text;
  const re = new RegExp(`\\b${escapeRegExp(word)}\\b`, "gi");
  const out = text.replace(re, replacement);
  // Collapse the double spaces / dangling punctuation a removal can leave behind.
  return out.replace(/\s{2,}/g, " ").replace(/\s+([,.;:!?])/g, "$1").trim();
}

/** Core scrub: apply the known replacements + every runtime-learned blocked word. */
function scrub(text: string): string {
  if (!text) return text;
  let out = text;
  for (const [bad, good] of Object.entries(REPLACEMENTS)) out = stripWord(out, bad, good);
  for (const bad of runtimeBlocked) out = stripWord(out, bad, "");
  return out;
}

/** The crowd's typed "I want to…" — scrubbed before it's shown on stage, stored, or
 *  fed to the lyric agent, so one bad word can't poison the whole generation. */
export function sanitizeIntent(text: string): string {
  return scrub(text);
}

/** Suno `style` / tags field — the most rejection-prone (artist-name false positives). */
export function sanitizeStyle(style: string): string {
  return scrub(style);
}

/** Full lyrics body. */
export function sanitizeLyrics(lyrics: string): string {
  return scrub(lyrics);
}

/** Song title. */
export function sanitizeTitle(title: string): string {
  return scrub(title);
}
