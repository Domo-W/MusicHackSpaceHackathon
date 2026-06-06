import "dotenv/config";
import path from "node:path";

function required(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) throw new Error(`Missing env ${name} (set it in .env)`);
  return v.trim();
}

export const CONFIG = {
  port: Number(process.env.PORT ?? 8787),

  // --- secrets (from gitignored .env) ---
  sunoApiKey: required("SUNO_API_KEY"),
  anthropicApiKey: required("ANTHROPIC_API_KEY"),

  // --- Suno ---
  sunoBaseUrl: "https://api.suno.com",
  // Cloudflare blocks default Python/Node UAs (error 1010) — always send a real one.
  userAgent: "BetweenSets/0.1 (+hackathon)",
  presetVoiceId: process.env.SUNO_VOICE_ID || undefined, // optional preset voice
  pollIntervalMs: 2000,
  maxGenWaitMs: 240_000,

  // --- Claude prompt agent ---
  // Opus 4.8 for best lyric quality (the show has huge timing headroom — Suno
  // completes in ~27s). Set AGENT_MODEL=claude-haiku-4-5 to trade quality for
  // speed/cost. Structured JSON output is supported on opus-4-8/sonnet-4-6/haiku-4-5.
  agentModel: process.env.AGENT_MODEL || "claude-opus-4-8",

  // --- show / timing ---
  defaultBpm: Number(process.env.DEFAULT_BPM ?? 120),
  fadeSeconds: Number(process.env.FADE_SECONDS ?? 2), // fade-out + fade-in transition length
  collectSeconds: Number(process.env.COLLECT_SECONDS ?? 50), // tug round / collection window
  targetSections: 6, // lyric sections → song length lever (calibrate at rehearsal)

  // --- local song archive ---
  // This is the current SongStore implementation. It can later be replaced by
  // a Supabase-backed store without changing the generation pipeline.
  songsDir: path.resolve(process.env.SONGS_DIR || "data/songs"),
} as const;

export type Config = typeof CONFIG;
