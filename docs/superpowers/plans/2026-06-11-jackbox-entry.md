# Jackbox-Style Entry Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the three-card landing page with a Jackbox-style flow: one START A SHOW button on the big screen → a code-gated lobby → the first phone to join becomes host and starts the show.

**Architecture:** A new leaf module `backend/src/room.ts` owns room/lobby state (4-letter code, lobby phase, host binding) and broadcasts `room_state` over the existing bus. `showMachine.ts` and the whole show loop are untouched except that `reset()` now also closes the room. The big screen (`stage-live.html`) gains a `menu → lobby → show` state machine; the phone (`phone-live.html`) gains a code-entry screen and host controls. Every new wire message carries a room code so a future multi-room backend (phase 2) needs no protocol changes.

**Tech Stack:** TypeScript + Node (ws, express), Vitest for backend TDD, vanilla JS + React/Babel JSX on the frontend (no DOM test harness — frontend verified manually against a running backend).

**Spec:** `docs/superpowers/specs/2026-06-11-jackbox-entry-design.md`

**Branch:** Work continues on `fix/zombie-show-opener-audio` (already checked out, ahead of main).

---

## File Structure

- **Create** `backend/src/room.ts` — room/lobby state: code minting, join validation, host assignment/promotion, lobby lifecycle. Broadcasts `room_state` via bus.
- **Create** `backend/src/room.test.ts` — Vitest TDD for room.ts.
- **Modify** `backend/src/types.ts` — new client/server message variants.
- **Modify** `backend/src/server.ts` — wire room messages into the WS switch; track ws-by-connection-key for targeted `host_granted`; close room on disconnect/reset; add `?code` to the QR.
- **Modify** `backend/src/showMachine.ts` — `reset()` also closes the room.
- **Modify** `frontend/index.html` — redirect to `stage-live.html`.
- **Modify** `frontend/stage-live.html` — add `#menu` overlay markup + CSS; add room-code element to the lobby.
- **Modify** `frontend/stage-reveal.js` — menu/lobby state machine, send `create_room`, react to `room_state`, set QR with code.
- **Modify** `frontend/phone-live.html` — code-entry screen container.
- **Modify** `frontend/phone-shell.jsx` — code screen before name; host controls in the lobby.
- **Modify** `frontend/phone-net.js` — attach `code` + `hostToken` to every join; cache in `sessionStorage`; handle `join_rejected` / `host_granted`.
- **Modify** `scripts/democrowd.mjs` and `scripts/loadtest.mjs` — optional `--code` argument.

---

## Task 1: room.ts — code minting

**Files:**
- Create: `backend/src/room.ts`
- Test: `backend/src/room.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/room.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import * as room from "./room.js";

describe("room code minting", () => {
  beforeEach(() => room.close());

  it("opens a room with a 4-char code from the unambiguous alphabet", () => {
    const res = room.createRoom();
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.code).toMatch(/^[A-HJ-NP-Z2-9]{4}$/);
    expect(room.snapshot().lobbyState).toBe("open");
  });

  it("never includes ambiguous characters I, L, O, 0, 1", () => {
    for (let i = 0; i < 300; i++) {
      room.close();
      const res = room.createRoom();
      if (res.ok) expect(res.code).not.toMatch(/[ILO01]/);
    }
  });

  it("rejects a second createRoom while one is open (busy)", () => {
    room.createRoom();
    const res = room.createRoom();
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("busy");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run backend/src/room.test.ts`
Expected: FAIL — cannot find module `./room.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// backend/src/room.ts
import { broadcast } from "./bus.js";

type LobbyState = "closed" | "open" | "live" | "ended";

// 4-letter join code, Jackbox-style. Alphabet excludes I, L, O, 0, 1 so a code
// read off a projector is never mistyped. Members are tracked by an opaque
// connection key (the server passes its per-socket id) in JOIN ORDER, so host
// promotion can pick the earliest remaining phone. Host is bound to the
// connection, not the participantId (which the phone discards every round).
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

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

function hostName(): string | null {
  const h = members.find((m) => m.key === hostKey);
  return h ? h.name : null;
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
  broadcastState();
  return { ok: true, code };
}

export function close(): void {
  code = null;
  lobbyState = "closed";
  hostKey = null;
  hostToken = null;
  members.length = 0;
  broadcastState();
}

function broadcastState(): void {
  broadcast({ type: "room_state", ...snapshot() });
}
```

