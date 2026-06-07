# Between Sets — Handoff Note

_Last updated: 2026-06-06. For whoever (Codex / a fresh session) picks this up._

## What this is

A live, audience-driven generative music show. The crowd scans a QR on the stage
screen → enters a name → answers an "I want to…" intent → votes between two genres
(tug-of-war) → at the buzzer one random participant's (name + intent + winning genre)
becomes a **Suno-generated song** with **Claude-written name-chant lyrics**, which
crossfades in on the stage. The loop repeats continuously while the crowd votes for
the next song. Three surfaces: **phone** (audience), **stage/projector**, **DJ dashboard**.

Built on the partner's (`Domo-W`) React prototype, networked **without editing the
partner's files** — we integrate only through `window.*` seams and our own files.

## Run it

```bash
# from repo root
npm run dev            # tsx watch backend/src/server.ts on :8787
# optional: COLLECT_SECONDS=30 npm run dev   (shorter vote window for testing)
```

Then open (all served by the backend on :8787):
- **Stage:** http://localhost:8787/stage-live.html
- **Dashboard:** http://localhost:8787/dash-live.html
- **Phone:** http://localhost:8787/phone-live.html

**Keys live in gitignored `.env`** (`SUNO_API_KEY`, `ANTHROPIC_API_KEY`). They were
shared in plaintext chat → treat as **exposed**, never commit them, and **rotate
after the event**. `.env.example` uses non-key-shaped placeholders so GitHub
secret-scanning doesn't block pushes.

Berkeley campus WiFi blocks device-to-device, so phone testing is browser-only
(multiple localhost tabs). For real phones, expose :8787 via a tunnel (ngrok).

## Architecture

```
phones / stage / dashboard ── WebSocket(:8787) ──► backend (Node+tsx+ws)
                                                     • showMachine (state machine)
                                                     • agent.ts  → Claude (lyrics)
                                                     • suno.ts   → Suno (audio)
                                                     • songStore → local archive
stage screen is the ONLY audio host (crossfade → PA)
```

- **Backend is the single source of truth.** It owns the tug game state, the round
  state machine, generate-one-ahead, and broadcasts to all clients ~15Hz.
- **Generate one ahead:** while song N plays, the next round collects + generates
  N+1. The stage crossfades N→N+1 as soon as N+1's streaming URL is ready
  (`audioEngine.js`, `minPlaySec` gate). Never dead air — current song loops.
- **Wire contract:** `backend/src/types.ts` (`ClientMsg`/`ServerMsg`) +
  `docs/client-api.md`. This is the single source of truth for messages.

## Key files

**Backend (`backend/src/`):**
- `server.ts` — Express + ws on :8787. Routes: `/api/info`, `/api/songs`,
  `/api/songs/:id/download`, `/qr`. WS routing for all `ClientMsg`.
- `showMachine.ts` — the state machine: rounds, tug aggregation, buzzer, participant
  selection, generate-one-ahead, genre rotation/override, hold/skip/reset/endVote.
- `agent.ts` — `craftSongPrompt(seed) → {title, lyrics, style}` via Claude
  (`claude-opus-4-8`, structured JSON output, `effort:"low"`). Guarantees the name is
  sung; template fallback on failure. Style BPM comes from `genreBpm()`.
- `tempo.ts` — `genreBpm(genre)` → genre-typical BPM (Soca 130, Dancehall 100, etc.;
  falls back to `CONFIG.defaultBpm`=120 only for unknown genres).
- `suno.ts` — Custom mode submit + poll; resolves at `streaming` (~10-13s, progressive
  MP3) then `complete` (m4a CDN). **Must send a real `User-Agent`** (Cloudflare 1010).
- `songStore.ts` — local song archive at `data/songs/` (`<id>-<title>.m4a` + `<id>.json`
  sidecar). `save/list/fileFor`. Saved on `complete`. Swap for Supabase later without
  touching the pipeline.
- `participants.ts` — join/answer/select. Intents persist across rounds.
- `config.ts` — all tunables + env.

**Frontend (`frontend/`, no build step — React via window globals + inline Babel):**
- `net.js` — `window.Net` WS bus (connect/on/send/reconnect).
- `net-tug.js` / `net-crowd.js` — networked drop-ins for the partner's sims (same API).
- `phone-shell.jsx` + `phone-net.js` — our linear phone walkthrough
  (name → vibe → intent → vote → loading). New users get the full sequence; returning
  users get vibe → vote.
