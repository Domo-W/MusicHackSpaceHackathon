import { CONFIG } from "./config.js";
import { broadcast } from "./bus.js";
import { craftSongPrompt, craftOpenerPrompt } from "./agent.js";
import { generateSong } from "./suno.js";
import { songStore } from "./songStore.js";
import { genreBpm } from "./tempo.js";
import * as participants from "./participants.js";
import * as vibes from "./vibes.js";
import * as tug from "./tug.js";
import type { GenreInfo, Phase, SavedSong, Seed, ShowState, Side, Song } from "./types.js";

// The real Between Sets flow, built on the generate-one-ahead spine.
//
// A song is always playing (or cold-start silent) while the NEXT round COLLECTS
// audience input. At the collecting buzzer the winning genre + a selected
// participant become a Seed → the EXISTING pipeline (craftSongPrompt →
// generateSong) produces the next song. The pipeline gate releases the moment a
// song is PLAYABLE (onPlayable), never at complete, so the next round can begin.

// ---------------- config / defaults ----------------
let question = "What do you want to do tonight?";
const genre = (key: Side, name: string, short: string): GenreInfo => ({
  key,
  name,
  short,
  color: key === "A" ? "#00E5FF" : "#FF1A8C",
});
const AUTO_GENRE_PAIRS: Array<{ A: GenreInfo; B: GenreInfo }> = [
  { A: genre("A", "Soca", "SOC"), B: genre("B", "Afrobeats", "AFR") },
  { A: genre("A", "Dancehall", "DHL"), B: genre("B", "Pop", "POP") },
  { A: genre("A", "Reggae", "REG"), B: genre("B", "Tropical House", "TRP") },
  { A: genre("A", "Country", "CTY"), B: genre("B", "Pop Rock", "RCK") },
  { A: genre("A", "Afrobeats", "AFR"), B: genre("B", "Dancehall", "DHL") },
  { A: genre("A", "Pop", "POP"), B: genre("B", "Soca", "SOC") },
  { A: genre("A", "Tropical House", "TRP"), B: genre("B", "Country", "CTY") },
  { A: genre("A", "Pop Rock", "RCK"), B: genre("B", "Reggae", "REG") },
];
let genreA: GenreInfo = { ...AUTO_GENRE_PAIRS[0]!.A };
let genreB: GenreInfo = { ...AUTO_GENRE_PAIRS[0]!.B };
let gatherSeconds = CONFIG.gatherSeconds;
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
let activeSeed: Seed | undefined;
let generationError: string | undefined;
let genreSource: "auto" | "dj" = "auto";
let autoGenrePairIndex = 0;
let pendingGenreOverride: { A: GenreInfo; B: GenreInfo } | null = null;
// When the show has ended, the recap playlist is held here so a phone that scans
// the end-of-set QR FRESH (a new connection) can still be shown the recap. Cleared
// on reset and when a new collecting round begins (the set is live again).
let endedRecap: SavedSong[] | null = null;
// The songs generated DURING the current set (since start/reset). The end-of-set
// recap shows only these — not every track ever archived across past sets.
let setSongs: SavedSong[] = [];
const songBpms = new Map<string, number>();

let collectEndsAt = 0; // epoch ms when the current collecting window buzzes
let gatherEndsAt = 0; // epoch ms when the name-cloud window opens voting
let gatherTimer: NodeJS.Timeout | null = null; // name-cloud window → opens voting
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

export function currentShowState(): ShowState {
  return {
    started,
    held,
    phase,
    round: roundIndex,
    genres: { A: genreA, B: genreB },
    genreSource,
    seed: activeSeed,
    error: generationError,
  };
}

/** The recap playlist if the show has ended (else null) — to seed late scanners. */
export function currentRecap(): SavedSong[] | null {
  return endedRecap;
}

/** Songs generated during the CURRENT set (cleared on reset/start) — the
 *  dashboard's Session Setlist, distinct from the full cross-set archive. */
export function currentSetSongs(): SavedSong[] {
  return setSongs.slice();
}

