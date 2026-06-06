/* ============================================================
   dash-net.js — DJ DASHBOARD ↔ backend glue (Agent D).
   Loaded LAST, after net.js + dash.jsx. Does NOT edit partner files.

   How it sources dashboard config:
     The partner's dash.jsx already broadcasts every "Push to crowd"
     action on a BroadcastChannel('dj-console') as {channel, payload, ts}
     (see pushToCrowd() in dash.jsx / frontend/README.md). We SUBSCRIBE to
     that channel — no monkey-patching, no file edits — and translate the
     relevant broadcasts into Net.send({type:"config", ...}).

   Channels seen on 'dj-console':
     - "tug-genres" : { sideA, sideB }  (genre ids) -> genreA/genreB GenreInfo
     - "vibe-cards" : ["..","..","..",".."]          -> question (best-effort)

   It also injects a small control strip (Start / Skip / Hold / Resume +
   a collectSeconds input) and a live status area, since the partner
   dashboard has no transport controls of its own.

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

  function status(text) {
    if (statusEl) statusEl.textContent = "● " + text;
  }

  function makeBtn(label, accent, onClick) {
    var b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.style.cssText =
      "font:600 12px 'Space Grotesk',system-ui,sans-serif;letter-spacing:.06em;" +
      "text-transform:uppercase;color:#0A0A0F;background:" + accent + ";" +
      "border:none;border-radius:8px;padding:9px 14px;cursor:pointer;";
    b.addEventListener("click", onClick);
    return b;
  }

  function buildStrip() {
    var bar = document.createElement("div");
    bar.id = "dashNetBar";
    bar.style.cssText =
      "position:fixed;left:0;right:0;bottom:0;z-index:9999;" +
      "display:flex;align-items:center;gap:10px;flex-wrap:wrap;" +
      "padding:10px 16px;background:rgba(16,16,24,0.96);" +
      "border-top:1px solid rgba(255,255,255,0.18);" +
      "font-family:'JetBrains Mono',ui-monospace,monospace;color:#F4F4F8;";

    var tag = document.createElement("span");
    tag.textContent = "SHOW CONTROL";
    tag.style.cssText = "font:700 11px 'JetBrains Mono',monospace;letter-spacing:.12em;color:#8C8C9C;";
    bar.appendChild(tag);

    bar.appendChild(makeBtn("Start", "#00E5FF", function () { Net.send({ type: "start" }); status("start sent"); }));
    bar.appendChild(makeBtn("Skip", "#FF7A1A", function () { Net.send({ type: "skip" }); status("skip sent"); }));
    bar.appendChild(makeBtn("Hold", "#B65CFF", function () { Net.send({ type: "hold" }); status("hold sent"); }));
    bar.appendChild(makeBtn("Resume", "#FF1A8C", function () { Net.send({ type: "resume" }); status("resume sent"); }));
    bar.appendChild(makeBtn("Reset", "#8a8a99", function () { Net.send({ type: "reset" }); status("reset → blank lobby"); }));

    // collectSeconds input (fills the config gap — dashboard has no such field)
    var secWrap = document.createElement("label");
    secWrap.style.cssText = "display:flex;align-items:center;gap:6px;font:500 11px 'JetBrains Mono',monospace;color:#8C8C9C;";
    var secLabel = document.createElement("span");
    secLabel.textContent = "COLLECT s";
    var secInput = document.createElement("input");
    secInput.type = "number";
    secInput.min = "1";
    secInput.placeholder = "—";
    secInput.style.cssText =
      "width:56px;background:#15151F;border:1px solid rgba(255,255,255,0.18);" +
      "border-radius:6px;color:#F4F4F8;padding:5px 7px;font:500 12px 'JetBrains Mono',monospace;";
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
    bar.appendChild(secWrap);

    statusEl = document.createElement("span");
    statusEl.id = "dashNetStatus";
    statusEl.style.cssText = "margin-left:auto;font:500 12px 'JetBrains Mono',monospace;color:#00E5FF;max-width:46%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
    statusEl.textContent = "● waiting…";
    bar.appendChild(statusEl);

    document.body.appendChild(bar);

    // Our fixed control bar would otherwise cover the partner's bottom "PUSH TO
    // CROWD" buttons (the dashboard is a fixed design scaled to fill the screen).
    // Scale the whole dashboard viewport down just enough to leave room for the
    // bar below it — everything stays visible, no scrolling.
    function fitForBar() {
      var vp = document.getElementById("viewport");
      if (!vp) return;
      var barH = bar.getBoundingClientRect().height || 60;
      var vh = window.innerHeight || 800;
      var scale = Math.max(0.55, (vh - barH - 10) / vh);
      vp.style.transformOrigin = "top center";
      vp.style.transform = "scale(" + scale + ")";
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

    Net.on("now_playing", function (m) {
      status("now playing id " + (m && m.id));
    });
  }

  // Auto-sync the DJ's selected genres to the backend so the phone vote ALWAYS
  // reflects the dashboard — no need to remember to hit "push". Polls the
  // partner's window.DJConsoleState (updated live as they pick A/B genres).
  function autoSyncGenres() {
    var last = "";
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
    status("ready" + (Net.ready() ? " · connected" : ""));
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
