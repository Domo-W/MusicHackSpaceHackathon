# HANDOFF — Between Sets: Waiting · Recap · Stage Intro · Stage Ended

Four new screens to fold into the live-set app, plus the supporting files to run
them in isolation. **These changes are additive.** Nothing here should replace an
existing file wholesale — bring the *new* files in as-is, and apply the *edits* to
existing files as insertions only.

> ⚠️ **Do not copy the files in this folder over your repo's files.**
> Stage this folder as `design-handoff/` (reference only) and merge *from* it, so
> your newer versions of shared files are never silently overwritten.

---

## 0) What's in this bundle

| File | Role |
|---|---|
| `screen-wait.jsx` | **NEW** — Waiting screen component (`window.ScreenWait`) |
| `screen-recap.jsx` | **NEW** — Recap *playlist player* component (`window.ScreenRecap`) |
| `setlist.js` | **NEW** — placeholder track data (`window.SetList`) — swap for `/api/playlist` |
| `standalone-phone.jsx` | NEW (review-only harness — mounts one phone screen) |
| `standalone-stage.js` | NEW (review-only harness — locks one projector state) |
| `THE SHOW - Waiting.html` / `- Recap.html` | NEW standalones (open via a local server) |
| `THE SHOW - Stage Intro.html` / `- Stage Ended.html` | NEW standalones (open by double-click) |
| `_reference_app.jsx` | EDITED phone shell — **reference for the diff only** |
| `_reference_stage.js` | EDITED projector script — **reference for the diff only** |
| `app-styles.css`, `screens.css`, `stage.css`, `crowd-sim.js`, `ios-frame.jsx`, `shared.jsx` | support files so the standalones run; `screens.css`/`stage.css` also carry EDITS (see §2) |

---

## 1) NEW files — just add them (zero overwrite risk)

Drop into your components/data folders:

- `screen-wait.jsx`
- `screen-recap.jsx`
- `setlist.js`

Then load them **before** your phone shell script, after `shared.jsx`:

```html
<script type="text/babel" src="screen-wait.jsx"></script>
<script type="text/babel" src="screen-recap.jsx"></script>
<script src="setlist.js"></script>
```

> ⚠️ If your repo already has a file by one of these names, rename mine first.

`screen-recap.jsx` also defines small local icon components (`PlayIcon`, `PauseIcon`,
`DownloadIcon`, `CheckIcon`, `ShareIcon`). If your codebase has a shared icon set,
swap these for yours — they're self-contained so it's optional.

---

## 2) EDITED CSS — append only (safe, namespaced)

All new CSS uses **new class names** and does not redefine your existing selectors
(the only scoped overrides live under `.recap`). Copy the appended blocks to the end
of your stylesheets.

**`screens.css`** — append the block that begins with the marker comment:
```
/* ============================================================
   .ls-orb — shared loading spinner (waiting + recap building)
   ============================================================ */
```
…through the end of file. It covers: `.ls-orb`, `.wait*`, `.recap*`, `.rc-*`
(track rows), `.eq` (equalizer), `.np-*` (now-playing bar), `.phone-toast`,
`.live-pill.steady`, and `.dev-step` *(dev-only — see §5)*.

**`stage.css`** — append the block that begins with:
```
/* ============================================================
   INTRO + PARTY-ENDED states (cross-fade over the battlefront)
   ============================================================ */
```
…through the end of file. Covers: `.screen-state`, `.st-live.done`, `.state-hint`,
`.lobby*`, `.disc-glyph`, `.qr-*`, `.ended-*`, `.credits*`, plus `.dev-step`
*(dev-only)*.

Both blocks reuse your existing CSS variables (`--bg`, `--surface`, `--line`,
`--cyan`, `--magenta`, `--ecolor`, `--glow`, `--disp`, `--mono`). No new variables.

---

## 3) EDITED phone shell (`app.jsx` → see `_reference_app.jsx`)

Add a **phase switch** so the shell renders the right surface. The three additions:

**(a) phase state + transitions** (near your other `useState`s):
```jsx
const [phase, setPhase] = useState('idle');          // 'idle' | 'live' | 'ended'
const [waitStatus, setWaitStatus] = useState('connecting'); // 'connecting'|'waiting'|'go'
```
In production, **drive `phase` from your real show state** (showMachine / ws `tug`
phase + `show_ended`), not from local state. `waitStatus` can stay local
(connecting → waiting on connect; flash `'go'` briefly when the set opens).