function broadcastShowState(): void {
  broadcast({ type: "show_state", ...currentShowState() });
}

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
  activeSeed = undefined;
  generationError = undefined;
  genreSource = "auto";
  autoGenrePairIndex = 0;
  pendingGenreOverride = null;
  endedRecap = null;
  setSongs = [];
  genreA = { ...AUTO_GENRE_PAIRS[0]!.A };
  genreB = { ...AUTO_GENRE_PAIRS[0]!.B };
  if (gatherTimer) {
    clearTimeout(gatherTimer);
    gatherTimer = null;
  }
  if (buzzerTimer) {
    clearTimeout(buzzerTimer);
    buzzerTimer = null;
  }
  tug.reset(genreA, genreB);
  participants.reset();
  vibes.reset();
  console.log("[show] reset → blank lobby");
  broadcast({ type: "show_reset" });
  broadcast({ type: "names", names: [] }); // clear the stage name cloud
  broadcast({ type: "vibe_options", cards: [] }); // clear the vibe poll
  broadcast({ type: "vibe_tally", counts: [], total: 0 });
  broadcastShowState();
  broadcastTug();
}

/**
 * Dashboard pressed "End show". Stop advancing and broadcast the recap: the set
 * the crowd made tonight (the locally saved songs). Phones flip to ScreenRecap;
 * the stage shows the finale. The pipeline gate / generationEpoch is left as-is
 * (a later `reset` fully clears state for the next show).
 */
export async function endShow(): Promise<void> {
  started = false;
  held = false;
  phase = "idle";
  if (gatherTimer) {
    clearTimeout(gatherTimer);
    gatherTimer = null;
  }
  if (buzzerTimer) {
    clearTimeout(buzzerTimer);
    buzzerTimer = null;
  }
  // Only THIS set's songs — not every track ever archived across past sets.
  const songs: SavedSong[] = setSongs.slice();
  endedRecap = songs; // seed late scanners (new connections) with this set's recap
  console.log(`[show] ended — broadcasting recap (${songs.length} tracks from this set)`);
  broadcast({ type: "show_ended", songs });
  broadcastShowState(); // started=false → dashboard re-enables "Start Show"
  broadcastTug();
}

// The fixed opener track the stage plays the instant the show starts — no
// generation, no "crafting your song" tease. Served statically from
// frontend/assets so it resolves on both localhost and the Render host.
const OPENER_URL = "/assets/opener.m4a";

/**
 * Broadcast the fixed opener track as the first "song" so the stage plays it
 * from silence immediately. There is NO generation step, so phones never hit the
 * loading/"generating" screen — they sit on the NAME screen while it plays. The
 * stage's onPlaying (fired by AudioEngine.makeCurrent) then opens round 1
 * collecting for song-2, exactly like the steady-state loop.
 */
function playOpenerTrack(): void {
  const id = `song-opener-${Date.now()}`;
  const song: Song = {
    id,
    title: "In Between — Opener",
    name: "BETWEEN SETS",
    genre: "",
    bpm: currentBpm,
    lyrics: "",
    streamUrl: OPENER_URL,
    finalUrl: OPENER_URL,
  };
  songBpms.set(id, currentBpm);
  console.log(`[show] opener → playing fixed track ${OPENER_URL}`);
  broadcast({ type: "song_ready", song });
}

/** Dashboard pressed Start. Play the fixed opener, then COLLECT round 1. */
export function startShow(_opener?: { prompt: string; genre: string }): void {
  if (started) return;
  started = true;
  roundIndex = 0;
  held = false;
  setSongs = []; // a fresh set — the recap reflects only what's made from here
  endedRecap = null;
  // Stay on the name-cloud view from the start (phase "gathering", not "playing")
  // so there's no lobby→battle→lobby flicker. The fixed opener plays from silence;
  // its onPlaying opens the real 15s gather window (round 1), then voting.
  phase = "gathering";
  console.log("[show] starting — fixed opener track, then gather → vote");
  playOpenerTrack();
  broadcastShowState();
}

/**
 * The stage reports a song became the current track. Broadcast now_playing and
 * (unless held) start the NEXT collecting round so the next song generates one
 * ahead. This is the round boundary where we reset tug + answers.
 */
export function onPlaying(id: string): void {
  // If the show isn't running (e.g. after reset/end), ignore stray "playing"
  // reports from a stage still looping audio — otherwise the round keeps
  // advancing and generating forever (zombie loop).
  if (!started) return;
  if (id === lastPlayingId) return;
  lastPlayingId = id;
  currentBpm = songBpms.get(id) ?? currentBpm;
  broadcast({ type: "now_playing", id });
  console.log(`[show] now playing ${id}`);
  broadcastShowState();
  if (held) {
    console.log("[show] held — not advancing to next round");
    return;
  }
  beginGathering();
}

