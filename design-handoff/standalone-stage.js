/* ============================================================
   standalone-stage.js — drives a SINGLE locked projector state
   (intro or ended) with no battle canvas and no dev stepper.
   Reuses stage.css. The body class (intro/ended) is set in the
   HTML; this just scales to fit, paints the faux QR, and fills
   the ended stats + credits from window.SetList.
   ============================================================ */
(function () {
  'use strict';
  const root = document.getElementById('stageRoot');
  const W = 1920, H = 1080;
  function fit() { root.style.transform = `scale(${Math.min(window.innerWidth / W, window.innerHeight / H)})`; }
  fit(); window.addEventListener('resize', fit);

  const SL = window.SetList || { tracks: [] };
  const el = (id) => document.getElementById(id);

  // deterministic faux-QR placeholder (matches stage.js)
  function drawQR(canvas, seed) {
    if (!canvas) return;
    const c = canvas.getContext('2d');
    const N = 29, S = canvas.width / N;
    let s = seed >>> 0;
    const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    c.fillStyle = '#fff'; c.fillRect(0, 0, canvas.width, canvas.height);
    c.fillStyle = '#0A0A0F';
    for (let y = 2; y < N - 2; y++) for (let x = 2; x < N - 2; x++) { if (rnd() > 0.52) c.fillRect(x * S, y * S, S, S); }
    const finder = (fx, fy) => {
      c.fillStyle = '#fff'; c.fillRect((fx - 1) * S, (fy - 1) * S, 9 * S, 9 * S);
      c.fillStyle = '#0A0A0F'; c.fillRect(fx * S, fy * S, 7 * S, 7 * S);
      c.fillStyle = '#fff'; c.fillRect((fx + 1) * S, (fy + 1) * S, 5 * S, 5 * S);
      c.fillStyle = '#0A0A0F'; c.fillRect((fx + 2) * S, (fy + 2) * S, 3 * S, 3 * S);
    };
    finder(1, 1); finder(N - 8, 1); finder(1, N - 8);
  }
  drawQR(el('qrIntro'), 0x51a7);
  drawQR(el('qrEnded'), 0x9e2c);

  // ended stats + credits
  const tracks = SL.tracks || [];
  if (el('endTracks')) el('endTracks').textContent = tracks.length;
  if (el('endCrowd')) el('endCrowd').textContent = 249;
  const ct = el('creditsTrack');
  if (ct && tracks.length) {
    const one = tracks.map((t, i) =>
      `<span class="cr"><b>${String(i + 1).padStart(2, '0')} ${t.title}</b> · ${t.genre} · <i>by ${t.by}</i></span>`).join('');
    ct.innerHTML = one + one;
  }
})();
