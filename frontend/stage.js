/* ============================================================
   stage.js — projector battlefront. Runs Tug as the AUTHORITY,
   renders the liquid split + readouts, broadcasts to phones.
   ============================================================ */
(function () {
  'use strict';
  const T = window.Tug;
  const G = T.GENRES;
  T.start('leader');                 // the stage owns the simulation

  const root = document.getElementById('stageRoot');
  const cv = document.getElementById('bf');
  const ctx = cv.getContext('2d');
  const W = 1920, H = 1080;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // fit-to-viewport
  function fit() {
    const s = Math.min(window.innerWidth / W, window.innerHeight / H);
    root.style.transform = `scale(${s})`;
  }
  fit(); window.addEventListener('resize', fit);

  // DOM refs
  const el = (id) => document.getElementById(id);
  const tecPct = el('tecPct'), dscPct = el('dscPct'), tecName = el('tecName'), dscName = el('dscName');
  const roundTxt = el('roundTxt'), scoreEl = el('score'), hypeFill = el('hypeFill');
  const suddenEl = el('sudden'), winFlash = el('winFlash'), wfName = el('wfName'), wfSub = el('wfSub');
  tecName.textContent = G.A.name; dscName.textContent = G.B.name;

  // win flash
  T.on('win', ({ side, isMatch }) => {
    const c = G[side].color;
    winFlash.style.background = `radial-gradient(circle at 50% 45%, #fff 0%, ${c} 52%, #050507 100%)`;
    wfName.textContent = G[side].name;
    wfName.style.color = '#050507';
    wfSub.textContent = isMatch ? 'WINS THE MATCH' : 'WINS THE ROUND';
    winFlash.dataset.on = '1';
    // retrigger animation
    winFlash.style.animation = 'none'; void winFlash.offsetWidth; winFlash.style.animation = '';
    setTimeout(() => { winFlash.dataset.on = '0'; }, 2900);
  });

  // particles along the seam
  const sp = [];
  let hypeSmooth = 0.08;
  let lastDom = 0;

  function loop(now) {
    requestAnimationFrame(loop);
    const s = T.getState();
    const p = s.p;
    const net = s.forceB - s.forceA;             // + => disco pushing
    const slosh = Math.min(1, Math.abs(net) / 2.5);
    const dividerX = (1 - p) * W;
    const amp = 10 + slosh * 72;
    const seamAt = (y) => dividerX + Math.sin(y * 0.011 + now * 0.0026) * amp + Math.sin(y * 0.027 - now * 0.004) * amp * 0.5;

    ctx.clearRect(0, 0, W, H);

    // left (techno) region
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(seamAt(0), 0);
    for (let y = 0; y <= H; y += 10) ctx.lineTo(seamAt(y), y);
    ctx.lineTo(0, H); ctx.closePath();
    let lg = ctx.createLinearGradient(0, 0, Math.max(dividerX, 1), 0);
    lg.addColorStop(0, '#02141A'); lg.addColorStop(0.72, 'rgba(0,150,180,0.30)'); lg.addColorStop(1, 'rgba(0,229,255,0.72)');
    ctx.fillStyle = lg; ctx.fill();

    // right (disco) region
    ctx.beginPath(); ctx.moveTo(W, 0); ctx.lineTo(seamAt(0), 0);
    for (let y = 0; y <= H; y += 10) ctx.lineTo(seamAt(y), y);
    ctx.lineTo(W, H); ctx.closePath();
    let rg = ctx.createLinearGradient(Math.min(dividerX, W - 1), 0, W, 0);
    rg.addColorStop(0, 'rgba(255,26,140,0.72)'); rg.addColorStop(0.3, 'rgba(180,20,110,0.30)'); rg.addColorStop(1, '#160210');
    ctx.fillStyle = rg; ctx.fill();

    // seam glow
    ctx.beginPath();
    for (let y = 0; y <= H; y += 8) { const x = seamAt(y); y === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
    ctx.lineWidth = 9; ctx.strokeStyle = net >= 0 ? '#ffe2f1' : '#dffbff';
    ctx.shadowBlur = 55; ctx.shadowColor = net >= 0 ? G.B.color : G.A.color; ctx.stroke();
    ctx.lineWidth = 3; ctx.strokeStyle = '#fff'; ctx.shadowBlur = 18; ctx.stroke();
    ctx.shadowBlur = 0;

    // spawn seam particles toward the pushing direction
    const spawn = 1 + Math.round(slosh * 6);
    for (let i = 0; i < spawn; i++) {
      const y = Math.random() * H;
      const dir = net >= 0 ? -1 : 1;            // disco pushes left, techno pushes right
      sp.push({ x: seamAt(y), y, vx: dir * (2 + Math.random() * 6 + slosh * 6), vy: (Math.random() - 0.5) * 2.4,
        life: 1, decay: 0.010 + Math.random() * 0.02, size: 2 + Math.random() * 4.5, col: net >= 0 ? G.B.color : G.A.color });
    }
    if (sp.length > 320) sp.splice(0, sp.length - 320);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = sp.length - 1; i >= 0; i--) {
      const q = sp[i]; q.x += q.vx; q.y += q.vy; q.vx *= 0.985; q.life -= q.decay;
      if (q.life <= 0) { sp.splice(i, 1); continue; }
      ctx.globalAlpha = Math.max(0, q.life); ctx.fillStyle = q.col;
      ctx.beginPath(); ctx.arc(q.x, q.y, q.size * q.life, 0, 7); ctx.fill();
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';

    // DOM updates (throttled ~20fps)
    if (now - lastDom > 50) {
      lastDom = now;
      const tec = Math.round((1 - p) * 100);
      tecPct.textContent = tec; dscPct.textContent = 100 - tec;
      roundTxt.textContent = `ROUND ${s.round} · BEST OF ${s.bestOf}`;
      // score dots: 2 slots per side (first to 2)
      let html = '';
      for (let i = 0; i < 2; i++) html += `<i class="${i < s.scoreA ? 'a' : ''}"></i>`;
      html += '<span style="width:22px"></span>';
      for (let i = 0; i < 2; i++) html += `<i class="${i < s.scoreB ? 'b' : ''}"></i>`;
      scoreEl.innerHTML = html;
      hypeSmooth += (Math.min(1, (s.forceA + s.forceB) / 4.5) - hypeSmooth) * 0.15;
      hypeFill.style.width = (8 + hypeSmooth * 92) + '%';

      if (s.phase === 'sudden') {
        const g = G[s.suddenSide];
        suddenEl.dataset.on = '1'; suddenEl.style.color = g.color;
        suddenEl.innerHTML = `<span>⚡ ${g.name} · SUDDEN DEATH</span><span class="sd-count">${s.suddenRemain}</span>`;
      } else {
        suddenEl.dataset.on = '0';
      }
    }
  }
  requestAnimationFrame(loop);
})();