/** config: set the question, the two genres, and the collect window. */
export function applyConfig(msg: {
  question?: string;
  genreA?: GenreInfo;
  genreB?: GenreInfo;
  collectSeconds?: number;
  genreOverride?: boolean;
}): void {
  if (typeof msg.question === "string") question = msg.question;
  if (msg.genreA || msg.genreB) {
    pendingGenreOverride = {
      A: msg.genreA ? { ...msg.genreA, key: "A" } : { ...genreA, key: "A" },
      B: msg.genreB ? { ...msg.genreB, key: "B" } : { ...genreB, key: "B" },
    };
  }
  if (typeof msg.collectSeconds === "number" && msg.collectSeconds > 0) {
    collectSeconds = msg.collectSeconds;
  }
  console.log(
    `[show] config: question="${question}" override=${pendingGenreOverride ? `${pendingGenreOverride.A.name}/${pendingGenreOverride.B.name}` : "none"} collect=${collectSeconds}s`,
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
  generationError = undefined;
  // Re-resolve from whatever input we currently have for this round.
  resolveAndGenerate();
}

/** hold: keep the current song playing, pause advancing to the next round. */
export function hold(): void {
  held = true;
  console.log("[show] hold — advancing paused");
  broadcastShowState();
}

/** resume: undo hold. If we're idling between rounds, advance now. */
export function resume(): void {
  if (!held) return;
  held = false;
  console.log("[show] resume — advancing re-enabled");
  broadcastShowState();
  if (started && phase === "playing") beginGathering();
}

/** endVote: force the current collecting round to resolve NOW (testing). */
export function endVote(): void {
  if (phase !== "collecting") {
    console.log("[show] endVote ignored — not collecting");
    broadcastShowState();
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

/**
 * Start a round with the NAME-CLOUD window (phase "gathering"): the stage shows
 * the name cloud, people join + submit intents, no voting yet. After
 * `gatherSeconds` the tug-of-war vote opens (beginVoting). This is the round
 * boundary — genre pick + tug/answer reset happen here.
 */
function beginGathering(): void {
  roundIndex += 1;
  const automaticPair = AUTO_GENRE_PAIRS[autoGenrePairIndex % AUTO_GENRE_PAIRS.length]!;
  autoGenrePairIndex += 1;
  if (pendingGenreOverride) {
    genreA = { ...pendingGenreOverride.A };
    genreB = { ...pendingGenreOverride.B };
    pendingGenreOverride = null;
    genreSource = "dj";
  } else {
    genreA = { ...automaticPair.A };
    genreB = { ...automaticPair.B };
    genreSource = "auto";
  }
  // Round boundary: reset the tug + clear EVERYONE so each round starts fresh —
  // the crowd re-submits their name (and intent) every round, so the name cloud
  // reflects who's in for THIS round. EXCEPTION: round 1 is a cold start — joins
  // that arrived BEFORE the operator pressed Start must carry in.
  if (roundIndex > 1) {
    tug.reset(genreA, genreB);
    participants.reset();
    broadcast({ type: "names", names: [] }); // clear the stage name cloud immediately
  }
  phase = "gathering";
  endedRecap = null; // a new round means the set is live again, not in recap
  activeSeed = undefined;
  generationError = undefined;

  // No buzzer yet — just run the name-cloud window, then open voting.
  gatherEndsAt = Date.now() + gatherSeconds * 1000;
  if (buzzerTimer) { clearTimeout(buzzerTimer); buzzerTimer = null; }
  if (gatherTimer) clearTimeout(gatherTimer);
  gatherTimer = setTimeout(beginVoting, gatherSeconds * 1000);

  startTugLoop();
  console.log(`[show] gathering (name cloud) round ${roundIndex} for ${gatherSeconds}s`);
  broadcastShowState();
}

/** Open the tug-of-war genre vote window (phase "collecting"); the buzzer at the
 *  end resolves the winning genre + selected participant. */
function beginVoting(): void {
  gatherTimer = null;
  phase = "collecting";
  collectEndsAt = Date.now() + collectSeconds * 1000;

  if (buzzerTimer) clearTimeout(buzzerTimer);
  buzzerTimer = setTimeout(onBuzzer, collectSeconds * 1000);

  startTugLoop();
  console.log(`[show] voting (tug-of-war) round ${roundIndex} for ${collectSeconds}s`);
  broadcastShowState();
}

/** Re-open the current round's vote window (no round bump) — used when a buzzer
 *  fires with no submissions, so the show waits for the crowd without churning. */
function extendCollecting(): void {
  phase = "collecting";
  collectEndsAt = Date.now() + collectSeconds * 1000;
  if (buzzerTimer) clearTimeout(buzzerTimer);
  buzzerTimer = setTimeout(onBuzzer, collectSeconds * 1000);
  startTugLoop();
  broadcastShowState();
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
  // The countdown carried in the snapshot matches the current phase: the gather
  // window (name cloud) counts down to voting; the vote window counts down to the
  // buzzer. Both feed the same timeRemaining/timeTotal fields.
  let timeRemaining = 0;
  let timeTotal = collectSeconds;
  if (phase === "collecting") {
    timeRemaining = Math.max(0, (collectEndsAt - Date.now()) / 1000);
    timeTotal = collectSeconds;
  } else if (phase === "gathering") {
    timeRemaining = Math.max(0, (gatherEndsAt - Date.now()) / 1000);
    timeTotal = gatherSeconds;
  }
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
    timeTotal,
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
  const picked = participants.selectRandomAnswerer();
  if (!picked) {
    // Nobody submitted an intent — don't invent a song. Re-open the SAME round's
    // vote window (no round bump / genre churn) until someone submits.
    console.log(`[show] round ${roundIndex} → no submissions; waiting for the crowd`);
    extendCollecting();
    return;
  }
  const winnerSide: Side = tug.winner();
  const genre = winnerSide === "A" ? genreA.name : genreB.name;
  const { name, answer } = picked;
  const vibe = vibes.winner() ?? undefined; // the crowd's winning Pick-the-Vibe mood

  broadcast({ type: "round_result", winner: winnerSide, genre, name, answer, roundIndex });
  console.log(`[show] round ${roundIndex} → ${winnerSide} (${genre})${vibe ? ` · vibe ${vibe}` : ""} — selected ${name}`);

  const seed: Seed = { name, answer, genre, vibe };
  activeSeed = seed;
  generationError = undefined;
  void generateNext(seed);
}

/**
 * Craft + generate one song. The pipeline gate (`generating`) releases as soon
 * as the song is PLAYABLE (streaming) — NOT when it fully completes — so the
 * next round can start while `complete` polling continues in the background.
 */
async function generateNext(seed: Seed, opts?: { opener?: boolean }): Promise<void> {
  if (generating) {
    console.log("[show] generateNext skipped — already generating");
    return;
  }
  generating = true;
  phase = "generating";
  activeSeed = seed;
  generationError = undefined;
  const epoch = generationEpoch;
  const jobId = ++generationJobSequence;
  const id = `song-${Date.now()}-${++songSequence}`;
  activeGenerationJobId = jobId;
  latestGeneration = { jobId, songId: id };
  const bpm = genreBpm(seed.genre);
  songBpms.set(id, bpm);
  broadcastShowState();
  let playableSent = false;

  const isCurrentJob = () =>
    epoch === generationEpoch && !cancelledGenerationJobs.has(jobId);

  const releaseGate = () => {
    if (activeGenerationJobId === jobId && generating) {
      activeGenerationJobId = null;
      generating = false;
      // The current song is now playable/queued; treat the stage as "playing"
      // for our phase-tracking until the stage confirms via onPlaying.
      phase = "playing";
      if (playableSent) activeSeed = undefined;
      broadcastShowState();
    }
  };

  const failGeneration = (err: unknown) => {
    if (!isCurrentJob() || playableSent) return;
    generationError = (err as Error).message || "Song generation failed.";
    broadcast({ type: "generation_failed", id, message: generationError });
  };

  const song: Song = {
    id,
    title: "",
    name: seed.name,
    genre: seed.genre,
    bpm,
    lyrics: "",
    streamUrl: "",
    finalUrl: "",
  };

  const onPlayable = (url: string) => {
    if (!isCurrentJob()) return;
    playableSent = true;
    song.streamUrl = url;
    console.log(`[show] ${id}: playable (streaming) → sending to stage; gate released`);
    broadcast({ type: "song_ready", song: { ...song } });
    releaseGate(); // next round may begin now
  };

  const onComplete = async (result: { finalUrl: string; msToComplete: number }) => {
    if (!isCurrentJob()) return;
    song.finalUrl = result.finalUrl;
    broadcast({ type: "song_final", id, finalUrl: result.finalUrl });
    console.log(`[show] ${id}: complete in ${(result.msToComplete / 1000).toFixed(1)}s`);
    try {
      const saved = await songStore.save(song, result.finalUrl);
      setSongs.push(saved); // part of THIS set → shown in the end-of-set recap
      broadcast({ type: "song_saved", song: saved });
      console.log(`[show] ${id}: saved as ${saved.fileName}`);
    } catch (err) {
      console.error(`[show] ${id}: save failed —`, (err as Error).message);
    }
  };

  // Craft lyrics + generate. If Suno REJECTS before the song is playable (e.g. a
  // flagged word slipped through), re-craft with an aggressive sanitize and retry
  // ONCE before giving up.
  const runAttempt = async (strict: boolean): Promise<void> => {
    const prompt = opts?.opener
      ? await craftOpenerPrompt({ prompt: seed.answer, genre: seed.genre }, { strict })
      : await craftSongPrompt(seed, { strict });
    console.log(`[show] ${id}: ${strict ? "sanitized retry — " : ""}style → ${prompt.style}`);
    song.title = prompt.title;
    song.lyrics = prompt.lyrics;
    return generateSong(prompt, { onPlayable })
      .then(onComplete)
      .catch((err) => {
        if (!isCurrentJob() || playableSent) return;
        if (!strict) {
          console.warn(`[show] ${id}: Suno rejected — re-crafting (sanitized) + retrying once: ${(err as Error).message}`);
          return runAttempt(true);
        }
        throw err;
      });
  };

  try {
    broadcast({ type: "generating", seed, roundIndex });
    console.log(`[show] ${id}: crafting ${opts?.opener ? "OPENER" : "lyrics"} for ${seed.name} / ${seed.genre}`);
    await runAttempt(false);
  } catch (err) {
    console.error(`[show] ${id}: generation failed —`, (err as Error).message);
    failGeneration(err);
    // Both attempts failed — keep the show moving with a previous-set track
    // instead of looping the current one forever (unless this job was superseded).
    if (isCurrentJob() && !playableSent && !opts?.opener) await playFallbackSong();
  } finally {
    releaseGate(); // safety: release if it errored before playable
  }
}

/**
 * Generation failed after retries — crossfade in a previously-archived song
 * (preferring one from a PAST set) so the round advances and the stage isn't
 * stuck on the "cooking" hold. No-op (current track keeps looping) if the
 * archive is empty.
 */
async function playFallbackSong(): Promise<void> {
  try {
    const archive = await songStore.list();
    const setIds = new Set(setSongs.map((s) => s.id));
    const previous = archive.filter((s) => !setIds.has(s.id));
    const pool = previous.length ? previous : archive;
    if (!pool.length) {
      console.warn("[show] generation failed and no archived song to fall back to — current track loops");
      return;
    }
    const pick = pool[Math.floor(Math.random() * pool.length)]!;
    const fallback: Song = {
      id: `fallback-${Date.now()}-${++songSequence}`,
      title: pick.title,
      name: pick.name,
      genre: pick.genre,
      bpm: pick.bpm,
      lyrics: pick.lyrics ?? "",
      streamUrl: pick.downloadUrl,
      finalUrl: pick.downloadUrl,
    };
    songBpms.set(fallback.id, pick.bpm);
    console.log(`[show] generation failed — falling back to archived track "${pick.title}" by ${pick.name}`);
    broadcast({ type: "song_ready", song: fallback });
  } catch (err) {
    console.error("[show] fallback song failed:", (err as Error).message);
  }
}

// ---------------- audience input passthrough ----------------

export function handlePull(participantId: string, side: Side, impulse: number): void {
  tug.applyPull(participantId, side, impulse);
}

export function handleAnswer(participantId: string, text: string): void {
  participants.setAnswer(participantId, text);
}
