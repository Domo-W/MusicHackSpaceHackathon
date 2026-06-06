/* ============================================================
   net.js — shared WebSocket bus for all surfaces (phone / stage / dashboard).
   The single connection the networked seams (net-tug, net-crowd, intent/name,
   dj-console) ride on. Auto-reconnects; queues sends until open.
   Exposes window.Net. Load this BEFORE the net-* seam scripts.
   Protocol: see docs/client-api.md. Messages are JSON {type, ...}.
   ============================================================ */
(function () {
  "use strict";

  const listeners = new Map(); // type -> Set<fn>
  const anyListeners = new Set();
  const stickyTypes = new Set(["show_state", "playback_state", "tug", "names"]);
  const lastMessages = new Map();
  let ws = null;
  let queue = [];
  let reconnectMs = 500;

  function url() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    return `${proto}://${location.host}`;
  }

  function connect() {
    ws = new WebSocket(url());
    ws.onopen = () => {
      reconnectMs = 500;
      const q = queue;
      queue = [];
      q.forEach((m) => ws.send(m));
      emit("__open", {});
    };
    ws.onclose = () => {
      emit("__close", {});
      setTimeout(connect, reconnectMs);
      reconnectMs = Math.min(5000, reconnectMs * 1.6);
    };
    ws.onerror = () => { try { ws.close(); } catch (e) {} };
    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch (err) { return; }
      if (stickyTypes.has(msg.type)) lastMessages.set(msg.type, msg);
      emit(msg.type, msg);
      anyListeners.forEach((fn) => { try { fn(msg); } catch (err) {} });
    };
  }

  function emit(type, msg) {
    const set = listeners.get(type);
    if (set) set.forEach((fn) => { try { fn(msg); } catch (e) {} });
  }

  const Net = {
    connect() { if (!ws) connect(); return Net; },
    // subscribe to a server message type (or "__open"/"__close"). returns unsub.
    on(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
      if (lastMessages.has(type)) {
        const msg = lastMessages.get(type);
        queueMicrotask(() => {
          if (listeners.get(type) && listeners.get(type).has(fn)) {
            try { fn(msg); } catch (e) {}
          }
        });
      }
      return () => listeners.get(type) && listeners.get(type).delete(fn);
    },
    onAny(fn) { anyListeners.add(fn); return () => anyListeners.delete(fn); },
    send(msg) {
      const s = JSON.stringify(msg);
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(s);
      else queue.push(s);
    },
    ready() { return !!ws && ws.readyState === WebSocket.OPEN; },
  };

  window.Net = Net;
  Net.connect();
})();
