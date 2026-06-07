/* ============================================================
   phone-net.js — phone glue. Loaded LAST (after app.jsx), so every
   partner global (window.IntentSink, window.CrowdSim) already exists.
   Wires the two seams that net-tug.js / net-crowd.js don't own:

     NAME (join)   -> Net.send({type:"join", name})
                      stores participantId from Net.on("joined")
                      into window.__participantId.
     INTENT (answer) -> wraps window.IntentSink.submit so it ALSO sends
                        Net.send({type:"answer", participantId, text}),
                        preserving the original behaviour.

   We never edit partner files; everything here is a window-global
   override / monkey-patch. Audience text is only ever passed as JSON
   over the wire (never written to the DOM here), so no innerHTML risk.
   ============================================================ */
(function () {
  'use strict';

  // ---- participant identity ----
  window.__participantId = window.__participantId || null;
  let joinSent = false;
  let pendingAnswer = null; // answer typed before join completes (see ordering note)

  if (window.Net && window.Net.on) {
    window.Net.on('joined', function (msg) {
      if (msg && msg.participantId != null) {
        window.__participantId = msg.participantId;
        // Flush any answer that was typed before the join completed, now bound.
        if (pendingAnswer != null) {
          window.Net.send({ type: 'answer', participantId: window.__participantId, text: pendingAnswer });
          pendingAnswer = null;
        }
      }
    });
  }

  // ---- NAME -> join. Idempotent: only the FIRST real name joins, so we
  //      keep ONE stable participantId (answer/pull must reference it). ----
  function submitName(name) {
    const n = String(name || '').trim().slice(0, 40);
    if (!n || joinSent) return;
    joinSent = true;
    if (window.Net) window.Net.send({ type: 'join', name: n });
  }
  window.submitName = submitName;

  // ---- Best-effort auto-hook for the NAME screen (screen-texture.jsx).
  //      That screen's only outbound is CrowdSim.addWord(text); it fires
  //      for BOTH the form submit (a typed name) and emoji taps. We join
  //      on the first non-emoji word only. This is lossy by design — see
  //      the note below; the clean fix is a one-liner the lead can add. ----
  const EMOJI_RE = /^[\p{Extended_Pictographic}☀-➿️‍\s]+$/u;
  function looksLikeEmoji(t) {
    try { return EMOJI_RE.test(t); } catch (e) { return /^[^A-Za-z0-9]+$/.test(t); }
  }
  if (window.CrowdSim && typeof window.CrowdSim.addWord === 'function') {
    const origAddWord = window.CrowdSim.addWord.bind(window.CrowdSim);
    window.CrowdSim.addWord = function (text) {
      const r = origAddWord(text);
      try {
        const t = String(text || '').trim();
        if (t && !looksLikeEmoji(t)) {
          if (!joinSent) {
            // first real name → join; the shell auto-advances on the 'joined' event.
            submitName(t);
          } else if (window.__advanceFromName) {
            // returning participant (already joined): submitting a name on the
            // re-entry screen advances them too, so they don't have to tap Continue.
            window.__advanceFromName();
          }
        }
      } catch (e) {}
      return r;
    };
  }

  // ---- INTENT -> answer. Wrap IntentSink.submit, keep original behaviour. ----
  function wrapIntent() {
    const sink = window.IntentSink;
    if (!sink || typeof sink.submit !== 'function' || sink.__netWrapped) return false;
    const orig = sink.submit.bind(sink);
    sink.submit = function (str) {
      const out = orig(str);                 // preserve dissolve/history/listeners
      try {
        const text = String(str || '').trim();
        if (text) {
          // NAME (join) comes AFTER INTENT in the tab order, so the
          // participantId may not exist yet. If it's here, bind now; otherwise
          // BUFFER the answer and the 'joined' handler flushes it bound to the
          // real id (resolves the ordering without editing partner files).
          if (window.__participantId != null) {
            window.Net.send({ type: 'answer', participantId: window.__participantId, text: text });
          } else {
            pendingAnswer = text;
          }
        }
      } catch (e) {}
      return out;
    };
    sink.__netWrapped = true;
    return true;
  }

  // IntentSink is defined when screen-intent.jsx runs (Babel-transpiled async),
  // so it may not exist yet at this script's first tick. Retry briefly.
  if (!wrapIntent()) {
    let tries = 0;
    const id = setInterval(function () {
      if (wrapIntent() || ++tries > 100) clearInterval(id);
    }, 50);
  }

  // ---- VIBE pick -> report the selected option index to the backend. ScreenVibe
  //      renders the DJ's options as ordered `.vibe-card` buttons; the clicked
  //      index IS the option index. Delegated so we never edit the partner screen.
  document.addEventListener('click', function (e) {
    const card = e.target && e.target.closest ? e.target.closest('.vibe-card') : null;
    if (!card) return;
    const cards = Array.prototype.slice.call(document.querySelectorAll('.vibe-card'));
    const index = cards.indexOf(card);
    if (index >= 0 && window.Net) window.Net.send({ type: 'vibe', index: index });
  });

  /* ============================================================
     SEAM NOTE FOR THE LEAD (flagged, not silently patched):

     1) NAME join hook is best-effort. The clean one-line fix lives in
        screen-texture.jsx's form `submit` (around line 37 — NOT tapEmoji):
            window.submitName && window.submitName(val);
        That guarantees the join uses the typed name and never an emoji.

     2) TAB ORDER (RESOLVED by buffering, no partner edit): MODES order is
        VIBE -> INTENT -> NAME -> TUG, so the INTENT `answer` is typed BEFORE
        the NAME `join`. We buffer the answer (pendingAnswer) and the 'joined'
        handler flushes it bound to the real participantId. Works regardless of
        screen order. (If a user answers but never enters a name, the answer is
        simply never sent — the backend falls back to a sample seed.)
     ============================================================ */
})();
