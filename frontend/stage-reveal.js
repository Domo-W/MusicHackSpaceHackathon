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
        position: state.position || 0,
        duration: state.duration || 0,
      });
    },
  });

  Net.on("song_ready", function (m) {
    if (!m || !m.song) return;
    // The opener marks a FRESH set — wipe any leftover audio (a looping song or a
    // stuck crossfade carried over from a prior set) so the opener plays from
    // silence and replaces the old track instead of being queued behind it.
    if (String(m.song.id).indexOf("song-opener-") === 0 && AudioEngine.reset) AudioEngine.reset();
    AudioEngine.ready(m.song);
  });
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
  var gatherCountdown = document.getElementById("gatherCountdown");
  var gcNum = document.getElementById("gcNum");
  var voteFill = document.getElementById("voteFill");
  var voteLbl = document.getElementById("voteLbl");
  // stage.js sets the genre NAME text only once at init (when net-tug still holds
  // its NU FUNK/NU SOUL defaults) and never refreshes it — so we keep the names in
  // sync with the backend genres live here.
  var tecName = document.getElementById("tecName");
  var dscName = document.getElementById("dscName");

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

  // ---- round_result → "cooking" hold screen ----
  // The reveal drops in at the buzzer and STAYS UP for the whole generation —
  // covering the tug battle (no giant genre showing behind) — until the next Suno
  // song actually starts playing. It's dismissed by phase (→ "gathering"), NOT a
  // timer, so we never flash back to the tug while a song is still cooking.
  var revealUp = false;
  function dismissReveal() {
    if (!reveal) return;
    reveal.dataset.on = "0";
    document.body.classList.remove("revealing"); // bring the battle text back
    revealUp = false;
  }
  Net.on("round_result", function (m) {
    if (!reveal) return;

    // genre accent color from the winning side, if we can resolve it
    var color = "#ffffff";
    try {
      var G = (Tug && Tug.GENRES) ? Tug.GENRES : null;
      if (G && m.winner && G[m.winner] && G[m.winner].color) color = G[m.winner].color;
    } catch (e) {}

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

    // persistent "cooking" status so it reads as being-made, not a flash reveal
    var cooking = document.createElement("div");
    cooking.className = "rv-cooking";
    cooking.textContent = "COOKING THE NEXT TRACK";
    card.append(cooking);

    reveal.append(card);

    // animate in → HOLD (no timed fade-out; phase drives dismissal)
    reveal.dataset.on = "1";
    document.body.classList.add("revealing"); // hide the background text/readouts
    reveal.style.animation = "none";
    void reveal.offsetWidth; // reflow so re-triggered animation restarts
    reveal.style.animation = "";
    revealUp = true;
  });

  // Safety dismissals: a failed generation or a reset shouldn't leave the cooking
  // screen stuck up. (The happy-path dismissal is phase→"gathering" in the tug handler.)
  Net.on("generation_failed", dismissReveal);

  // ---- LOBBY vs BATTLE: the show is started from the DASHBOARD now. Before the
  // DJ starts (phase "idle"), the stage shows the "scan to join" lobby; once a
  // round is collecting it shows the tug battle. Driven by the raw 'tug' phase. ----
  // ---- SET COMPLETE finale (merged from design-handoff) ----
  // The DJ ends the show -> show_ended carries the saved-song playlist. We flip
  // body.ended so the #ended overlay cross-fades over the battlefront. A new
  // collecting round (or a reset) leaves the finale.
  var ended = false;
  var lastCrowd = 0;
  var endTracksEl = document.getElementById("endTracks");
  var endCrowdEl = document.getElementById("endCrowd");
  var creditsTrack = document.getElementById("creditsTrack");

  // Build the scrolling credits with createElement + textContent (audience names
  // are user input — never innerHTML). Doubled so the -50% loop is seamless.
  function buildCredits(tracks) {
    if (!creditsTrack) return;
    creditsTrack.textContent = "";
    if (!tracks.length) return;
    function run() {
      tracks.forEach(function (t, i) {
        var span = document.createElement("span");
        span.className = "cr";
        var b = document.createElement("b");
        b.textContent = String(i + 1).padStart(2, "0") + " " + (t.title || "");
        span.appendChild(b);
        span.appendChild(document.createTextNode(" · " + (t.genre || "") + " · "));
        var by = document.createElement("i");
        by.textContent = "by " + (t.name || "");
        span.appendChild(by);
        creditsTrack.appendChild(span);
      });
    }
    run();
    run();
  }

  Net.on("show_ended", function (m) {
    ended = true;
    var tracks = (m && Array.isArray(m.songs)) ? m.songs : [];
    if (endTracksEl) endTracksEl.textContent = tracks.length;
    if (endCrowdEl) endCrowdEl.textContent = lastCrowd;
    buildCredits(tracks);
    document.body.classList.remove("lobby");
    document.body.classList.add("ended");
  });
  Net.on("show_reset", function () {
    ended = false;
    document.body.classList.remove("ended");
  });

  Net.on("tug", function (m) {
    if (!m) return;
    if (typeof m.crowdSize === "number") lastCrowd = m.crowdSize;
    // While the finale is up, ignore lobby/battle toggles — only a live round
    // (collecting) tears it down.
    if (ended) {
      if (m.phase === "collecting" || m.phase === "gathering") {
        ended = false;
        document.body.classList.remove("ended");
      } else {
        return;
      }
    }
    // The name cloud (lobby view) stays up before the show AND during each round's
    // gather window; it flips to the tug battle only once voting opens.
    var isLobby = m.phase === "idle" || m.phase === "gathering";
    document.body.classList.toggle("lobby", isLobby);

    // The "cooking" hold (reveal) stays up through generation; it drops only when
    // the next song actually starts (→ "gathering") or we reset (→ "idle").
    if (revealUp && (m.phase === "gathering" || m.phase === "idle")) dismissReveal();

    // Name-cloud countdown: during the gather window, show "VOTING STARTS IN Ns".
    if (gatherCountdown) {
      if (m.phase === "gathering" && m.timeTotal > 0) {
        gatherCountdown.dataset.on = "1";
        if (gcNum) gcNum.textContent = Math.ceil(m.timeRemaining);
      } else {
        gatherCountdown.dataset.on = "0";
      }
    }
    if (lobbyCount && typeof m.crowdSize === "number") lobbyCount.textContent = m.crowdSize;

    // Keep the genre names in sync (stage.js only sets them once, at init).
    if (m.genres) {
      if (tecName && m.genres.A) tecName.textContent = m.genres.A.name;
      if (dscName && m.genres.B) dscName.textContent = m.genres.B.name;
    }

    // Vote countdown meter (replaces CROWD HYPE): a depleting bar + "Ns left".
    if (voteFill && voteLbl) {
      if (m.phase === "collecting" && m.timeTotal > 0) {
        var frac = Math.max(0, Math.min(1, m.timeRemaining / m.timeTotal));
        voteFill.style.width = (frac * 100).toFixed(1) + "%";
        voteLbl.textContent = "VOTE — " + Math.ceil(m.timeRemaining) + "S LEFT";
      } else {
        voteFill.style.width = "0%";
        voteLbl.textContent = m.phase === "playing" ? "NEXT VOTE SOON" : "GET READY TO VOTE";
      }
    }
  });

  // ---- LIVE NAME CLOUD: grows as people submit their name ----
  var nameCloud = document.getElementById("nameCloud");
  var cloudEmpty = document.getElementById("cloudEmpty");
  var NC_SIZES = [26, 32, 40, 30, 48, 28, 36, 34];
  var NC_COLORS = ["var(--cyan)", "var(--magenta)", "#ffffff", "var(--cyan)", "var(--magenta)"];
  var shown = {}; // name -> element, so adds are idempotent (no flicker on re-broadcast)

  // ---- TEAM credits seed: before any real name lands, the cloud shows the team.
  // The instant the first audience name arrives, the seed clears and only real
  // names show. Re-seeds whenever the cloud empties (lobby / reset). ----
  var TEAM_SEED = [
    { name: "Dominic Woetzel", loc: "Los Angeles, CA" },
    { name: "Daniel Hopin", loc: "Austin, TX" },
    { name: "C.Y. Lee", loc: "Seattle, WA" },
    { name: "Dupes", loc: "St. Lucia, West Indies" },
    { name: "Pete Rango", loc: "Richmond, VA" },
  ];
  var seedEls = [];
  var seedActive = false;
  function showTeamSeed() {
    if (seedActive || !nameCloud) return;
    seedActive = true;
    TEAM_SEED.forEach(function (m, i) {
      var el = document.createElement("span");
      el.className = "nc-name nc-team";
      el.textContent = m.name; // ours, but keep textContent for consistency/safety
      if (m.loc) {
        var loc = document.createElement("i");
        loc.className = "nc-loc";
        loc.textContent = m.loc;
        el.appendChild(loc);
      }
      el.style.color = NC_COLORS[i % NC_COLORS.length];
      el.style.setProperty("--fd", (4 + (i % 3) * 0.8).toFixed(2) + "s");
      el.style.setProperty("--fdel", (-i * 0.9).toFixed(2) + "s");
      nameCloud.appendChild(el);
      requestAnimationFrame(function () { el.classList.add("in"); });
      seedEls.push(el);
    });
    updateEmpty();
  }
  function clearTeamSeed() {
    if (!seedActive) return;
    seedActive = false;
    seedEls.forEach(function (el) { if (el && el.parentNode) el.parentNode.removeChild(el); });
    seedEls = [];
    updateEmpty();
  }

  function updateEmpty() {
    if (cloudEmpty) cloudEmpty.style.display = (Object.keys(shown).length || seedActive) ? "none" : "";
  }
  function addName(name) {
    if (!nameCloud || !name || shown[name]) return;
    if (seedActive) clearTeamSeed(); // first real name clears the team credits
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
    // No real names yet (pre-show / after reset) → show the team credits.
    if (Object.keys(shown).length === 0) showTeamSeed();
    updateEmpty();
  }
  Net.on("name", function (m) { if (m && m.name) addName(m.name); });
  Net.on("names", function (m) { reconcile((m && m.names) || []); });
  showTeamSeed(); // seed immediately on load (the lobby is up before any join)

  // ---- audio unlock: browsers block audio until a user gesture. The DJ starts
  // the show from the dashboard, so the stage just needs ONE click anywhere to
  // enable sound. A small banner hints at it; any click dismisses + unlocks. ----
  var audioUnlocked = false;
  function unlockAudio() {
    if (audioUnlocked) return;
    audioUnlocked = true;
    try { var a = new Audio(); a.muted = true; var p = a.play(); if (p && p.catch) p.catch(function () {}); } catch (e) {}
    // If a song already arrived but autoplay was blocked (no gesture yet),
    // this click IS the gesture — retry it instead of staying silent.
    if (window.AudioEngine && AudioEngine.unblock) AudioEngine.unblock();
    var gate = document.getElementById("audioGate");
    if (gate) gate.dataset.on = "0";
  }
  document.addEventListener("click", unlockAudio);

  // The cursor does nothing useful on the projector — hide it entirely.
  document.documentElement.style.cursor = "none";
  document.body.style.cursor = "none";
})();
