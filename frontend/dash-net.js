/* ============================================================
   dash-net.js — DJ DASHBOARD ↔ backend glue (Agent D).
   Loaded LAST, after net.js + dash.jsx.

   How it sources dashboard config:
     The partner's dash.jsx already broadcasts every "Push to crowd"
     action on a BroadcastChannel('dj-console') as {channel, payload, ts}
     (see pushToCrowd() in dash.jsx / frontend/README.md). We SUBSCRIBE to
     that channel — no monkey-patching, no file edits — and translate the
     relevant broadcasts into Net.send({type:"config", ...}).

   Channels seen on 'dj-console':
     - "tug-genres" : { sideA, sideB }  (genre ids) -> genreA/genreB GenreInfo
     - "vibe-cards" : ["..","..","..",".."]          -> question (best-effort)

   It also injects a Live screen audio player. Less-frequent show actions
   and vote timing controls live in a compact drawer beside the transport.

   Protocol: docs/client-api.md + backend/src/types.ts.
   ============================================================ */
(function () {
  "use strict";

  if (!window.Net) {
    console.warn("[dash-net] window.Net missing — load net.js before dash-net.js");
    return;
  }

  // ---- genre id -> display name (mirror of dash.jsx GENRES; read-only copy) ----
  // Kept in sync with the partner's GENRES list so we can resolve names without
  // reaching into the dashboard's React state.
  var GENRE_NAMES = {
    soca: "Soca",
    reggae: "Reggae",
    dancehall: "Dancehall",
    afrobeats: "Afrobeats",
    pop: "Pop",
    country: "Country",
    poprock: "Pop Rock",
    tropicalhouse: "Tropical House",
  };

  // Convention from the spec: A -> cyan, B -> magenta.
  var SIDE_COLOR = { A: "#00E5FF", B: "#FF1A8C" };

  // Derive a 3-letter short code from a genre name (vowel-strip then truncate).
  function shortCode(name) {
    var clean = String(name || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (clean.length <= 3) return clean || "GEN";
    var noVowel = clean.replace(/[AEIOU]/g, "");
    var base = noVowel.length >= 3 ? noVowel : clean;
    return base.slice(0, 3);
  }

  // Build a GenreInfo {key, name, short, color} from a dashboard genre id.
  function genreInfo(side, id) {
    var name = GENRE_NAMES[id] || (id ? String(id) : "Genre " + side);
    return { key: side, name: name, short: shortCode(name), color: SIDE_COLOR[side] };
  }

  // ---- collectSeconds (no dashboard field; supplied via our injected input) ----
  var collectSeconds = null; // null => omit from config (backend default)

  // ---- translate a 'dj-console' broadcast into a config send ----
  function handleConsole(channel, payload) {
    if (channel === "tug-genres" && payload && typeof payload === "object") {
      var msg = {
        type: "config",
        genreA: genreInfo("A", payload.sideA),
        genreB: genreInfo("B", payload.sideB),
      };
      if (collectSeconds != null) msg.collectSeconds = collectSeconds;
      Net.send(msg);
      status("config sent · " + msg.genreA.name + " vs " + msg.genreB.name);
    } else if (channel === "vibe-cards" && Array.isArray(payload)) {
      // No dedicated "question" field on the dashboard. Best-effort: use the
      // first non-empty vibe card as the round question. (Flagged for lead.)
      var q = payload.map(function (s) { return String(s == null ? "" : s).trim(); })
        .filter(function (s) { return s.length; })[0];
      if (q) {
        Net.send({ type: "config", question: q });
        status("config sent · question: " + q);
      }
    }
  }

  // Subscribe to the channel the dashboard already posts on.
  try {
    var bc = new BroadcastChannel("dj-console");
    bc.onmessage = function (e) {
      var d = e && e.data;
      if (d && typeof d.channel === "string") handleConsole(d.channel, d.payload);
    };
  } catch (err) {
    console.warn("[dash-net] BroadcastChannel unavailable:", err);
  }

  // ============================================================
  // Injected control strip + live status. All text via textContent.
  // ============================================================
  var statusEl = null;
  var downloadBtn = null;
  var playPauseBtn = null;
  var skipSongBtn = null;
  var playerLabel = null;
  var playerMeta = null;
  var playerPulse = null;
  var actionsMenu = null;
  var latestSavedSong = null;
  var playbackState = { playing: false, canSkip: false, song: null };

  function status(text) {
    if (statusEl) statusEl.textContent = text;
  }

  function makeBtn(label, className, onClick) {
    var b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.className = className;
    b.addEventListener("click", onClick);
    return b;
  }

  function addPlayerStyles() {
    var style = document.createElement("style");
    style.textContent = [
      "#dashNetBar{position:fixed;left:0;right:0;bottom:0;z-index:9999;height:88px;",
      "display:grid;grid-template-columns:minmax(250px,1fr) auto minmax(250px,1fr);align-items:center;",
      "gap:24px;padding:12px 22px;background:rgba(10,10,15,.97);border-top:1px solid rgba(255,255,255,.14);",
      "box-shadow:0 -18px 50px rgba(0,0,0,.38);font-family:'JetBrains Mono',ui-monospace,monospace;color:#F4F4F8}",
      ".dnp-now{display:flex;align-items:center;gap:13px;min-width:0}.dnp-art{position:relative;display:grid;place-items:center;",
      "width:52px;height:52px;flex:none;border-radius:12px;background:linear-gradient(135deg,#1D2630,#15151F);",
      "border:1px solid rgba(0,229,255,.24);overflow:hidden}.dnp-bars{display:flex;align-items:flex-end;gap:3px;height:18px}",
      ".dnp-bars i{display:block;width:3px;height:7px;background:#00E5FF;border-radius:2px;opacity:.35}",
      ".dnp-bars.is-playing i{animation:dnp-wave .8s ease-in-out infinite;opacity:1}.dnp-bars i:nth-child(2){height:14px;animation-delay:.12s}",
      ".dnp-bars i:nth-child(3){height:10px;animation-delay:.24s}.dnp-bars i:nth-child(4){height:17px;animation-delay:.36s}",
      "@keyframes dnp-wave{0%,100%{transform:scaleY(.45)}50%{transform:scaleY(1)}}",
      ".dnp-copy{min-width:0}.dnp-kicker{font-size:9px;font-weight:700;letter-spacing:.18em;color:#00E5FF;text-transform:uppercase}",
      ".dnp-title{margin-top:5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;",
      "font:600 14px 'Space Grotesk',system-ui,sans-serif;letter-spacing:.02em}.dnp-meta{margin-top:3px;",
      "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:9px;letter-spacing:.1em;color:#8C8C9C;text-transform:uppercase}",
      ".dnp-transport{display:flex;align-items:center;gap:12px}.dnp-transport button,.dnp-utility{border:1px solid rgba(255,255,255,.16);",
      "color:#F4F4F8;background:#15151F;transition:opacity .15s,border-color .15s,background .15s,transform .12s}",
      ".dnp-transport button:hover:not(:disabled),.dnp-utility:hover:not(:disabled){border-color:rgba(255,255,255,.42);background:#1B1B27}",
      ".dnp-transport button:active:not(:disabled),.dnp-utility:active:not(:disabled){transform:scale(.96)}",
      ".dnp-transport button:disabled,.dnp-utility:disabled{opacity:.3;cursor:not-allowed}",
      ".dnp-play{width:52px;height:52px;border-radius:50%!important;background:#F4F4F8!important;color:#0A0A0F!important;",
      "border-color:#F4F4F8!important;font:700 10px 'Space Grotesk',system-ui,sans-serif;letter-spacing:.08em}",
      ".dnp-skip{height:38px;border-radius:999px;padding:0 16px;font:600 10px 'Space Grotesk',system-ui,sans-serif;",
      "letter-spacing:.1em;text-transform:uppercase}.dnp-right{position:relative;display:flex;align-items:center;justify-content:flex-end;gap:9px;min-width:0}",
      ".dnp-utility{height:36px;border-radius:8px;padding:0 12px;font:600 10px 'Space Grotesk',system-ui,sans-serif;",
      "letter-spacing:.08em;text-transform:uppercase}.dnp-actions-toggle{color:#0A0A0F;background:#00E5FF;border-color:#00E5FF}",
      ".dnp-actions{position:absolute;right:0;bottom:52px;width:310px;padding:14px;background:#101018;",
      "border:1px solid rgba(255,255,255,.18);border-radius:14px;box-shadow:0 18px 60px rgba(0,0,0,.55);display:none}",
      ".dnp-actions.is-open{display:block}.dnp-actions-head{display:flex;align-items:center;justify-content:space-between;",
      "margin-bottom:10px;font:700 10px 'JetBrains Mono',monospace;letter-spacing:.15em;color:#8C8C9C;text-transform:uppercase}",
      ".dnp-action-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.dnp-action{height:38px;border-radius:8px;",
      "border:1px solid rgba(255,255,255,.12);background:#191923;color:#F4F4F8;font:600 10px 'Space Grotesk',system-ui,sans-serif;",
      "letter-spacing:.08em;text-transform:uppercase}.dnp-action:hover{border-color:rgba(0,229,255,.5);background:#20202C}",
      ".dnp-action-primary{background:#00E5FF;color:#0A0A0F;border-color:#00E5FF}.dnp-action-danger{color:#FF7A9F}",
      ".dnp-timing{display:flex;align-items:center;justify-content:space-between;margin-top:10px;padding-top:10px;",
      "border-top:1px solid rgba(255,255,255,.1);font-size:9px;letter-spacing:.12em;color:#8C8C9C;text-transform:uppercase}",
      ".dnp-timing input{width:64px;height:30px;padding:0 8px;background:#15151F;border:1px solid rgba(255,255,255,.18);",
      "border-radius:7px;color:#F4F4F8;font:500 11px 'JetBrains Mono',monospace;outline:none}",
      "#dashNetStatus{position:absolute;right:22px;bottom:5px;max-width:360px;overflow:hidden;text-overflow:ellipsis;",
      "white-space:nowrap;font-size:8px;letter-spacing:.08em;color:#8C8C9C;text-transform:uppercase}",
      "@media(max-width:900px){#dashNetBar{grid-template-columns:minmax(180px,1fr) auto auto;gap:12px;padding-inline:12px}",
      ".dnp-download{display:none}.dnp-actions{right:0}.dnp-art{width:44px;height:44px}.dnp-meta{display:none}}"
    ].join("");
    document.head.appendChild(style);
  }

  function buildStrip() {
    addPlayerStyles();
    var bar = document.createElement("div");
    bar.id = "dashNetBar";

    var nowPlaying = document.createElement("div");
    nowPlaying.className = "dnp-now";
    var art = document.createElement("div");
    art.className = "dnp-art";
    playerPulse = document.createElement("span");
    playerPulse.className = "dnp-bars";
    for (var i = 0; i < 4; i += 1) playerPulse.appendChild(document.createElement("i"));
    art.appendChild(playerPulse);
    var copy = document.createElement("div");
    copy.className = "dnp-copy";
    var kicker = document.createElement("div");
    kicker.className = "dnp-kicker";
    kicker.textContent = "LIVE SCREEN AUDIO";
    playerLabel = document.createElement("div");
    playerLabel.className = "dnp-title";
    playerLabel.textContent = "No song loaded";
    playerMeta = document.createElement("div");
    playerMeta.className = "dnp-meta";
    playerMeta.textContent = "Waiting for the first generated track";
    copy.appendChild(kicker);
    copy.appendChild(playerLabel);
    copy.appendChild(playerMeta);
    nowPlaying.appendChild(art);
    nowPlaying.appendChild(copy);
    bar.appendChild(nowPlaying);

    var transport = document.createElement("div");
    transport.className = "dnp-transport";
    playPauseBtn = makeBtn("PLAY", "dnp-play", function () {
      var action = playbackState.playing ? "pause" : "play";
      Net.send({ type: "playbackControl", action: action });
      status(action + " sent to Live screen");
    });
    playPauseBtn.setAttribute("aria-label", "Play Live screen audio");
    playPauseBtn.disabled = true;
    skipSongBtn = makeBtn("Next track", "dnp-skip", function () {
      Net.send({ type: "forceNext" });
      status("next track sent to Live screen");
    });
    skipSongBtn.disabled = true;
    transport.appendChild(playPauseBtn);
    transport.appendChild(skipSongBtn);
    bar.appendChild(transport);

    var right = document.createElement("div");
    right.className = "dnp-right";
    downloadBtn = makeBtn("Download", "dnp-utility dnp-download", function () {
      if (!latestSavedSong) return;
      var a = document.createElement("a");
      a.href = latestSavedSong.downloadUrl;
      a.download = latestSavedSong.fileName || "";
      document.body.appendChild(a);
      a.click();
      a.remove();
      status("downloading " + latestSavedSong.title);
    });
    downloadBtn.disabled = true;
    right.appendChild(downloadBtn);

    var actionsToggle = makeBtn("Show Actions", "dnp-utility dnp-actions-toggle", function () {
      actionsMenu.classList.toggle("is-open");
      actionsToggle.setAttribute("aria-expanded", actionsMenu.classList.contains("is-open") ? "true" : "false");
    });
    actionsToggle.setAttribute("aria-expanded", "false");
    right.appendChild(actionsToggle);

    actionsMenu = document.createElement("div");
    actionsMenu.className = "dnp-actions";
    var actionsHead = document.createElement("div");
    actionsHead.className = "dnp-actions-head";
    var actionsTitle = document.createElement("span");
    actionsTitle.textContent = "SHOW ACTIONS";
    var actionsHint = document.createElement("span");
    actionsHint.textContent = "ROUND + ADMIN";
    actionsHead.appendChild(actionsTitle);
    actionsHead.appendChild(actionsHint);
    actionsMenu.appendChild(actionsHead);
    var actionGrid = document.createElement("div");
    actionGrid.className = "dnp-action-grid";
    actionGrid.appendChild(makeBtn("Start Show", "dnp-action dnp-action-primary", function () { Net.send({ type: "start" }); status("show started"); }));
    actionGrid.appendChild(makeBtn("End Vote", "dnp-action", function () { Net.send({ type: "endVote" }); status("vote ended"); }));
    actionGrid.appendChild(makeBtn("Regenerate", "dnp-action", function () { Net.send({ type: "skip" }); status("regenerating queued song"); }));
    actionGrid.appendChild(makeBtn("Hold Flow", "dnp-action", function () { Net.send({ type: "hold" }); status("show flow held"); }));
    actionGrid.appendChild(makeBtn("Resume Flow", "dnp-action", function () { Net.send({ type: "resume" }); status("show flow resumed"); }));
    actionGrid.appendChild(makeBtn("Reset Show", "dnp-action dnp-action-danger", function () { Net.send({ type: "reset" }); status("show reset to lobby"); }));
    actionGrid.appendChild(makeBtn("End Show", "dnp-action dnp-action-danger", function () { Net.send({ type: "end" }); status("end show → recap"); }));
    actionsMenu.appendChild(actionGrid);

    var secWrap = document.createElement("label");
    secWrap.className = "dnp-timing";
    var secLabel = document.createElement("span");
    secLabel.textContent = "Vote duration (seconds)";
    var secInput = document.createElement("input");
    secInput.type = "number";
    secInput.min = "1";
    secInput.placeholder = "50";
    secInput.addEventListener("change", function () {
      var v = parseInt(secInput.value, 10);
      collectSeconds = (isFinite(v) && v > 0) ? v : null;
      if (collectSeconds != null) {
        Net.send({ type: "config", collectSeconds: collectSeconds });
        status("config sent · collectSeconds: " + collectSeconds);
      }
    });
    secWrap.appendChild(secLabel);
    secWrap.appendChild(secInput);
    actionsMenu.appendChild(secWrap);
    right.appendChild(actionsMenu);
    bar.appendChild(right);

    statusEl = document.createElement("span");
    statusEl.id = "dashNetStatus";
    statusEl.textContent = "waiting";
    bar.appendChild(statusEl);

    document.body.appendChild(bar);
    document.addEventListener("click", function (event) {
      if (!actionsMenu.contains(event.target) && event.target !== actionsToggle) {
        actionsMenu.classList.remove("is-open");
        actionsToggle.setAttribute("aria-expanded", "false");
      }
    });

    // dash.jsx includes the player height in its fit calculation. Trigger that
    // calculation after the injected player has measurable dimensions.
    function fitForBar() {
      window.dispatchEvent(new Event("resize"));
    }
    requestAnimationFrame(fitForBar);
    window.addEventListener("resize", fitForBar);
  }

  // ============================================================
  // Live status from server messages (textContent only).
  // ============================================================
  function wireStatus() {
    Net.on("__open", function () { status("connected"); });
    Net.on("__close", function () { status("disconnected — reconnecting…"); });

    Net.on("tug", function (m) {
      var t = (m && typeof m.timeRemaining === "number") ? m.timeRemaining.toFixed(1) + "s" : "–";
      status("phase " + (m && m.phase) + " · round " + (m && m.round) + " · " + t +
        " · crowd " + (m && m.crowdSize));
    });

    Net.on("generating", function (m) {
      var s = m && m.seed;
      status("generating " + (s ? (s.name + " — " + s.genre) : "…"));
    });

    Net.on("song_ready", function (m) {
      var s = m && m.song;
      status("now playing: " + (s ? (s.title + " (" + s.name + ")") : "song"));
    });

    Net.on("song_saved", function (m) {
      setLatestSaved(m && m.song);
      if (m && m.song) status("saved locally · " + m.song.title);
    });

    Net.on("now_playing", function (m) {
      status("now playing id " + (m && m.id));
    });

    Net.on("playback_state", function (m) {
      playbackState = {
        playing: !!(m && m.playing),
        canSkip: !!(m && m.canSkip),
        song: m && m.song ? m.song : null,
      };
      updatePlayer();
    });
  }

  function updatePlayer() {
    if (!playPauseBtn) return;
    playPauseBtn.textContent = playbackState.playing ? "PAUSE" : "PLAY";
    playPauseBtn.setAttribute("aria-label", (playbackState.playing ? "Pause" : "Play") + " Live screen audio");
    playPauseBtn.disabled = !playbackState.song;
    playPauseBtn.title = playbackState.song
      ? (playbackState.playing ? "Pause " : "Play ") + playbackState.song.title + " on the Live screen"
      : "No song loaded on the Live screen";
    if (skipSongBtn) {
      skipSongBtn.disabled = !playbackState.canSkip;
      skipSongBtn.title = playbackState.canSkip ? "Crossfade to the queued track" : "No next track queued";
    }
    if (playerLabel) {
      playerLabel.textContent = playbackState.song
        ? playbackState.song.title
        : "No song loaded";
      playerLabel.title = playbackState.song ? playbackState.song.title : "";
    }
    if (playerMeta) {
      playerMeta.textContent = playbackState.song
        ? (playbackState.playing ? "Playing" : "Paused") + " · " +
          playbackState.song.genre + " · " + playbackState.song.bpm + " BPM · for " + playbackState.song.name
        : "Waiting for the first generated track";
    }
    if (playerPulse) playerPulse.classList.toggle("is-playing", playbackState.playing);
  }

  function setLatestSaved(song) {
    if (!song) return;
    latestSavedSong = song;
    if (downloadBtn) {
      downloadBtn.disabled = false;
      downloadBtn.title = song.title + " · " + song.genre + " · " + song.bpm + " BPM";
    }
  }

  function loadSavedSongs() {
    fetch("/api/songs")
      .then(function (res) { return res.ok ? res.json() : Promise.reject(new Error("HTTP " + res.status)); })
      .then(function (data) {
        if (data && Array.isArray(data.songs) && data.songs.length) setLatestSaved(data.songs[0]);
      })
      .catch(function (err) { console.warn("[dash-net] could not load saved songs:", err.message); });
  }

  // Auto-sync the DJ's selected genres to the backend so the phone vote ALWAYS
  // reflects the dashboard — no need to remember to hit "push". Polls the
  // partner's window.DJConsoleState (updated live as they pick A/B genres).
  function autoSyncGenres() {
    var last = "";
    // Re-push the current genres whenever we (re)connect — e.g. after a server
    // restart the backend reverts to defaults, so force a resend.
    if (Net && Net.on) Net.on("__open", function () { last = ""; });
    setInterval(function () {
      var s = window.DJConsoleState;
      if (!s || s.sideA == null || s.sideB == null) return;
      var key = String(s.sideA) + "|" + String(s.sideB);
      if (key === last) return;
      last = key;
      var msg = { type: "config", genreA: genreInfo("A", s.sideA), genreB: genreInfo("B", s.sideB) };
      Net.send(msg);
      status("genres → " + msg.genreA.name + " vs " + msg.genreB.name);
    }, 700);
  }

  function init() {
    buildStrip();
    wireStatus();
    autoSyncGenres();
    loadSavedSongs();
    status("ready" + (Net.ready() ? " · connected" : ""));
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
