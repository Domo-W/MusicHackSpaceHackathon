/* ============================================================
   crowd-sim.js  —  THE single simulated live-feed source.
   This is the ONLY place "the crowd" lives. Swap this module
   for a real websocket/Magenta feed later; the UI subscribes
   through the same tiny event bus + getState() contract.
   Loaded as a plain global (no Babel). Exposes window.CrowdSim.
   ============================================================ */
(function () {
  'use strict';

  // ---- tiny event bus ----------------------------------------
  const cb = {};
  function on(ev, fn) {
    (cb[ev] = cb[ev] || new Set()).add(fn);
    return () => cb[ev] && cb[ev].delete(fn);
  }
  function emit(ev, data) {
    const s = cb[ev];
    if (s) s.forEach((fn) => { try { fn(data); } catch (e) { /* noop */ } });
  }

  // ---- color ramp: cool (low energy) -> warm (peak) ----------
  const STOPS = [
    { p: 0.00, c: [0, 229, 255] },   // cyan
    { p: 0.42, c: [46, 123, 255] },  // electric blue
    { p: 0.68, c: [255, 138, 30] },  // orange
    { p: 0.86, c: [255, 59, 48] },   // red
    { p: 1.00, c: [255, 26, 140] },  // magenta
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

  // ---- the four DJ-preloaded vibes (what they came to do tonight) ----
  const VIBES = [
    { key: 'dance',    label: 'DANCE',         color: '#00E5FF', sub: 'move your body' },
    { key: 'drink',    label: 'DRINK',         color: '#FF7A1A', sub: 'to the bar' },
    { key: 'flirt',    label: 'FLIRT',         color: '#FF1A8C', sub: 'shoot your shot' },
    { key: 'memories', label: 'MAKE MEMORIES', color: '#B65CFF', sub: 'tonight matters' },
  ];

  // ---- crowd shout-out pool (names people yell out) ----------
  const WORD_POOL = [
    'SARAH', 'MARCUS', 'LUNA', 'DJ KAI', 'ZARA', 'OMAR', 'MIA', 'LEO',
    'ANNA', 'RAVI', 'NINA', 'JAX', 'CHLOE', 'THEO', 'MAYA', 'FELIX',
    'ROSA', 'KOJI', 'ELLA', 'DRE', 'IVY', 'SAM', 'TARA', 'NICO',
    'PRIYA', 'BEN', 'YUKI', 'CARMEN', 'ABEL', 'GRETA',
    '🙌', '🔥', '❤️', '🥂', '✨',
  ];

  // ---- state -------------------------------------------------
  const state = {
    energy: 0.16,                 // shared room energy 0..1
    color: energyColor(0.16),
    beat: 0,                      // increments each musical beat
    bpm: 140,
    crowdSize: 212,               // mocked heads in the room
    votes: { dance: 9, drink: 6, flirt: 5, memories: 4 },
    cooldown: false,             // true briefly right after a DROP
  };

  // ---- internal sim variables --------------------------------
  let liveliness = 1.0;          // 0.4 subtle .. 1.6 chaotic (tweakable)
  let crowdBaseline = 0.18;      // ambient energy the crowd holds
  let userBoost = 0;             // decaying contribution from THIS phone's holds
  let baselineTarget = 0.22;
  let cooldownUntil = 0;
  let lastBeat = 0;
  let lastCrowdAction = 0;
  let lastStateEmit = 0;
  let lastFrameEmit = 0;
  let running = false;
  let holdCharge = 0;            // ramps to 1 while held; guarantees a DROP
  let lastPump = 0;             // timestamp of the most recent hold/shake input
  let holdStart = 0;            // when the current continuous hold streak began
  let wasHolding = false;

  function setLiveliness(v) { liveliness = Math.max(0.3, Math.min(2, v)); }

  // user-facing inputs (the UI calls these) --------------------
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
  // called continuously while the hero "HOLD TO HYPE" is pressed
  function pump(amount) {
    userBoost = Math.min(1.4, userBoost + amount);
    lastPump = performance.now();   // hold ramp is driven by elapsed time in the frame loop
  }

  function getState() { return state; }
  function getEnergy() { return state.energy; }

  // ---- main loop ---------------------------------------------
  function frame(now) {
    if (!running) return;
    requestAnimationFrame(frame);

    // beat clock
    const beatMs = 60000 / state.bpm;
    if (now - lastBeat >= beatMs) {
      lastBeat = now;
      state.beat += 1;
      emit('beat', state.beat);
    }

    const inCooldown = now < cooldownUntil;
    state.cooldown = inCooldown;

    // crowd baseline random-walks; livelier crowd -> higher, jumpier
    if (now - lastCrowdAction > (820 / liveliness)) {
      lastCrowdAction = now;
      // drift the baseline target
      const hi = inCooldown ? 0.14 : (0.30 + 0.34 * liveliness);
      baselineTarget = 0.12 + Math.random() * hi;
      // crowd casts a vote (weighted toward current leader for momentum)
      if (Math.random() < 0.85) {
        const keys = Object.keys(state.votes);
        const total = keys.reduce((s, k) => s + state.votes[k], 0) || 1;
        let r = Math.random();
        // 55% follow the crowd, 45% pick at random -> feels alive but shifts
        let pick;
        if (Math.random() < 0.55) {
          let acc = 0;
          for (const k of keys) { acc += state.votes[k] / total; if (r <= acc) { pick = k; break; } }
        }
        pick = pick || keys[(Math.random() * keys.length) | 0];
        state.votes[pick] += 1 + ((Math.random() * 2 * liveliness) | 0);
        emit('votes', state.votes);
      }
      // crowd shouts a word
      if (Math.random() < 0.7 * liveliness) {
        const w = WORD_POOL[(Math.random() * WORD_POOL.length) | 0];
        emit('word', { text: w, mine: false, ts: Date.now() });
      }
      // crowd size jitters
      state.crowdSize += (Math.random() < 0.5 ? -1 : 1) * ((Math.random() * 3) | 0);
      state.crowdSize = Math.max(120, state.crowdSize);
    }

    // integrate energy: crowd baseline (randomized) + decaying boost,
    // OR the guaranteed hold ramp — whichever is higher.
    crowdBaseline += (baselineTarget - crowdBaseline) * 0.02;
    userBoost *= 0.965;
    // hold ramp is time-based (frame-rate independent): a continuous hold
    // reaches full charge in ~2.6s and is GUARANTEED to trigger the DROP.
    const holding = now - lastPump < 160;
    if (inCooldown) {
      holdCharge = 0; holdStart = now;             // forced breather after a DROP
    } else if (holding) {
      if (!wasHolding) holdStart = now;            // a new hold streak began
      holdCharge = Math.min(1.05, (now - holdStart) / 2600);
    } else {
      holdCharge = Math.max(0, holdCharge - 0.02); // bleeds out on release
    }
    wasHolding = holding;
    const target = inCooldown
      ? crowdBaseline
      : Math.min(1, Math.max(crowdBaseline + userBoost, holdCharge));
    state.energy += (target - state.energy) * 0.10;
    state.energy = Math.max(0, Math.min(1, state.energy));
    state.color = energyColor(state.energy);

    // DROP! when we cross the ceiling and not already cooling down
    if (state.energy >= 0.985 && !inCooldown) {
      cooldownUntil = now + 2600;
      crowdBaseline = 0.12;
      baselineTarget = 0.14;
      userBoost = 0;
      holdCharge = 0;
      holdStart = now;
      emit('drop', { ts: Date.now() });
    }

    // high-rate frame signal (energy/color) — for smooth visuals
    if (now - lastFrameEmit >= 16) {
      lastFrameEmit = now;
      emit('frame', state);
    }
    // lower-rate state signal — for number displays / lists
    if (now - lastStateEmit >= 120) {
      lastStateEmit = now;
      emit('state', state);
    }
  }

  function start() {
    if (running) return;
    running = true;
    lastBeat = lastCrowdAction = lastStateEmit = lastFrameEmit = performance.now();
    requestAnimationFrame(frame);
  }

  document.addEventListener('visibilitychange', () => {
    // keep the sim honest when tab is backgrounded
    if (!document.hidden && running) {
      lastBeat = lastCrowdAction = performance.now();
    }
  });

  window.CrowdSim = {
    on, getState, getEnergy, vote, addWord, pump, setLiveliness, start,
    VIBES, energyColor, WORD_POOL,
  };
  window.energyColor = energyColor;
})();
