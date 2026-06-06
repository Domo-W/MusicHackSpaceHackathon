import { CONFIG } from "./config.js";
import { broadcast } from "./bus.js";
import { craftSongPrompt } from "./agent.js";
import { generateSong } from "./suno.js";
import { songStore } from "./songStore.js";
import { genreBpm } from "./tempo.js";
import * as participants from "./participants.js";
import * as tug from "./tug.js";
import type { GenreInfo, Phase, Seed, Side, Song } from "./types.js";

// The real Between Sets flow, built on the generate-one-ahead spine.
//
// A song is always playing (or cold-start silent) while the NEXT round COLLECTS
// audience input. At the collecting buzzer the winning genre + a selected
// participant become a Seed → the EXISTING pipeline (craftSongPrompt →
// generateSong) produces the next song. The pipeline gate releases the moment a
// song is PLAYABLE (onPlayable), never at complete, so the next round can begin.

// ---------------- config / defaults ----------------
let question = "What do you want to do tonight?";
let genreA: GenreInfo = { key: "A", name: "NEW FUNK", short: "FNK", color: "#00E5FF" };
let genreB: GenreInfo = { key: "B", name: "NEW SOUL", short: "SOL", color: "#FF1A8C" };
let collectSeconds = CONFIG.collectSeconds;

// ---------------- runtime state ----------------
let started = false;
let generating = false;
let held = false;
let roundIndex = 0;
let phase: Phase = "idle";
let generationEpoch = 0;
let generationJobSequence = 0;
let activeGenerationJobId: number | null = null;
let latestGeneration: { jobId: number; songId: string } | null = null;
const cancelledGenerationJobs = new Set<number>();
let songSequence = 0;
let currentBpm = CONFIG.defaultBpm;
let lastPlayingId = "";
const songBpms = new Map<string, number>();

let collectEndsAt = 0; // epoch ms when the current collecting window buzzes
let buzzerTimer: NodeJS.Timeout | null = null;
let tugLoop: NodeJS.Timeout | null = null; // decay + ~15Hz snapshot broadcast

const SNAPSHOT_HZ = 15;

// Initialize the tug with default genres at module load so any pulls that arrive
// BEFORE `start` still accumulate into round 1 (cold start uses real input too).
tug.reset(genreA, genreB);
// Broadcast state continuously from boot — even in idle/lobby — so the stage can
// show the "scan to join" lobby (crowd count, phase) before the DJ starts.
startTugLoop();

// Periodically re-broadcast the name list so a freshly-loaded stage seeds its
// name cloud even if it missed the connect-time snapshot. The client reconciles
// idempotently (adds missing, removes gone) so this never causes a flicker.
setInterval(() => broadcast({ type: "names", names: participants.names() }), 4000);

// ---------------- public message handlers ----------------

/** Reset everything to a blank lobby state (dashboard "Reset"). */
export function reset(): void {
  started = false;
  held = false;
  generating = false;
  generationEpoch += 1;
  activeGenerationJobId = null;
  latestGeneration = null;
  cancelledGenerationJobs.clear();
  roundIndex = 0;
  phase = "idle";
  currentBpm = CONFIG.defaultBpm;
  lastPlayingId = "";
  if (buzzerTimer) {
    clearTimeout(buzzerTimer);
    buzzerTimer = null;
  }
  tug.reset(genreA, genreB);
  participants.reset();
  console.log("[show] reset → blank lobby");
  broadcast({ type: "show_reset" });
  broadcast({ type: "names", names: [] }); // clear the stage name cloud
  broadcastTug();
}

/** Dashboard pressed Start. Begin COLLECTING round 1 (cold start). */
export function startShow(): void {
  if (started) return;
  started = true;
  roundIndex = 0;
  held = false;
  console.log("[show] starting — collecting round 1");
  beginCollecting();
}

/**
 * The stage reports a song became the current track. Broadcast now_playing and
 * (unless held) start the NEXT collecting round so the next song generates one
 * ahead. This is the round boundary where we reset tug + answers.
 */
