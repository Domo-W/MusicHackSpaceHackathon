/* ============================================================
   net-crowd.js — NETWORKED drop-in replacement for window.CrowdSim.
   Same public API + events as crowd-sim.js so the partner's screens
   (screen-vibe, screen-texture) and app.jsx render unchanged:
     API   : { on, getState, getEnergy, vote, addWord, pump,
               setLiveliness, start, VIBES, energyColor, WORD_POOL }
     events: 'frame' (rAF, energy/color), 'state' (~8x/s),
             'beat' (on bpm interval), 'word', 'votes', 'drop'
   The authoritative {energy, color, bpm, crowdSize} now come from the
   server "tug" snapshots; the votes/word "chatter" stays a light local
   sim so the VIBE poll + NAME wall still feel alive with no extra wire.
   Reuses crowd-sim.js's exact energy->color ramp.
   Load AFTER net.js and INSTEAD OF crowd-sim.js. Exposes window.CrowdSim.
   ============================================================ */
(function () {
  'use strict';

  // ---- tiny event bus (identical contract) ----
  const cb = {};
  function on(ev, fn) { (cb[ev] = cb[ev] || new Set()).add(fn); return () => cb[ev] && cb[ev].delete(fn); }
  function emit(ev, data) { const s = cb[ev]; if (s) s.forEach((fn) => { try { fn(data); } catch (e) {} }); }

  // ---- color ramp: cool (low energy) -> warm (peak) — copied verbatim ----
  const STOPS = [
    { p: 0.00, c: [0, 229, 255] },
    { p: 0.42, c: [46, 123, 255] },
    { p: 0.68, c: [255, 138, 30] },
    { p: 0.86, c: [255, 59, 48] },
    { p: 1.00, c: [255, 26, 140] },
  ];
  function energyColor(e) {
    e = Math.max(0, Math.min(1, e));
    for (let i = 1; i < STOPS.length; i++) {
      if (e <= STOPS[i].p) {
        const a = STOPS[i - 1], b = STOPS[i];
        const t = (e - a.p) / (b.p - a.p || 1);
        const r = Math.round(a.c[0] + (b.c[0] - a.c[0]) * t);
        const g = Math.round(a.c[1] + (b.c[1] - a.c[1]) * t);
        const bl = Math.round(a.c[2] + (b.c[2] - a.c[2]) * t);
        return `rgb(${r}, ${g}, ${bl})`;
      }
    }
    return 'rgb(255,26,140)';
  }

  // ---- the four DJ-preloaded vibes (unchanged; ScreenVibe reads these) ----
  const VIBES = [
    { key: 'dance',    label: 'DANCE',         color: '#00E5FF', sub: 'move your body' },
    { key: 'drink',    label: 'DRINK',         color: '#FF7A1A', sub: 'to the bar' },
    { key: 'flirt',    label: 'FLIRT',         color: '#FF1A8C', sub: 'shoot your shot' },
    { key: 'memories', label: 'MAKE MEMORIES', color: '#B65CFF', sub: 'tonight matters' },
  ];

  // ---- crowd shout-out pool (NAME wall chatter) ----
  const WORD_POOL = [
    'SARAH', 'MARCUS', 'LUNA', 'DJ KAI', 'ZARA', 'OMAR', 'MIA', 'LEO',
    'ANNA', 'RAVI', 'NINA', 'JAX', 'CHLOE', 'THEO', 'MAYA', 'FELIX',
    'ROSA', 'KOJI', 'ELLA', 'DRE', 'IVY', 'SAM', 'TARA', 'NICO',
    'PRIYA', 'BEN', 'YUKI', 'CARMEN', 'ABEL', 'GRETA',
    '🙌', '🔥', '❤️', '🥂', '✨',
  ];

  // ---- state: same shape crowd-sim.js exposes via getState() ----
  const state = {
    energy: 0.16,
    color: energyColor(0.16),
    beat: 0,
    bpm: 140,
    crowdSize: 0,
    votes: { dance: 9, drink: 6, flirt: 5, memories: 4 },
    cooldown: false,
  };

  // ---- wire-driven targets (smoothed toward in the frame loop) ----
  let targetEnergy = state.energy;
  let liveliness = 1.0;

  // ---- timers ----
  let running = false;
  let lastBeat = 0;
  let lastStateEmit = 0;
  let lastFrameEmit = 0;
  let lastChatter = 0;

  function setLiveliness(v) { liveliness = Math.max(0.3, Math.min(2, v)); }

  // ---- user-facing inputs (kept so ScreenVibe/ScreenTexture work) ----
  function vote(key) {
    if (state.votes[key] == null) return;
    state.votes[key] += 1;
    emit('votes', state.votes);
  }
  function addWord(text) {
    const t = String(text || '').trim().slice(0, 16);
    if (!t) return;
    emit('word', { text: t.toUpperCase(), mine: true, ts: Date.now() });
  }
  function pump(amount) {
    // No local energy sim drives the wire; nudge the local target a touch
    // so a held hype still feels responsive between snapshots.
    targetEnergy = Math.min(1, targetEnergy + (amount || 0) * 0.5);
  }

  function getState() { return state; }
  function getEnergy() { return state.energy; }

  // ---- ingest a server "tug" snapshot: the authoritative crowd feed ----
  function onTug(msg) {
    if (!msg) return;
    if (typeof msg.energy === 'number') targetEnergy = Math.max(0, Math.min(1, msg.energy));
    if (typeof msg.bpm === 'number' && msg.bpm > 0) state.bpm = msg.bpm;
    if (typeof msg.crowdSize === 'number') state.crowdSize = msg.crowdSize;
  }

  // ---- main loop ----
  function frame(now) {
    if (!running) return;
    requestAnimationFrame(frame);

    // beat clock driven by the (wire-sourced) bpm
    const beatMs = 60000 / (state.bpm || 140);
    if (now - lastBeat >= beatMs) {
      lastBeat = now;
      state.beat += 1;
      emit('beat', state.beat);
    }

    // ease energy toward the latest snapshot for smooth visuals
    state.energy += (targetEnergy - state.energy) * 0.10;
    state.energy = Math.max(0, Math.min(1, state.energy));
    state.color = energyColor(state.energy);

    // light local chatter so the VIBE poll + NAME wall stay alive
    if (now - lastChatter > (820 / liveliness)) {
      lastChatter = now;
      if (Math.random() < 0.85) {
        const keys = Object.keys(state.votes);
        const total = keys.reduce((s, k) => s + state.votes[k], 0) || 1;
        let pick;
        if (Math.random() < 0.55) {
          const r = Math.random(); let acc = 0;
          for (const k of keys) { acc += state.votes[k] / total; if (r <= acc) { pick = k; break; } }
        }
        pick = pick || keys[(Math.random() * keys.length) | 0];
        state.votes[pick] += 1 + ((Math.random() * 2 * liveliness) | 0);
        emit('votes', state.votes);
      }
      if (Math.random() < 0.7 * liveliness) {
        const w = WORD_POOL[(Math.random() * WORD_POOL.length) | 0];
        emit('word', { text: w, mine: false, ts: Date.now() });
      }
    }

    // high-rate frame signal (energy/color) — app.jsx drives CSS vars off this
    if (now - lastFrameEmit >= 16) {
      lastFrameEmit = now;
      emit('frame', state);
    }
    // lower-rate state signal — number displays / lists
    if (now - lastStateEmit >= 120) {
      lastStateEmit = now;
      emit('state', state);
    }
  }

  function start() {
    if (running) return;
    running = true;
    window.Net.on('tug', onTug);
    lastBeat = lastStateEmit = lastFrameEmit = lastChatter = performance.now();
    requestAnimationFrame(frame);
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && running) {
      lastBeat = lastChatter = performance.now();
    }
  });

  window.CrowdSim = {
    on, getState, getEnergy, vote, addWord, pump, setLiveliness, start,
    VIBES, energyColor, WORD_POOL,
  };
  window.energyColor = energyColor;
})();
