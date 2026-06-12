// backend/src/room.ts
import { randomBytes } from "node:crypto";
import { broadcast } from "./bus.js";

export type LobbyState = "closed" | "open" | "live" | "ended";

// 4-letter join code, Jackbox-style. Alphabet excludes I, L, O, 0, 1 so a code
// read off a projector is never mistyped. Members are tracked by an opaque
// connection key (the server passes its per-socket id) in JOIN ORDER, so host
// promotion can pick the earliest remaining phone. Host is bound to the
// connection, not the participantId (which the phone discards every round).
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

const EMPTY_LOBBY_MS = 10 * 60_000;
let emptyTimer: NodeJS.Timeout | null = null;

let code: string | null = null;
let lobbyState: LobbyState = "closed";
let hostKey: string | null = null;
let hostToken: string | null = null;
const members: Array<{ key: string; name: string }> = [];

function genCode(): string {
  let out = "";
  for (let i = 0; i < 4; i++) out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return out;
}

function genToken(): string {
  return randomBytes(32).toString("base64url");
}

function hostName(): string | null {
  const h = members.find((m) => m.key === hostKey);
  return h ? h.name : null;
}

function armEmptyTimer(): void {
  if (emptyTimer) clearTimeout(emptyTimer);
  emptyTimer = setTimeout(() => {
    emptyTimer = null;
    if (lobbyState === "open" && members.length === 0) {
      console.warn("[room] empty lobby idle — auto-closing");
      close();
    }
  }, EMPTY_LOBBY_MS);
}

function disarmEmptyTimer(): void {
  if (emptyTimer) clearTimeout(emptyTimer);
  emptyTimer = null;
}

export function snapshot(): {
  code: string | null;
  lobbyState: LobbyState;
  hostName: string | null;
  crowd: number;
} {
  return { code, lobbyState, hostName: hostName(), crowd: members.length };
}

export function createRoom(): { ok: true; code: string } | { ok: false; reason: "busy" } {
  if (lobbyState === "open" || lobbyState === "live") return { ok: false, reason: "busy" };
  code = genCode();
  lobbyState = "open";
  hostKey = null;
  hostToken = null;
  members.length = 0;
  armEmptyTimer();
  broadcastState();
  return { ok: true, code };
}

export function close(): void {
  disarmEmptyTimer();
  code = null;
  lobbyState = "closed";
  hostKey = null;
  hostToken = null;
  members.length = 0;
  broadcastState();
}

export function tryJoin(
  connKey: string,
  name: string,
  joinCode: string | undefined,
  token: string | undefined,
):
  | { ok: true; isHost: boolean; hostToken?: string }
  | { ok: false; reason: "bad_code" } {
  // No room open → accept without a code (DJ-console flow, loadtest, democrowd
  // with no --code). These joins are not lobby members and never become host.
  if (lobbyState === "closed" || lobbyState === "ended") {
    return { ok: true, isHost: false };
  }
  if (!joinCode || joinCode.trim().toUpperCase() !== code) {
    return { ok: false, reason: "bad_code" };
  }
  const existing = members.find((m) => m.key === connKey);
  if (existing) existing.name = name;
  else {
    members.push({ key: connKey, name });
    disarmEmptyTimer();
  }

  if (token && token === hostToken) {
    hostKey = connKey;
    broadcastState();
    return { ok: true, isHost: true, hostToken };
  }
  // Take an empty host seat — in an OPEN lobby (the normal first-joiner case) or
  // during a LIVE show whose host vanished (everyone reloaded mid-show): the next
  // phone to (re)connect becomes host so end/reset controls are never orphaned.
  if (hostKey === null && (lobbyState === "open" || lobbyState === "live")) {
    hostKey = connKey;
    hostToken = genToken();
    broadcastState();
    return { ok: true, isHost: true, hostToken };
  }
  broadcastState();
  return { ok: true, isHost: false };
}

export function isHost(connKey: string): boolean {
  return connKey === hostKey;
}

/** Authorize a host action by connection OR by the host token. If the token
 *  matches but the connKey differs (the host reconnected with a new socket),
 *  reclaim host onto this connection so future checks pass too. Makes host_start
 *  / host_end robust to the connection dropping and reconnecting mid-show. */
export function authorizeHost(connKey: string, token: string | undefined): boolean {
  if (connKey === hostKey) return true;
  if (token && hostToken && token === hostToken) {
    hostKey = connKey;
    return true;
  }
  return false;
}

/** Add a simulated player as a room member so it counts toward the crowd. Never
 *  becomes host. Caller (sim.ts) broadcasts room_state once after a batch. */
export function addSimMember(key: string, name: string): void {
  if (!members.find((m) => m.key === key)) {
    members.push({ key, name });
    disarmEmptyTimer();
  }
}

export function markLive(): void {
  if (lobbyState === "open") {
    lobbyState = "live";
    broadcastState();
  }
}

export function markEnded(): void {
  if (lobbyState === "live" || lobbyState === "open") {
    lobbyState = "ended";
    broadcastState();
  }
}

export function leave(connKey: string):
  | { hostChanged: false }
  | { hostChanged: true; newHostKey: string | null; newHostToken: string | null } {
  const idx = members.findIndex((m) => m.key === connKey);
  if (idx >= 0) members.splice(idx, 1);
  // Re-arm the empty timer if the lobby is now empty
  if (members.length === 0 && lobbyState === "open") armEmptyTimer();
  // Promote only in an OPEN lobby — during a live show the host's start button is
  // already spent, and silent re-assignment would just churn. The DJ console and
  // the watchdog still own end/reset.
  if (connKey === hostKey && lobbyState === "open") {
    hostKey = members.length > 0 ? members[0]!.key : null;
    hostToken = members.length > 0 ? genToken() : null;
    broadcastState();
    return { hostChanged: true, newHostKey: hostKey, newHostToken: hostToken };
  }
  // Host left during live/ended — clear the dead socket but KEEP hostToken so the
  // host can reclaim it on reload (phones persist it in sessionStorage). If they
  // don't come back, the next phone to (re)join takes the empty host seat via
  // tryJoin, so the show is never left without end/reset controls.
  if (connKey === hostKey) {
    hostKey = null;
    broadcastState();
    return { hostChanged: false };
  }
  if (idx >= 0) broadcastState();
  return { hostChanged: false };
}

function broadcastState(): void {
  broadcast({ type: "room_state", ...snapshot() });
}
