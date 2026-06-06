/* ============================================================
   audioEngine.js — gapless crossfade between streaming Suno songs.
   Plays each song from its progressive stream URL via a plain <audio>
   element and crossfades by ramping .volume (CORS-proof; desktop Chrome).
   The CURRENT element always loops, so there is never dead air while the
   next song is still generating (the "not-ready" fallback).
   Exposes window.AudioEngine.
   ============================================================ */
(function () {
  "use strict";

  // Each song plays for ~segmentSec, then crossfades to the next (if ready; else
  // loops until it is). Fixed segment length avoids depending on Suno's highly
  // variable `complete` time / unreliable stream duration — robust pacing.
  let segmentSec = 70;
  let fadeSec = 6;
  let onPlaying = () => {};

  const voices = new Map(); // id -> { song, el, durationSec, startedAt }
  let current = null;
  let pending = null;
  let crossTimer = null;
  let crossing = false;

  const now = () => performance.now() / 1000;

  function buildVoice(song) {
    const el = new Audio();
    el.src = song.streamUrl;
    el.preload = "auto";
    el.crossOrigin = "anonymous";
    el.loop = true; // never gap; crossfade replaces it
    el.volume = 0;
    const voice = { song, el, durationSec: null, startedAt: null };
    voices.set(song.id, voice);
    return voice;
  }

  function makeCurrent(voice) {
    voice.el.volume = 1;
    voice.startedAt = now();
    current = voice;
    voice.el.play().catch((e) => console.warn("play() blocked:", e.message));
    onPlaying(voice.song.id);
    log(`▶ playing ${voice.song.id} — ${voice.song.name} · ${voice.song.genre}`);
  }

  // Once we have both current + pending, schedule the crossfade for
  // (segmentSec - fade) into the current song. If pending arrives late (current
  // already looping past the segment), wait is 0 → crossfade immediately, no gap.
  function maybeCross() {
    if (!current || !pending || crossing) return;
    const elapsed = now() - current.startedAt;
    const wait = Math.max(0, segmentSec - fadeSec - elapsed);
    if (crossTimer) clearTimeout(crossTimer);
    crossTimer = setTimeout(crossfade, wait * 1000);
    log(`⤬ crossfade ${current.song.id}→next scheduled in ${wait.toFixed(1)}s`);
  }

  function crossfade() {
    if (!current || !pending || crossing) return;
    crossing = true;
    const from = current;
    const to = pending;
    pending = null;
    to.el.volume = 0;
    to.startedAt = now();
    to.el.play().catch((e) => console.warn("play() blocked:", e.message));
    log(`⤬ crossfading ${from.song.id} → ${to.song.id}`);

    const t0 = performance.now();
    const durMs = fadeSec * 1000;
    function step(t) {
      const k = Math.min(1, (t - t0) / durMs);
      // equal-power-ish: keep perceived loudness ~constant
      from.el.volume = Math.max(0, Math.cos((k * Math.PI) / 2));
      to.el.volume = Math.min(1, Math.sin((k * Math.PI) / 2));
      if (k < 1) {
        requestAnimationFrame(step);
      } else {
        from.el.pause();
        from.el.src = "";
        voices.delete(from.song.id);
        current = to;
        crossing = false;
        onPlaying(to.song.id);
        log(`✓ now playing ${to.song.id}`);
        maybeCross(); // in case the next one is already queued
      }
    }
    requestAnimationFrame(step);
  }

  const AudioEngine = {
    init(opts) {
      fadeSec = opts.fadeSec ?? fadeSec;
      segmentSec = opts.segmentSec ?? segmentSec;
      onPlaying = opts.onPlaying ?? onPlaying;
    },

    // A song's streaming URL is ready to play.
    ready(song) {
      if (voices.has(song.id)) return; // dedupe
      const voice = buildVoice(song);
      if (!current) makeCurrent(voice); // cold start
      else {
        pending = voice;
        maybeCross();
      }
    },

    // The clean CDN url arrived. Pacing no longer depends on it (segment-based),
    // so this is just a hook — a future upgrade could swap a long-looping
    // current voice from the stream to the seekable m4a for fidelity.
    final(id, finalUrl) {
      const voice = voices.get(id);
      if (voice) voice.finalUrl = finalUrl;
      log(`⏱ ${id} final m4a ready`);
    },
  };

  function log(msg) {
    if (window.__spineLog) window.__spineLog(msg);
    console.log("[engine]", msg);
  }

  window.AudioEngine = AudioEngine;
})();
