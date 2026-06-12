import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import express from "express";
import QRCode from "qrcode";
import { WebSocketServer, WebSocket } from "ws";
import { CONFIG } from "./config.js";
import { setSender, broadcast } from "./bus.js";
import {
  startShow,
  onPlaying,
  applyConfig,
  skip,
  hold,
  resume,
  reset,
  endShow,
  endVote,
  handlePull,
  handleAnswer,
  currentShowState,
  currentRecap,
  currentSetSongs,
} from "./showMachine.js";
import { join, remove, names } from "./participants.js";
import * as vibes from "./vibes.js";
import * as room from "./room.js";
import * as sim from "./sim.js";
import { songStore } from "./songStore.js";
import type { ClientMsg, ServerMsg } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(__dirname, "../../frontend");

// First non-internal IPv4 address — the LAN IP phones on the same WiFi use.
function lanIp(): string {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const a of ifaces[name] ?? []) {
      if (a.family === "IPv4" && !a.internal) return a.address;
    }
  }
  return "localhost";
}
const LOCAL_JOIN_URL = `http://${lanIp()}:${CONFIG.port}/phone-live.html`;

// The public URL phones scan to join. On a host (Render) it comes from the request
// (or PUBLIC_URL); locally it falls back to the LAN IP for same-WiFi phones.
function publicJoinUrl(req: express.Request): string {
  const env = process.env.PUBLIC_URL?.trim();
  if (env) return `${env.replace(/\/+$/, "")}/phone-live.html`;
  const host = (req.get("x-forwarded-host") || req.get("host") || "").split(",")[0]!.trim();
  if (host) {
    const proto = (req.get("x-forwarded-proto") || req.protocol || "http").split(",")[0]!.trim();
    return `${proto}://${host}/phone-live.html`;
  }
  return LOCAL_JOIN_URL;
}

const app = express();
app.set("trust proxy", true); // Render & most PaaS sit behind a proxy → trust x-forwarded-*
app.get("/health", (_req, res) => res.json({ ok: true }));
// Join info + a QR for it so phones can scan to join.
app.get("/api/info", (req, res) => res.json({ joinUrl: publicJoinUrl(req), lanIp: lanIp(), port: CONFIG.port }));
app.get("/api/songs", async (_req, res) => {
  try {
    res.json({ songs: await songStore.list() });
  } catch (err) {
    console.error("[songs] list failed:", (err as Error).message);
    res.status(500).json({ error: "Could not list locally saved songs." });
  }
});
// Only the CURRENT set's songs (the dashboard Session Setlist) — cleared on
// reset/start, so a new set starts with an empty list.
app.get("/api/session-songs", (_req, res) => res.json({ songs: currentSetSongs() }));
app.get("/api/songs/:id/download", async (req, res) => {
  try {
    const saved = await songStore.fileFor(req.params.id);
    if (!saved) {
      res.status(404).json({ error: "Song not found." });
      return;
    }
    if (saved.url) {
      res.redirect(saved.url); // Supabase Storage public URL
    } else if (saved.filePath) {
      res.download(saved.filePath, saved.song.fileName); // local file
    } else {
      res.status(404).json({ error: "Song file not found." });
    }
  } catch (err) {
    console.error("[songs] download failed:", (err as Error).message);
    res.status(500).json({ error: "Could not download the saved song." });
  }
});
app.delete("/api/songs/:id", async (req, res) => {
  try {
    const removed = await songStore.delete(req.params.id);
    if (!removed) {
      res.status(404).json({ error: "Song not found." });
      return;
    }
    broadcast({ type: "song_deleted", id: req.params.id });
    res.json({ ok: true, id: req.params.id });
  } catch (err) {
    console.error("[songs] delete failed:", (err as Error).message);
    res.status(500).json({ error: "Could not delete the saved song." });
  }
});
app.get("/qr", async (req, res) => {
  try {
    let url = publicJoinUrl(req);
    const c = room.snapshot().code;
    if (c) url += (url.includes("?") ? "&" : "?") + "code=" + encodeURIComponent(c);
    const svg = await QRCode.toString(url, { type: "svg", margin: 1, color: { dark: "#0A0A0F", light: "#FFFFFF" } });
    res.type("image/svg+xml").send(svg);
  } catch {
    res.status(500).send("qr error");
  }
});
app.use(express.static(frontendDir));

const server = createServer(app);
const wss = new WebSocketServer({ server });
let playbackState: Extract<ServerMsg, { type: "playback_state" }> = {
  type: "playback_state",
  playing: false,
  canSkip: false,
};

// Broadcast helper wired into the bus so showMachine can reach all clients.
setSender((msg: ServerMsg) => {
  const data = JSON.stringify(msg);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(data);
  }
});

// Track which participantId each socket owns, for crowdSize + disconnect cleanup.
const wsParticipant = new WeakMap<WebSocket, string>();
let wsSeq = 0; // stable per-socket id for the vibe tally (distinct phones per option)
// connKey (stringified per-socket id) → ws, so a host promotion can target the
// newly-crowned phone with host_granted. WeakMap can't iterate, so use a Map and
// clean it up on close.
const wsByKey = new Map<string, WebSocket>();
const MIN_PLAYERS = 2; // a show needs at least this many in the room to start

// Tally helpers shared by the vibe message + disconnect paths.
const vibeTallyMsg = (): ServerMsg => {
  const t = vibes.tally();
  return { type: "vibe_tally", counts: t.counts, total: t.total };
};

