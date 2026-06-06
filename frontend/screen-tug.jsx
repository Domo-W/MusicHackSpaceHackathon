/* ============================================================
   screen-tug.jsx — Screen 4: GENRE TUG-OF-WAR (phone)
   ============================================================ */
function useTug() {
  const [, force] = React.useState(0);
  const ref = React.useRef(window.Tug.getState());
  React.useEffect(() => {
    let raf = null;
    const off = window.Tug.on('tug', (s) => {
      ref.current = s;
      if (!raf) raf = requestAnimationFrame(() => { raf = null; force((n) => n + 1); });
    });
    return () => { off(); if (raf) cancelAnimationFrame(raf); };
  }, []);
  return ref.current;
}

function ScreenTug({ active }) {
  const G = window.Tug.GENRES;
  const t = useTug();
  const [side, setSide] = React.useState(() => {
    try { return localStorage.getItem('tug-side') || null; } catch (e) { return null; }
  });
  const canvasRef = React.useRef(null);
  const parts = React.useRef([]);
  const holdTimer = React.useRef(null);

  const pick = (s) => {
    setSide(s); try { localStorage.setItem('tug-side', s); } catch (e) {}
    haptic(26);
  };

  // ---- particles fly toward the user's side ----
  const burst = () => {
    const cv = canvasRef.current; if (!cv) return;
    const cx = cv.clientWidth / 2, cy = cv.clientHeight * 0.5;
    const dir = side === 'A' ? -1 : 1;
    const col = side === 'A' ? G.A.color : G.B.color;
    for (let i = 0; i < 7; i++) {
      parts.current.push({
        x: cx, y: cy + (Math.random() - 0.5) * 90,
        vx: dir * (3 + Math.random() * 6), vy: (Math.random() - 0.5) * 2.4,
        life: 1, decay: 0.018 + Math.random() * 0.02, size: 2 + Math.random() * 3.5, color: col,
      });
    }
    if (parts.current.length > 220) parts.current.splice(0, parts.current.length - 220);
  };

  const fire = () => { window.Tug.pull(side, 0.62); haptic(14); burst(); };
  const down = (e) => {
    e.preventDefault(); if (!side) return;
    fire();
    holdTimer.current = setInterval(fire, 110);   // holding = rapid auto-fire
  };
  const up = () => { if (holdTimer.current) { clearInterval(holdTimer.current); holdTimer.current = null; } };

  // ---- particle canvas loop ----
  React.useEffect(() => {
    const cv = canvasRef.current; if (!cv) return;
    const ctx = cv.getContext('2d');
    let raf;
    const resize = () => {
      const r = cv.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = r.width * dpr; cv.height = r.height * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize(); const ro = new ResizeObserver(resize); ro.observe(cv);
    const loop = () => {
      raf = requestAnimationFrame(loop);
      ctx.clearRect(0, 0, cv.clientWidth, cv.clientHeight);
      const ps = parts.current;
      for (let i = ps.length - 1; i >= 0; i--) {
        const p = ps[i]; p.x += p.vx; p.y += p.vy; p.vx *= 0.98; p.life -= p.decay;
        if (p.life <= 0) { ps.splice(i, 1); continue; }
        ctx.globalAlpha = Math.max(0, p.life); ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * p.life, 0, 7); ctx.fill();
      }
      ctx.globalAlpha = 1;
    };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); if (holdTimer.current) clearInterval(holdTimer.current); };
  }, [side]);

  // ---------- SIDE SELECT ----------
  if (!side) {
    return (
      <div className="screen tug">
        <div className="screen-kicker">GENRE TUG-OF-WAR</div>
        <h1 className="screen-title">PICK YOUR<br /><span className="accent">SIDE</span></h1>
        <p className="vibe-help">CHOOSE A TEAM TO JOIN THE BATTLE</p>
        <div className="side-pick thumb">
          {['A', 'B'].map((k) => (
            <button key={k} className="side-card" style={{ '--sc': G[k].color }} onClick={() => pick(k)}>
              <span className="side-team">TEAM {k}</span>
              <span className="side-name">{G[k].name}</span>
              <span className="side-tap">TAP TO JOIN →</span>
            </button>
          ))}
        </div>
        <a className="stage-link" href="THE SHOW — Stage.html" target="_blank" rel="noopener">OPEN STAGE / PROJECTOR VIEW ↗</a>
      </div>
    );
  }

  // ---------- BATTLE ----------
  const me = G[side], foe = G[side === 'A' ? 'B' : 'A'];
  const tecPct = Math.round((1 - t.p) * 100), dscPct = 100 - Math.round((1 - t.p) * 100);
  const myPct = side === 'A' ? tecPct : dscPct;
  const myMembers = side === 'A' ? t.membersA : t.membersB;
  // winning amount for THIS user: + = winning, - = losing
  const winAmt = side === 'A' ? (0.5 - t.p) * 2 : (t.p - 0.5) * 2;
  const winning = winAmt > 0.02;
  const edge = clamp(Math.abs(winAmt), 0, 1);

  const inSudden = t.phase === 'sudden';
  const mySudden = inSudden && t.suddenSide === side;       // I'm about to win
  const foeSudden = inSudden && t.suddenSide !== side;      // I'm about to lose

  return (
    <div className={'screen tug battle' + (winning ? ' winning' : '') + (foeSudden ? ' danger' : '')}
      style={{ '--me': me.color, '--foe': foe.color, '--edge': edge.toFixed(2) }}>

      {/* edge glow */}
      <div className="tug-edge" aria-hidden="true" />

      <div className="tug-head">
        <span className="screen-kicker">TUG-OF-WAR · ROUND {t.round}/{t.bestOf}</span>
        <a className="stage-link mini" href="THE SHOW — Stage.html" target="_blank" rel="noopener">STAGE ↗</a>
      </div>

      {/* rope indicator */}
      <div className="rope">
        <div className="rope-ends">
          <span className={'rope-end a' + (t.p < 0.5 ? ' lead' : '')}>{G.A.short} {tecPct}%</span>
          <span className={'rope-end b' + (t.p > 0.5 ? ' lead' : '')}>{dscPct}% {G.B.short}</span>
        </div>
        <div className="rope-bar">
          <span className="rope-center" />
          <span className="rope-knot" style={{ left: (t.p * 100) + '%' }} />
        </div>
      </div>

      {/* my team stat */}
      <div className="tug-stat">
        <span className="ts-team" style={{ color: me.color }}>● TEAM {me.name}</span>
        <span className="ts-members"><b>{myMembers}</b> PULLING</span>
      </div>

      {/* PULL zone (thumb) */}
      <div className="pull-zone thumb">
        <canvas ref={canvasRef} className="pull-canvas" />
        <button className="pull-btn" style={{ '--me': me.color }}
          onPointerDown={down} onPointerUp={up} onPointerLeave={up} onPointerCancel={up}
          onContextMenu={(e) => e.preventDefault()}>
          <span className="pull-arrow">{side === 'A' ? '←' : '→'}</span>
          <span className="pull-label">PULL</span>
          <span className="pull-sub">TAP FAST · OR HOLD</span>
        </button>
        <div className="pull-foot">
          <span className={winning ? 'win-txt' : 'lose-txt'}>
            {winning ? `${me.name} LEADING +${Math.round(edge * 100)}%` : (Math.abs(winAmt) < 0.02 ? 'DEAD EVEN' : `${foe.name} LEADING +${Math.round(edge * 100)}%`)}
          </span>
          <button className="switch-side" onClick={() => { setSide(null); try { localStorage.removeItem('tug-side'); } catch (e) {} }}>SWITCH SIDE</button>
        </div>
      </div>

      {/* SUDDEN DEATH overlay */}
      {inSudden && (
        <div className={'sudden' + (mySudden ? ' good' : ' bad')}>
          <span className="sudden-tag">⚠ SUDDEN DEATH</span>
          <span className="sudden-msg">{mySudden ? 'FINISH THEM' : 'PUSH BACK!'}</span>
          <span className="sudden-count">{t.suddenRemain}</span>
        </div>
      )}

      {/* WIN banner */}
      {t.phase === 'win' && (
        <div className="tug-win" style={{ '--wc': G[t.winner].color }}>
          <span className="tw-name">{G[t.winner].name}</span>
          <span className="tw-sub">{t.winIsMatch ? 'WINS THE MATCH' : 'WINS THE ROUND'}</span>
        </div>
      )}
    </div>
  );
}

window.ScreenTug = ScreenTug;
