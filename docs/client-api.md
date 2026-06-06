# Between Sets — Client ↔ Backend Contract

Single source of truth for how the **phone**, **stage/projector**, and **DJ dashboard**
talk to our Node backend. Wire types live in `backend/src/types.ts` — this doc is the
human-readable version + the frontend seam mapping + the build ownership map.

Live state is JSON over **one WebSocket** (`ws(s)://<host>`). The local song archive
uses the small REST surface documented below. No build step —
plain `window.*` globals + inline Babel, matching the partner's prototype.

## Gameplay model

A song is always playing (or cold-start silent) while the **next** round COLLECTS input:

1. **collecting** — phones JOIN (name), submit INTENT (the "I want to…" answer), and
   PULL the genre tug-of-war (two genres). A countdown runs (`collectSeconds`).
2. **buzzer** — winning genre = side ahead at the buzzer. One participant who answered
   is selected at random → `(name, intent, genre)` → broadcast `round_result`.
3. **generating** — Claude writes name-chant lyrics → Suno → streaming URL (~13–20s).
4. **playing** — the song crossfades in on the stage; the next collecting round starts.

Generate-one-ahead: the next song is produced *during* the current one. The stage owns
playback + crossfade timing; the backend owns aggregate game state + the pipeline.

## window.Net (shared transport — `frontend/net.js`, already written)

```
Net.connect()            // opens the WS (auto-reconnect, queues sends)
Net.on(type, fn)         // subscribe to a server message type; returns unsub
Net.onAny(fn)            // every message
Net.send({type, ...})    // send a client message (queued until open)
Net.ready()              // boolean
```
Also emits `"__open"` / `"__close"`. Load `net.js` BEFORE the `net-*` seam scripts.

## Client → server  (see `ClientMsg` in types.ts)

| message | from | meaning |
|---|---|---|
| `{type:"join", name}` | phone | join; server replies `{type:"joined", participantId}` |
| `{type:"answer", participantId, text}` | phone | the INTENT string (becomes lyrics) |
| `{type:"pull", participantId, side:"A"\|"B", impulse}` | phone | tug tap; **batch client-side ~250ms** (sum impulses) |
| `{type:"playing", id}` | stage | a song became the current track |
| `{type:"start"}` | dashboard | begin the show |
| `{type:"config", question?, genreA?, genreB?, collectSeconds?}` | dashboard | set question + the two genres (GenreInfo) |
| `{type:"skip"\|"hold"\|"resume"}` | dashboard | overrides |

## Server → clients  (see `ServerMsg` in types.ts)

| message | for | meaning |
|---|---|---|
| `{type:"joined", participantId}` | phone | id to use in answer/pull |
| `{type:"tug", phase, round, question, genres:{A,B}, p, driveA, driveB, membersA, membersB, timeRemaining, crowdSize, energy, bpm}` | all | ~15Hz aggregate snapshot |
| `{type:"round_result", winner, genre, name, answer, roundIndex}` | stage | the drop reveal |
| `{type:"generating", seed:{name,answer,genre}, roundIndex}` | stage | "crafting <name>'s song…" |
| `{type:"song_ready", song}` | stage | `song.streamUrl` is playable |
| `{type:"song_final", id, finalUrl}` | stage | clean CDN m4a |
| `{type:"song_saved", song}` | dashboard | final audio + metadata saved in the local archive |
| `{type:"song_cancelled", id}` | stage | discard a skipped queued song |
| `{type:"now_playing", id}` | all | a song is current |
| `{type:"show_reset"}` | stage | stop and clear stage audio |

## Local song archive

Completed songs are downloaded into `SONGS_DIR` (default `data/songs/`, gitignored).
This is the current storage boundary until a hosted store such as Supabase is added.

| endpoint | meaning |
|---|---|
| `GET /api/songs` | newest-first saved-song metadata |
| `GET /api/songs/:id/download` | download the locally archived audio file |

`GenreInfo = {key:"A"|"B", name, short, color}` (matches the prototype's `Tug.GENRES`).

## Frontend seam mapping (partner kept these swappable — see `frontend/README.md`)

| partner seam | defined in | networked replacement |
|---|---|---|
| `window.Tug` (`{on,start,pull,getState,getGenres,GENRES}`) | `tug-sim.js` | `net-tug.js` — `pull()`→`Net.send({type:"pull"})`; on `"tug"`→update `getState()`; on `"round_result"`→emit `"win"` |
| `window.CrowdSim` (`{on,getState,getEnergy,setLiveliness,start}`) | `crowd-sim.js` | `net-crowd.js` — fields from the `"tug"` snapshot (energy/bpm/crowdSize) |
| `window.IntentSink` (`{submit,on}`) | `screen-intent.jsx` | override `submit` to also `Net.send({type:"answer", participantId, text})` |
| name entry (NAME screen) | `screen-texture.jsx` | `Net.send({type:"join", name})` → store the returned participantId |
| `window.DJConsoleState` + `pushToCrowd()` | `dash.jsx` | `pushToCrowd()`→`Net.send({type:"config", ...})` |

Networked `getState()` shapes MUST match the prototype's (read `tug-sim.js` / `crowd-sim.js`
for exact fields) so the partner's rendering code works unchanged. Collapse best-of-3 →
one timed round (set `bestOf:1`, `scoreA/B:0`; keep `p,forceA,forceB,phase,round`).

## Build ownership (no two agents touch the same file)

- **A — backend** : `backend/src/*` only (new `tug.ts`, `participants.ts`; edit `showMachine.ts`, `server.ts`, `types.ts`, `seeds.ts`). May restart the dev server to test.
- **B — phone + shared seams** : `frontend/net-tug.js`, `frontend/net-crowd.js`, `frontend/phone-live.html`, `frontend/phone-net.js` (join/intent/name glue). **Do NOT edit** partner `.jsx`/`.js`/`.css` or `net.js`/`audioEngine.js`.
- **C — stage** : `frontend/stage-live.html`, `frontend/stage-reveal.js` (drop reveal overlay). Uses existing `audioEngine.js`, `net.js`, and (at runtime) B's `net-tug.js`/`net-crowd.js`. **Do NOT edit** `stage.js`, `audioEngine.js`, `net.js`, or B's files.
- **D — dashboard** : `frontend/dash-live.html`, `frontend/dash-net.js` (DJConsole→config glue). **Do NOT edit** `dash.jsx`/`dash.css`/`net.js`.

Shared/owned-by-lead (do not edit): `net.js`, `audioEngine.js`, `backend/src/types.ts` is edited only by A. Render audience-typed values (name, answer) with `textContent`/safe DOM — never `innerHTML`.
