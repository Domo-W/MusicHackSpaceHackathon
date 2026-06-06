/* ============================================================
   stage-reveal.js — STAGE crossfade-audio engine + "song drop" reveal.
   Loaded LAST on stage-live.html. Owns:
     - AudioEngine init + song_ready/song_final wiring (crossfade playback)
     - "generating" subtle ticker ("crafting <name>'s song…")
     - "round_result" BIG full-screen drop reveal (name · genre + intent)
     - the ▶ Start show user gesture (unblocks audio, sends {type:"start"})
   Audience-typed strings (name, answer) are ALWAYS rendered with
   .textContent — never innerHTML. See docs/client-api.md.
   ============================================================ */
(function () {
  "use strict";

  var Net = window.Net;
  var AudioEngine = window.AudioEngine;
  var Tug = window.Tug;

  // ---- audio engine: transition between streaming Suno songs ----
  AudioEngine.init({
    fadeSec: 2,
    minPlaySec: 22, // each song plays >= this, then transitions as soon as the next is ready
    onPlaying: function (id) { Net.send({ type: "playing", id: id }); },
    onState: function (state) {
      Net.send({
        type: "playbackState",
        playing: !!state.playing,
        canSkip: !!state.canSkip,
        song: state.song || undefined,
        nextSong: state.nextSong || undefined,
      });
    },
  });

  Net.on("song_ready", function (m) { AudioEngine.ready(m.song); });
  Net.on("song_final", function (m) { AudioEngine.final(m.id, m.finalUrl); });
  Net.on("song_cancelled", function (m) { if (AudioEngine.cancel) AudioEngine.cancel(m.id); });
  Net.on("show_reset", function () { if (AudioEngine.reset) AudioEngine.reset(); });
  Net.on("force_next", function () { if (AudioEngine.forceNext) AudioEngine.forceNext(); });
  Net.on("playback_control", function (m) {
    if (m.action === "pause" && AudioEngine.pause) AudioEngine.pause();
    if (m.action === "play" && AudioEngine.play) AudioEngine.play();
  });

  // ---- DOM handles (created lazily so order-of-load is irrelevant) ----
  var ticker = document.getElementById("revealTicker");
  var reveal = document.getElementById("revealOverlay");
  var lobbyCount = document.getElementById("lobbyCount");

  // ---- generating ticker: "crafting <name>'s song…" ----
  // Single shared timeout so rapid generating events don't stack.
  var tickerTimer = null;
  Net.on("generating", function (m) {
    if (!ticker) return;
    var seed = m.seed || {};
    ticker.textContent = "";
    var label = document.createElement("span");
    label.className = "tk-label";
    label.textContent = "crafting ";
    var nameEl = document.createElement("span");
    nameEl.className = "tk-name";
    nameEl.textContent = seed.name || "the next";   // audience input → textContent
    var tail = document.createElement("span");
    tail.className = "tk-label";
    tail.textContent = "’s song…";
    ticker.append(label, nameEl, tail);
    ticker.dataset.on = "1";
    if (tickerTimer) clearTimeout(tickerTimer);
    tickerTimer = setTimeout(function () { ticker.dataset.on = "0"; }, 9000);
  });

  // ---- round_result: BIG full-screen drop reveal ----
  // Build all DOM with createElement + textContent. Single timeout handle so a
  // new reveal arriving mid-hold cleanly replaces the previous one.
  var revealTimer = null;
  Net.on("round_result", function (m) {
    if (!reveal) return;

    // genre accent color from the winning side, if we can resolve it
    var color = "#ffffff";
    try {
      var G = (Tug && Tug.GENRES) ? Tug.GENRES : null;
      if (G && m.winner && G[m.winner] && G[m.winner].color) color = G[m.winner].color;
    } catch (e) {}

    // tear down any in-flight reveal
    if (revealTimer) { clearTimeout(revealTimer); revealTimer = null; }
    reveal.textContent = "";

    var card = document.createElement("div");
    card.className = "rv-card";

    var kicker = document.createElement("div");
    kicker.className = "rv-kicker";
    kicker.textContent = "THE NEXT SONG IS FOR";

    var nameEl = document.createElement("div");
    nameEl.className = "rv-name";
    nameEl.textContent = m.name || "";              // audience input → textContent
    nameEl.style.color = color;
    nameEl.style.textShadow = "0 0 60px " + color;

    var genreEl = document.createElement("div");
    genreEl.className = "rv-genre";
    genreEl.textContent = m.genre || "";            // display string from server
    genreEl.style.borderColor = color;
    genreEl.style.color = color;

    card.append(kicker, nameEl, genreEl);

    if (m.answer) {
      var answerEl = document.createElement("div");
      answerEl.className = "rv-answer";
      answerEl.textContent = "“" + m.answer + "”"; // audience input → textContent
      card.append(answerEl);
    }

    reveal.append(card);

    // animate in → hold ~4s → fade out
    reveal.dataset.on = "1";
    reveal.style.animation = "none";
    void reveal.offsetWidth; // reflow so re-triggered animation restarts
    reveal.style.animation = "";

    revealTimer = setTimeout(function () {
      reveal.dataset.on = "0";
      revealTimer = null;
    }, 4600); // ~0.6s in + ~4s hold (fade-out handled by CSS transition)
  });

  // ---- LOBBY vs BATTLE: the show is started from the DASHBOARD now. Before the
  // DJ starts (phase "idle"), the stage shows the "scan to join" lobby; once a
  // round is collecting it shows the tug battle. Driven by the raw 'tug' phase. ----
  Net.on("tug", function (m) {
    if (!m) return;
    var isLobby = m.phase === "idle";
    document.body.classList.toggle("lobby", isLobby);
    if (lobbyCount && typeof m.crowdSize === "number") lobbyCount.textContent = m.crowdSize;
  });

  // ---- LIVE NAME CLOUD: grows as people submit their name ----
  var nameCloud = document.getElementById("nameCloud");
  var cloudEmpty = document.getElementById("cloudEmpty");
  var NC_SIZES = [26, 32, 40, 30, 48, 28, 36, 34];
  var NC_COLORS = ["var(--cyan)", "var(--magenta)", "#ffffff", "var(--cyan)", "var(--magenta)"];
  var shown = {}; // name -> element, so adds are idempotent (no flicker on re-broadcast)
  function updateEmpty() {
    if (cloudEmpty) cloudEmpty.style.display = Object.keys(shown).length ? "none" : "";
  }
  function addName(name) {
    if (!nameCloud || !name || shown[name]) return;
    var el = document.createElement("span");
    el.className = "nc-name";
    el.textContent = name; // audience input → textContent, never innerHTML
    el.style.fontSize = NC_SIZES[Math.floor(Math.random() * NC_SIZES.length)] + "px";
    el.style.color = NC_COLORS[Math.floor(Math.random() * NC_COLORS.length)];
    // per-name drift so the cloud is alive (mentimeter-like), each out of sync
    el.style.setProperty("--fd", (3.4 + Math.random() * 3).toFixed(2) + "s");
    el.style.setProperty("--fdel", (-Math.random() * 5).toFixed(2) + "s");
    el.style.setProperty("--rot", (Math.random() * 8 - 4).toFixed(1) + "deg");
    shown[name] = el;
    nameCloud.appendChild(el);
    requestAnimationFrame(function () { el.classList.add("in"); });
    updateEmpty();
  }
  // Reconcile to the authoritative list: add missing, remove gone (clears on reset).
  function reconcile(list) {
    var keep = {};
    list.forEach(function (n) { keep[n] = true; addName(n); });
    Object.keys(shown).forEach(function (n) {
      if (!keep[n]) { var el = shown[n]; if (el && el.parentNode) el.parentNode.removeChild(el); delete shown[n]; }
    });
    updateEmpty();
  }
  Net.on("name", function (m) { if (m && m.name) addName(m.name); });
  Net.on("names", function (m) { reconcile((m && m.names) || []); });

  // ---- audio unlock: browsers block audio until a user gesture. The DJ starts
  // the show from the dashboard, so the stage just needs ONE click anywhere to
  // enable sound. A small banner hints at it; any click dismisses + unlocks. ----
  var audioUnlocked = false;
  function unlockAudio() {
    if (audioUnlocked) return;
    audioUnlocked = true;
    try { var a = new Audio(); a.muted = true; var p = a.play(); if (p && p.catch) p.catch(function () {}); } catch (e) {}
    var gate = document.getElementById("audioGate");
    if (gate) gate.dataset.on = "0";
  }
  document.addEventListener("click", unlockAudio);

  // The cursor does nothing useful on the projector — hide it entirely.
  document.documentElement.style.cursor = "none";
  document.body.style.cursor = "none";
})();