wss.on("connection", (ws) => {
  const socketId = ++wsSeq;
  const connKey = String(socketId);
  wsByKey.set(connKey, ws);
  console.log("[ws] client connected");
  // Seed the new client (e.g. a freshly-loaded stage) with the current names.
  ws.send(JSON.stringify({ type: "names", names: names() } as ServerMsg));
  ws.send(JSON.stringify(playbackState));
  ws.send(JSON.stringify({ type: "show_state", ...currentShowState() } as ServerMsg));
  ws.send(JSON.stringify({ type: "room_state", ...room.snapshot() } as ServerMsg));
  // Seed the current vibe poll (options + live tally) so a fresh phone renders it.
  ws.send(JSON.stringify({ type: "vibe_options", cards: vibes.getCards() } as ServerMsg));
  ws.send(JSON.stringify(vibeTallyMsg()));
  // If the set has already ended, seed this fresh connection with the recap so a
  // phone scanning the end-of-set QR lands on the playlist, not the lobby.
  const recap = currentRecap();
  if (recap) ws.send(JSON.stringify({ type: "show_ended", songs: recap } as ServerMsg));

  ws.on("message", (raw) => {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    switch (msg.type) {
      case "join": {
        const res = room.tryJoin(connKey, msg.name, msg.code, msg.hostToken);
        if (!res.ok) {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "join_rejected", reason: res.reason } as ServerMsg));
          }
          break;
        }
        const id = join(msg.name);
        wsParticipant.set(ws, id);
        const reply: ServerMsg = {
          type: "joined",
          participantId: id,
          isHost: res.isHost,
          hostToken: res.hostToken,
          code: room.snapshot().code,
        };
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(reply));
        const nm = (msg.name || "").trim();
        if (nm) broadcast({ type: "name", name: nm });
        break;
      }
      case "answer":
        handleAnswer(msg.participantId, msg.text);
        break;
      case "pull":
        handlePull(msg.participantId, msg.side, msg.impulse);
        break;
      case "vibe":
        vibes.recordPick(socketId, msg.index);
        broadcast(vibeTallyMsg());
        break;
      case "vibeCards":
        vibes.setCards(msg.cards);
        broadcast({ type: "vibe_options", cards: vibes.getCards() });
        broadcast(vibeTallyMsg());
        break;
      case "playing":
        onPlaying(msg.id);
        break;
      case "start":
        startShow(msg.opener);
        break;
      case "create_room": {
        const r = room.createRoom();
        if (!r.ok && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "join_rejected", reason: "busy" } as ServerMsg));
        }
        break;
      }
      case "host_start": {
        const s = room.snapshot();
        // A show needs at least MIN_PLAYERS in the room (host + ≥1 other). The
        // phone hides START below this, but enforce it server-side too.
        if (room.authorizeHost(connKey, msg.hostToken) && s.lobbyState === "open" && s.crowd >= MIN_PLAYERS) {
          room.markLive();
          startShow();
        }
        break;
      }
      case "host_end": {
        if (room.authorizeHost(connKey, msg.hostToken)) {
          room.markEnded();
          void endShow();
        }
        break;
      }
      case "add_sim_players": {
        // Dev/test: the host fills the room with fake players so a solo tester can
        // hit the 2-player minimum and run a believable show alone.
        if (room.isHost(connKey)) {
          const n = Math.min(Math.max(1, msg.count ?? 4), 12);
          sim.add(n);
        }
        break;
      }
      case "config":
        applyConfig(msg);
        break;
      case "skip":
        skip();
        break;
      case "hold":
        hold();
        break;
      case "resume":
        resume();
        break;
      case "reset":
        reset();
        break;
      case "end":
        void endShow();
        break;
      case "endVote":
        endVote();
        break;
      case "forceNext":
        broadcast({ type: "force_next" });
        break;
      case "playbackControl":
        broadcast({ type: "playback_control", action: msg.action });
        break;
      case "playbackState":
        playbackState = {
          type: "playback_state",
          playing: msg.playing,
          canSkip: msg.canSkip,
          song: msg.song,
          nextSong: msg.nextSong,
          position: msg.position,
          duration: msg.duration,
        };
        broadcast(playbackState);
        break;
      default:
        break;
    }
  });

  ws.on("close", () => {
    const id = wsParticipant.get(ws);
    if (id) {
      remove(id);
      wsParticipant.delete(ws);
    }
    const promo = room.leave(connKey);
    if (promo.hostChanged && promo.newHostKey) {
      const newHostWs = wsByKey.get(promo.newHostKey);
      if (newHostWs && newHostWs.readyState === WebSocket.OPEN && promo.newHostToken) {
        newHostWs.send(JSON.stringify({ type: "host_granted", hostToken: promo.newHostToken } as ServerMsg));
      }
    }
    wsByKey.delete(connKey);
    vibes.removeSocket(socketId);
    broadcast(vibeTallyMsg());
    console.log("[ws] client disconnected");
  });
});

server.listen(CONFIG.port, () => {
  console.log(`[server] stage:     http://localhost:${CONFIG.port}/stage-live.html`);
  console.log(`[server] dashboard: http://localhost:${CONFIG.port}/dash-live.html`);
  console.log(`[server] JOIN (phones on same WiFi): ${LOCAL_JOIN_URL}`);
  console.log(`[server] (on a host, the join URL/QR use the request host or PUBLIC_URL)`);
  console.log(`[server] collectSeconds=${CONFIG.collectSeconds} fadeSeconds=${CONFIG.fadeSeconds} model=${CONFIG.agentModel}`);
});
