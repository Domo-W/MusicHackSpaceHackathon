/* ============================================================
   net-tug.js — NETWORKED drop-in replacement for window.Tug.
   Same public API as tug-sim.js: { on, start, pull, setOpponent,
   getState, getGenres, GENRES }. Instead of running a local sim,
   it rides window.Net:
     - pull(side, impulse) batches taps client-side (~250ms, summing
       impulse) and sends {type:"pull", participantId, side, impulse}.
     - Net.on("tug")          -> updates the internal getState() object
                                 (shaped EXACTLY like tug-sim.js) and
                                 refreshes GENRES from msg.genres.
     - Net.on("round_result") -> flips phase to 'win' + emits 'win'
                                 ({side,isMatch:true}) so the prototype's
                                 win flash fires, then reverts to 'battle'.
   The partner's screen-tug.jsx renders against the prototype phase
   vocabulary ('battle'|'sudden'|'win'), NOT the server's
   ('idle'|'collecting'|'generating'|'playing'), so we translate.
   Load AFTER net.js and INSTEAD OF tug-sim.js. Exposes window.Tug.
   ============================================================ */
(function () {
  'use strict';

  // ---- GENRES: start with the prototype defaults; mutated in place from
  //      the "tug" snapshot so any captured reference stays valid. ----
  const GENRES = {
    A: { key: 'A', name: 'NU FUNK', short: 'FNK', color: '#00E5FF' },
    B: { key: 'B', name: 'NU SOUL', short: 'SOL', color: '#FF1A8C' },
  };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // ---- event bus (same shape the UI relies on) ----
  const cb = {};
  function on(ev, fn) { (cb[ev] = cb[ev] || new Set()).add(fn); return () => cb[ev] && cb[ev].delete(fn); }
  function emit(ev, d) { const s = cb[ev]; if (s) s.forEach((fn) => { try { fn(d); } catch (e) {} }); }

  // ---- state: shaped EXACTLY like tug-sim.js getState() so the
  //      partner's screen-tug.jsx renders unchanged. ----
  const state = {
    p: 0.5,                 // rope position 0=A(left) .. 1=B(right)
    forceA: 0, forceB: 0,   // = server driveA/driveB (slosh/particles)
    crowdDrive: 0,          // unused over the wire; kept for parity
    membersA: 0, membersB: 0,
    round: 1, bestOf: 1,    // collapse best-of-3 -> one timed round
    scoreA: 0, scoreB: 0,
    timeRemaining: 0, timeTotal: 0, // vote countdown (seconds left / full window)
    phase: 'battle',        // prototype vocabulary: 'battle' | 'sudden' | 'win'
    winner: null, winIsMatch: false,
    suddenSide: null, suddenRemain: 0,
  };

  let running = false;
  let winTimer = null;

  // ---- batched PULL: sum impulses per side over a ~250ms window ----
  const PULL_FLUSH_MS = 250;
  let pendA = 0, pendB = 0, flushTimer = null;
  function scheduleFlush() {
    if (flushTimer) return;
    flushTimer = setTimeout(flushPull, PULL_FLUSH_MS);
  }
  function flushPull() {
    flushTimer = null;
    const pid = window.__participantId;
    if (pendA > 0) { window.Net.send({ type: 'pull', participantId: pid, side: 'A', impulse: pendA }); pendA = 0; }
    if (pendB > 0) { window.Net.send({ type: 'pull', participantId: pid, side: 'B', impulse: pendB }); pendB = 0; }
  }

  // ---- public inputs ----
  function pull(side, impulse) {
    impulse = impulse || 0.6;
    // local feel: drive this view's own particles immediately (same as sim)
    if (side === 'A') { state.forceA += impulse; pendA += impulse; }
    else { state.forceB += impulse; pendB += impulse; }
    scheduleFlush();
  }
  function setOpponent() { /* no-op over the wire (the crowd IS the opponent) */ }
  function getState() { return state; }
  function getGenres() { return GENRES; }

  // ---- apply a GenreInfo onto a GENRES slot, mutating in place ----
  function applyGenre(slot, info) {
    if (!info) return;
    if (info.name != null) slot.name = info.name;
    if (info.short != null) slot.short = info.short;
    if (info.color != null) slot.color = info.color;
    if (info.key != null) slot.key = info.key;
  }

  // ---- ingest a server "tug" snapshot ----
  function onTug(msg) {
    if (!msg) return;
    if (msg.genres) { applyGenre(GENRES.A, msg.genres.A); applyGenre(GENRES.B, msg.genres.B); }
    if (typeof msg.p === 'number') state.p = clamp(msg.p, 0, 1);
    if (typeof msg.driveA === 'number') state.forceA = msg.driveA;
    if (typeof msg.driveB === 'number') state.forceB = msg.driveB;
    if (typeof msg.membersA === 'number') state.membersA = msg.membersA;
    if (typeof msg.membersB === 'number') state.membersB = msg.membersB;
    if (typeof msg.round === 'number') state.round = msg.round;
    if (typeof msg.timeRemaining === 'number') state.timeRemaining = msg.timeRemaining;
    if (typeof msg.timeTotal === 'number') state.timeTotal = msg.timeTotal;
    state.collecting = msg.phase === 'collecting';
    // While a round_result win flash is showing we keep phase='win' so the
    // banner stays up; otherwise normal snapshots are the 'battle' phase.
    if (state.phase !== 'win') {
      state.phase = 'battle';
      state.suddenSide = null;
      state.suddenRemain = 0;
    }
    emit('tug', state);
  }

  // ---- ingest a server "round_result": fire the win flash ----
  function onResult(msg) {
    if (!msg || (msg.winner !== 'A' && msg.winner !== 'B')) return;
    state.phase = 'win';
    state.winner = msg.winner;
    state.winIsMatch = true;            // timed single round => always a match win
    emit('tug', state);                 // re-render so the win banner mounts
    emit('win', { side: msg.winner, isMatch: true });
    if (winTimer) clearTimeout(winTimer);
    winTimer = setTimeout(() => {
      winTimer = null;
      state.phase = 'battle';
      state.winner = null;
      state.winIsMatch = false;
      state.p = 0.5;
      state.forceA = state.forceB = 0;
      emit('tug', state);
    }, 2900);                           // matches the prototype's win-flash duration
  }

  // ---- start: subscribe to the wire (role arg ignored; phones follow) ----
  function start() {
    if (running) return;
    running = true;
    window.Net.on('tug', onTug);
    window.Net.on('round_result', onResult);
    // surface the seeded state once so first paint isn't empty
    emit('tug', state);
  }

  window.Tug = { on, start, pull, setOpponent, getState, getGenres, GENRES };
})();
