// ============================================================
// Wire contract — the SINGLE SOURCE OF TRUTH for all client↔server messages.
// Owned by the lead; gameplay/frontend agents import these, do not redefine.
// See docs/client-api.md for the human-readable protocol + gameplay model.
// ============================================================

export interface Seed {
  name: string;
  answer: string;
  genre: string;
}

export interface Song {
  id: string; // local round id, e.g. "song-1"
  title: string;
  name: string;
  genre: string;
  lyrics: string;
  streamUrl: string; // audiopipe progressive mp3 (playable ~13–20s in)
  finalUrl: string; // cdn m4a (filled on `complete`)
}

export interface GenreInfo {
  key: "A" | "B";
  name: string; // e.g. "NEW FUNK"
  short: string; // e.g. "FNK"
  color: string; // hex, e.g. "#00E5FF"
}

export type Side = "A" | "B";

// Phase of the round currently COLLECTING input (the next song). A song is
// always playing (or cold-start silent) while the next round collects.
export type Phase = "idle" | "collecting" | "generating" | "playing";

// ---------------- client → server ----------------
export type ClientMsg =
  // phone / audience
  | { type: "join"; name: string }
  | { type: "answer"; participantId: string; text: string }
  | { type: "pull"; participantId: string; side: Side; impulse: number } // tug tap (batched client-side ~250ms)
  // stage
  | { type: "playing"; id: string } // a song became the current track
  // dashboard control
  | { type: "start" }
  | { type: "config"; question?: string; genreA?: GenreInfo; genreB?: GenreInfo; collectSeconds?: number }
  | { type: "skip" } // drop the queued/generating song, re-run the round
  | { type: "hold" } // keep current playing, pause advancing
  | { type: "resume" } // undo hold
  | { type: "reset" }; // blank slate — back to the lobby

// ---------------- server → clients ----------------
export type ServerMsg =
  | { type: "joined"; participantId: string }
  | { type: "name"; name: string } // a participant just joined — add to the name cloud
  | { type: "names"; names: string[] } // full snapshot (sent on connect; cleared on reset)
  // ~15Hz tug + crowd snapshot (the authoritative aggregate; clients render/integrate locally)
  | {
      type: "tug";
      phase: Phase;
      round: number;
      question: string;
      genres: { A: GenreInfo; B: GenreInfo };
      p: number; // rope position 0=A .. 1=B
      driveA: number; // decaying per-side drive (slosh/particles)
      driveB: number;
      membersA: number; // participants currently pulling each side
      membersB: number;
      timeRemaining: number; // seconds left in collecting (0 otherwise)
      crowdSize: number;
      energy: number; // 0..1
      bpm: number;
    }
  // a collecting round resolved: winning genre + the selected participant
  | { type: "round_result"; winner: Side; genre: string; name: string; answer: string; roundIndex: number }
  | { type: "generating"; seed: Seed; roundIndex: number }
  | { type: "song_ready"; song: Song } // streamUrl playable
  | { type: "song_final"; id: string; finalUrl: string } // clean CDN url
  | { type: "now_playing"; id: string };
