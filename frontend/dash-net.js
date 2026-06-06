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
        genreOverride: true,
      };
      if (collectSeconds != null) msg.collectSeconds = collectSeconds;
      Net.send(msg);
      if (!showState.started) {
        Net.send({ type: "start" });
        status("show started · " + msg.genreA.name + " vs " + msg.genreB.name);
      } else {
        status("next round genres · " + msg.genreA.name + " vs " + msg.genreB.name);
      }
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
  var flowLabel = null;
  var flowMeta = null;
  var actionsMenu = null;
  var startShowBtn = null;
  var endVoteBtn = null;
  var regenerateBtn = null;
  var holdBtn = null;
  var resumeBtn = null;
  var latestSavedSong = null;
  var savedSongs = []; // full session archive (newest first), from /api/songs
  var songsPanel = null;
  var songsList = null;
  var songsToggle = null;
  var songsBadge = null;
  var playbackState = { playing: false, canSkip: false, song: null, nextSong: null };
  var showState = {
    started: false,
    held: false,
    phase: "idle",
    round: 0,
    genres: null,
    genreSource: "auto",
    seed: null,
    error: "",
  };
  var lastTug = null;

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
      ".dnp-flow{min-width:150px;max-width:260px;padding-right:10px;text-align:right}.dnp-flow-label{overflow:hidden;text-overflow:ellipsis;",
      "white-space:nowrap;font:700 10px 'Space Grotesk',system-ui,sans-serif;letter-spacing:.04em;color:#F4F4F8}",
      ".dnp-flow-meta{margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:8px;",
      "letter-spacing:.1em;color:#8C8C9C;text-transform:uppercase}.dnp-flow.is-error .dnp-flow-label{color:#FF7A9F}",
      ".dnp-flow.is-generating .dnp-flow-label{color:#FFD23F}.dnp-flow.is-ready .dnp-flow-label{color:#2DD36F}",
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
      ".dnp-action:disabled{opacity:.3;cursor:not-allowed}.dnp-action:disabled:hover{border-color:rgba(255,255,255,.12);background:#191923}",
      ".dnp-timing{display:flex;align-items:center;justify-content:space-between;margin-top:10px;padding-top:10px;",
      "border-top:1px solid rgba(255,255,255,.1);font-size:9px;letter-spacing:.12em;color:#8C8C9C;text-transform:uppercase}",
      ".dnp-timing input{width:64px;height:30px;padding:0 8px;background:#15151F;border:1px solid rgba(255,255,255,.18);",
      "border-radius:7px;color:#F4F4F8;font:500 11px 'JetBrains Mono',monospace;outline:none}",
      "#dashNetStatus{position:absolute;right:22px;bottom:5px;max-width:360px;overflow:hidden;text-overflow:ellipsis;",
      "white-space:nowrap;font-size:8px;letter-spacing:.08em;color:#8C8C9C;text-transform:uppercase}",
      // ---- Session Songs slide-out panel ----
      ".dnp-songs{position:fixed;top:0;bottom:88px;right:0;z-index:9998;width:360px;max-width:92vw;",
      "transform:translateX(100%);transition:transform .26s cubic-bezier(.4,0,.2,1);display:flex;flex-direction:column;",
      "background:rgba(12,12,18,.985);border-left:1px solid rgba(255,255,255,.14);box-shadow:-22px 0 60px rgba(0,0,0,.5);",
      "font-family:'JetBrains Mono',ui-monospace,monospace;color:#F4F4F8}.dnp-songs.is-open{transform:translateX(0)}",
      ".dnp-songs-head{display:flex;align-items:center;justify-content:space-between;padding:18px 18px 12px;",
      "border-bottom:1px solid rgba(255,255,255,.1)}.dnp-songs-title{font:700 13px 'Space Grotesk',system-ui,sans-serif;",
      "letter-spacing:.04em}.dnp-songs-sub{margin-top:3px;font-size:9px;letter-spacing:.12em;color:#8C8C9C;text-transform:uppercase}",
      ".dnp-songs-close{width:30px;height:30px;flex:none;border-radius:8px;border:1px solid rgba(255,255,255,.16);",
      "background:#15151F;color:#F4F4F8;font-size:15px;line-height:1;cursor:pointer}.dnp-songs-close:hover{background:#1B1B27}",
      ".dnp-songs-list{flex:1;overflow-y:auto;padding:12px 14px 18px;display:flex;flex-direction:column;gap:9px}",
      ".dnp-songs-empty{padding:34px 18px;text-align:center;font-size:10px;letter-spacing:.1em;color:#6E6E80;text-transform:uppercase}",
      ".dnp-song{display:flex;align-items:center;gap:11px;padding:11px 12px;border-radius:11px;background:#15151F;",
      "border:1px solid rgba(255,255,255,.08)}.dnp-song.is-now{border-color:rgba(45,211,111,.6);background:rgba(45,211,111,.07)}",
      ".dnp-song-num{width:24px;flex:none;text-align:center;font:700 11px 'JetBrains Mono',monospace;color:#8C8C9C}",
      ".dnp-song.is-now .dnp-song-num{color:#2DD36F}.dnp-song-copy{min-width:0;flex:1}.dnp-song-title{overflow:hidden;",
      "text-overflow:ellipsis;white-space:nowrap;font:600 12px 'Space Grotesk',system-ui,sans-serif}",
      ".dnp-song-meta{margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:8px;",
      "letter-spacing:.09em;color:#8C8C9C;text-transform:uppercase}.dnp-song.is-now .dnp-song-meta{color:#2DD36F}",
      ".dnp-song-dl{flex:none;height:30px;border-radius:8px;padding:0 11px;border:1px solid rgba(255,255,255,.16);",
      "background:#191923;color:#F4F4F8;font:600 9px 'Space Grotesk',system-ui,sans-serif;letter-spacing:.08em;",
      "text-transform:uppercase;cursor:pointer}.dnp-song-dl:hover{border-color:rgba(0,229,255,.5);background:#20202C}",
      ".dnp-song-del{flex:none;width:30px;height:30px;border-radius:8px;border:1px solid rgba(255,255,255,.12);",
      "background:#191923;color:#8C8C9C;font-size:13px;line-height:1;cursor:pointer}",
      ".dnp-song-del:hover{border-color:rgba(255,122,159,.6);color:#FF7A9F;background:#221820}",
      ".dnp-song-del.is-confirm{width:auto;padding:0 11px;border-color:#FF4D6D;color:#0A0A0F;background:#FF4D6D;",
      "font:700 9px 'Space Grotesk',system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase}",
      ".dnp-songs-toggle{color:#0A0A0F;background:#F4F4F8;border-color:#F4F4F8}",
      ".dnp-songs-toggle .dnp-songs-badge{margin-left:6px;padding:1px 6px;border-radius:999px;background:#0A0A0F;",
      "color:#F4F4F8;font-size:9px;font-weight:700}",
      "@media(max-width:900px){#dashNetBar{grid-template-columns:minmax(180px,1fr) auto auto;gap:12px;padding-inline:12px}",
      ".dnp-download,.dnp-flow{display:none}.dnp-actions{right:0}.dnp-art{width:44px;height:44px}.dnp-meta{display:none}",
      ".dnp-songs{width:100vw;max-width:100vw}}"
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
    var flow = document.createElement("div");
    flow.className = "dnp-flow";
    flowLabel = document.createElement("div");
    flowLabel.className = "dnp-flow-label";
    flowLabel.textContent = "Show is ready";
    flowMeta = document.createElement("div");
    flowMeta.className = "dnp-flow-meta";
    flowMeta.textContent = "Choose genres and start the show";
    flow.appendChild(flowLabel);
    flow.appendChild(flowMeta);
    right.appendChild(flow);

    // Downloads the track currently LOOPING on the Live screen when it's been
    // archived (saved on `complete`); otherwise the most recent saved track.
    // (We generate one ahead, so "latest saved" is often the queued next song —
    // this targets the one the user actually hears.)
    downloadBtn = makeBtn("Download", "dnp-utility dnp-download", function () {
      var song = nowPlayingSaved() || latestSavedSong;
      if (!song) return;
      downloadSong(song);
    });
    downloadBtn.disabled = true;
    right.appendChild(downloadBtn);

    songsToggle = makeBtn("Songs", "dnp-utility dnp-songs-toggle", function () {
      var open = !songsPanel.classList.contains("is-open");
      songsPanel.classList.toggle("is-open", open);
      songsToggle.setAttribute("aria-expanded", open ? "true" : "false");
      if (open) refreshSongs();
    });
    songsToggle.setAttribute("aria-expanded", "false");
    songsToggle.title = "Session playlist — download any generated track";
    songsBadge = document.createElement("span");
    songsBadge.className = "dnp-songs-badge";
    songsBadge.textContent = "0";
    songsToggle.appendChild(songsBadge);
    right.appendChild(songsToggle);

    var openLiveBtn = makeBtn("Open Live", "dnp-utility", function () {
      window.open("/stage-live.html", "_blank", "noopener");
      status("Live screen opened in a new tab");
    });
    openLiveBtn.title = "Open the projector Live screen in a new tab";
    right.appendChild(openLiveBtn);

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
    startShowBtn = makeBtn("Start Show", "dnp-action dnp-action-primary", function () { Net.send({ type: "start" }); status("show started"); });
    endVoteBtn = makeBtn("End Vote", "dnp-action", function () { Net.send({ type: "endVote" }); status("ending active vote"); });
    regenerateBtn = makeBtn("Regenerate", "dnp-action", function () { Net.send({ type: "skip" }); status("regenerating next song"); });
    holdBtn = makeBtn("Hold Flow", "dnp-action", function () { Net.send({ type: "hold" }); status("show flow held"); });
    resumeBtn = makeBtn("Resume Flow", "dnp-action", function () { Net.send({ type: "resume" }); status("show flow resumed"); });
    actionGrid.appendChild(startShowBtn);
    actionGrid.appendChild(endVoteBtn);
    actionGrid.appendChild(regenerateBtn);
    actionGrid.appendChild(holdBtn);
    actionGrid.appendChild(resumeBtn);
    actionGrid.appendChild(makeBtn("Reset Show", "dnp-action dnp-action-danger", function () { Net.send({ type: "reset" }); status("show reset to lobby"); }));
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
    buildSongsPanel();
    updateFlow();
    updateActions();
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
      lastTug = m || null;
      var t = (m && typeof m.timeRemaining === "number") ? m.timeRemaining.toFixed(1) + "s" : "–";
      status("phase " + (m && m.phase) + " · round " + (m && m.round) + " · " + t +
        " · crowd " + (m && m.crowdSize));
      updateFlow();
    });

    Net.on("round_result", function (m) {
      if (m) status("round " + m.roundIndex + " winner · " + m.genre + " · " + m.name);
    });

    Net.on("generating", function (m) {
      var s = m && m.seed;
      status("generating " + (s ? (s.name + " — " + s.genre) : "…"));
    });

    Net.on("song_ready", function (m) {
      var s = m && m.song;
      status("track ready: " + (s ? (s.title + " (" + s.name + ")") : "song"));
    });

    Net.on("generation_failed", function (m) {
      status("generation failed · " + ((m && m.message) || "try regenerate"));
    });

    Net.on("song_saved", function (m) {
      if (m && m.song) status("saved locally · " + m.song.title);
      refreshSongs(); // pull the authoritative archive so the panel stays in order
    });

    Net.on("song_deleted", function () {
      refreshSongs(); // a track was pruned (possibly from another view) — re-sync
    });

    Net.on("now_playing", function (m) {
      status("now playing id " + (m && m.id));
    });

    Net.on("playback_state", function (m) {
      playbackState = {
        playing: !!(m && m.playing),
        canSkip: !!(m && m.canSkip),
        song: m && m.song ? m.song : null,
        nextSong: m && m.nextSong ? m.nextSong : null,
      };
      updatePlayer();
    });

    Net.on("show_state", function (m) {
      showState = {
        started: !!(m && m.started),
        held: !!(m && m.held),
        phase: (m && m.phase) || "idle",
        round: (m && m.round) || 0,
        genres: m && m.genres ? m.genres : null,
        genreSource: (m && m.genreSource) || "auto",
        seed: m && m.seed ? m.seed : null,
        error: (m && m.error) || "",
      };
      updateFlow();
      updateActions();
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
    updateFlow();
    updateActions();
    renderSongs(); // re-mark the now-playing track in the session panel
    updateDownloadBtn();
  }

  function updateFlow() {
    if (!flowLabel || !flowMeta) return;
    var flow = flowLabel.parentNode;
    flow.classList.remove("is-error", "is-generating", "is-ready");
    if (showState.error) {
      flow.classList.add("is-error");
      flowLabel.textContent = "Generation failed";
      flowMeta.textContent = "Open Show Actions and regenerate";
      flowLabel.title = showState.error;
      return;
    }
    if (showState.phase === "generating") {
      flow.classList.add("is-generating");
      flowLabel.textContent = showState.seed
        ? "Generating for " + showState.seed.name
        : "Generating next track";
      flowMeta.textContent = showState.seed
        ? showState.seed.genre + " · round " + showState.round
        : "Round " + showState.round;
      return;
    }
    if (playbackState.nextSong) {
      flow.classList.add("is-ready");
      flowLabel.textContent = "Next ready · " + playbackState.nextSong.title;
      flowMeta.textContent = playbackState.nextSong.genre + " · for " + playbackState.nextSong.name;
      return;
    }
    if (showState.phase === "collecting") {
      var seconds = lastTug && typeof lastTug.timeRemaining === "number"
        ? Math.ceil(lastTug.timeRemaining) + "s remaining"
        : "Voting live";
      flowLabel.textContent = "Round " + showState.round + " · voting";
      var pair = showState.genres
        ? showState.genres.A.name + " vs " + showState.genres.B.name
        : "";
      var source = showState.genreSource === "dj" ? "DJ override" : "Auto rotation";
      flowMeta.textContent = (pair ? pair + " · " : "") + source + " · " + seconds;
      return;
    }
    if (showState.started) {
      flowLabel.textContent = playbackState.song ? "Preparing the next round" : "Waiting for first track";
      flowMeta.textContent = showState.held ? "Show flow held" : "Generation pipeline active";
      return;
    }
    flowLabel.textContent = "Show is ready";
    flowMeta.textContent = "Choose genres and start the show";
  }

  function updateActions() {
    if (!startShowBtn) return;
    startShowBtn.disabled = showState.started;
    startShowBtn.title = showState.started ? "The show is already running" : "Begin round 1 voting";
    endVoteBtn.disabled = showState.phase !== "collecting";
    endVoteBtn.title = endVoteBtn.disabled ? "Available while a vote is active" : "Resolve this vote and generate the next track";
    regenerateBtn.disabled = !(showState.phase === "generating" || showState.error || playbackState.nextSong);
    regenerateBtn.title = regenerateBtn.disabled ? "No generating or queued track to replace" : "Discard and regenerate the next track";
    holdBtn.disabled = !showState.started || showState.held;
    resumeBtn.disabled = !showState.held;
    var genreButton = document.getElementById("genreRoundButton");
    if (genreButton) {
      genreButton.textContent = showState.started
        ? "Override next round"
        : "Start show with selected genres";
    }
  }

  function setLatestSaved(song) {
    if (!song) return;
    latestSavedSong = song;
    updateDownloadBtn();
  }

  // The archived record for the track currently looping on the Live screen, if it
  // has finished generating and been saved (saved on `complete`). Matched by id.
  function nowPlayingSaved() {
    var id = playbackState.song && playbackState.song.id;
    if (!id) return null;
    for (var i = 0; i < savedSongs.length; i += 1) {
      if (savedSongs[i].id === id) return savedSongs[i];
    }
    return null;
  }

  function downloadSong(song) {
    if (!song || !song.downloadUrl) return;
    var a = document.createElement("a");
    a.href = song.downloadUrl;
    a.download = song.fileName || "";
    document.body.appendChild(a);
    a.click();
    a.remove();
    status("downloading " + song.title);
  }

  function updateDownloadBtn() {
    if (!downloadBtn) return;
    var target = nowPlayingSaved() || latestSavedSong;
    downloadBtn.disabled = !target;
    if (!target) {
      downloadBtn.title = "No track saved yet";
      return;
    }
    var nowPlaying = target === nowPlayingSaved();
    downloadBtn.title = (nowPlaying ? "Download the looping track · " : "Download latest · ") +
      target.title + " · " + target.genre + " · " + target.bpm + " BPM";
  }

  function buildSongsPanel() {
    songsPanel = document.createElement("div");
    songsPanel.className = "dnp-songs";

    var head = document.createElement("div");
    head.className = "dnp-songs-head";
    var headCopy = document.createElement("div");
    var title = document.createElement("div");
    title.className = "dnp-songs-title";
    title.textContent = "Session Songs";
    var sub = document.createElement("div");
    sub.className = "dnp-songs-sub";
    sub.textContent = "Every track generated this session";
    headCopy.appendChild(title);
    headCopy.appendChild(sub);
    var closeBtn = makeBtn("✕", "dnp-songs-close", function () {
      songsPanel.classList.remove("is-open");
      if (songsToggle) songsToggle.setAttribute("aria-expanded", "false");
    });
    closeBtn.setAttribute("aria-label", "Close session songs");
    head.appendChild(headCopy);
    head.appendChild(closeBtn);
    songsPanel.appendChild(head);

    songsList = document.createElement("div");
    songsList.className = "dnp-songs-list";
    songsPanel.appendChild(songsList);
    document.body.appendChild(songsPanel);
    renderSongs();
  }

  function renderSongs() {
    if (!songsList) return;
    var nowId = playbackState.song && playbackState.song.id;
    songsList.textContent = "";
    if (songsBadge) songsBadge.textContent = String(savedSongs.length);
    if (!savedSongs.length) {
      var empty = document.createElement("div");
      empty.className = "dnp-songs-empty";
      empty.textContent = "No songs yet — they appear here as the crowd generates them.";
      songsList.appendChild(empty);
      return;
    }
    savedSongs.forEach(function (song, idx) {
      var row = document.createElement("div");
      row.className = "dnp-song" + (song.id === nowId ? " is-now" : "");

      var num = document.createElement("div");
      num.className = "dnp-song-num";
      num.textContent = song.id === nowId ? "▶" : String(savedSongs.length - idx);
      row.appendChild(num);

      var copy = document.createElement("div");
      copy.className = "dnp-song-copy";
      var t = document.createElement("div");
      t.className = "dnp-song-title";
      t.textContent = song.title; // server-derived; safe text
      var meta = document.createElement("div");
      meta.className = "dnp-song-meta";
      meta.textContent = (song.id === nowId ? "Now playing · " : "") +
        song.genre + " · " + song.bpm + " BPM · for " + song.name; // audience name → textContent
      copy.appendChild(t);
      copy.appendChild(meta);
      row.appendChild(copy);

      var dl = makeBtn("Download", "dnp-song-dl", function () { downloadSong(song); });
      dl.title = "Download " + song.title;
      row.appendChild(dl);

      var del = makeBtn("✕", "dnp-song-del", function () {});
      del.title = "Remove " + song.title + " from the session archive";
      del.setAttribute("aria-label", "Delete " + song.title);
      wireDelete(del, song);
      row.appendChild(del);

      songsList.appendChild(row);
    });
  }

  // Two-step inline confirm so a track is never deleted on a single stray click.
  var deleteConfirmTimer = null;
  function wireDelete(btn, song) {
    var armed = false;
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      if (!armed) {
        armed = true;
        btn.classList.add("is-confirm");
        btn.textContent = "Delete?";
        if (deleteConfirmTimer) clearTimeout(deleteConfirmTimer);
        deleteConfirmTimer = setTimeout(function () {
          armed = false;
          btn.classList.remove("is-confirm");
          btn.textContent = "✕";
        }, 3000);
        return;
      }
      armed = false;
      if (deleteConfirmTimer) clearTimeout(deleteConfirmTimer);
      deleteSong(song);
    });
  }

  function deleteSong(song) {
    if (!song || !song.id) return;
    fetch("/api/songs/" + encodeURIComponent(song.id), { method: "DELETE" })
      .then(function (res) { return res.ok ? res.json() : Promise.reject(new Error("HTTP " + res.status)); })
      .then(function () { status("deleted " + song.title); refreshSongs(); })
      .catch(function (err) { status("delete failed · " + err.message); });
  }

  function refreshSongs() {
    fetch("/api/songs")
      .then(function (res) { return res.ok ? res.json() : Promise.reject(new Error("HTTP " + res.status)); })
      .then(function (data) {
        savedSongs = (data && Array.isArray(data.songs)) ? data.songs : [];
        if (savedSongs.length) setLatestSaved(savedSongs[0]);
        renderSongs();
        updateDownloadBtn();
      })
      .catch(function (err) { console.warn("[dash-net] could not load saved songs:", err.message); });
  }

  function init() {
    buildStrip();
    wireStatus();
    refreshSongs();
    status("ready" + (Net.ready() ? " · connected" : ""));
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