Note: `broadcast` is a no-op until `server.ts` wires the real sender (see `bus.ts`), so these tests run without a server.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run backend/src/room.test.ts`
Expected: PASS (3 tests). TypeScript will complain that `room_state` is not a known `ServerMsg` — that is fixed in Task 5; for now `bus.broadcast` accepts `ServerMsg`, so add the type there first if the test fails to compile. If compilation fails, do Task 5 Step 3 (the `room_state` ServerMsg variant) now, then re-run.

- [ ] **Step 5: Commit**

```bash
git add backend/src/room.ts backend/src/room.test.ts
git commit -m "room: 4-letter code minting + busy guard (TDD)"
```

---

## Task 2: room.ts — join validation & host assignment

**Files:**
- Modify: `backend/src/room.ts`
- Test: `backend/src/room.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// append to backend/src/room.test.ts
describe("room join + host assignment", () => {
  beforeEach(() => room.close());

  it("accepts a codeless join when no room is open (legacy DJ/loadtest flow)", () => {
    const res = room.tryJoin("c1", "Maya", undefined, undefined);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.isHost).toBe(false);
  });

  it("rejects a join with the wrong code while a room is open", () => {
    const open = room.createRoom();
    const wrong = open.ok ? open.code + "X" : "ZZZZ";
    const res = room.tryJoin("c1", "Maya", wrong, undefined);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("bad_code");
  });

  it("accepts a correct code case-insensitively and makes the first joiner host", () => {
    const open = room.createRoom();
    const c = open.ok ? open.code : "";
    const res = room.tryJoin("c1", "Maya", c.toLowerCase(), undefined);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.isHost).toBe(true);
      expect(typeof res.hostToken).toBe("string");
    }
    expect(room.snapshot().hostName).toBe("Maya");
    expect(room.snapshot().crowd).toBe(1);
  });

  it("makes only the first joiner host; later joiners are not", () => {
    const open = room.createRoom();
    const c = open.ok ? open.code : "";
    room.tryJoin("c1", "Maya", c, undefined);
    const res = room.tryJoin("c2", "Theo", c, undefined);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.isHost).toBe(false);
    expect(room.snapshot().crowd).toBe(2);
  });

  it("lets the host reclaim via a valid hostToken (e.g. after reconnect)", () => {
    const open = room.createRoom();
    const c = open.ok ? open.code : "";
    const first = room.tryJoin("c1", "Maya", c, undefined);
    const token = first.ok ? first.hostToken : undefined;
    const again = room.tryJoin("c9", "Maya", c, token); // new connection key
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.isHost).toBe(true);
  });

  it("does not add a duplicate member when the same connection re-joins each round", () => {
    const open = room.createRoom();
    const c = open.ok ? open.code : "";
    room.tryJoin("c1", "Maya", c, undefined);
    room.tryJoin("c1", "Maya", c, undefined);
    expect(room.snapshot().crowd).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run backend/src/room.test.ts`
Expected: FAIL — `room.tryJoin is not a function`.

- [ ] **Step 3: Write minimal implementation**

```ts
// add to backend/src/room.ts
function genToken(): string {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
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
  else members.push({ key: connKey, name });

  if (token && token === hostToken) {
    hostKey = connKey;
    broadcastState();
    return { ok: true, isHost: true, hostToken };
  }
  if (hostKey === null && lobbyState === "open") {
    hostKey = connKey;
    hostToken = genToken();
    broadcastState();
    return { ok: true, isHost: true, hostToken };
  }
  broadcastState();
  return { ok: true, isHost: false };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run backend/src/room.test.ts`
Expected: PASS (all join tests + Task 1 tests green).

- [ ] **Step 5: Commit**

```bash
git add backend/src/room.ts backend/src/room.test.ts
git commit -m "room: code-validated join + first-joiner-is-host + token reclaim (TDD)"
```

---

## Task 3: room.ts — host authorization & lobby lifecycle

**Files:**
- Modify: `backend/src/room.ts`
- Test: `backend/src/room.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// append to backend/src/room.test.ts
describe("room host authorization + lifecycle", () => {
  beforeEach(() => room.close());

  it("authorizes host-only actions by connection key", () => {
    const open = room.createRoom();
    const c = open.ok ? open.code : "";
    room.tryJoin("host", "Maya", c, undefined);
    room.tryJoin("guest", "Theo", c, undefined);
    expect(room.isHost("host")).toBe(true);
    expect(room.isHost("guest")).toBe(false);
  });

  it("markLive moves an open lobby to live; markEnded to ended", () => {
    room.createRoom();
    room.markLive();
    expect(room.snapshot().lobbyState).toBe("live");
    room.markEnded();
    expect(room.snapshot().lobbyState).toBe("ended");
  });

  it("promotes the earliest remaining member when the host leaves an open lobby", () => {
    const open = room.createRoom();
    const c = open.ok ? open.code : "";
    room.tryJoin("host", "Maya", c, undefined);
    room.tryJoin("g1", "Theo", c, undefined);
    room.tryJoin("g2", "Priya", c, undefined);
    const res = room.leave("host");
    expect(res.hostChanged).toBe(true);
    if (res.hostChanged) {
      expect(res.newHostKey).toBe("g1");
      expect(typeof res.newHostToken).toBe("string");
    }
    expect(room.snapshot().hostName).toBe("Theo");
  });

  it("does not promote on a non-host leave", () => {
    const open = room.createRoom();
    const c = open.ok ? open.code : "";
    room.tryJoin("host", "Maya", c, undefined);
    room.tryJoin("g1", "Theo", c, undefined);
    const res = room.leave("g1");
    expect(res.hostChanged).toBe(false);
    expect(room.snapshot().hostName).toBe("Maya");
  });

  it("does not promote during a live show when the host leaves", () => {
    const open = room.createRoom();
    const c = open.ok ? open.code : "";
    room.tryJoin("host", "Maya", c, undefined);
    room.tryJoin("g1", "Theo", c, undefined);
    room.markLive();
    const res = room.leave("host");
    expect(res.hostChanged).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run backend/src/room.test.ts`
Expected: FAIL — `room.isHost is not a function`.

- [ ] **Step 3: Write minimal implementation**

```ts
// add to backend/src/room.ts
export function isHost(connKey: string): boolean {
  return connKey === hostKey;
}

export function markLive(): void {
  if (lobbyState === "open") {
    lobbyState = "live";
    broadcastState();
  }
}

export function markEnded(): void {
  lobbyState = "ended";
  broadcastState();
}

export function leave(connKey: string):
  | { hostChanged: false }
  | { hostChanged: true; newHostKey: string | null; newHostToken: string | null } {
  const idx = members.findIndex((m) => m.key === connKey);
  if (idx >= 0) members.splice(idx, 1);
  // Promote only in an OPEN lobby — during a live show the host's start button is
  // already spent, and silent re-assignment would just churn. The DJ console and
  // the watchdog still own end/reset.
  if (connKey === hostKey && lobbyState === "open") {
    hostKey = members.length > 0 ? members[0]!.key : null;
    hostToken = members.length > 0 ? genToken() : null;
    broadcastState();
    return { hostChanged: true, newHostKey: hostKey, newHostToken: hostToken };
  }
  if (idx >= 0) broadcastState();
  return { hostChanged: false };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run backend/src/room.test.ts`
Expected: PASS (all room tests green).

- [ ] **Step 5: Commit**

```bash
git add backend/src/room.ts backend/src/room.test.ts
git commit -m "room: host authorization, lobby lifecycle, host promotion (TDD)"
```

---

## Task 4: room.ts — empty-lobby auto-close watchdog

**Files:**
- Modify: `backend/src/room.ts`
- Test: `backend/src/room.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// append to backend/src/room.test.ts — needs fake timers, so add at top of file:
//   import { vi } from "vitest";
describe("empty-lobby watchdog", () => {
  beforeEach(() => { vi.useFakeTimers(); room.close(); });
  afterEach(() => vi.useRealTimers());

  it("auto-closes an open lobby that nobody joins within the idle window", () => {
    room.createRoom();
    vi.advanceTimersByTime(10 * 60_000 + 1000);
    expect(room.snapshot().lobbyState).toBe("closed");
  });

  it("does not auto-close while at least one member is present", () => {
    const open = room.createRoom();
    const c = open.ok ? open.code : "";
    room.tryJoin("c1", "Maya", c, undefined);
    vi.advanceTimersByTime(30 * 60_000);
    expect(room.snapshot().lobbyState).toBe("open");
  });
});
```

Add `afterEach` and `vi` to the existing import line: `import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";`

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run backend/src/room.test.ts`
Expected: FAIL — lobby stays `open` after the window (no watchdog yet).

- [ ] **Step 3: Write minimal implementation**

```ts
// add to backend/src/room.ts, near the state declarations:
const EMPTY_LOBBY_MS = 10 * 60_000;
let emptyTimer: NodeJS.Timeout | null = null;

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
```

Then call the timers from the lifecycle functions:
- In `createRoom()`, after `lobbyState = "open";` and before `broadcastState()`, add `armEmptyTimer();`.
- In `tryJoin()`, immediately after a member is added (`else members.push(...)`), add `disarmEmptyTimer();`.
- In `leave()`, after `members.splice`, add: `if (members.length === 0 && lobbyState === "open") armEmptyTimer();`
- In `close()`, add `disarmEmptyTimer();` at the top.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run backend/src/room.test.ts`
Expected: PASS (all room tests, including watchdog).

- [ ] **Step 5: Commit**

```bash
git add backend/src/room.ts backend/src/room.test.ts
git commit -m "room: empty-lobby auto-close watchdog (TDD)"
```

---

## Task 5: types.ts — new message variants

**Files:**
- Modify: `backend/src/types.ts` (ClientMsg union ~line 67, ServerMsg union ~line 89)

- [ ] **Step 1: Extend the ClientMsg union**

Replace the existing join line and add the host/room messages. Find:

```ts
  | { type: "join"; name: string }
```

Replace with:

```ts
  | { type: "join"; name: string; code?: string; hostToken?: string }
  | { type: "create_room" } // big screen → mint a lobby code
  | { type: "host_start" } // host phone → start the show
  | { type: "host_end" } // host phone → end the show
```

- [ ] **Step 2: Extend the ServerMsg union**

Find:

```ts
  | { type: "joined"; participantId: string }
```

Replace with:

```ts
  | { type: "joined"; participantId: string; isHost?: boolean; hostToken?: string; code?: string | null }
  | { type: "join_rejected"; reason: string } // wrong/missing room code
  | { type: "host_granted"; hostToken: string } // promoted to host (e.g. prior host left)
  | { type: "room_state"; code: string | null; lobbyState: "closed" | "open" | "live" | "ended"; hostName: string | null; crowd: number }
```

- [ ] **Step 3: Verify it compiles**

Run: `npm run typecheck`
Expected: PASS (`tsc --noEmit` exits clean). If `room.ts`'s `broadcast({ type: "room_state", ... })` was already added in Task 1, this resolves its earlier type error.

- [ ] **Step 4: Run the room tests again**

Run: `npx vitest run backend/src/room.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/types.ts
git commit -m "types: create_room, host_start/end, room_state, join_rejected, host_granted"
```

---

## Task 6: server.ts — wire room into the WS server

**Files:**
- Modify: `backend/src/server.ts` (imports ~line 1-20; connection handler 144-252; QR endpoint 108-115)
- Modify: `backend/src/showMachine.ts` (`reset()` ~line 122)

- [ ] **Step 1: Import room and add a connection-key → ws map**

At the top of `server.ts`, alongside the other backend imports, add:

```ts
import * as room from "./room.js";
```

Just below `const wsParticipant = new WeakMap<WebSocket, string>();` (~line 135), add:

```ts
// connKey (stringified per-socket id) → ws, so a host promotion can target the
// newly-crowned phone with host_granted. WeakMap can't iterate, so use a Map and
// clean it up on close.
const wsByKey = new Map<string, WebSocket>();
```

- [ ] **Step 2: Seed room_state on connect and register the connection key**

In the `wss.on("connection", (ws) => {` block, just after `const socketId = ++wsSeq;` (~line 145), add:

```ts
  const connKey = String(socketId);
  wsByKey.set(connKey, ws);
```

Then, alongside the other connect-time `ws.send(...)` seed messages (after the `show_state` send ~line 150), add:

```ts
  ws.send(JSON.stringify({ type: "room_state", ...room.snapshot() } as ServerMsg));
```

- [ ] **Step 3: Replace the `join` case with code validation + host reply**

Replace the existing `case "join": { ... }` block (~lines 168-176) with:

```ts
      case "join": {
        const res = room.tryJoin(connKey, msg.name, msg.code, msg.hostToken);
        if (!res.ok) {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "join_rejected", reason: res.reason } as ServerMsg));
          }
          break;
        }
        const id = join(msg.name);
        wsParticipant.set(ws, id);
        const reply: ServerMsg = {
          type: "joined",
          participantId: id,
          isHost: res.isHost,
          hostToken: res.hostToken,
          code: room.snapshot().code,
        };
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(reply));
        const nm = (msg.name || "").trim();
        if (nm) broadcast({ type: "name", name: nm });
        break;
      }
```

- [ ] **Step 4: Add the room/host action cases**

In the same `switch`, after the `case "start":` block (~line 197), add:

```ts
      case "create_room": {
        const r = room.createRoom();
        if (!r.ok && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "join_rejected", reason: "busy" } as ServerMsg));
        }
        break;
      }
      case "host_start": {
        const s = room.snapshot();
        if (room.isHost(connKey) && s.lobbyState === "open" && s.crowd >= 1) {
          room.markLive();
          startShow();
        }
        break;
      }
      case "host_end": {
        if (room.isHost(connKey)) {
          room.markEnded();
          void endShow();
        }
        break;
      }
```

- [ ] **Step 5: Close the room on disconnect and promote the host**

Replace the `ws.on("close", () => { ... })` body (~lines 242-251) with:

```ts
  ws.on("close", () => {
    const id = wsParticipant.get(ws);
    if (id) {
      remove(id);
      wsParticipant.delete(ws);
    }
    const promo = room.leave(connKey);
    if (promo.hostChanged && promo.newHostKey) {
      const newHostWs = wsByKey.get(promo.newHostKey);
      if (newHostWs && newHostWs.readyState === WebSocket.OPEN && promo.newHostToken) {
        newHostWs.send(JSON.stringify({ type: "host_granted", hostToken: promo.newHostToken } as ServerMsg));
      }
    }
    wsByKey.delete(connKey);
    vibes.removeSocket(socketId);
    broadcast(vibeTallyMsg());
    console.log("[ws] client disconnected");
  });
```

- [ ] **Step 6: Update the QR endpoint to embed the room code**

Replace the `/qr` handler (~lines 108-115) with:

```ts
app.get("/qr", async (req, res) => {
  try {
    let url = publicJoinUrl(req);
    const c = room.snapshot().code;
    if (c) url += (url.includes("?") ? "&" : "?") + "code=" + encodeURIComponent(c);
    const svg = await QRCode.toString(url, { type: "svg", margin: 1, color: { dark: "#0A0A0F", light: "#FFFFFF" } });
    res.type("image/svg+xml").send(svg);
  } catch {
    res.status(500).send("qr error");
  }
});
```

- [ ] **Step 7: Close the room when the show resets**

In `backend/src/showMachine.ts`, add the import at the top alongside the others:

```ts
import * as room from "./room.js";
```

Inside `reset()` (~line 122), after `tug.reset(genreA, genreB);` and before `participants.reset();`, add:

```ts
  room.close();
```

- [ ] **Step 8: Verify compile + full test suite**

Run: `npm run typecheck && npx vitest run`
Expected: typecheck clean; all tests pass (room + showMachine watchdog + songStore + tempo).

- [ ] **Step 9: Commit**

```bash
git add backend/src/server.ts backend/src/showMachine.ts
git commit -m "server: wire room lobby — create/join/host_start/host_end, host promotion, coded QR; reset closes room"
```

---

## Task 7: index.html — redirect to the stage

**Files:**
- Modify: `frontend/index.html` (replace whole file)

- [ ] **Step 1: Replace index.html with a redirect**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Between Sets</title>
  <meta http-equiv="refresh" content="0; url=/stage-live.html" />
  <script>location.replace("/stage-live.html");</script>
</head>
<body style="margin:0;background:#07070B;color:#fff;font-family:system-ui,sans-serif">
  <p style="padding:24px">Loading Between Sets… <a style="color:#00E5FF" href="/stage-live.html">continue</a></p>
</body>
</html>
```

- [ ] **Step 2: Verify**

Start the server (`npm run dev`), open `http://localhost:8787/` → it should land on `stage-live.html`.

- [ ] **Step 3: Commit**

```bash
git add frontend/index.html
git commit -m "index: redirect straight to the stage (one entry point)"
```

---

## Task 8: stage-live.html — start-menu overlay markup + CSS

**Files:**
- Modify: `frontend/stage-live.html` (add `#menu` markup; add a room-code element to `#lobby`; add CSS)

- [ ] **Step 1: Add the menu overlay markup**

Inside `<body>`, as the FIRST child element (before `#lobby`), add:

```html
  <!-- Cold-start menu: the only thing a fresh visitor sees. START A SHOW mints a
       room. This click also unlocks audio on the page that plays the opener. -->
  <div id="menu">
    <div class="menu-inner">
      <div class="menu-wordmark">BETWEEN<br/>SETS</div>
      <div class="menu-tag">the set your crowd writes itself</div>
      <button id="startShowBtn" class="menu-cta">START A SHOW</button>
      <a class="menu-crew" href="/dash-live.html">crew · dj console</a>
    </div>
  </div>
```

- [ ] **Step 2: Add the room-code element to the lobby**

Inside the existing `.lobby-join` container in `#lobby` (just above the `.lobby-qr` element), add:

```html
      <div class="lobby-code-wrap">
        <div class="lobby-code-kicker">ROOM CODE</div>
        <div id="lobbyCode" class="lobby-code">––––</div>
      </div>
```

- [ ] **Step 3: Add the CSS**

In the `<style>` block, append:

```css
    /* ---- COLD-START MENU ---- */
    #menu { position: fixed; inset: 0; z-index: 50; display: none;
      background: radial-gradient(120% 90% at 50% 10%, rgba(180,140,255,0.12), transparent 60%), #07070B;
      align-items: center; justify-content: center; text-align: center; }
    body.menu #menu { display: flex; }
    body.menu #lobby, body.menu #joinPanel, body.menu #viewport .overlay { display: none; }
    .menu-inner { display: flex; flex-direction: column; align-items: center; gap: 22px; }
    .menu-wordmark { font-family: var(--disp); font-weight: 800; font-size: 92px; line-height: 0.98;
      letter-spacing: 0.04em; background: linear-gradient(90deg, #00E5FF, #FF1A8C);
      -webkit-background-clip: text; background-clip: text; color: transparent; }
    .menu-tag { font-family: var(--mono); font-size: 16px; letter-spacing: 0.22em; text-transform: uppercase;
      color: rgba(255,255,255,0.55); }
    .menu-cta { margin-top: 10px; padding: 18px 44px; border: none; border-radius: 999px; cursor: pointer;
      background: #FF1A8C; color: #0A0A0F; font-family: var(--disp); font-weight: 700; font-size: 20px;
      letter-spacing: 0.06em; box-shadow: 0 0 60px rgba(255,26,140,0.45); transition: transform .12s ease; }
    .menu-cta:active { transform: scale(0.96); }
    .menu-crew { font-family: var(--mono); font-size: 12px; letter-spacing: 0.14em; text-transform: uppercase;
      color: rgba(255,255,255,0.35); text-decoration: none; }
    .menu-crew:hover { color: rgba(255,255,255,0.6); }
    /* ---- LOBBY ROOM CODE ---- */
    .lobby-code-wrap { display: flex; flex-direction: column; align-items: center; gap: 4px; margin-bottom: 6px; }
    .lobby-code-kicker { font-family: var(--mono); font-size: 13px; letter-spacing: 0.3em; color: rgba(255,255,255,0.5); }
    .lobby-code { font-family: var(--mono); font-weight: 700; font-size: 64px; letter-spacing: 0.3em; color: var(--cyan);
      text-shadow: 0 0 40px rgba(0,229,255,0.4); }
```

- [ ] **Step 4: Verify markup loads**

Reload `stage-live.html`. It will not show the menu yet (no JS wiring) — confirm there are no console errors and the page still renders. Wiring is Task 9.

- [ ] **Step 5: Commit**

```bash
git add frontend/stage-live.html
git commit -m "stage: start-menu overlay + lobby room-code markup and styles"
```

---

## Task 9: stage-reveal.js — menu/lobby state machine

**Files:**
- Modify: `frontend/stage-reveal.js`

- [ ] **Step 1: Cache the new elements and a state object**

Near the other `getElementById` calls (~line 54-65), add:

```js
  var menuEl = document.getElementById("menu");
  var startShowBtn = document.getElementById("startShowBtn");
  var lobbyCodeEl = document.getElementById("lobbyCode");
  var lobbyQrImg = document.querySelector(".lobby-qr img");
  var roomState = { code: null, lobbyState: "closed", hostName: null, crowd: 0 };
  var showStarted = false;
```

- [ ] **Step 2: Add the state-resolver and wire the Start button**

Add this function and listener (anywhere after the element caching, e.g. just before the audio-unlock block near the end):

```js
  // Resolve which big-screen state to show. Priority: finale > live show >
  // open room lobby > cold menu. The existing tug/show_ended handlers own the
  // finale + battle views; this only toggles the menu and the room lobby.
  function applyStageState() {
    var inShow = showStarted || roomState.lobbyState === "live";
    var showMenu = !inShow && (roomState.lobbyState === "closed" || roomState.lobbyState === "ended");
    document.body.classList.toggle("menu", showMenu && !document.body.classList.contains("ended"));
    if (roomState.code && lobbyCodeEl) lobbyCodeEl.textContent = roomState.code;
    if (roomState.code && lobbyQrImg) {
      var want = "/qr?code=" + encodeURIComponent(roomState.code);
      if (lobbyQrImg.getAttribute("src") !== want) lobbyQrImg.setAttribute("src", want);
    }
  }

  Net.on("room_state", function (m) {
    if (!m) return;
    roomState = { code: m.code, lobbyState: m.lobbyState, hostName: m.hostName, crowd: m.crowd };
    applyStageState();
  });

  Net.on("show_state", function (m) {
    if (m) showStarted = !!m.started;
    applyStageState();
  });

  if (startShowBtn) {
    startShowBtn.addEventListener("click", function () {
      Net.send({ type: "create_room" });
      // The click is the audio-unlock gesture; retry any blocked playback later.
      if (window.AudioEngine && AudioEngine.unblock) AudioEngine.unblock();
    });
  }

  // Cold start: show the menu until room_state/show_state say otherwise.
  document.body.classList.add("menu");
  applyStageState();
```

- [ ] **Step 3: Keep the menu hidden once the show runs**

The existing `tug` handler toggles `body.lobby` for gathering/collecting. Confirm that when `lobbyState === "live"` the menu is gone: since `applyStageState()` sets `showMenu=false` when `lobbyState==="live"`, and `host_start` sets the room live, the menu hides as soon as the host starts. No change needed beyond Step 2 — but verify in Step 4.

- [ ] **Step 4: Verify the stage flow manually**

Start `npm run dev`. Open `stage-live.html`:
- It shows the START A SHOW menu.
- Click it → menu disappears, lobby shows a 4-letter code + QR + name cloud.
- (Phone join + host start are verified after Tasks 10-12.)

Confirm no console errors. `node --check frontend/stage-reveal.js` passes.

- [ ] **Step 5: Commit**

```bash
git add frontend/stage-reveal.js
git commit -m "stage: menu/lobby state machine — create_room on Start, render code + coded QR"
```

---

## Task 10: phone-net.js — code + host token plumbing

**Files:**
- Modify: `frontend/phone-net.js`

- [ ] **Step 1: Read the current join/joined wiring**

The file stores `window.__participantId` from `joined` and sends `{type:"join", name}` once per round (idempotent via `joinSent`). We extend it to (a) attach a cached `code` + `hostToken` to every join, (b) capture `hostToken`/`isHost` from `joined`, (c) expose host state, (d) handle `join_rejected` and `host_granted`.

- [ ] **Step 2: Add session-cached code/host helpers near the top of the IIFE**

Just after `window.__participantId = window.__participantId || null;`, add:

```js
  // Room code + host token survive reloads via sessionStorage, so a phone that
  // refreshes (or re-joins each round) stays in the same room and keeps the crown.
  function ssGet(k) { try { return sessionStorage.getItem(k) || null; } catch (e) { return null; } }
  function ssSet(k, v) { try { if (v == null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch (e) {} }
  // Seed the code from the QR URL (?code=XXXX) on first load.
  (function seedCodeFromUrl() {
    try {
      var u = new URL(window.location.href);
      var c = u.searchParams.get("code");
      if (c) ssSet("bs_code", c.trim().toUpperCase());
    } catch (e) {}
  })();
  window.__roomCode = ssGet("bs_code");
  window.__isHost = false;
  window.__hostName = null;
```

- [ ] **Step 3: Capture host info from `joined`**

In the existing `Net.on('joined', ...)` handler, after `window.__participantId = msg.participantId;`, add:

```js
        if (msg.isHost) window.__isHost = true;
        if (msg.hostToken) ssSet("bs_hostToken", msg.hostToken);
        if (msg.code) { window.__roomCode = msg.code; ssSet("bs_code", msg.code); }
        window.dispatchEvent(new CustomEvent("bs:hoststate"));
```

- [ ] **Step 4: Attach code + token to the join send**

Find the join send (`window.Net.send({ type: 'join', name: n });`) and replace with:

```js
    if (window.Net) window.Net.send({ type: 'join', name: n, code: window.__roomCode || undefined, hostToken: ssGet("bs_hostToken") || undefined });
```

- [ ] **Step 5: Handle rejection, host promotion, and room_state; expose host actions**

Before the IIFE closes (after the existing handlers), add:

```js
  Net.on("join_rejected", function (m) {
    window.__joinRejected = (m && m.reason) || "bad_code";
    // The join guard was set when the name was submitted; clear it so the user
    // can fix the code and re-submit (otherwise submitName() no-ops forever).
    if (window.__resetJoinState) window.__resetJoinState();
    window.dispatchEvent(new CustomEvent("bs:joinrejected", { detail: window.__joinRejected }));
  });
  Net.on("host_granted", function (m) {
    if (m && m.hostToken) ssSet("bs_hostToken", m.hostToken);
    window.__isHost = true;
    window.dispatchEvent(new CustomEvent("bs:hoststate"));
  });
  Net.on("room_state", function (m) {
    if (!m) return;
    window.__hostName = m.hostName;
    window.__roomCrowd = m.crowd;
    window.dispatchEvent(new CustomEvent("bs:roomstate", { detail: m }));
  });
  window.PhoneRoom = {
    setCode: function (c) { window.__roomCode = (c || "").trim().toUpperCase(); ssSet("bs_code", window.__roomCode); },
    hasCode: function () { return !!window.__roomCode; },
    code: function () { return window.__roomCode; },
    isHost: function () { return !!window.__isHost; },
    hostName: function () { return window.__hostName; },
    crowd: function () { return window.__roomCrowd || 0; },
    startShow: function () { if (window.Net) window.Net.send({ type: "host_start" }); },
    endShow: function () { if (window.Net) window.Net.send({ type: "host_end" }); },
  };
```

- [ ] **Step 6: Verify**

`node --check frontend/phone-net.js` passes. (Functional verification is in Task 12.)

- [ ] **Step 7: Commit**

```bash
git add frontend/phone-net.js
git commit -m "phone-net: room code + host token plumbing, PhoneRoom host actions"
```

---

## Task 11: phone-live.html — code-entry container

**Files:**
- Modify: `frontend/phone-live.html`

- [ ] **Step 1: Confirm no markup is needed beyond the React root**

The phone renders through `phone-shell.jsx` into `#root`. The code screen is a new JSX screen (Task 12), so `phone-live.html` needs no new container — only a bump to the `phone-shell.jsx` cache-buster so the new code loads.

- [ ] **Step 2: Bump the phone-shell script version**

Find the script tag that loads `phone-shell.jsx` (it has a `?v=` query, e.g. `phone-shell.jsx?v=N`) and increment N by 1. If `phone-shell.jsx` is loaded without a `?v=`, add `?v=2`.

- [ ] **Step 3: Verify**

Reload `phone-live.html` — confirm it still renders the existing flow (no behavior change yet). Console clean.

- [ ] **Step 4: Commit**

```bash
git add frontend/phone-live.html
git commit -m "phone: bump phone-shell cache-buster for the code screen"
```

---

## Task 12: phone-shell.jsx — code screen + host controls

**Files:**
- Modify: `frontend/phone-shell.jsx`

- [ ] **Step 1: Add a code-gate before the name flow**

Near the top of `PhoneShell()` with the other `useState` hooks (~lines 44-56), add:

```jsx
  const [needCode, setNeedCode] = useState(() => !window.PhoneRoom || (!window.PhoneRoom.hasCode() && !window.__participantId));
  const [codeInput, setCodeInput] = useState('');
  const [codeError, setCodeError] = useState('');
  const [isHost, setIsHost] = useState(() => !!(window.PhoneRoom && window.PhoneRoom.isHost()));
  const [hostName, setHostName] = useState(null);
  const [started, setStarted] = useState(false); // reactive show-started flag (drives host buttons)
```

- [ ] **Step 2: Subscribe to host/room/rejection events**

Add a `useEffect` (alongside the other effects):

```jsx
  useEffect(() => {
    const onHost = () => setIsHost(!!(window.PhoneRoom && window.PhoneRoom.isHost()));
    const onRoom = (e) => setHostName(e.detail ? e.detail.hostName : null);
    const onRej = (e) => { setNeedCode(true); setCodeError(e.detail === 'busy' ? 'A show is already running' : 'Wrong code — try again'); };
    window.addEventListener('bs:hoststate', onHost);
    window.addEventListener('bs:roomstate', onRoom);
    window.addEventListener('bs:joinrejected', onRej);
    return () => {
      window.removeEventListener('bs:hoststate', onHost);
      window.removeEventListener('bs:roomstate', onRoom);
      window.removeEventListener('bs:joinrejected', onRej);
    };
  }, []);
```

- [ ] **Step 3: Render the code screen when needed**

At the start of the `return` (before the existing screen rendering), add a guard. Find the top-level `return (` of the component body and insert just inside it:

```jsx
  if (needCode) {
    return (
      <div className="screen code-screen" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 14, padding: 20 }}>
        <div className="screen-kicker" style={{ letterSpacing: '0.2em', opacity: 0.6 }}>ENTER ROOM CODE</div>
        <input
          value={codeInput}
          onChange={(e) => { setCodeInput(e.target.value.toUpperCase().slice(0, 4)); setCodeError(''); }}
          placeholder="CODE"
          maxLength={4}
          autoCapitalize="characters"
          style={{ width: 160, textAlign: 'center', fontFamily: 'monospace', fontSize: 34, letterSpacing: '0.3em', padding: '12px 0', borderRadius: 12, border: '1px solid #333', background: '#15151F', color: '#00E5FF' }}
        />
        {codeError ? <div style={{ color: '#FF7A9F', fontSize: 13 }}>{codeError}</div> : null}
        <button
          onClick={() => {
            if (codeInput.length !== 4) { setCodeError('4 letters'); return; }
            window.PhoneRoom.setCode(codeInput);
            setNeedCode(false);
          }}
          style={{ padding: '12px 30px', borderRadius: 999, border: 'none', background: '#00E5FF', color: '#0A0A0F', fontWeight: 700, letterSpacing: '0.06em' }}
        >JOIN</button>
      </div>
    );
  }
```

Note: a wrong code only surfaces *after* the name join (server validates on join). The `onRej` handler in Step 2 already sets `needCode` back to true so the user can re-enter, and `phone-net.js`'s `join_rejected` handler clears the join guard (Task 10 Step 5) so the re-submit actually fires.

- [ ] **Step 4: Add host controls in the pre-show lobby state**

First make the show-started flag reactive. In the existing `show_state` subscription in this file (the effect that reads `m.phase`), add `setStarted(!!(m && m.started));` so the buttons below re-render when the show starts/stops.

The phone sits on the NAME/lobby screen before the show starts. Add a host action band. Find where the pre-show name screen renders and add, for the host, a start button; for non-hosts, a waiting line. Insert this block into the render where the name screen is shown (immediately after the name screen's submit control), guarded by `!started`:

```jsx
        {!started && isHost ? (
          <button
            onClick={() => window.PhoneRoom.startShow()}
            style={{ marginTop: 14, padding: '14px 24px', borderRadius: 999, border: 'none', background: '#FF1A8C', color: '#0A0A0F', fontWeight: 700, letterSpacing: '0.05em', width: '100%' }}
          >👑 EVERYBODY'S IN — START</button>
        ) : null}
        {!started && !isHost && hostName ? (
          <div style={{ marginTop: 14, textAlign: 'center', fontSize: 12, color: '#8C8C9C' }}>waiting for {hostName} to start the show</div>
        ) : null}
```

Also surface a small **End show** control for the host once started — add near the recap/loading area:

```jsx
        {started && isHost ? (
          <button
            onClick={() => { if (confirm('End the show and go to the recap?')) window.PhoneRoom.endShow(); }}
            style={{ position: 'fixed', bottom: 10, right: 10, padding: '8px 14px', borderRadius: 999, border: '1px solid #FF1A8C', background: 'transparent', color: '#FF7A9F', fontSize: 11, letterSpacing: '0.05em', zIndex: 30 }}
          >End show</button>
        ) : null}
```

- [ ] **Step 5: Verify syntax + render**

There is no JSX unit harness; verify by loading the page. With the backend running and a room open (Start pressed on the stage), open `phone-live.html?code=WRONG` → after entering a name it should bounce back to the code screen with "Wrong code". Then `phone-live.html?code=<real>` → joins, and the FIRST such phone shows the 👑 START button.

Quickest check that the file parses: load `phone-live.html` in the browser; a Babel parse error shows in console. Fix any before committing.

- [ ] **Step 6: Commit**

```bash
git add frontend/phone-shell.jsx
git commit -m "phone-shell: code-entry gate + host start/end controls"
```

---

## Task 13: democrowd + loadtest — optional --code flag

**Files:**
- Modify: `scripts/democrowd.mjs`
- Modify: `scripts/loadtest.mjs`

- [ ] **Step 1: Add --code parsing + attach to joins in democrowd.mjs**

Near the top arg parsing (after `const STAR = ...`), add:

```js
const CODE = process.argv[5] || process.env.ROOM_CODE || null; // optional room code for hosted lobbies
```

In `makeClient`, update both join sends (the initial `joined`→answer flow uses `answer`, and the per-round re-join uses `{ type: "join", name }`). For the re-join send, replace with:

```js
            ws.send(JSON.stringify({ type: "join", name: pickShoutName(i), code: CODE || undefined }));
```

If democrowd has an initial join too, add `code: CODE || undefined` there as well. Update the startup log to print the code when set:

```js
  console.log(`[democrowd] target=${URL}  crowd=${N}  star="${STAR}"  code=${CODE || "(none)"}`);
```

- [ ] **Step 2: Add --code to loadtest.mjs**

After its arg parsing, add `const CODE = process.argv[6] || null;` and attach `code: CODE || undefined` to the `{ type: "join", ... }` sends in `makeClient`.

- [ ] **Step 3: Verify**

`node --check scripts/democrowd.mjs && node --check scripts/loadtest.mjs` pass.

- [ ] **Step 4: Commit**

```bash
git add scripts/democrowd.mjs scripts/loadtest.mjs
git commit -m "scripts: optional --code so simulators can join a hosted lobby"
```

---

## Task 14: End-to-end manual verification

**Files:** none (verification only)

- [ ] **Step 1: Cold start → lobby**

Run `npm run dev`. Open `http://localhost:8787/` → redirects to the stage → START A SHOW menu. Click it → lobby shows a 4-letter code + QR.

- [ ] **Step 2: Two phones join, first is host**

Open `phone-live.html?code=<code>` in two tabs. Enter two names. Confirm: the stage name cloud grows; the first phone shows the 👑 START button; the second shows "waiting for <first name> to start".

- [ ] **Step 3: Wrong code is rejected**

Open `phone-live.html?code=ZZZZ`, enter a name → bounces to the code screen with "Wrong code".

- [ ] **Step 4: Host starts the show**

Press START on the host phone → the stage leaves the lobby and the opener plays (audio unlocked by the earlier Start click); rounds proceed as today.

- [ ] **Step 5: Simulated crowd**

With a room open, run `node scripts/democrowd.mjs ws://localhost:8787 40 Dupes <code>` → the cloud fills, votes move, songs generate.

- [ ] **Step 6: Host ends; reset returns to menu**

Press End show on the host phone → recap appears. From the DJ console (`dash-live.html`) press Reset → the stage returns to the START A SHOW menu (room closed).

- [ ] **Step 7: Legacy DJ flow still works**

In a fresh server run, skip the menu: open `dash-live.html`, press Start Show directly (no room). Confirm the show still runs and `phone-live.html` (no code) can still join — the codeless path is intact.

- [ ] **Step 8: Final full check + commit a note**

Run `npm run typecheck && npx vitest run` one more time — all green. No code change to commit; if any fix was needed during verification, commit it with a descriptive message.

---

## Notes for the implementer

- **TDD applies to `room.ts` only** (Tasks 1-4) — there is no frontend DOM harness in this repo, so frontend tasks are implement-then-verify-in-browser, consistent with how the rest of the frontend is maintained.
- **Do not touch `showMachine.ts`'s show loop.** The only change there is `reset()` calling `room.close()`.
- **The codeless join path must stay working** — it's what `loadtest.mjs`, the DJ console, and existing muscle-memory rely on. Task 2's first test pins this.
- **Host is bound to the connection, not the participantId**, because the phone discards its participantId every round. The `hostToken` in `sessionStorage` is what survives reloads and reconnects.
- **Deliberate deviation from the spec's "every message carries roomCode":** `host_start`/`host_end`/`create_room` are authorized by the server from the *connection's* room membership, not a client-supplied code. This is strictly more secure (a phone can't act on a room it didn't join) and equally phase-2-compatible (in multi-room, the ws still belongs to exactly one room). Only `join` carries a code, because that's the one message that establishes which room the connection belongs to.
- **Deferred (cosmetic, out of scope for phase 1):** the 👑 next to the host's name *in the stage name cloud* (the mock showed "MAYA 👑"). The crown is shown where it matters — on the host's own phone (the START button). Adding it to the stage cloud means matching `roomState.hostName` against rendered cloud nodes in `stage-reveal.js`; pick it up later if desired.
