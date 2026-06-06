import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import express from "express";
import QRCode from "qrcode";
import { WebSocketServer, WebSocket } from "ws";
import { CONFIG } from "./config.js";
import { setSender } from "./bus.js";
import {
  startShow,
  onPlaying,
  applyConfig,
  skip,
  hold,
  resume,
  reset,
  handlePull,
  handleAnswer,
} from "./showMachine.js";
import { join, remove } from "./participants.js";
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
const JOIN_URL = `http://${lanIp()}:${CONFIG.port}/phone-live.html`;

const app = express();
app.get("/health", (_req, res) => res.json({ ok: true }));
// Join info + a QR for it, so the stage can show "scan to join" on the same LAN.
app.get("/api/info", (_req, res) => res.json({ joinUrl: JOIN_URL, lanIp: lanIp(), port: CONFIG.port }));
app.get("/qr", async (_req, res) => {
  try {
    const svg = await QRCode.toString(JOIN_URL, { type: "svg", margin: 1, color: { dark: "#0A0A0F", light: "#FFFFFF" } });
    res.type("image/svg+xml").send(svg);
  } catch {
    res.status(500).send("qr error");
  }
});
app.use(express.static(frontendDir));

const server = createServer(app);
const wss = new WebSocketServer({ server });

// Broadcast helper wired into the bus so showMachine can reach all clients.
setSender((msg: ServerMsg) => {
  const data = JSON.stringify(msg);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(data);
  }
});

// Track which participantId each socket owns, for crowdSize + disconnect cleanup.
const wsParticipant = new WeakMap<WebSocket, string>();

wss.on("connection", (ws) => {
  console.log("[ws] client connected");

  ws.on("message", (raw) => {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    switch (msg.type) {
      case "join": {
        const id = join(msg.name);
        wsParticipant.set(ws, id);
        const reply: ServerMsg = { type: "joined", participantId: id };
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(reply));
        break;
      }
      case "answer":
        handleAnswer(msg.participantId, msg.text);
        break;
      case "pull":
        handlePull(msg.participantId, msg.side, msg.impulse);
        break;
      case "playing":
        onPlaying(msg.id);
        break;
      case "start":
        startShow();
        break;
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
    console.log("[ws] client disconnected");
  });
});

server.listen(CONFIG.port, () => {
  console.log(`[server] stage:     http://localhost:${CONFIG.port}/stage-live.html`);
  console.log(`[server] dashboard: http://localhost:${CONFIG.port}/dash-live.html`);
  console.log(`[server] JOIN (phones on same WiFi): ${JOIN_URL}`);
  console.log(`[server] collectSeconds=${CONFIG.collectSeconds} fadeSeconds=${CONFIG.fadeSeconds} model=${CONFIG.agentModel}`);
});