export function onPlaying(id: string): void {
  if (id === lastPlayingId) return;
  lastPlayingId = id;
  currentBpm = songBpms.get(id) ?? currentBpm;
  broadcast({ type: "now_playing", id });
  console.log(`[show] now playing ${id}`);
  if (held) {
    console.log("[show] held — not advancing to next round");
    return;
  }
  beginCollecting();
}

/** config: set the question, the two genres, and the collect window. */
export function applyConfig(msg: {
  question?: string;
  genreA?: GenreInfo;
  genreB?: GenreInfo;
  collectSeconds?: number;
}): void {
  if (typeof msg.question === "string") question = msg.question;
  if (msg.genreA) genreA = { ...msg.genreA, key: "A" };
  if (msg.genreB) genreB = { ...msg.genreB, key: "B" };
  if (typeof msg.collectSeconds === "number" && msg.collectSeconds > 0) {
    collectSeconds = msg.collectSeconds;
  }
  console.log(
    `[show] config: question="${question}" A=${genreA.name} B=${genreB.name} collect=${collectSeconds}s`,
  );
}

/** skip: drop the queued/generating song and re-run the current round. */
export function skip(): void {
  console.log("[show] skip — re-running current round generation");
  if (latestGeneration) {
    cancelledGenerationJobs.add(latestGeneration.jobId);
    broadcast({ type: "song_cancelled", id: latestGeneration.songId });
  }
  activeGenerationJobId = null;
  generating = false; // release the gate so generateNext can fire again
  // Re-resolve from whatever input we currently have for this round.
  resolveAndGenerate();
}

/** hold: keep the current song playing, pause advancing to the next round. */
export function hold(): void {
  held = true;
  console.log("[show] hold — advancing paused");
}

/** resume: undo hold. If we're idling between rounds, advance now. */
export function resume(): void {
  if (!held) return;
  held = false;
  console.log("[show] resume — advancing re-enabled");
  if (started && phase === "playing") beginCollecting();
}

/** endVote: force the current collecting round to resolve NOW (testing). */
export function endVote(): void {
  if (phase !== "collecting") {
    console.log("[show] endVote ignored — not collecting");
    return;
  }
  if (buzzerTimer) {
    clearTimeout(buzzerTimer);
    buzzerTimer = null;
  }
  console.log("[show] endVote — forcing buzzer");
  onBuzzer();
}

// ---------------- collecting ----------------

function beginCollecting(): void {
  roundIndex += 1;
  // Round boundary: reset the tug + everyone's answers for the new round.
  // EXCEPTION: round 1 is a cold start — pulls/answers that arrived BEFORE the
  // operator pressed Start must carry in, so do NOT reset on the first round.
  if (roundIndex > 1) {
    tug.reset(genreA, genreB);
    participants.clearRound();
  }
  phase = "collecting";
  collectEndsAt = Date.now() + collectSeconds * 1000;

  if (buzzerTimer) clearTimeout(buzzerTimer);
  buzzerTimer = setTimeout(onBuzzer, collectSeconds * 1000);

  startTugLoop();
  console.log(`[show] collecting round ${roundIndex} for ${collectSeconds}s`);
}

function startTugLoop(): void {
  if (tugLoop) return;
  tugLoop = setInterval(() => {
    tug.tick();
    broadcastTug();
  }, Math.round(1000 / SNAPSHOT_HZ));
}

function broadcastTug(): void {
  const s = tug.snapshot();
  const timeRemaining =
    phase === "collecting" ? Math.max(0, (collectEndsAt - Date.now()) / 1000) : 0;
  broadcast({
    type: "tug",
    phase,
    round: roundIndex,
    question,
    genres: { A: genreA, B: genreB },
    p: s.p,
    driveA: s.driveA,
    driveB: s.driveB,
    membersA: s.membersA,
    membersB: s.membersB,
    timeRemaining,
    crowdSize: participants.count(),
    energy: s.energy,
    bpm: currentBpm,
  });
}

