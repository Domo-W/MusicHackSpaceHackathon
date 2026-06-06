/* ============================================================
   tug-sim.js  —  GENRE TUG-OF-WAR : the single isolated source.
   ONLY external state is `p` (rope position, 0=A .. 1=B) plus the
   force inputs. The "other team" is a scripted opponent driven by
   ONE scalar (crowdDrive ∈ [-1,1]) — swap that for a real feed later.

   Cross-view sync: the STAGE runs as authority (leader) and broadcasts
   state; PHONES are followers that send PULL impulses. Falls back to a
   local sim when no leader is present, so any view also works alone.
   Sync rides BroadcastChannel with a localStorage 'storage' fallback.

   Loaded as a plain global. Exposes window.Tug.
   ============================================================ */
(function () {
  'use strict';

  const GENRES = {
    A: { key: 'A', name: 'NEW FUNK', short: 'FNK', color: '#00E5FF' },
    B: { key: 'B', name: 'NEW JAZZ', short: 'JAZ', color: '#FF1A8C' },
  };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // ---- event bus ----
  const cb = {};
  function on(ev, fn) { (cb[ev] = cb[ev] || new Set()).add(fn); return () => cb[ev] && cb[ev].delete(fn); }
  function emit(ev, d) { const s = cb[ev]; if (s) s.forEach((fn) => { try { fn(d); } catch (e) {} }); }

  // ---- the ONLY external state ----
  const state = {
    p: 0.5,                 // rope position 0=A(left) .. 1=B(right)
    forceA: 0, forceB: 0,   // decaying impulse accumulators (drive slosh/particles)
    crowdDrive: 0,          // single simulated opponent scalar [-1..1]
    membersA: 128, membersB: 121,
    round: 1, bestOf: 3, scoreA: 0, scoreB: 0,
    phase: 'battle',        // 'battle' | 'sudden' | 'win'
    winner: null, winIsMatch: false,
    suddenSide: null, suddenRemain: 0,
  };

  // ---- internals ----
  let role = 'follower';            // 'leader' | 'follower'
  let myPrio = Math.random();       // leader priority (stage forces high)
  let running = false;
  let sliderOverride = null;        // hidden test slider for opponent (null = scripted)
  let driveTarget = 0, nextDriveChange = 0;
  let suddenUntil = 0, winUntil = 0;
  let lastStateRecv = -1e9;
  let lastBroadcast = 0;
  let lastMembers = 0;

  // ---- cross-view transport ----
  const chan = (typeof BroadcastChannel !== 'undefined') ? new BroadcastChannel('tug-arena') : null;
  function send(msg) {
    if (chan) { try { chan.postMessage(msg); } catch (e) {} }
    try { localStorage.setItem('tug-arena', JSON.stringify({ ...msg, _n: Math.random() })); } catch (e) {}
  }
  function handle(msg) {
    if (!msg || !msg.t) return;
    if (msg.t === 'state') {
      // someone else is (or wants to be) leader
      if (role === 'leader') {
        if (msg.prio > myPrio) role = 'follower';   // higher-priority leader wins
        else return;                                // ignore weaker leaders
      }
      lastStateRecv = performance.now();
      Object.assign(state, msg.s);
      emit('tug', state);
    } else if (msg.t === 'pull') {
      if (role === 'leader') {
        if (msg.side === 'A') state.forceA += msg.impulse; else state.forceB += msg.impulse;
      }
    }
  }
  if (chan) chan.onmessage = (e) => handle(e.data);
  window.addEventListener('storage', (e) => {
    if (e.key === 'tug-arena' && e.newValue) { try { handle(JSON.parse(e.newValue)); } catch (_) {} }
  });

  // ---- public inputs ----
  function pull(side, impulse) {
    impulse = impulse || 0.6;
    // apply locally (drives this view's own particles/feel)
    if (side === 'A') state.forceA += impulse; else state.forceB += impulse;
    // followers relay to the leader; leaders already counted it above
    if (role !== 'leader') send({ t: 'pull', side, impulse });
  }
  function setOpponent(v) { sliderOverride = (v == null ? null : clamp(v, -1, 1)); }  // hidden test slider
  function getState() { return state; }
  function getGenres() { return GENRES; }

  // ---- the authoritative integration (leader only) ----
  function integrate(now) {
    // decay impulse accumulators
    state.forceA *= 0.90; state.forceB *= 0.90;

    // scripted opponent — the single simulated force source
    if (sliderOverride != null) {
      state.crowdDrive = sliderOverride;
    } else {
      if (now > nextDriveChange) {
        nextDriveChange = now + (1100 + Math.random() * 1900);
        driveTarget = (Math.random() * 2 - 1) * 0.85;
      }
      state.crowdDrive += (driveTarget - state.crowdDrive) * 0.03;
    }
    const amb = 0.05;
    if (state.crowdDrive < 0) state.forceA += -state.crowdDrive * amb;
    else state.forceB += state.crowdDrive * amb;

    // move the rope (only while the round is live)
    if (state.phase === 'battle' || state.phase === 'sudden') {
      const net = state.forceB - state.forceA;        // + pulls toward B (right)
      state.p += net * 0.013;
      state.p += (0.5 - state.p) * 0.008;             // gentle center tension
      state.p = clamp(state.p, 0, 1);
    }

    // phase machine
    if (state.phase === 'battle') {
      if (state.p <= 0.2) { state.phase = 'sudden'; state.suddenSide = 'A'; suddenUntil = now + 4000; }
      else if (state.p >= 0.8) { state.phase = 'sudden'; state.suddenSide = 'B'; suddenUntil = now + 4000; }
    } else if (state.phase === 'sudden') {
      const inZone = (state.suddenSide === 'A' && state.p <= 0.2) || (state.suddenSide === 'B' && state.p >= 0.8);
      if (!inZone) { state.phase = 'battle'; state.suddenSide = null; state.suddenRemain = 0; }
      else if (now >= suddenUntil) {
        state.winner = state.suddenSide;
        state.winIsMatch = ((state.winner === 'A' ? state.scoreA : state.scoreB) + 1) >= Math.ceil(state.bestOf / 2) + (state.bestOf % 2 === 0 ? 1 : 0);
        // best-of-3 -> first to 2
        state.winIsMatch = ((state.winner === 'A' ? state.scoreA : state.scoreB) + 1) >= 2;
        state.phase = 'win'; winUntil = now + 2900;
        emit('win', { side: state.winner, isMatch: state.winIsMatch });
      } else {
        state.suddenRemain = Math.max(0, Math.ceil((suddenUntil - now) / 1000));
      }
    } else if (state.phase === 'win') {
      if (now >= winUntil) {
        if (state.winner === 'A') state.scoreA++; else state.scoreB++;
        const matchOver = state.scoreA >= 2 || state.scoreB >= 2;
        state.round = matchOver ? 1 : state.round + 1;
        if (matchOver) { state.scoreA = 0; state.scoreB = 0; }
        state.p = 0.5; state.forceA = state.forceB = 0;
        state.phase = 'battle'; state.winner = null; state.winIsMatch = false; state.suddenSide = null;
      }
    }

    // mock member counts drift a little
    if (now - lastMembers > 900) {
      lastMembers = now;
      state.membersA = Math.max(40, state.membersA + ((Math.random() * 7 - 3) | 0));
      state.membersB = Math.max(40, state.membersB + ((Math.random() * 7 - 3) | 0));
    }
  }

  function frame(now) {
    if (!running) return;
    requestAnimationFrame(frame);

    // followers promote themselves if the leader vanished
    if (role === 'follower' && now - lastStateRecv > 1400) { role = 'leader'; }

    if (role === 'leader') {
      integrate(now);
      emit('tug', state);                              // local render every frame
      if (now - lastBroadcast > 50) {                  // throttle network to ~20fps
        lastBroadcast = now;
        send({ t: 'state', prio: myPrio, s: { ...state } });
      }
    }
  }

  // role: 'leader' (stage), 'follower' (phone, falls back to local leader)
  function start(wantRole) {
    if (wantRole === 'leader') { role = 'leader'; myPrio = 1000 + Math.random(); }
    else { role = 'follower'; myPrio = Math.random(); lastStateRecv = performance.now(); }
    if (running) return;
    running = true;
    nextDriveChange = performance.now();
    requestAnimationFrame(frame);
  }

  window.Tug = { on, start, pull, setOpponent, getState, getGenres, GENRES,
    get role() { return role; } };
})();
