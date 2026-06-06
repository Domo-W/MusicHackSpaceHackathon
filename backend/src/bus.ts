import type { ServerMsg } from "./types.js";

// Tiny broadcast indirection so showMachine doesn't import the WS server
// (avoids a circular dependency). server.ts wires the real sender at startup.
type Sender = (msg: ServerMsg) => void;
let sender: Sender = () => {};

export function setSender(s: Sender): void {
  sender = s;
}

export function broadcast(msg: ServerMsg): void {
  sender(msg);
}