- `stage-reveal.js` + `audioEngine.js` — stage audio engine (crossfade), generating
  ticker, big round-result reveal, live name cloud, lobby/battle toggle.
- `dash.jsx` — partner's DJ console, **edited by us** (with their sign-off): the old
  Name Cloud panel is replaced by a first-class **Session Setlist** panel (live
  `/api/songs` list with per-track Download + two-step Delete, marks the now-playing
  track from `playback_state`), and the fixed 1440×900 scale-to-fit was replaced by a
  fluid full-viewport layout (injected `DASH_CSS`) so it uses the whole screen.
- `dash-net.js` — **our** dashboard glue. Subscribes to the partner's
  BroadcastChannel(`dj-console`) for genre/question config; injects the bottom
  **LIVE SCREEN AUDIO** player bar (play/pause, next track, show-actions drawer with
  Start / End Vote / Regenerate / Hold / Resume / Reset / **End Show**). The session
  playlist used to live here as a slide-out — it now lives in `dash.jsx` (above).

**Partner files — avoid editing** (integrate via `window.*` + our files where possible):
`app.jsx`, `screen-*.jsx`, `stage.js`, `tug-sim.js`, `crowd-sim.js`, their CSS.
NOTE: `dash.jsx` was intentionally edited by us (Name Cloud → Session Setlist + fluid
layout) with the user's approval — coordinate with the partner before further edits.

## Security invariants (keep these)

- Keys only in gitignored `.env`; never commit; rotate after the event.
- Audience-typed strings (names, answers) rendered on stage/dashboard **must** use
  `textContent` / safe DOM — never `innerHTML`.

## Status / what's done

- ✅ Suno + Claude pipeline, streaming crossfade loop, generate-one-ahead.
- ✅ Networked tug, phone walkthrough, lobby/battle/reveal, live name cloud.
- ✅ Genre propagation from dashboard (re-pushes on reconnect).
- ✅ Local song archive + `/api/songs` + download endpoint.
- ✅ Lyrics no longer over-repeat "good vibe/good energy" — each chorus is custom to
  the person's intent (prompt rewritten in `agent.ts`).
- ✅ Tempo follows genre common tempos via `tempo.ts` (not stuck at 120).
- ✅ **End Show → recap** (partner's screens, merged): dashboard End Show → `show_ended`
  → stage **SET COMPLETE** finale + phone **ScreenRecap** playlist (play-all + per-track
  download), both driven by the real saved songs. Verified end-to-end.
- ✅ **Dashboard redesign**: Name Cloud → first-class **Session Setlist** panel
  (download/delete/now-playing), fluid full-screen layout, redundant slide-out removed.
- ✅ **Setlist numbering** matches the public recap (01…N, newest-first).
- ✅ **DJ Set Opener** (Panel 03): freeform brief + Side A genre → generates song-1 from
  a separate opener prompt (`craftOpenerPrompt`, welcomes the room, no name-chant) and
  plays it immediately; round 1 collects for song 2. No cold-start silence.
- ✅ **Recap reaches late scanners**: `endedRecap` held in showMachine + seeded on
  connect; `show_ended` is sticky in net.js. A fresh phone scanning the end QR lands
  on the recap. (`currentRecap()` / `net.js` stickyTypes.)
- ✅ **Vibe full-loop** (`vibes.ts`): DJ vibe cards become the phone Pick-the-Vibe
  options (`vibe_options`) AND a live dashboard tally (`vibe_tally`, distinct phones per
  option, last-pick-per-socket). Phone display is driven by the REAL tally via
  net-crowd (sim chatter gated when real options active). Picks captured via DOM
  delegation in phone-net.js (no partner-file edit). Tally bars in dash.jsx Panel 01.

## Open / next

- **Supabase**: replace `songStore.ts`'s local-disk implementation with a Supabase
  bucket + table. The pipeline calls only `songStore.save/list/fileFor`, so keep that
  interface and the `/api/songs*` routes stable.
- **Session-end playlist page** (partner is building): "download whole playlist or
  individual tracks." The dashboard Session Songs panel reads the same `/api/songs`,
  so they stay consistent. When the partner's page lands, add a button in the panel
  that opens it (don't reimplement playlist download on our side).
- **Real-phone test** over a tunnel (ngrok) once off campus WiFi.
- **Length calibration**: `CONFIG.targetSections` (6) → tune so songs reliably outlast
  the collect window + generate lead.
