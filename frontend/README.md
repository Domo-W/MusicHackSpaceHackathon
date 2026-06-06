# THE SHOW — Live Crowd Hype System

An interactive prototype suite for a live concert / DJ "crowd hype" experience.
Boiler Room rave aesthetic (true-black, neon magenta/cyan). All data is mocked
locally — no backend required.

## What's inside

### 1. Crowd phone app  →  `THE SHOW — Crowd Hype.html`
The audience-facing mobile web app (portrait). Zero login. Tabs:
- **VIBE** — live poll: Dance / Drink / Flirt / Make Memories
- **INTENT** — "I want to…" free-text intent capture (dissolves into the room)
- **NAME** — shout-out wall; names float up, repeats trend
- **TUG** — Genre Tug-of-War (Nu Funk vs Nu Soul); hold PULL to drag the rope

### 2. Stage / projector view (16:9)  →  `THE SHOW — Stage.html`
Big-screen battlefront for the tug-of-war: liquid split, live %, rounds, win flash.
Runs the tug simulation as the **authority**; phones connect as followers.

### 3. DJ control dashboard (16:10)  →  `THE SHOW — DJ Dashboard.html`
Backstage console: edit the 4 Vibe Cards, moderate the name cloud, and pick the
two tug-of-war genres. "Push to crowd" buttons (mocked).

### Standalone single-file versions (open by double-click, work offline)
- `THE SHOW — Crowd Hype (standalone).html`
- `THE SHOW — Stage (standalone).html`
- `THE SHOW — DJ Dashboard (standalone).html`

## How to run

**Quick look:** double-click any `… (standalone).html` file.

**Full live demo (phone ↔ stage sync):** serve the folder over a local web server
so the views share an origin and can talk over BroadcastChannel:
```
python3 -m http.server 8000
```
Then open in separate tabs / devices:
- Phone:   http://localhost:8000/THE%20SHOW%20—%20Crowd%20Hype.html
- Stage:   http://localhost:8000/THE%20SHOW%20—%20Stage.html
- DJ:      http://localhost:8000/THE%20SHOW%20—%20DJ%20Dashboard.html

Pulling on a phone's TUG tab moves the rope on the Stage in real time.
(Opened via file:// the sync is disabled and each view runs its own mock battle.)

## Swapping in a real backend
All "live feed" state is isolated so it can be replaced with a websocket / Magenta feed:
- `crowd-sim.js`  — window.CrowdSim (energy, beat, votes, words)
- `tug-sim.js`    — window.Tug (rope position `p` + force inputs; the only shared state)
- Intent screen   — window.IntentSink (submitted intent strings)
- DJ dashboard    — window.DJConsoleState + pushToCrowd() (broadcasts on the `dj-console` channel)

Built with React + inline Babel; no build step.