**(b) the render switch** — wrap your existing live UI and add the two new screens:
```jsx
<div className="phone">
  <Background />

  {phase === 'idle'  && <ScreenWait status={waitStatus} />}
  {phase === 'ended' && <ScreenRecap />}

  {phase === 'live' && (
    <React.Fragment>
      {/* ...your existing topbar + deck + tabs, unchanged... */}
    </React.Fragment>
  )}
</div>
```

That's the whole integration for the phone. `ScreenWait`/`ScreenRecap` own their own
topbar (LIVE pill / SET COMPLETE pill), so you don't render the live chrome in those
phases.

**Do NOT port:** the `PhaseDev` component, the `goIdle/goLive/goEnded` helpers, and the
`keydown 1/2/3` effect — those exist only to fake phase changes in the prototype (§5).

---

## 4) EDITED projector (`stage.js` + `Stage.html` → see `_reference_stage.js`)

**Markup** — add two overlays as siblings inside `#stageRoot` (copy from
`THE SHOW - Stage Intro.html` and `- Stage Ended.html`): `<div id="intro" class="screen-state">…`
and `<div id="ended" class="screen-state">…`. They show via `body.intro #intro` /
`body.ended #ended` and cross-fade over your battle layer (the appended CSS hides
`.overlay`/`#bf` under those body classes).

**Script** — append the block beginning with
`// ===== INTRO / ENDED states + faux QR + dev phase stepper =====`. It:
- draws a **faux QR** into `#qrIntro` / `#qrEnded`,
- fills `#endTracks` / `#endCrowd` and the `#creditsTrack` ticker from `SetList`,
- defines `setPhase('intro'|'battle'|'ended')` which toggles the body class.

**Rewire for prod:**
- Replace the faux-QR `drawQR(...)` calls with your real `<img src="/qr">` /
  `<img src="/qr?target=playlist">`.
- Call `setPhase('intro')` on load, `setPhase('battle')` (or clear the classes) when the
  DJ starts, and `setPhase('ended')` on `show_ended` — from your message handler, not
  the dev stepper.
- Pull `#endCrowd` / track data from real state instead of the mocked `249` / `SetList`.

---

## 5) Strip these dev-only bits before shipping

Search for and remove:
- `PhaseDev` component + its `<PhaseDev … />` mount (phone)
- the dev stepper DOM built in `stage.js` (the `dev-step` element + its listeners)
- the `keydown` `1` / `2` / `3` phase shortcuts (both files)
- the `.dev-step` CSS rules (harmless if left, but unused)

They're all commented `dev-only / prototype demo aid`.

---

## 6) Mock seams → real wiring (the only "careful" lines)

| Prototype mock | Replace with |
|---|---|
| `phase` from dev stepper / keys | real show phase (showMachine / ws) |
| `SetList.tracks` (placeholder) | `/api/playlist` payload |
| Recap `playTrack` (simulated ticker) | real audio playback of `finalUrl` |
| Recap download → toast / `SAVED ✓` | real `/api/download/:id` + `/api/playlist.zip` |
| Recap "copy link" → fixed URL | real share URL from `/api/info.playlistUrl` |
| Projector faux-QR canvas | real `/qr` image |
| `#endCrowd` = `249`, mocked counts | real room/crowd count |

Everything else is presentation and ports as-is.

---

## 7) Brand note

The DJ Dashboard title was changed `THE SHOW → BETWEEN SETS`. The phone + projector
keep "THE SHOW" as the venue-style live label; the projector **center wordmark** is
"BETWEEN SETS" with the subtitle "YOUR VOICE, YOUR ANTHEM". Match whatever your repo
expects.

---

## 8) Suggested git flow

```bash
git checkout -b add-between-sets-screens
# unzip this bundle into ./design-handoff/  (reference only)
# move screen-wait.jsx, screen-recap.jsx, setlist.js into your real source dirs
# apply §2–§4 as insertions; strip §5; rewire §6
git add -A && git commit -m "Add Waiting, Recap, Stage Intro, Stage Ended screens"
git push -u origin add-between-sets-screens
# open a PR and review the file-by-file diff before merging
```

Ask your code assistant: *"Treat `design-handoff/` as reference only — do not copy its
files over existing ones. Follow HANDOFF.md: add the NEW files, apply the CSS/JS edits
as insertions preserving all current functions, skip the dev-only bits, and show me each
diff before writing."*
