# Jackbox-Style Entry Experience — Design Spec

**Date:** 2026-06-11
**Status:** Approved design, pending implementation plan
**Phase:** 1 of 2 — code-gated single room. Phase 2 (full multi-room backend sessionization) is a separate future project; every protocol decision here is made so phase 2 changes no wire messages.

## Goal

Someone who receives the app link cold should get a Jackbox/Quiplash-grade experience: open the site → one **START A SHOW** button → big-screen lobby with a 4-letter room code + QR → friends join on phones → the **first person to join becomes the host** (👑) and starts the show from their phone. No three-card chooser (stage/dashboard/phone), no DJ console required.

## Approved flow

1. **Big screen (start menu):** wordmark + START A SHOW + a small "crew · dj console" link. The old `index.html` chooser is replaced.
2. **Big screen (lobby):** room code huge + join QR (QR embeds the code) + existing name cloud filling in live; crown on the host's name; "waiting for HOST to start the show".
3. **Phone (join):** code entry (skipped when `?code=` came from the QR) → name entry → join.
4. **Host's phone:** crown + live count + **EVERYBODY'S IN — START**; during the show, a small **End show → recap** action. Non-hosts see "waiting for {host} to start".
5. **Show:** everything downstream of the lobby is the existing loop, untouched (opener → gather → vote → generate → crossfade → recap).

## Architecture (Approach 1 — thin session layer)

`showMachine.ts` and the entire show loop remain untouched. A new small backend module owns room/lobby state; the stage and phone get new pre-show states.

### Backend — `backend/src/room.ts`

State (module-level, mirroring the codebase's existing style):

```ts
code: string | null            // 4 letters, unambiguous alphabet (no O, I, L, 0, 1)
lobbyState: "closed" | "open" | "live" | "ended"
hostWs: WebSocket | null       // host bound to the CONNECTION, not participantId
hostToken: string | null       // random token to reclaim the crown after a reload
hostName: string | null        // for "waiting for MAYA" copy
```

**Why connection + token, not participantId:** phones re-join every round and receive a fresh `participantId` (`phone-net.js` forgets it on each round broadcast), so participantId is unstable. The host's WS connection is stable for the session; the `hostToken` (issued in the `joined` reply, kept in `sessionStorage`) lets a reloaded/reconnected phone reclaim host by sending it with `join`.

### New WS messages

All new messages carry `roomCode` so phase 2 can scope them per-room without protocol changes.

| Message | Direction | Behavior |
|---|---|---|
| `create_room` | stage → server | Mints code, `lobbyState = "open"`, broadcasts `room_state`. If a lobby/show is already open/live → reply `room_busy`. |
| `room_state {code, lobbyState, hostName, crowd}` | server → all | Broadcast on every transition and to each client on connect (so a refreshed stage lands in the right state). |
| `join {name, code, hostToken?}` | phone → server | Code validated case-insensitively while `lobbyState` is `open` or `live` (late joiners allowed). Invalid/missing → `join_rejected {reason}`. First successful join while `open` → caller becomes host. Valid `hostToken` → reclaims host. |
| `joined {participantId, isHost, hostToken?, code}` | server → phone | Extends the existing reply. `hostToken` present only for the host. |
| `host_start` | host phone → server | Only from `hostWs`; requires `lobbyState === "open"` and crowd ≥ 1. Calls existing `startShow()`; `lobbyState = "live"`. |
| `host_end` | host phone → server | Only from `hostWs`; calls existing `endShow()`; `lobbyState = "ended"`. |

**Compatibility:** when no room exists (`lobbyState === "closed"`) and a `join` arrives **without** a code, accept it (current behavior) — this keeps the DJ-console-driven flow, `loadtest.mjs`, and `democrowd.mjs` working unchanged. A code is required only once a room is open.

### Lifecycle and edge cases

- **Crew override:** the DJ dashboard's existing `start` / `end` / `reset` messages keep working untouched.
- **`reset`** (dashboard or watchdog): closes the room (`lobbyState = "closed"`, code cleared) → stage returns to the start menu.
- **`endShow`** (host or dashboard): `lobbyState = "ended"` → recap as today; a later `reset` returns to the menu.
- **Empty-lobby watchdog:** a lobby with zero participants for 10 minutes auto-closes (same self-healing philosophy as the zombie-show watchdog).
- **Host disconnect in lobby:** crown passes to the earliest remaining participant's connection; `room_state` re-broadcast. If the room empties, the lobby stays open until its watchdog closes it.
- **Wrong code:** `join_rejected` → inline error on the phone, no navigation.
- **`/qr` endpoint:** appends `?code=XXXX` to the join URL while a room is open.

### Big screen — start menu as a state of `stage-live.html`

`stage-live.html` gains a state machine: `menu → lobby → show`.

- **`index.html`** becomes a redirect to `stage-live.html`. (Direct URLs to `dash-live.html` / `phone-live.html` still work; the menu's "crew" link points at the dashboard.)
- **menu:** wordmark + START A SHOW. Clicking sends `create_room` — and because this click happens **on the page that plays audio**, it doubles as the autoplay-unlock gesture, structurally eliminating the blocked-opener failure for hosted shows.
- **lobby:** room code + QR + existing name cloud (reused as-is) + 👑 on `hostName` + waiting copy.
- **show:** the existing stage experience, unchanged.
- A stage that loads while a room is open/live jumps straight to the correct state from the connect-time `room_state`.

### Phone — `phone-live.html`

- New first screen: 4-cell code input. Skipped when `?code=` is in the URL (QR path) or a cached code exists in `sessionStorage`.
- `code`, `hostToken` (host only) cached in `sessionStorage`; all `join` sends (including the automatic per-round re-joins) attach them.
- Host UI: crown, "X people in the room", **EVERYBODY'S IN — START** (sends `host_start`); during the show a compact **End show** control (sends `host_end`, with a confirm tap).
- Non-host lobby UI: "waiting for {hostName} to start the show".

### Tooling

- `scripts/democrowd.mjs` and `scripts/loadtest.mjs`: optional `--code XXXX` argument attached to joins (required only when testing the hosted flow).

## Testing

- **TDD (vitest), `room.test.ts`:** code minting & alphabet, join validation (wrong/missing/case-insensitive code), first-join-becomes-host, host reclaim via token, host-only authorization of `host_start`/`host_end`, codeless join allowed when no room exists, host promotion on disconnect, empty-lobby auto-close (fake timers), `reset` closes the room.
- **Frontend:** no DOM harness exists in the repo; verified manually against a running backend (menu → lobby → two phones → host start → show → host end → recap), plus a `democrowd --code` run.

## Out of scope (phase 2)

Concurrent rooms (sessionizing `showMachine`/participants/tug/songs per room), room browser, host migration mid-show, spectator mode. The message shapes above are designed to survive that refactor unchanged.