function onBuzzer(): void {
  buzzerTimer = null;
  console.log(`[show] buzzer for round ${roundIndex}`);
  resolveAndGenerate();
}

// ---------------- resolve → generate ----------------

/** Resolve the tug winner + selected participant, then run the pipeline. */
function resolveAndGenerate(): void {
  const winnerSide: Side = tug.winner();
  const genre = winnerSide === "A" ? genreA.name : genreB.name;
  const { name, answer } = participants.selectRandomAnswerer();

  broadcast({ type: "round_result", winner: winnerSide, genre, name, answer, roundIndex });
  console.log(`[show] round ${roundIndex} → ${winnerSide} (${genre}) — selected ${name}`);

  const seed: Seed = { name, answer, genre };
  void generateNext(seed);
}

/**
 * Craft + generate one song. The pipeline gate (`generating`) releases as soon
 * as the song is PLAYABLE (streaming) — NOT when it fully completes — so the
 * next round can start while `complete` polling continues in the background.
 */
async function generateNext(seed: Seed): Promise<void> {
  if (generating) {
    console.log("[show] generateNext skipped — already generating");
    return;
  }
  generating = true;
  phase = "generating";
  const epoch = generationEpoch;
  const jobId = ++generationJobSequence;
  const id = `song-${Date.now()}-${++songSequence}`;
  activeGenerationJobId = jobId;
  latestGeneration = { jobId, songId: id };
  const bpm = genreBpm(seed.genre);
  songBpms.set(id, bpm);

  const isCurrentJob = () =>
    epoch === generationEpoch && !cancelledGenerationJobs.has(jobId);

  const releaseGate = () => {
    if (activeGenerationJobId === jobId && generating) {
      activeGenerationJobId = null;
      generating = false;
      // The current song is now playable/queued; treat the stage as "playing"
      // for our phase-tracking until the stage confirms via onPlaying.
      phase = "playing";
    }
  };

  try {
    broadcast({ type: "generating", seed, roundIndex });
    console.log(`[show] ${id}: crafting lyrics for ${seed.name} / ${seed.genre}`);
    const prompt = await craftSongPrompt(seed);

    const song: Song = {
      id,
      title: prompt.title,
      name: seed.name,
      genre: seed.genre,
      bpm,
      lyrics: prompt.lyrics,
      streamUrl: "",
      finalUrl: "",
    };

    // Fire the generation; release the gate the moment it's playable.
    generateSong(prompt, {
      onPlayable: (url) => {
        if (!isCurrentJob()) return;
        song.streamUrl = url;
        console.log(`[show] ${id}: playable (streaming) → sending to stage; gate released`);
        broadcast({ type: "song_ready", song: { ...song } });
        releaseGate(); // next round may begin now
      },
    })
      .then(async (result) => {
        if (!isCurrentJob()) return;
        song.finalUrl = result.finalUrl;
        broadcast({ type: "song_final", id, finalUrl: result.finalUrl });
        console.log(`[show] ${id}: complete in ${(result.msToComplete / 1000).toFixed(1)}s`);
        try {
          const saved = await songStore.save(song, result.finalUrl);
          broadcast({ type: "song_saved", song: saved });
          console.log(`[show] ${id}: saved locally as ${saved.fileName}`);
        } catch (err) {
          console.error(`[show] ${id}: local save failed —`, (err as Error).message);
        }
      })
      .catch((err) => {
        if (isCurrentJob()) {
          console.error(`[show] ${id}: generation failed —`, (err as Error).message);
        }
      })
      .finally(releaseGate); // safety: release if it errored before playable
  } catch (err) {
    console.error(`[show] ${id}: prompt failed —`, (err as Error).message);
    releaseGate();
  }
}

// ---------------- audience input passthrough ----------------

export function handlePull(participantId: string, side: Side, impulse: number): void {
  tug.applyPull(participantId, side, impulse);
}

export function handleAnswer(participantId: string, text: string): void {
  participants.setAnswer(participantId, text);
}
